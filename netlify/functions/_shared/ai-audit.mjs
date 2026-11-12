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

import { getStore } from "@netlify/blobs";
import { commitJson, createIfAbsent, safeKey, stampKey } from "./case-store.mjs";

export const AUDIT_STORE = "ai-gateway-audit";
export const RATE_STORE = "ai-gateway-ratelimit";
export const AUDIT_RETENTION_DAYS = 180;

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
export const maskPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return digits ? "***" : "";
  return `${digits.slice(0, 3)}…${digits.slice(-3)}`;
};

// Argument i loggbar form: nycklar behålls, telefonliknande värden maskeras,
// fritext förkortas och hashas inte (den är sökfrågan, inte kunddata).
export const summarizeArgs = (args = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (value === undefined || value === null) continue;
    if (/phone|number|tel|from|to/i.test(key) && /^[+\d\s-]{6,}$/.test(String(value))) out[key] = maskPhone(value);
    else if (typeof value === "string") out[key] = clean(value, 80);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else out[key] = clean(JSON.stringify(value), 80);
  }
  return out;
};

export const writeAudit = async ({ client, via = "", tool, args = {}, ok = true, status = 200, count = null, durationMs = 0, error = "", transport = "rest", ip = "" } = {}) => {
  const at = new Date().toISOString();
  const entry = {
    at, client: clean(client, 60), via: clean(via, 20), transport: clean(transport, 10), tool: clean(tool, 60),
    args: summarizeArgs(args), ok: Boolean(ok), status: Number(status) || 0,
    count: count === null ? null : Number(count) || 0, durationMs: Math.round(Number(durationMs) || 0),
    error: clean(error, 160), ipHash: ip ? clean(ip, 64) : "",
  };
  try {
    await getStore({ name: AUDIT_STORE, consistency: "strong" }).setJSON(safeKey(stampKey(new Date(at)), entry.client, Math.random().toString(36).slice(2, 7)), entry);
  } catch (error) {
    console.error("ai-gateway audit write failed", { error: clean(error?.message, 120) });
  }
  console.log("ai_gateway_call", JSON.stringify({ client: entry.client, tool: entry.tool, ok: entry.ok, status: entry.status, count: entry.count, durationMs: entry.durationMs }));
  return entry;
};

// { allowed, remaining, limit, resetAt }. Kastar aldrig: faller lagringen
// släpps anropet igenom (rate limit är skydd mot missbruk, inte en spärr som
// får stoppa verksamheten) och felet loggas.
export const checkRateLimit = async ({ client, limit = 60, now = Date.now() } = {}) => {
  const minute = Math.floor(now / 60000);
  const key = safeKey(clean(client, 60), String(minute));
  const resetAt = new Date((minute + 1) * 60000).toISOString();
  try {
    const store = getStore({ name: RATE_STORE, consistency: "strong" });
    const created = await createIfAbsent(store, key, { client, minute, count: 1 });
    if (created.created) return { allowed: true, remaining: limit - 1, limit, resetAt };
    const bumped = await commitJson(store, key, (row) => ({ ...row, count: (Number(row.count) || 0) + 1 }), { current: created.item, etag: created.etag });
    const count = bumped.ok ? bumped.item.count : (Number(created.item?.count) || 0) + 1;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit, resetAt };
  } catch (error) {
    console.error("ai-gateway ratelimit unavailable", { error: clean(error?.message, 120) });
    return { allowed: true, remaining: limit, limit, resetAt, degraded: true };
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
