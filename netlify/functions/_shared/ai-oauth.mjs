// OAuth 2.1 authorization code + PKCE + dynamisk klientregistrering (RFC 7591)
// för NEMOB AI Gateway – det ChatGPT:s och claude.ai:s MCP-connectors kräver.
//
// Flöde:
//   1. Klienten (ChatGPT) läser /.well-known/oauth-protected-resource och
//      /.well-known/oauth-authorization-server.
//   2. POST /api/ai/oauth/register → client_id (publik klient, PKCE krävs,
//      inga hemligheter). Dynamiska klienter får INGA scopes av sig själva.
//   3. GET /api/ai/oauth/authorize → samtyckessida där ÄGAREN (Sebastian)
//      anger ägar-PIN (env AI_GATEWAY_OWNER_SECRET, aldrig ADMIN_TOKEN) och
//      väljer scopes (taket sätts av env AI_GATEWAY_OAUTH_SCOPES).
//   4. POST samtycke → engångskod (5 min) → redirect med code & state.
//   5. POST /api/ai/oauth/token grant_type=authorization_code + code_verifier
//      → åtkomsttoken (HMAC, 60 min) + refresh token (roteras, 30 dagar).
//
// Lagring: store "ai-oauth" (client_*, code_*, refresh_*). Koder och refresh
// tokens lagras som SHA-256-hash. Allt är fail-closed utan ägar-PIN och
// signeringsnyckel. Samtyckesförsök är frekvensbegränsade per IP-hash.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { claimJson, commitJson, createIfAbsent, readWithEtag, safeKey } from "./case-store.mjs";
import { ALL_SCOPES, issueToken, SCOPES } from "./ai-auth.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
export const OAUTH_STORE = "ai-oauth";
export const CODE_TTL_MS = 5 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 86400000;
const store = () => getStore({ name: OAUTH_STORE, consistency: "strong" });
const sha256 = (v) => createHash("sha256").update(String(v)).digest();
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const hashKey = (v) => createHash("sha256").update(String(v)).digest("hex");

export const ownerSecretConfigured = () => Boolean(clean(env("AI_GATEWAY_OWNER_SECRET"), 400));
const ownerMatches = (pin) => {
  const expected = Buffer.from(clean(env("AI_GATEWAY_OWNER_SECRET"), 400));
  const provided = Buffer.from(clean(pin, 400));
  return expected.length > 0 && expected.length === provided.length && timingSafeEqual(expected, provided);
};
// Scopes som dynamiska klienter högst kan få (ägaren väljer vid samtycke).
export const allowedOauthScopes = () => {
  const configured = clean(env("AI_GATEWAY_OAUTH_SCOPES"), 400).split(/[\s,]+/).filter((s) => ALL_SCOPES.includes(s));
  return configured.length ? configured : ["cases:read", "calls:read", "overview:read", "presence:read", "presence:write"];
};

const validRedirect = (uri) => {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch { return false; }
};

// RFC 7591. { ok, client } | { ok:false, error, description }
export const registerClient = async (body = {}) => {
  const redirectUris = (Array.isArray(body.redirect_uris) ? body.redirect_uris : []).map((u) => clean(u, 500)).filter(validRedirect).slice(0, 10);
  if (!redirectUris.length) return { ok: false, error: "invalid_redirect_uri", description: "Minst en https- eller localhost-redirect_uri krävs." };
  const grants = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code"];
  if (grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) return { ok: false, error: "invalid_client_metadata", description: "Bara authorization_code och refresh_token stöds." };
  const client = {
    client_id: `dyn_${randomBytes(12).toString("hex")}`,
    client_name: clean(body.client_name, 120) || "AI-klient",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    created_at: new Date().toISOString(),
  };
  const created = await createIfAbsent(store(), `client_${client.client_id}`, client);
  if (!created.created) return { ok: false, error: "server_error", description: "Kunde inte registrera klienten." };
  return { ok: true, client };
};

// Återkallade klienter räknas som obefintliga: inga nya koder, inga refresh,
// och gatewayen avvisar deras åtkomsttoken vid nästa anrop.
export const getDynamicClient = async (clientId, { includeRevoked = false } = {}) => {
  const id = clean(clientId, 80);
  if (!/^dyn_[0-9a-f]{24}$/.test(id)) return null;
  const item = (await readWithEtag(store(), `client_${id}`, { allowMissingEtag: true })).item;
  if (!item) return null;
  if (item.revoked && !includeRevoked) return null;
  return item;
};

// Ägaren återkallar en dynamisk klient (ChatGPT-connector etc.). Kräver ägar-PIN.
// Åtkomsttoken (max 60 min) avvisas från nästa anrop, refresh nekas direkt.
export const revokeDynamicClient = async ({ clientId, ownerPin, reason = "", now = Date.now() } = {}) => {
  if (!ownerSecretConfigured()) return { ok: false, status: 503, error: "AI_GATEWAY_OWNER_SECRET saknas." };
  if (!ownerMatches(ownerPin)) return { ok: false, status: 401, error: "Fel ägar-PIN." };
  const id = clean(clientId, 80);
  const key = `client_${id}`;
  const existing = await readWithEtag(store(), key, { allowMissingEtag: true });
  if (!existing.item) return { ok: false, status: 404, error: "Okänd klient." };
  const saved = await commitJson(store(), key, (row) => ({ ...row, revoked: true, revokedAt: new Date(now).toISOString(), revokeReason: clean(reason, 120) }), { current: existing.item, etag: existing.etag });
  if (!saved.ok) return { ok: false, status: 503, error: "Återkallelsen kunde inte sparas säkert." };
  return { ok: true, client: saved.item };
};

export const listDynamicClients = async () => {
  const s = store();
  const { blobs } = await s.list({ prefix: "client_" }).catch(() => ({ blobs: [] }));
  const rows = await Promise.all((blobs || []).map((b) => s.get(b.key, { type: "json" }).catch(() => null)));
  return rows.filter(Boolean).map((c) => ({ client_id: c.client_id, client_name: c.client_name, created_at: c.created_at, revoked: Boolean(c.revoked), revokedAt: c.revokedAt || "" }));
};

// Validerar en authorize-förfrågan. { ok, client, redirectUri, scopes, state, challenge } | { ok:false, error, description }
export const validateAuthorizeRequest = async (params) => {
  const client = await getDynamicClient(params.get("client_id"));
  if (!client) return { ok: false, error: "invalid_client", description: "Okänd client_id." };
  const redirectUri = clean(params.get("redirect_uri"), 500);
  if (!client.redirect_uris.includes(redirectUri)) return { ok: false, error: "invalid_request", description: "redirect_uri är inte registrerad." };
  if (clean(params.get("response_type"), 20) !== "code") return { ok: false, error: "unsupported_response_type", description: "Bara response_type=code." };
  const challenge = clean(params.get("code_challenge"), 200);
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || clean(params.get("code_challenge_method"), 10) !== "S256") return { ok: false, error: "invalid_request", description: "PKCE med S256 krävs." };
  const requested = clean(params.get("scope"), 400).split(/[\s,]+/).filter(Boolean);
  const allowed = allowedOauthScopes();
  const scopes = (requested.length ? requested : allowed).filter((s) => allowed.includes(s));
  if (!scopes.length) return { ok: false, error: "invalid_scope", description: `Tillåtna scopes: ${allowed.join(" ")}` };
  return { ok: true, client, redirectUri, scopes, state: clean(params.get("state"), 500), challenge };
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const consentPage = ({ client, redirectUri, scopes, state, challenge, error = "" }) => `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Godkänn AI-klient – NEMOB</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#111}label{display:block;margin:8px 0}input[type=password]{width:100%;padding:10px;font-size:16px}button{background:#00c853;border:0;border-radius:8px;padding:12px 18px;font-weight:700;font-size:16px}.err{color:#b00020}.muted{color:#555;font-size:14px}</style></head><body>
<h1>Ge <em>${escapeHtml(client.client_name)}</em> åtkomst till NEMOB?</h1>
<p class="muted">Klienten får bara de scopes du bockar för. Inga kundutskick, inga godkännanden – och telefonroutingen ändras inte av presence förrän den är aktiverad separat.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<form method="post">
<input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}"><input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}"><input type="hidden" name="state" value="${escapeHtml(state)}"><input type="hidden" name="code_challenge" value="${escapeHtml(challenge)}">
<fieldset><legend>Behörigheter</legend>${scopes.map((s) => `<label><input type="checkbox" name="scope" value="${escapeHtml(s)}" checked> <code>${escapeHtml(s)}</code> – ${escapeHtml(SCOPES[s] || "")}</label>`).join("")}</fieldset>
<label>Ägar-PIN<input type="password" name="owner_pin" autocomplete="one-time-code" required></label>
<p><button type="submit">Godkänn</button></p>
<p class="muted">Redirect: <code>${escapeHtml(redirectUri)}</code></p>
</form></body></html>`;

// Samtycke: verifierar ägar-PIN och utfärdar engångskod. { ok, redirect } | { ok:false, status, error }
export const grantConsent = async (form, { now = Date.now() } = {}) => {
  if (!ownerSecretConfigured()) return { ok: false, status: 503, error: "AI_GATEWAY_OWNER_SECRET saknas – samtycke är avstängt." };
  if (!ownerMatches(form.owner_pin)) return { ok: false, status: 401, error: "Fel ägar-PIN." };
  const client = await getDynamicClient(form.client_id);
  const redirectUri = clean(form.redirect_uri, 500);
  if (!client || !client.redirect_uris.includes(redirectUri)) return { ok: false, status: 400, error: "Ogiltig klient eller redirect." };
  const allowed = allowedOauthScopes();
  const chosen = (Array.isArray(form.scope) ? form.scope : [form.scope]).map((s) => clean(s, 40)).filter((s) => allowed.includes(s));
  if (!chosen.length) return { ok: false, status: 400, error: "Välj minst ett scope." };
  const challenge = clean(form.code_challenge, 200);
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return { ok: false, status: 400, error: "PKCE-utmaning saknas." };
  const code = randomBytes(32).toString("base64url");
  await createIfAbsent(store(), `code_${hashKey(code)}`, { clientId: client.client_id, redirectUri, challenge, scopes: chosen, exp: now + CODE_TTL_MS, used: false });
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (form.state) url.searchParams.set("state", clean(form.state, 500));
  return { ok: true, redirect: url.toString(), scopes: chosen };
};

const dynamicPrincipalClient = (client, scopes) => ({ id: `oauth:${client.client_id}`, label: client.client_name, scopes, rpm: 60 });

// Byter kod (+ PKCE) mot tokens. { ok, access_token, token_type, expires_in, scope, refresh_token } | { ok:false, error, description }
export const exchangeCode = async ({ code, clientId, redirectUri, codeVerifier, now = Date.now() } = {}) => {
  const key = `code_${hashKey(clean(code, 200))}`;
  // Engångs: reservera posten villkorat så att två parallella byten inte båda lyckas.
  const claim = await claimJson(store(), key, { by: "token", now, staleMs: 10 * 60 * 1000 });
  if (!claim.ok) return { ok: false, error: "invalid_grant", description: "Koden är okänd eller redan använd." };
  const row = claim.item;
  if (row.used || Number(row.exp) <= now) return { ok: false, error: "invalid_grant", description: "Koden har gått ut eller är använd." };
  if (row.clientId !== clean(clientId, 80) || row.redirectUri !== clean(redirectUri, 500)) return { ok: false, error: "invalid_grant", description: "client_id eller redirect_uri matchar inte koden." };
  const verifier = clean(codeVerifier, 200);
  const verified = /^[A-Za-z0-9_.~-]{43,128}$/.test(verifier) && b64u(sha256(verifier)) === row.challenge;
  // Koden förbrukas VERSIONERAT och FÖRE utfärdande, även vid fel verifierare
  // (skydd mot gissning). Går markeringen inte att spara utfärdas inget.
  const consumed = await commitJson(store(), key, (fresh) => ({ ...fresh, used: true, usedAt: new Date(now).toISOString(), verified }), { current: row, etag: claim.etag });
  if (!consumed.ok) return { ok: false, error: "temporarily_unavailable", description: "Koden kunde inte förbrukas säkert. Inget utfärdades." };
  if (!verified) return { ok: false, error: "invalid_grant", description: "PKCE-verifieraren matchar inte." };
  const client = await getDynamicClient(row.clientId);
  if (!client) return { ok: false, error: "invalid_client" };
  const issued = issueToken({ client: dynamicPrincipalClient(client, row.scopes), scopes: row.scopes, now });
  if (!issued.ok) return issued;
  const refresh = randomBytes(32).toString("base64url");
  await createIfAbsent(store(), `refresh_${hashKey(refresh)}`, { clientId: client.client_id, scopes: row.scopes, exp: now + REFRESH_TTL_MS, rotatedFrom: "" });
  const { ok, ...tokens } = issued;
  return { ok: true, ...tokens, refresh_token: refresh };
};

export const refreshTokens = async ({ refreshToken, clientId, now = Date.now() } = {}) => {
  const key = `refresh_${hashKey(clean(refreshToken, 200))}`;
  const claim = await claimJson(store(), key, { by: "refresh", now, staleMs: 60 * 1000 });
  if (!claim.ok) return { ok: false, error: "invalid_grant", description: "Refresh token är okänd eller används just nu." };
  const row = claim.item;
  if (row.revoked || Number(row.exp) <= now || row.clientId !== clean(clientId, 80)) return { ok: false, error: "invalid_grant", description: "Refresh token är ogiltig." };
  const client = await getDynamicClient(row.clientId);
  if (!client) return { ok: false, error: "invalid_grant", description: "Klienten är återkallad eller okänd." };
  // Ordning (fail-closed): 1) återkalla den gamla tokenen VERSIONERAT, 2) skapa
  // den nya, 3) utfärda. Misslyckas steg 1 utfärdas inget och den gamla
  // tokenen är fortfarande reserverad – ett lagringsfel kan aldrig lämna en
  // återanvändbar refresh token. Misslyckas steg 2/3 är den gamla redan
  // återkallad: klienten får gå via samtycket igen (säkert, inte dubbelt).
  const revoked = await commitJson(store(), key, (fresh) => (fresh.revoked ? null : { ...fresh, revoked: true, revokedAt: new Date(now).toISOString(), rotating: true }), { current: row, etag: claim.etag });
  if (!revoked.ok) {
    console.error("ai-oauth: refresh-återkallelse misslyckades", { reason: revoked.reason });
    return { ok: false, error: "temporarily_unavailable", description: "Refresh token kunde inte roteras säkert. Försök igen." };
  }
  const next = randomBytes(32).toString("base64url");
  const created = await createIfAbsent(store(), `refresh_${hashKey(next)}`, { clientId: client.client_id, scopes: row.scopes, exp: now + REFRESH_TTL_MS, rotatedFrom: key }).catch(() => ({ created: false }));
  if (!created.created) return { ok: false, error: "temporarily_unavailable", description: "Ny refresh token kunde inte sparas. Den gamla är återkallad – gör om samtycket." };
  const issued = issueToken({ client: dynamicPrincipalClient(client, row.scopes), scopes: row.scopes, now });
  if (!issued.ok) return issued;
  const { ok, ...tokens } = issued;
  return { ok: true, ...tokens, refresh_token: next };
};

export const authorizationServerMetadata = (issuer) => ({
  issuer,
  authorization_endpoint: `${issuer}/api/ai/oauth/authorize`,
  token_endpoint: `${issuer}/api/ai/oauth/token`,
  registration_endpoint: `${issuer}/api/ai/oauth/register`,
  scopes_supported: allowedOauthScopes(),
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
});
export const protectedResourceMetadata = (issuer) => ({
  resource: `${issuer}/api/ai/mcp`,
  authorization_servers: [issuer],
  scopes_supported: allowedOauthScopes(),
  bearer_methods_supported: ["header"],
  resource_name: "NEMOB AI Gateway",
});
export const pkceChallenge = (verifier) => b64u(sha256(verifier)); // för tester
