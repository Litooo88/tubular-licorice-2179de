// Revisionslogg och anropsfrekvens för NEMOB AI Gateway.
//
// Varje verktygsanrop från en AI-klient loggas i storen "ai-gateway-audit":
// vem (klient-id, autentiseringssätt), vad (verktyg), med vilka argument
// (telefonnummer maskerade, aldrig fritext från kunddata), utfall, antal
// träffar och tid. Aldrig hemligheter. Gallras efter 180 dagar.
//
// Rate limit: räknare per klient och minut i storen "ai-gateway-ratelimit"
// (versionerad skrivning via commitJson/createIfAbsent så att två parallella
// anrop inte räknar fel). Standard 60 anrop/min per klient (klientens `rpm`).

import { createHash, createHmac } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { commitJson, createIfAbsent, safeKey, stampKey } from "./case-store.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

export const AUDIT_STORE = "ai-gateway-audit";
export const RATE_STORE = "ai-gateway-ratelimit";
export const AUDIT_RETENTION_DAYS = 180;

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
export const maskPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return digits ? "***" : "";
  return `${digits.slice(0, 3)}…${digits.slice(-3)}`;
};

// IP lagras aldrig i klartext: HMAC med signeringsnyckeln och dagens datum
// som salt (samma IP ger samma hash inom ett dygn – räcker för att se
// missbruksmönster, går inte att vända).
export const hashIp = (ip, now = Date.now()) => {
  const value = clean(ip, 64);
  if (!value) return "";
  const salt = `${env("AI_GATEWAY_SIGNING_SECRET") || "nemob"}:${new Date(now).toISOString().slice(0, 10)}`;
  return createHmac("sha256", salt).update(value).digest("hex").slice(0, 16);
};

// Fritext (sökfrågor, anteckningar) kan innehålla namn, e-post eller nummer.
// Lagras bara som form + kort hash: nog för att korrelera upprepade anrop,
// aldrig för att läsa ut vad som söktes.
const FREE_TEXT_KEYS = /^(query|note|message|text|name|email)$/i;
const describeText = (value) => {
  const text = String(value);
  const digits = text.replace(/\D/g, "");
  const kind = digits.length >= 6 && digits.length >= text.replace(/\s/g, "").length * 0.6 ? "phone" : /@/.test(text) ? "email" : /^NE-?\d+/i.test(text.trim()) ? "service_number" : "text";
  return { kind, len: text.length, hash: createHash("sha256").update(text.trim().toLowerCase()).digest("hex").slice(0, 12) };
};

// Argument i loggbar form: nycklar behålls, telefonliknande värden maskeras,
// fritext blir form + hash, enum/datum/tal behålls.
export const summarizeArgs = (args = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (value === undefined || value === null) continue;
    if (FREE_TEXT_KEYS.test(key) && typeof value === "string") out[key] = describeText(value);
    else if (/phone|number|tel|from|to/i.test(key) && /^[+\d\s-]{6,}$/.test(String(value))) out[key] = maskPhone(value);
    else if (typeof value === "string") out[key] = clean(value, 40);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else out[key] = clean(JSON.stringify(value), 40);
  }
  return out;
};

export const writeAudit = async ({ client, via = "", tool, args = {}, ok = true, status = 200, count = null, durationMs = 0, error = "", transport = "rest", ip = "" } = {}) => {
  const at = new Date().toISOString();
  const entry = {
    at, client: clean(client, 60), via: clean(via, 20), transport: clean(transport, 10), tool: clean(tool, 60),
    args: summarizeArgs(args), ok: Boolean(ok), status: Number(status) || 0,
    count: count === null ? null : Number(count) || 0, durationMs: Math.round(Number(durationMs) || 0),
    error: clean(error, 160), ipHash: hashIp(ip),
  };
  try {
    await getStore({ name: AUDIT_STORE, consistency: "strong" }).setJSON(safeKey(stampKey(new Date(at)), entry.client, Math.random().toString(36).slice(2, 7)), entry);
  } catch (error) {
    console.error("ai-gateway audit write failed", { error: clean(error?.message, 120) });
  }
  console.log("ai_gateway_call", JSON.stringify({ client: entry.client, tool: entry.tool, ok: entry.ok, status: entry.status, count: entry.count, durationMs: entry.durationMs }));
  return entry;
};

// { allowed, remaining, limit, resetAt, unavailable? }. Kastar aldrig. Faller
// lagringen nekas anropet (fail-closed): en externt nåbar gateway med kunddata
// får inte bli obegränsad för att räknaren inte går att läsa.
export const checkRateLimit = async ({ client, limit = 60, now = Date.now() } = {}) => {
  const minute = Math.floor(now / 60000);
  const key = safeKey(clean(client, 60), String(minute));
  const resetAt = new Date((minute + 1) * 60000).toISOString();
  try {
    const store = getStore({ name: RATE_STORE, consistency: "strong" });
    const created = await createIfAbsent(store, key, { client, minute, count: 1 });
    if (created.created) return { allowed: true, remaining: limit - 1, limit, resetAt };
    if (!created.verified) return { allowed: false, remaining: 0, limit, resetAt, unavailable: true, reason: "unverified_create" };
    const bumped = await commitJson(store, key, (row) => ({ ...row, count: (Number(row.count) || 0) + 1 }), { current: created.item, etag: created.etag });
    // Varje misslyckat resultat (conflict efter omförsök, storage_error,
    // unversioned, not_found) nekar: utan verifierad räkning finns ingen gräns.
    if (!bumped.ok) {
      console.error("ai-gateway ratelimit counter failed", { reason: bumped.reason });
      return { allowed: false, remaining: 0, limit, resetAt, unavailable: true, reason: bumped.reason };
    }
    const count = Number(bumped.item.count) || 0;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit, resetAt };
  } catch (error) {
    console.error("ai-gateway ratelimit unavailable", { error: clean(error?.message, 120) });
    return { allowed: false, remaining: 0, limit, resetAt, unavailable: true, reason: "threw" };
  }
};

export const readAudit = async ({ limit = 100 } = {}) => {
  const store = getStore({ name: AUDIT_STORE, consistency: "strong" });
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined).catch(() => ({ blobs: [] }));
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  const recent = keys.sort().slice(-limit);
  const rows = await Promise.all(recent.map((k) => store.get(k, { type: "json" }).catch(() => null)));
  return rows.filter(Boolean).reverse();
};

export const pruneAudit = async (now = Date.now()) => {
  const store = getStore({ name: AUDIT_STORE, consistency: "strong" });
  const cutoff = stampKey(new Date(now - AUDIT_RETENTION_DAYS * 86400000));
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  let pruned = 0;
  for (const blob of blobs || []) if (blob.key < cutoff) { await store.delete(blob.key).catch(() => {}); pruned += 1; }
  return pruned;
};
