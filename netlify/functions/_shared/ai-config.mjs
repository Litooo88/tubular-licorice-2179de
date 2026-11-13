// Läser/skriver AI Gateway-konfigurationen i storen "ai-gateway-config"
// (nyckel "current") och gör den aktiv för ai-auth/ai-oauth/ai-audit.
//
//   { clients: [ { id, label, secretHash, scopes, rpm, disabled } ],
//     signingSecret, ownerSecretHash, oauthScopes: [...], updatedAt, updatedBy }
//
// Ägar-PIN lagras som SHA-256-hash; signeringsnyckeln lagras i klartext (den
// behövs för HMAC) – samma skyddsnivå som övriga Blobs (privat lagring).
// Skrivs bara via POST /api/ai/config med x-admin-token (Sebastian).

import { randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { commitJson, createIfAbsent, readWithEtag } from "./case-store.mjs";
import { ALL_SCOPES, hashSecret, loadClients, sha256Hex } from "./ai-auth.mjs";
import { activeConfig, envConfig, setActiveConfig } from "./ai-config-state.mjs";

export const CONFIG_STORE = "ai-gateway-config";
export const CONFIG_KEY = "current";
export const CACHE_MS = 60 * 1000;
const clean = (value, max = 400) => String(value ?? "").trim().slice(0, max);
const store = () => getStore({ name: CONFIG_STORE, consistency: "strong" });
let cache = { at: 0 };

const toActive = (cfg) => ({
  source: "blobs",
  clientsRaw: JSON.stringify(Array.isArray(cfg?.clients) ? cfg.clients : []),
  signingSecret: clean(cfg?.signingSecret),
  ownerSecret: "",
  ownerSecretHash: clean(cfg?.ownerSecretHash, 80),
  oauthScopes: (Array.isArray(cfg?.oauthScopes) ? cfg.oauthScopes : []).join(" "),
  updatedAt: clean(cfg?.updatedAt, 40),
});

// Laddar från Blobs (cache 60 s) om env inte redan ger ett klientregister. Kastar aldrig.
export const ensureGatewayConfig = async ({ force = false, now = Date.now() } = {}) => {
  if (envConfig().clientsRaw) { setActiveConfig(null); return { source: "env" }; }
  if (!force && now - cache.at < CACHE_MS) return { source: "blobs", cached: true };
  try {
    const { item } = await readWithEtag(store(), CONFIG_KEY, { allowMissingEtag: true });
    setActiveConfig(item ? toActive(item) : null);
    cache = { at: now };
    return { source: item ? "blobs" : "none" };
  } catch (error) {
    console.error("ai-config: kunde inte läsa konfigurationen", { error: clean(error?.message, 120) });
    return { source: "error", error: clean(error?.message, 120) };
  }
};
export const resetConfigCache = () => { cache = { at: 0 }; setActiveConfig(null); };

// Status utan hemligheter.
export const configStatus = () => {
  const a = activeConfig();
  const registry = loadClients(a.clientsRaw);
  return {
    source: a.source,
    clients: registry.clients.map((c) => ({ id: c.id, label: c.label, scopes: c.scopes, rpm: c.rpm, disabled: c.disabled })),
    clientsOk: registry.ok,
    hasSigningSecret: Boolean(a.signingSecret),
    hasOwnerSecret: Boolean(a.ownerSecret || a.ownerSecretHash),
    oauthScopes: a.oauthScopes ? a.oauthScopes.split(/[\s,]+/).filter(Boolean) : ALL_SCOPES.filter((s) => s !== "admin:propose"),
    updatedAt: a.updatedAt || "",
    ready: registry.ok && Boolean(a.signingSecret),
    oauthReady: Boolean(a.signingSecret) && Boolean(a.ownerSecret || a.ownerSecretHash),
  };
};

// Sparar en patch versionerat. { ok, status } | { ok:false, error, description }.
//   clients: hela listan (ersätter) – poster { id, label?, secretHash | secret, scopes, rpm?, disabled? }
//   ownerPin: ny ägar-PIN (lagras som hash) | signingSecret: "generate" eller sträng ≥ 32 | oauthScopes: [...]
export const saveGatewayConfig = async (patch = {}, { by = "admin", now = Date.now() } = {}) => {
  const next = {};
  if (patch.clients !== undefined) {
    if (!Array.isArray(patch.clients)) return { ok: false, error: "invalid_clients", description: "clients ska vara en array." };
    const prepared = patch.clients.map((c) => ({
      id: clean(c?.id, 60), label: clean(c?.label, 80),
      secretHash: c?.secret ? hashSecret(String(c.secret)) : clean(c?.secretHash, 120),
      scopes: (Array.isArray(c?.scopes) ? c.scopes : []).filter((s) => ALL_SCOPES.includes(s)),
      rpm: Math.min(Math.max(Number(c?.rpm) || 60, 1), 600), disabled: c?.disabled === true,
    }));
    const check = loadClients(JSON.stringify(prepared));
    if (!check.ok) return { ok: false, error: "invalid_clients", description: check.reason };
    if (check.clients.length !== prepared.length) return { ok: false, error: "invalid_clients", description: "Minst en klient saknar giltigt id eller secretHash (sha256:<64 hex>)." };
    next.clients = prepared;
  }
  if (patch.ownerPin !== undefined) {
    const pin = clean(patch.ownerPin);
    if (pin.length < 12) return { ok: false, error: "invalid_owner_pin", description: "Ägar-PIN måste vara minst 12 tecken." };
    next.ownerSecretHash = `sha256:${sha256Hex(pin)}`;
  }
  if (patch.signingSecret !== undefined) {
    const value = patch.signingSecret === "generate" ? randomBytes(48).toString("base64url") : clean(patch.signingSecret);
    if (value.length < 32) return { ok: false, error: "invalid_signing_secret", description: "Signeringsnyckeln måste vara minst 32 tecken (eller \"generate\")." };
    next.signingSecret = value;
  }
  if (patch.oauthScopes !== undefined) {
    const scopes = (Array.isArray(patch.oauthScopes) ? patch.oauthScopes : String(patch.oauthScopes).split(/[\s,]+/)).map((s) => clean(s, 40)).filter((s) => ALL_SCOPES.includes(s));
    if (!scopes.length) return { ok: false, error: "invalid_scopes", description: `Tillåtna: ${ALL_SCOPES.join(", ")}` };
    next.oauthScopes = scopes;
  }
  if (!Object.keys(next).length) return { ok: false, error: "empty_patch", description: "Inget att spara." };
  const s = store();
  const existing = await readWithEtag(s, CONFIG_KEY, { allowMissingEtag: true });
  const build = (cur) => ({ ...(cur || {}), ...next, updatedAt: new Date(now).toISOString(), updatedBy: clean(by, 60) });
  let saved;
  if (!existing.item) {
    const created = await createIfAbsent(s, CONFIG_KEY, build({}));
    saved = created.created ? { ok: true, item: created.item } : await commitJson(s, CONFIG_KEY, build);
  } else {
    saved = await commitJson(s, CONFIG_KEY, build, { current: existing.item, etag: existing.etag });
  }
  if (!saved.ok) return { ok: false, error: "storage", description: `Kunde inte spara (${saved.reason}).` };
  setActiveConfig(toActive(saved.item));
  cache = { at: now };
  return { ok: true, status: configStatus() };
};
