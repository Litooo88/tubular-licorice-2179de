// NEMOB AI Gateway – en säker ingång för AI-assistenter (ChatGPT, Claude, Grok …)
// ovanpå befintliga Netlify Functions och datakällor. Ingen kopia av kunddata.
//
// Rutter (alla kräver egen klientauth, aldrig ADMIN_TOKEN – se _shared/ai-auth.mjs):
//   POST /api/ai/mcp               MCP Streamable HTTP (JSON-RPC 2.0, utan SSE):
//                                   initialize, notifications/initialized, ping, tools/list, tools/call
//   GET  /api/ai/tools              verktygslista (REST)
//   POST /api/ai/tools/:name        kör ett verktyg (REST), body = argument
//   GET  /api/ai/whoami             klient, scopes, autentiseringssätt
//   POST /api/ai/oauth/token        OAuth 2.0 client credentials → åtkomsttoken
//   GET  /api/ai/openapi.json       OpenAPI 3.1 för ChatGPT Actions (publik, bara schema)
//   GET  /api/ai/.well-known        metadata (publik): vilka flöden som stöds
//
// Varje verktygsanrop: auth → scope → rate limit → validering → körning →
// revisionslogg. Fel svarar med stabila koder (not_configured 503, unauthorized
// 401, forbidden_scope 403, rate_limited 429, invalid_arguments 400).

import { authenticate, hasScope, issueToken, loadClients, SCOPES, verifyApiKey } from "./_shared/ai-auth.mjs";
import { checkRateLimit, writeAudit } from "./_shared/ai-audit.mjs";
import { TOOLS, toolByName, validateArgs } from "./_shared/ai-tools.mjs";
import { authorizationServerMetadata, consentPage, exchangeCode, grantConsent, protectedResourceMetadata, refreshTokens, registerClient, validateAuthorizeRequest } from "./_shared/ai-oauth.mjs";
import { hashIp } from "./_shared/ai-audit.mjs";

const SITE_URL = () => {
  try { return (globalThis.Netlify?.env?.get?.("SITE_URL") || process.env.SITE_URL || "https://www.nordicemobility.se").replace(/\/$/, ""); } catch { return "https://www.nordicemobility.se"; }
};
export const PROTOCOL_VERSION = "2025-03-26";
export const SERVER_INFO = { name: "nemob-ai-gateway", version: "0.1.0" };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const clientIp = (request) => clean(request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0], 60);

const publicTool = (t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, scope: t.scope });

// Kör ett verktyg för en autentiserad principal. Returnerar { status, body }.
export const runTool = async ({ name, args, principal, request, transport }) => {
  const started = Date.now();
  const tool = toolByName(name);
  const audit = (extra) => writeAudit({ client: principal.client.id, via: principal.via, tool: clean(name, 60), args, transport, ip: clientIp(request), durationMs: Date.now() - started, ...extra });
  if (!tool) { await audit({ ok: false, status: 404, error: "unknown_tool" }); return { status: 404, body: { error: "unknown_tool", description: `Okänt verktyg: ${clean(name, 60)}` } }; }
  if (!hasScope(principal, tool.scope)) { await audit({ ok: false, status: 403, error: "forbidden_scope" }); return { status: 403, body: { error: "forbidden_scope", description: `Verktyget kräver scope ${tool.scope}.`, required: tool.scope } }; }
  const rate = await checkRateLimit({ client: principal.client.id, limit: principal.client.rpm });
  if (rate.unavailable) { await audit({ ok: false, status: 503, error: "rate_limit_unavailable" }); return { status: 503, body: { error: "rate_limit_unavailable", description: "Anropsräknaren kan inte nås. Anropet nekas tills den fungerar." }, headers: { "Retry-After": "60" } }; }
  if (!rate.allowed) { await audit({ ok: false, status: 429, error: "rate_limited" }); return { status: 429, body: { error: "rate_limited", description: `Max ${rate.limit} anrop per minut.`, resetAt: rate.resetAt }, headers: { "Retry-After": "60" } }; }
  const errors = validateArgs(tool.inputSchema, args);
  if (errors.length) { await audit({ ok: false, status: 400, error: errors.join("; ") }); return { status: 400, body: { error: "invalid_arguments", description: errors.join("; ") } }; }
  try {
    const result = await tool.run(args || {}, { principal, request, now: Date.now() });
    const count = Array.isArray(result?.calls) ? result.calls.length : Array.isArray(result?.cases) ? result.cases.length : null;
    const ok = !["failed", "invalid", "rejected"].includes(result?.status);
    await audit({ ok, status: ok ? 200 : 422, count, error: ok ? "" : clean(result?.error, 120) });
    return { status: 200, body: result, headers: { "X-RateLimit-Remaining": String(rate.remaining) } };
  } catch (error) {
    await audit({ ok: false, status: 500, error: clean(error?.message, 160) });
    console.error("ai-gateway tool failed", { tool: name, error: clean(error?.message, 160) });
    return { status: 500, body: { error: "tool_failed", description: "Verktyget kunde inte köras. Felet är loggat." } };
  }
};

// --- MCP (JSON-RPC 2.0 över HTTP) ------------------------------------------
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

export const handleRpc = async (message, { principal, request }) => {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message?.id, -32600, "Ogiltig JSON-RPC-förfrågan.");
  const { id, method, params = {} } = message;
  const isNotification = id === undefined;
  switch (method) {
    case "initialize":
      return rpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: "NEMOB AI Gateway: läs samtal, kundärenden och verksamhetsläge, sätt tillgänglighet. Godkännanden och kundutskick görs aldrig här." });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS.filter((t) => hasScope(principal, t.scope)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = clean(params?.name, 60);
      const outcome = await runTool({ name, args: params?.arguments || {}, principal, request, transport: "mcp" });
      if (outcome.status === 404) return rpcError(id, -32602, outcome.body.description);
      if (outcome.status === 400) return rpcError(id, -32602, outcome.body.description);
      if (outcome.status === 403 || outcome.status === 429) return rpcResult(id, { isError: true, content: [{ type: "text", text: JSON.stringify(outcome.body) }] });
      if (outcome.status >= 500) return rpcError(id, -32603, outcome.body.description);
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(outcome.body) }], structuredContent: outcome.body, isError: ["failed", "invalid", "rejected"].includes(outcome.body?.status) });
    }
    default:
      return isNotification ? null : rpcError(id, -32601, `Metoden stöds inte: ${clean(method, 60)}`);
  }
};

// --- OpenAPI för ChatGPT Actions (publikt schema, ingen data) --------------
export const openApiDocument = () => ({
  openapi: "3.1.0",
  info: { title: "NEMOB AI Gateway", version: SERVER_INFO.version, description: "Läsverktyg för Nordic E-Mobility (samtal, kundärenden, verksamhetsläge) och tillgänglighet. Kräver Bearer-nyckel per AI-klient." },
  servers: [{ url: SITE_URL() }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
  security: [{ bearerAuth: [] }],
  paths: Object.fromEntries(TOOLS.map((t) => [`/api/ai/tools/${t.name}`, {
    post: {
      operationId: t.name,
      summary: t.description.slice(0, 120),
      description: `${t.description} Kräver scope ${t.scope}.`,
      requestBody: { required: true, content: { "application/json": { schema: t.inputSchema } } },
      responses: { 200: { description: "Resultat", content: { "application/json": { schema: { type: "object" } } } }, 401: { description: "Ej autentiserad" }, 403: { description: "Saknar scope" }, 429: { description: "För många anrop" } },
    },
  }])),
});

export default async (request) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const sub = path.replace(/^\/api\/ai/, "") || "/";

  // OAuth-metadata på rotnivå (RFC 8414 / RFC 9728) – det MCP-klienter läser först.
  if (request.method === "GET" && path === "/.well-known/oauth-authorization-server") return json(authorizationServerMetadata(SITE_URL()));
  if (request.method === "GET" && path === "/.well-known/oauth-protected-resource") return json(protectedResourceMetadata(SITE_URL()));

  // Dynamisk klientregistrering (RFC 7591). Publik klient, PKCE krävs, inga scopes förrän ägaren samtycker.
  if (sub === "/oauth/register") {
    if (request.method !== "POST") return json({ error: "invalid_request" }, 405);
    const rate = await checkRateLimit({ client: `register_${hashIp(clientIp(request))}`, limit: 10 });
    if (!rate.allowed) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    let body = {};
    try { body = await request.json(); } catch { return json({ error: "invalid_client_metadata" }, 400); }
    const result = await registerClient(body);
    if (!result.ok) return json({ error: result.error, error_description: result.description }, 400);
    await writeAudit({ client: result.client.client_id, via: "dcr", tool: "oauth/register", args: { client_name: result.client.client_name }, ok: true, status: 201, transport: "oauth", ip: clientIp(request) });
    return json(result.client, 201);
  }

  // Samtyckessida (ägaren godkänner klienten och väljer scopes).
  if (sub === "/oauth/authorize") {
    const html = (markup, status = 200) => new Response(markup, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (request.method === "GET") {
      const check = await validateAuthorizeRequest(url.searchParams);
      if (!check.ok) return json({ error: check.error, error_description: check.description }, 400);
      return html(consentPage(check));
    }
    if (request.method === "POST") {
      const rate = await checkRateLimit({ client: `consent_${hashIp(clientIp(request))}`, limit: 10 });
      if (!rate.allowed) return html("<p>För många försök. Vänta en minut.</p>", 429);
      const params = new URLSearchParams(await request.text());
      const form = Object.fromEntries(params);
      form.scope = params.getAll("scope");
      const granted = await grantConsent(form);
      if (!granted.ok) {
        await writeAudit({ client: clean(form.client_id, 80), via: "consent", tool: "oauth/authorize", ok: false, status: granted.status, error: granted.error, transport: "oauth", ip: clientIp(request) });
        if (granted.status === 401 || granted.status === 400) {
          const check = await validateAuthorizeRequest(new URLSearchParams({ client_id: form.client_id, redirect_uri: form.redirect_uri, response_type: "code", code_challenge: form.code_challenge, code_challenge_method: "S256", state: form.state || "", scope: (form.scope || []).join(" ") }));
          if (check.ok) return html(consentPage({ ...check, error: granted.error }), granted.status);
        }
        return html(`<p>${granted.error}</p>`, granted.status);
      }
      await writeAudit({ client: clean(form.client_id, 80), via: "consent", tool: "oauth/authorize", args: { scope: granted.scopes.join(" ") }, ok: true, status: 302, transport: "oauth", ip: clientIp(request) });
      return new Response(null, { status: 302, headers: { Location: granted.redirect, "Cache-Control": "no-store" } });
    }
    return json({ error: "invalid_request" }, 405);
  }

  // Publika metadata (inga data, inga hemligheter).
  if (request.method === "GET" && sub === "/openapi.json") return json(openApiDocument());
  if (request.method === "GET" && sub === "/.well-known") {
    return json({ name: SERVER_INFO.name, version: SERVER_INFO.version, mcp: { endpoint: `${SITE_URL()}/api/ai/mcp`, transport: "streamable-http", protocolVersion: PROTOCOL_VERSION, sse: false }, auth: { bearer_api_key: true, oauth_client_credentials: `${SITE_URL()}/api/ai/oauth/token`, oauth_authorization_code: true, oauth_authorization_server: `${SITE_URL()}/.well-known/oauth-authorization-server`, dynamic_client_registration: `${SITE_URL()}/api/ai/oauth/register` }, scopes: SCOPES, openapi: `${SITE_URL()}/api/ai/openapi.json` });
  }

  // OAuth client credentials.
  if (sub === "/oauth/token") {
    if (request.method !== "POST") return json({ error: "invalid_request" }, 405);
    const registry = loadClients();
    if (!registry.ok) return json({ error: "temporarily_unavailable", error_description: registry.reason }, 503);
    const contentType = clean(request.headers.get("content-type"), 80);
    let form = {};
    try {
      if (contentType.includes("application/json")) form = await request.json();
      else form = Object.fromEntries(new URLSearchParams(await request.text()));
    } catch { form = {}; }
    const basic = clean(request.headers.get("authorization"), 600).match(/^Basic\s+(.+)$/i);
    if (basic) {
      const [cid, ...rest] = Buffer.from(basic[1], "base64").toString("utf8").split(":");
      form.client_id = form.client_id || cid;
      form.client_secret = form.client_secret || rest.join(":");
    }
    const grant = clean(form.grant_type, 40);
    if (grant === "authorization_code") {
      const result = await exchangeCode({ code: form.code, clientId: form.client_id, redirectUri: form.redirect_uri, codeVerifier: form.code_verifier });
      if (!result.ok) return json({ error: result.error, error_description: result.description || "" }, result.error === "invalid_client" ? 401 : 400);
      await writeAudit({ client: `oauth:${clean(form.client_id, 80)}`, via: "oauth_code", tool: "oauth/token", args: { scope: result.scope }, ok: true, status: 200, transport: "oauth", ip: clientIp(request) });
      return json(result);
    }
    if (grant === "refresh_token") {
      const result = await refreshTokens({ refreshToken: form.refresh_token, clientId: form.client_id });
      if (!result.ok) return json({ error: result.error, error_description: result.description || "" }, 400);
      return json(result);
    }
    if (grant !== "client_credentials") return json({ error: "unsupported_grant_type", error_description: "Stöds: authorization_code, refresh_token, client_credentials." }, 400);
    const client = verifyApiKey(registry.clients, `${clean(form.client_id, 60)}.${clean(form.client_secret, 400)}`);
    if (!client) return json({ error: "invalid_client" }, 401, { "WWW-Authenticate": "Basic" });
    const scopes = clean(form.scope, 400).split(/[\s,]+/).filter(Boolean);
    const issued = issueToken({ client, scopes });
    if (!issued.ok) return json({ error: issued.error, error_description: issued.description }, issued.error === "server_error" ? 503 : 400);
    await writeAudit({ client: client.id, via: "oauth", tool: "oauth/token", args: { scope: issued.scope }, ok: true, status: 200, transport: "oauth", ip: clientIp(request) });
    const { ok, ...body } = issued;
    return json(body);
  }

  // Allt nedan kräver klientauth.
  const auth = authenticate(request);
  if (!auth.ok) return json({ error: auth.error, description: auth.description }, auth.status, auth.status === 401 ? { "WWW-Authenticate": `Bearer realm="nemob-ai-gateway", resource_metadata="${SITE_URL()}/.well-known/oauth-protected-resource"` } : {});
  const { principal } = auth;

  if (sub === "/mcp") {
    if (request.method === "GET") return json({ error: "sse_not_supported", description: "Servern svarar bara på POST (JSON-RPC). SSE-ström stöds inte." }, 405, { Allow: "POST" });
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    let payload;
    try { payload = await request.json(); } catch { return json(rpcError(null, -32700, "Ogiltig JSON."), 400); }
    const messages = Array.isArray(payload) ? payload : [payload];
    const responses = [];
    for (const message of messages) {
      const response = await handleRpc(message, { principal, request });
      if (response) responses.push(response);
    }
    if (!responses.length) return new Response(null, { status: 202 });
    return json(Array.isArray(payload) ? responses : responses[0]);
  }

  if (request.method === "GET" && sub === "/whoami") {
    return json({ client: principal.client.id, label: principal.client.label, scopes: principal.scopes, via: principal.via, rpm: principal.client.rpm, tools: TOOLS.filter((t) => hasScope(principal, t.scope)).map((t) => t.name) });
  }
  if (request.method === "GET" && sub === "/tools") {
    return json({ tools: TOOLS.filter((t) => hasScope(principal, t.scope)).map(publicTool) });
  }
  const toolMatch = sub.match(/^\/tools\/([a-z_]+)$/);
  if (toolMatch) {
    if (request.method !== "POST") return json({ error: "method_not_allowed", description: "Använd POST med JSON-argument." }, 405);
    let args = {};
    try { const text = await request.text(); args = text ? JSON.parse(text) : {}; } catch { return json({ error: "invalid_json" }, 400); }
    const outcome = await runTool({ name: toolMatch[1], args, principal, request, transport: "rest" });
    return json(outcome.body, outcome.status, outcome.headers || {});
  }
  return json({ error: "not_found" }, 404);
};

export const config = {
  path: ["/api/ai", "/api/ai/*", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource"],
};
