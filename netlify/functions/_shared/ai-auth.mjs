// Autentisering för NEMOB AI Gateway – separat från ADMIN_TOKEN.
//
// Klienter (ChatGPT, Claude, Grok …) får egna identiteter med egna scopes.
// Registret ligger server-side i env AI_GATEWAY_CLIENTS (JSON-array):
//   [{ "id": "claude", "secretHash": "sha256:<hex>", "scopes": ["cases:read", …], "rpm": 60, "label": "Claude Desktop" }]
// Hemligheten lagras ALDRIG i klartext på servern – bara SHA-256-hashen.
// Skapa en klient lokalt med `node scripts/ai-gateway-client.mjs <id> <scopes…>`.
//
// Två sätt att autentisera:
//   1. API-nyckel: `Authorization: Bearer <id>.<secret>` (klienter som kan sätta
//      en egen header: Claude Desktop/Code MCP-konfig, ChatGPT Actions, egna skript).
//   2. OAuth 2.0 client credentials: `POST /api/ai/oauth/token` med
//      client_id/client_secret (+ valfritt scope) → kortlivad åtkomsttoken
//      (HMAC-signerad med AI_GATEWAY_SIGNING_SECRET, 60 min). Används av klienter
//      som bara kan göra client-credentials. Authorization-code-flödet (det
//      claude.ai- och ChatGPT-connectors kräver) finns inte än – se docs.
//
// Fail-closed: saknas registret eller signeringsnyckeln svarar gatewayen 503.
// Alla jämförelser är tidssäkra. Scopes är en vitlista: ett verktyg körs bara
// om klientens scopes (eller tokenens, som är en delmängd) innehåller verktygets.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

export const SCOPES = Object.freeze({
  "cases:read": "Läsa kundärenden (behöriga fält).",
  "calls:read": "Läsa 46elks samtalshistorik.",
  "overview:read": "Läsa verksamhetsöversikt och godkännandekö.",
  "presence:read": "Läsa Sebastians tillgänglighet och routing.",
  "presence:write": "Ändra tillgänglighet (routing i dry-run tills den är godkänd).",
  "admin:propose": "Föreslå godkännandepliktiga åtgärder (utför aldrig).",
});
export const ALL_SCOPES = Object.keys(SCOPES);
export const TOKEN_TTL_SECONDS = 60 * 60;
const TOKEN_PREFIX = "nemob1";

export const sha256Hex = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
export const hashSecret = (secret) => `sha256:${sha256Hex(secret)}`;
export const newSecret = () => randomBytes(32).toString("base64url");

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

// Läser klientregistret. { ok, clients } eller { ok: false, reason }.
export const loadClients = (raw = env("AI_GATEWAY_CLIENTS")) => {
  if (!clean(raw, 50000)) return { ok: false, reason: "AI_GATEWAY_CLIENTS saknas", clients: [] };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: "AI_GATEWAY_CLIENTS är inte giltig JSON", clients: [] }; }
  if (!Array.isArray(parsed)) return { ok: false, reason: "AI_GATEWAY_CLIENTS ska vara en JSON-array", clients: [] };
  const clients = parsed
    .map((c) => ({
      id: clean(c?.id, 60).replace(/[^A-Za-z0-9_-]/g, ""),
      label: clean(c?.label, 80),
      secretHash: clean(c?.secretHash, 120),
      scopes: (Array.isArray(c?.scopes) ? c.scopes : []).map((s) => clean(s, 40)).filter((s) => ALL_SCOPES.includes(s)),
      rpm: Math.min(Math.max(Number(c?.rpm) || 60, 1), 600),
      disabled: c?.disabled === true,
    }))
    .filter((c) => c.id && /^sha256:[0-9a-f]{64}$/.test(c.secretHash));
  return { ok: clients.length > 0, reason: clients.length ? "" : "inga giltiga klienter i AI_GATEWAY_CLIENTS", clients };
};

export const findClient = (clients, id) => clients.find((c) => c.id === id && !c.disabled) || null;

// Verifierar <id>.<secret>. Returnerar klienten eller null.
export const verifyApiKey = (clients, key) => {
  const value = clean(key, 400);
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const client = findClient(clients, value.slice(0, dot));
  if (!client) return null;
  return safeEqual(hashSecret(value.slice(dot + 1)), client.secretHash) ? client : null;
};

// --- OAuth 2.0 client credentials → HMAC-signerad token -------------------
const signingSecret = () => clean(env("AI_GATEWAY_SIGNING_SECRET"), 400);
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sign = (payloadB64, secret) => createHmac("sha256", secret).update(`${TOKEN_PREFIX}.${payloadB64}`).digest("base64url");

export const issueToken = ({ client, scopes, now = Date.now(), ttlSeconds = TOKEN_TTL_SECONDS, secret = signingSecret() } = {}) => {
  if (!secret) return { ok: false, error: "server_error", description: "AI_GATEWAY_SIGNING_SECRET saknas" };
  const granted = (scopes && scopes.length ? scopes : client.scopes).filter((s) => client.scopes.includes(s));
  if (!granted.length) return { ok: false, error: "invalid_scope", description: "Inget av de begärda scopen är tillåtet för klienten." };
  const payload = { sub: client.id, scp: granted, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttlSeconds, jti: randomBytes(8).toString("hex") };
  const payloadB64 = b64u(JSON.stringify(payload));
  return { ok: true, access_token: `${TOKEN_PREFIX}.${payloadB64}.${sign(payloadB64, secret)}`, token_type: "Bearer", expires_in: ttlSeconds, scope: granted.join(" ") };
};

export const verifyToken = (token, { clients, now = Date.now(), secret = signingSecret() } = {}) => {
  const value = clean(token, 2000);
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !secret) return null;
  if (!safeEqual(sign(parts[1], secret), parts[2])) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
  if (!payload || typeof payload !== "object" || Number(payload.exp) * 1000 <= now) return null;
  const client = findClient(clients, clean(payload.sub, 60));
  if (!client) return null;
  const scopes = (Array.isArray(payload.scp) ? payload.scp : []).filter((s) => client.scopes.includes(s));
  return { client, scopes, exp: Number(payload.exp), jti: clean(payload.jti, 32), via: "oauth_token" };
};

// Autentiserar en Request. { ok, principal: { client, scopes, via } } eller { ok: false, status, error }.
export const authenticate = (request, { clients = null, now = Date.now() } = {}) => {
  const registry = clients ? { ok: clients.length > 0, clients } : loadClients();
  if (!registry.ok) return { ok: false, status: 503, error: "not_configured", description: registry.reason || "AI Gateway är inte konfigurerad." };
  const header = clean(request.headers.get("authorization"), 2100);
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401, error: "unauthorized", description: "Authorization: Bearer <client_id>.<secret> eller en åtkomsttoken krävs." };
  const credential = match[1].trim();
  if (credential.startsWith(`${TOKEN_PREFIX}.`)) {
    const verified = verifyToken(credential, { clients: registry.clients, now });
    if (!verified) return { ok: false, status: 401, error: "invalid_token", description: "Token är ogiltig eller har gått ut." };
    return { ok: true, principal: verified };
  }
  const client = verifyApiKey(registry.clients, credential);
  if (!client) return { ok: false, status: 401, error: "unauthorized", description: "Okänd klient eller fel hemlighet." };
  return { ok: true, principal: { client, scopes: client.scopes, via: "api_key" } };
};

export const hasScope = (principal, scope) => Boolean(principal?.scopes?.includes(scope));
