// NEMOB AI Gateway mot lokal Blobs-server: MCP + REST, scopes, rate limit,
// revisionslogg, verktygen med mockad 46elks och presence med sluttid.
// Inget lämnar maskinen; inga utskick.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./_blobs-test-env.mjs";
import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import { pinTestEnv } from "./_test-env.mjs";
import { resetVerification, setProbeStoreFactory } from "../netlify/functions/_shared/case-store.mjs";
import { hashSecret } from "../netlify/functions/_shared/ai-auth.mjs";

const SECRET = "hemlig-claude";
const setup = async (t, { rpm = 60 } = {}) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-ai-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  resetVerification();
  setProbeStoreFactory(() => getStore({ name: "case-store-probe", consistency: "strong" }));
  const restoreEnv = pinTestEnv({
    AI_GATEWAY_CLIENTS: JSON.stringify([
      { id: "claude", label: "Claude", secretHash: hashSecret(SECRET), scopes: ["cases:read", "calls:read", "overview:read", "presence:read", "presence:write"], rpm },
      { id: "lasare", secretHash: hashSecret("bara-las"), scopes: ["cases:read"] },
    ]),
    AI_GATEWAY_SIGNING_SECRET: "sign-test",
    VOICE_PRIMARY_NUMBER: "+46700243319",
    VOICE_WORKSHOP_PHONE: "+46700000099",
  });
  const realFetch = globalThis.fetch;
  const elks = { pages: [], requests: [] };
  const putLocks = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input);
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (u.includes("api.46elks.com/a1/calls")) {
      elks.requests.push(u);
      const start = new URL(u).searchParams.get("start");
      const page = elks.pages.find((p) => (p.cursor || "") === (start || "")) || { data: [] };
      return new Response(JSON.stringify({ data: page.data, ...(page.next ? { next: page.next } : {}) }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("api.46elks.com")) return new Response("{}", { status: 404 });
    if (method === "PUT") { const previous = putLocks.get(u) || Promise.resolve(); const run = previous.catch(() => {}).then(() => realFetch(input, init)); putLocks.set(u, run); return run; }
    return realFetch(input, init);
  };
  t.after(async () => { globalThis.fetch = realFetch; restoreEnv(); await server.stop(); await rm(dir, { recursive: true, force: true }); });
  const { default: handler } = await import("../netlify/functions/ai-gateway.mjs");
  const call = (path, { method = "GET", body, token = `claude.${SECRET}`, headers = {} } = {}) =>
    handler(new Request(`https://x${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const rpc = (message, token) => call("/api/ai/mcp", { method: "POST", body: message, token });
  return { handler, call, rpc, elks };
};
const iso = (daysAgo, hour = 10) => { const d = new Date(Date.UTC(2026, 10, 12 - daysAgo, hour, 0, 0)); return d.toISOString(); };

test("auth och metadata: 503 utan register, 401, openapi/well-known publika, whoami", async (t) => {
  const { call } = await setup(t);
  const oldClients = process.env.AI_GATEWAY_CLIENTS;
  delete process.env.AI_GATEWAY_CLIENTS;
  assert.equal((await call("/api/ai/tools")).status, 503, "fail-closed utan register");
  process.env.AI_GATEWAY_CLIENTS = oldClients;
  assert.equal((await call("/api/ai/tools", { token: null })).status, 401);
  assert.equal((await call("/api/ai/tools", { token: "claude.fel" })).status, 401);
  const openapi = await (await call("/api/ai/openapi.json", { token: null })).json();
  assert.equal(openapi.openapi, "3.1.0");
  assert.ok(openapi.paths["/api/ai/tools/search_calls"].post.operationId === "search_calls");
  const wk = await (await call("/api/ai/.well-known", { token: null })).json();
  assert.equal(wk.auth.oauth_authorization_code, true);
  assert.ok(String(wk.auth.dynamic_client_registration).endsWith("/api/ai/oauth/register"));
  const who = await (await call("/api/ai/whoami")).json();
  assert.equal(who.client, "claude");
  assert.ok(who.tools.includes("set_presence"));
  const reader = await (await call("/api/ai/whoami", { token: "lasare.bara-las" })).json();
  assert.deepEqual(reader.tools, ["search_customer"]);
});

test("OAuth client credentials: token utfärdas, används, begränsas till klientens scopes", async (t) => {
  const { call } = await setup(t);
  const form = new URLSearchParams({ grant_type: "client_credentials", client_id: "lasare", client_secret: "bara-las", scope: "cases:read presence:write" }).toString();
  const { default: handler } = await import("../netlify/functions/ai-gateway.mjs");
  const res = await handler(new Request("https://x/api/ai/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }));
  assert.equal(res.status, 200);
  const tok = await res.json();
  assert.equal(tok.token_type, "Bearer");
  assert.equal(tok.scope, "cases:read");
  const who = await (await call("/api/ai/whoami", { token: tok.access_token })).json();
  assert.equal(who.via, "oauth_token");
  assert.deepEqual(who.scopes, ["cases:read"]);
  const bad = await handler(new Request("https://x/api/ai/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials&client_id=lasare&client_secret=fel" }));
  assert.equal(bad.status, 401);
  const wrongGrant = await handler(new Request("https://x/api/ai/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=password" }));
  assert.equal(wrongGrant.status, 400);
});

test("MCP: initialize, tools/list per scope, tools/call, okänd metod, batch, notification 202", async (t) => {
  const { rpc } = await setup(t);
  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test" } } })).json();
  assert.equal(init.result.serverInfo.name, "nemob-ai-gateway");
  assert.ok(init.result.capabilities.tools);
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.deepEqual(list.result.tools.map((x) => x.name).sort(), ["get_business_overview", "get_presence", "search_calls", "search_customer", "set_presence"]);
  const listReader = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, "lasare.bara-las")).json();
  assert.deepEqual(listReader.result.tools.map((x) => x.name), ["search_customer"]);
  const unknown = await (await rpc({ jsonrpc: "2.0", id: 4, method: "resources/list" })).json();
  assert.equal(unknown.error.code, -32601);
  const badTool = await (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "radera_allt", arguments: {} } })).json();
  assert.equal(badTool.error.code, -32602);
  const forbidden = await (await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "set_presence", arguments: { status: "unavailable", untilMinutes: 30 } } }, "lasare.bara-las")).json();
  assert.equal(forbidden.result.isError, true);
  assert.match(forbidden.result.content[0].text, /forbidden_scope/);
  const batch = await (await rpc([{ jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", id: 8, method: "tools/list" }])).json();
  assert.equal(batch.length, 2);
  const { default: handler } = await import("../netlify/functions/ai-gateway.mjs");
  const sse = await handler(new Request("https://x/api/ai/mcp", { headers: { Authorization: `Bearer claude.${SECRET}` } }));
  assert.equal(sse.status, 405);
});

test("search_calls: paginerar 46elks via start-cursor, filtrerar på nummer/datum, summerar utfall", async (t) => {
  const { call, elks } = await setup(t);
  elks.pages = [
    { cursor: "", next: "2026-11-05T10:00:00.000000", data: [
      { id: "c1", created: iso(1), direction: "incoming", from: "+46701112233", to: "+46101385498", duration: 0, legs: [] },
      { id: "c2", created: iso(2), direction: "incoming", from: "+46701112233", to: "+46101385498", duration: 95, legs: [{ to: "+46700243319", state: "success", duration: 95 }] },
      { id: "c3", created: iso(3), direction: "incoming", from: "+46709998877", to: "+46101385498", duration: 30, legs: [{ to: "sip:nova@elevenlabs", state: "success", duration: 30 }] },
      { id: "c4", created: iso(4), direction: "outgoing", from: "+46101385498", to: "+46701112233", duration: 40, legs: [{ to: "+46701112233", state: "success" }] },
    ] },
    { cursor: "2026-11-05T10:00:00.000000", data: [
      { id: "c5", created: iso(20), direction: "incoming", from: "+46701112233", to: "+46101385498", duration: 0, legs: [], recordings: [{ url: "x" }] },
      { id: "c6", created: iso(45), direction: "incoming", from: "+46701112233", to: "+46101385498", duration: 0, legs: [] },
    ] },
  ];
  const res = await call("/api/ai/tools/search_calls", { method: "POST", body: { phone: "070-111 22 33", from: "2026-10-13" } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(elks.requests.length, 2, "två sidor hämtade");
  assert.ok(elks.requests[1].includes("start=2026-11-05T10%3A00%3A00.000000"), "next skickas som start-cursor");
  assert.deepEqual(body.calls.map((c) => c.id), ["c1", "c2", "c4", "c5"], "c3 annat nummer, c6 utanför fönstret");
  assert.equal(body.summary.total, 4);
  assert.equal(body.summary.incoming, 3);
  assert.equal(body.summary.outgoing, 1);
  assert.equal(body.summary.missed, 1);
  assert.equal(body.summary.voicemail, 1);
  assert.equal(body.summary.answered, 2);
  assert.equal(body.calls.find((c) => c.id === "c2").outcome, "sebastian");
  const onlyIncoming = await (await call("/api/ai/tools/search_calls", { method: "POST", body: { direction: "incoming", limit: 2 } })).json();
  assert.equal(onlyIncoming.summary.nova, 1);
  assert.equal(onlyIncoming.calls.length, 2);
  assert.equal(onlyIncoming.truncated, true);
  const invalid = await call("/api/ai/tools/search_calls", { method: "POST", body: { direction: "sidledes" } });
  assert.equal(invalid.status, 400);
  // Utan 46elks-uppgifter: tydligt not_configured, inget kast.
  delete process.env.ELKS_USERNAME;
  const nc = await (await call("/api/ai/tools/search_calls", { method: "POST", body: {} })).json();
  assert.equal(nc.status, "not_configured");
});

test("search_customer: träffar på telefon/namn/modell/servicenummer, vitlistade fält, inga anteckningar", async (t) => {
  const { call } = await setup(t);
  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  await cases.setJSON("case_a", { id: "case_a", serviceNumber: "NE-100", status: "repairing", service: "Batteri", vehicle: { brand: "Kukirin", model: "G2 Pro" }, customer: { name: "Anna Andersson", phone: "0701112233", email: "anna@example.com" }, notes: [{ text: "HEMLIG intern anteckning" }], workshop: { internalComment: "privat" }, media: [{ url: "x" }], coupon: { code: "RABATT" }, payment: { status: "unpaid", amount: 1200 }, timeline: [{ at: "2026-11-10T10:00:00Z", event: "Skapad" }, { at: "2026-11-11T10:00:00Z", event: "Felsökt" }], updatedAt: "2026-11-11T10:00:00Z" });
  await cases.setJSON("case_b", { id: "case_b", serviceNumber: "NE-101", status: "done", service: "Däck", vehicle: { model: "Ninebot Max" }, customer: { name: "Bo Berg", phone: "+46709998877" }, updatedAt: "2026-11-01T10:00:00Z" });
  const byPhone = await (await call("/api/ai/tools/search_customer", { method: "POST", body: { query: "070 111 22 33" } })).json();
  assert.equal(byPhone.total, 1);
  const row = byPhone.cases[0];
  assert.equal(row.serviceNumber, "NE-100");
  assert.equal(row.customer.phone, "+46701112233");
  assert.equal(row.open, true);
  assert.equal(JSON.stringify(row).includes("HEMLIG"), false, "inga anteckningar");
  assert.equal(JSON.stringify(row).includes("privat"), false);
  assert.equal(JSON.stringify(row).includes("RABATT"), false);
  assert.equal(row.media, undefined);
  assert.equal(row.lastTimeline.length, 2);
  assert.equal((await (await call("/api/ai/tools/search_customer", { method: "POST", body: { query: "ninebot" } })).json()).cases[0].id, "case_b");
  assert.equal((await (await call("/api/ai/tools/search_customer", { method: "POST", body: { query: "NE-101" } })).json()).total, 1);
  assert.equal((await (await call("/api/ai/tools/search_customer", { method: "POST", body: { query: "berg", onlyOpen: true } })).json()).total, 0);
  assert.equal((await call("/api/ai/tools/search_customer", { method: "POST", body: { query: "x" } })).status, 400);
  assert.equal((await call("/api/ai/tools/search_customer", { method: "POST", body: { query: "anna" }, token: "lasare.bara-las" })).status, 200, "lasare har cases:read");
  assert.equal((await call("/api/ai/tools/search_calls", { method: "POST", body: {}, token: "lasare.bara-las" })).status, 403);
});

test("get_business_overview: godkännanden, ärenden per status, kommande bokningar, presence", async (t) => {
  const { call } = await setup(t);
  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
  await cases.setJSON("c1", { id: "c1", status: "ready", customer: { name: "A", phone: "0701" }, updatedAt: "2026-11-01" });
  await cases.setJSON("c2", { id: "c2", status: "new", bookingMode: "request", bookingRequest: { status: "pending", requestedAt: "2026-11-11T09:00:00Z" }, preferredDate: soon, customer: { name: "B", phone: "0702" } });
  await cases.setJSON("c3", { id: "c3", status: "done", customer: { name: "C", phone: "0703" } });
  const body = await (await call("/api/ai/tools/get_business_overview", { method: "POST", body: {} })).json();
  assert.equal(body.status, "ok");
  assert.equal(body.cases.open, 2);
  assert.equal(body.cases.readyForPickup, 1);
  assert.equal(body.approvals.counts.booking_request, 1);
  assert.equal(body.upcomingBookings.count, 1);
  assert.equal(body.presence.status, "available_workshop", "översikten bär presence-vyn direkt");
  assert.ok(body.priorityCases.length >= 1);
});

test("presence: kräver sluttid, auto-återställning, historik, transaktionell samtidighet, dry-run", async (t) => {
  const { call } = await setup(t);
  const get = async () => (await call("/api/ai/tools/get_presence", { method: "POST", body: {} })).json();
  assert.equal((await get()).status, "ok");
  assert.equal((await get()).presence.routing.dryRun, true);
  const noUntil = await (await call("/api/ai/tools/set_presence", { method: "POST", body: { status: "nova_only" } })).json();
  assert.equal(noUntil.error, "until_required");
  const set = await (await call("/api/ai/tools/set_presence", { method: "POST", body: { status: "nova_only", untilMinutes: 1, note: "lunch" } })).json();
  assert.equal(set.status, "ok");
  assert.equal(set.previous, "available_workshop");
  assert.equal(set.routingApplied, false);
  assert.equal(set.dryRun, true);
  assert.equal(set.presence.setBy, "ai:claude");
  const now = await get();
  assert.equal(now.presence.status, "nova_only");
  assert.equal(now.presence.remainingMinutes <= 1, true);
  // Två samtidiga ändringar: båda går igenom i ordning, historiken tappar ingen.
  const [a, b] = await Promise.all([
    call("/api/ai/tools/set_presence", { method: "POST", body: { status: "unavailable", untilMinutes: 10 } }),
    call("/api/ai/tools/set_presence", { method: "POST", body: { status: "available_workshop" } }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const stored = await getStore({ name: "presence", consistency: "strong" }).get("current", { type: "json" });
  assert.equal(stored.history.length, 3, "alla tre ändringar i historiken");
  // Auto-återställning när sluttiden passerat.
  await getStore({ name: "presence", consistency: "strong" }).setJSON("current", { ...stored, status: "unavailable", until: new Date(Date.now() - 60000).toISOString() });
  const after = await get();
  assert.equal(after.presence.status, "available_workshop");
  assert.equal(after.autoReset, true);
  assert.equal(after.presence.recentHistory[0].by, "auto_reset");
  assert.equal((await (await call("/api/ai/tools/set_presence", { method: "POST", body: { status: "fel" } })).json()).error, "invalid_arguments");
});

test("rate limit och revisionslogg: 429 över gränsen, varje anrop loggas utan hemligheter", async (t) => {
  const { call } = await setup(t, { rpm: 3 });
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await call("/api/ai/tools/get_presence", { method: "POST", body: {} })).status);
  assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  const audit = getStore({ name: "ai-gateway-audit", consistency: "strong" });
  const { blobs } = await audit.list();
  const rows = (await Promise.all(blobs.map((b) => audit.get(b.key, { type: "json" })))).filter(Boolean);
  assert.equal(rows.length, 5);
  assert.equal(rows.filter((r) => r.status === 429).length, 2);
  assert.ok(rows.every((r) => r.client === "claude" && r.tool === "get_presence"));
  assert.equal(JSON.stringify(rows).includes(SECRET), false, "hemligheten finns aldrig i loggen");
  await call("/api/ai/tools/search_customer", { method: "POST", body: { query: "0701112233" }, token: "lasare.bara-las" });
  const { blobs: later } = await audit.list();
  const last = (await Promise.all(later.map((b) => audit.get(b.key, { type: "json" })))).find((r) => r?.tool === "search_customer");
  assert.deepEqual(Object.keys(last.args.query).sort(), ["hash", "kind", "len"], "sökfrågan lagras bara som form + hash");
  assert.equal(last.args.query.kind, "phone");
  assert.equal(JSON.stringify(rows).includes("0701112233"), false, "numret finns inte i loggen");
  assert.ok(rows.every((r) => !r.ipHash || /^[0-9a-f]{16}$/.test(r.ipHash)), "ipHash är en hash, aldrig en adress");
});

test("rate limit faller STÄNGT: går räknaren inte att nå nekas anropet med 503", async (t) => {
  const { call } = await setup(t);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => { if (String(input).includes("ai-gateway-ratelimit")) throw new Error("ECONNRESET (simulerat)"); return realFetch(input, init); };
  try {
    const res = await call("/api/ai/tools/get_presence", { method: "POST", body: {} });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "rate_limit_unavailable");
  } finally { globalThis.fetch = realFetch; }
});

test("overview: enbart overview:read ger lägesbild utan kunduppgifter; med cases:read fullt kundkort", async (t) => {
  const { call } = await setup(t);
  process.env.AI_GATEWAY_CLIENTS = JSON.stringify([
    ...JSON.parse(process.env.AI_GATEWAY_CLIENTS),
    { id: "rapport", secretHash: hashSecret("r"), scopes: ["overview:read"] },
  ]);
  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  const soon = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  await cases.setJSON("c1", { id: "c1", serviceNumber: "NE-7", status: "ready", customer: { name: "Hemlig Kund", phone: "0701112233", email: "hemlig@example.com" }, updatedAt: "2026-11-01" });
  await cases.setJSON("c2", { id: "c2", status: "new", bookingMode: "request", bookingRequest: { status: "pending", requestedAt: "2026-11-11T09:00:00Z" }, preferredDate: soon, message: "Kundens egna ord", customer: { name: "Hemlig Två", phone: "0709998877" } });
  const report = await (await call("/api/ai/tools/get_business_overview", { method: "POST", body: {}, token: "rapport.r" })).json();
  assert.equal(report.status, "ok");
  assert.equal(report.redacted, true);
  assert.equal(report.presenceOmitted, true);
  assert.equal(report.presence, null);
  assert.equal(report.cases.readyForPickup, 1);
  assert.equal(report.approvals.counts.booking_request, 1);
  const text = JSON.stringify(report);
  for (const pii of ["Hemlig", "0701112233", "0709998877", "+4670", "hemlig@example.com", "Kundens egna ord"]) assert.equal(text.includes(pii), false, "ingen kunduppgift: " + pii);
  assert.equal(report.priorityCases.find((c) => c.id === "c1").serviceNumber, "NE-7");
  const full = await (await call("/api/ai/tools/get_business_overview", { method: "POST", body: {} })).json();
  assert.equal(full.redacted, false);
  assert.equal(full.priorityCases.find((c) => c.id === "c1").customer.name, "Hemlig Kund");
  assert.equal(full.presence.status, "available_workshop");
});

test("set_presence rapporterar aldrig applicerad routing – inte ens med PRESENCE_ROUTING_ENABLED satt", async (t) => {
  const { call } = await setup(t);
  process.env.PRESENCE_ROUTING_ENABLED = "1";
  try {
    const set = await (await call("/api/ai/tools/set_presence", { method: "POST", body: { status: "nova_only", untilMinutes: 5 } })).json();
    assert.equal(set.routingApplied, false);
    assert.equal(set.presence.routing.applied, false, "ingen telefonikomponent har satt appliedAt");
    assert.equal(set.presence.routing.dryRun, false, "flaggan är på men inget har applicerats");
    const got = await (await call("/api/ai/tools/get_presence", { method: "POST", body: {} })).json();
    assert.equal(got.presence.routing.applied, false);
  } finally { delete process.env.PRESENCE_ROUTING_ENABLED; }
});

test("OAuth authorization code: DCR → samtycke med ägar-PIN och PKCE → token → MCP, refresh roterar, kod är engångs", async (t) => {
  const { call, handler } = await setup(t);
  process.env.AI_GATEWAY_OWNER_SECRET = "agar-pin-1234";
  process.env.AI_GATEWAY_OAUTH_SCOPES = "cases:read overview:read presence:read";
  const { pkceChallenge } = await import("../netlify/functions/_shared/ai-oauth.mjs");
  const meta = await (await handler(new Request("https://x/.well-known/oauth-authorization-server"))).json();
  assert.equal(meta.registration_endpoint, "https://www.nordicemobility.se/api/ai/oauth/register");
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  const prm = await (await handler(new Request("https://x/.well-known/oauth-protected-resource"))).json();
  assert.equal(prm.resource, "https://www.nordicemobility.se/api/ai/mcp");
  const unauth = await handler(new Request("https://x/api/ai/mcp", { method: "POST", body: "{}" }));
  assert.match(unauth.headers.get("www-authenticate"), /resource_metadata=/);

  const reg = await handler(new Request("https://x/api/ai/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect", "http://evil.example/x"] }) }));
  assert.equal(reg.status, 201);
  const client = await reg.json();
  assert.match(client.client_id, /^dyn_/);
  assert.deepEqual(client.redirect_uris, ["https://chatgpt.com/connector_platform_oauth_redirect"], "bara https/localhost-redirects");
  assert.equal(client.token_endpoint_auth_method, "none");

  const verifier = "v".repeat(43) + "abc";
  const challenge = pkceChallenge(verifier);
  const authUrl = `https://x/api/ai/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(client.redirect_uris[0])}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz&scope=cases:read%20presence:write%20overview:read`;
  const page = await handler(new Request(authUrl));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /ChatGPT/);
  assert.equal(html.includes("presence:write"), false, "scope utanför AI_GATEWAY_OAUTH_SCOPES erbjuds inte");
  assert.equal((await handler(new Request(authUrl.replace("S256", "plain")))).status, 400, "PKCE plain avvisas");
  assert.equal((await handler(new Request(authUrl.replace(encodeURIComponent(client.redirect_uris[0]), "https%3A%2F%2Fannan.example%2F")))).status, 400);

  const consent = (pin, scopes = ["cases:read", "overview:read"]) => handler(new Request("https://x/api/ai/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams([["client_id", client.client_id], ["redirect_uri", client.redirect_uris[0]], ["state", "xyz"], ["code_challenge", challenge], ["owner_pin", pin], ...scopes.map((s) => ["scope", s])]).toString() }));
  assert.equal((await consent("fel-pin")).status, 401);
  const ok = await consent("agar-pin-1234");
  assert.equal(ok.status, 302);
  const location = new URL(ok.headers.get("location"));
  assert.equal(location.origin + location.pathname, client.redirect_uris[0]);
  assert.equal(location.searchParams.get("state"), "xyz");
  const code = location.searchParams.get("code");
  assert.ok(code);

  const tokenReq = (body) => handler(new Request("https://x/api/ai/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }));
  assert.equal((await tokenReq({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: "w".repeat(50) })).status, 400, "fel verifierare");
  // Ett misslyckat byte bränner koden (skydd mot gissning): även rätt verifierare nekas nu.
  assert.equal((await tokenReq({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: verifier })).status, 400, "koden är förbrukad efter misslyckat försök");
  const again = await consent("agar-pin-1234");
  const code2 = new URL(again.headers.get("location")).searchParams.get("code");
  const tok = await (await tokenReq({ grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: verifier })).json();
  assert.equal(tok.token_type, "Bearer", JSON.stringify(tok));
  assert.equal(tok.scope, "cases:read overview:read");
  assert.ok(tok.refresh_token);
  assert.equal((await tokenReq({ grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: verifier })).status, 400, "koden är engångs");

  const who = await (await call("/api/ai/whoami", { token: tok.access_token })).json();
  assert.equal(who.via, "oauth_code");
  assert.deepEqual(who.scopes, ["cases:read", "overview:read"]);
  assert.deepEqual(who.tools.sort(), ["get_business_overview", "search_customer"]);
  const list = await (await call("/api/ai/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/list" }, token: tok.access_token })).json();
  assert.equal(list.result.tools.length, 2);
  assert.equal((await call("/api/ai/tools/get_presence", { method: "POST", body: {}, token: tok.access_token })).status, 403);

  const refreshed = await (await tokenReq({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: client.client_id })).json();
  assert.ok(refreshed.access_token && refreshed.refresh_token !== tok.refresh_token, "roterad");
  assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: client.client_id })).status, 400, "gammal refresh är återkallad");
  delete process.env.AI_GATEWAY_OWNER_SECRET;
  assert.equal((await consent("agar-pin-1234")).status, 503, "utan ägar-PIN är samtycke avstängt");
  delete process.env.AI_GATEWAY_OAUTH_SCOPES;
});

// Hjälpare: fullt OAuth-flöde → { client, tokens, tokenReq } (ägar-PIN satt av anroparen).
const oauthSession = async (handler, call, pin = "agar-pin-1234") => {
  const { pkceChallenge } = await import("../netlify/functions/_shared/ai-oauth.mjs");
  const reg = await (await handler(new Request("https://x/api/ai/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/cb"] }) }))).json();
  const verifier = "v".repeat(43) + "xyz";
  const consent = await handler(new Request("https://x/api/ai/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams([["client_id", reg.client_id], ["redirect_uri", reg.redirect_uris[0]], ["code_challenge", pkceChallenge(verifier)], ["owner_pin", pin], ["scope", "cases:read"]]).toString() }));
  if (!consent.headers.get("location")) throw new Error(`samtycke misslyckades: ${consent.status} ${(await consent.text()).replace(/<[^>]+>/g, " ").replace(/s+/g, " ").slice(0, 200)}`);
  const code = new URL(consent.headers.get("location")).searchParams.get("code");
  const tokenReq = (body) => handler(new Request("https://x/api/ai/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }));
  const tokens = await (await tokenReq({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], code_verifier: verifier })).json();
  return { client: reg, tokens, tokenReq, call };
};
const putFailer = (realFetch, match, nth) => {
  let puts = 0;
  return async (input, init = {}) => {
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    // SDK:n gör upp till 6 försök per skrivning: kasta för hela den n:te skrivningens försök.
    if (method === "PUT" && String(input).includes(match) && ++puts >= nth && puts < nth + 6) throw new Error("ECONNRESET (simulerat)");
    return realFetch(input, init);
  };
};

test("refresh-rotation: parallell växling ger EN ny token; den gamla kan aldrig återanvändas, inte heller efter reservationsfönstret", async (t) => {
  const { call, handler } = await setup(t);
  process.env.AI_GATEWAY_OWNER_SECRET = "agar-pin-1234";
  const { client, tokens, tokenReq } = await oauthSession(handler, call);
  assert.ok(tokens.refresh_token, JSON.stringify(tokens));
  const [a, b] = await Promise.all([
    tokenReq({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id }),
    tokenReq({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400], "exakt en vinner");
  const winner = await (a.status === 200 ? a : b).json();
  assert.ok(winner.refresh_token && winner.refresh_token !== tokens.refresh_token);
  const { refreshTokens } = await import("../netlify/functions/_shared/ai-oauth.mjs");
  assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id })).status, 400);
  const later = await refreshTokens({ refreshToken: tokens.refresh_token, clientId: client.client_id, now: Date.now() + 10 * 60 * 1000 });
  assert.equal(later.ok, false, "gammal token är återkallad, inte bara reserverad");
  assert.equal(later.error, "invalid_grant");
  assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token: winner.refresh_token, client_id: client.client_id })).status, 200, "kedjan lever");
  delete process.env.AI_GATEWAY_OWNER_SECRET;
});

test("refresh-rotation: lagringsfel vid återkallelsen → ingen ny token; den gamla roteras högst en gång efter reservationen", async (t) => {
  const { call, handler } = await setup(t);
  process.env.AI_GATEWAY_OWNER_SECRET = "agar-pin-1234";
  const { client, tokens } = await oauthSession(handler, call);
  const { refreshTokens, OAUTH_STORE } = await import("../netlify/functions/_shared/ai-oauth.mjs");
  const realFetch = globalThis.fetch;
  globalThis.fetch = putFailer(realFetch, `:${OAUTH_STORE}/refresh_`, 2); // 1 = reservation, 2 = återkallelse
  let failed;
  try { failed = await refreshTokens({ refreshToken: tokens.refresh_token, clientId: client.client_id }); } finally { globalThis.fetch = realFetch; }
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error, "temporarily_unavailable");
  assert.equal(failed.access_token, undefined, "inget utfärdat");
  assert.equal((await refreshTokens({ refreshToken: tokens.refresh_token, clientId: client.client_id })).ok, false, "inom reservationen: nekas");
  const retry = await refreshTokens({ refreshToken: tokens.refresh_token, clientId: client.client_id, now: Date.now() + 2 * 60 * 1000 });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  const replay = await refreshTokens({ refreshToken: tokens.refresh_token, clientId: client.client_id, now: Date.now() + 5 * 60 * 1000 });
  assert.equal(replay.ok, false, "samma refresh token kan aldrig användas två gånger");
  delete process.env.AI_GATEWAY_OWNER_SECRET;
});

test("engångskod: förbrukas versionerat före utfärdande; misslyckas markeringen utfärdas inget", async (t) => {
  const { handler } = await setup(t);
  process.env.AI_GATEWAY_OWNER_SECRET = "agar-pin-1234";
  const { pkceChallenge, exchangeCode, OAUTH_STORE } = await import("../netlify/functions/_shared/ai-oauth.mjs");
  const reg = await (await handler(new Request("https://x/api/ai/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "X", redirect_uris: ["https://x.example/cb"] }) }))).json();
  const verifier = "q".repeat(50);
  const consent = await handler(new Request("https://x/api/ai/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams([["client_id", reg.client_id], ["redirect_uri", reg.redirect_uris[0]], ["code_challenge", pkceChallenge(verifier)], ["owner_pin", "agar-pin-1234"], ["scope", "cases:read"]]).toString() }));
  const code = new URL(consent.headers.get("location")).searchParams.get("code");
  const realFetch = globalThis.fetch;
  globalThis.fetch = putFailer(realFetch, `:${OAUTH_STORE}/code_`, 2); // 1 = reservation, 2 = förbrukning
  let first;
  try { first = await exchangeCode({ code, clientId: reg.client_id, redirectUri: reg.redirect_uris[0], codeVerifier: verifier }); } finally { globalThis.fetch = realFetch; }
  assert.equal(first.ok, false);
  assert.equal(first.error, "temporarily_unavailable");
  assert.equal(first.access_token, undefined);
  const expired = await exchangeCode({ code, clientId: reg.client_id, redirectUri: reg.redirect_uris[0], codeVerifier: verifier, now: Date.now() + 11 * 60 * 1000 });
  assert.equal(expired.ok, false, "ett lagringsfel förlänger aldrig en kod: efter 5 min är den utgången");
  delete process.env.AI_GATEWAY_OWNER_SECRET;
});

test("klientåterkallelse: ägaren återkallar en dynamisk klient → åtkomsttoken avvisas direkt, refresh och nya koder nekas", async (t) => {
  const { call, handler } = await setup(t);
  process.env.AI_GATEWAY_OWNER_SECRET = "agar-pin-1234";
  const { client, tokens, tokenReq } = await oauthSession(handler, call);
  assert.equal((await call("/api/ai/whoami", { token: tokens.access_token })).status, 200);
  const owner = (body) => handler(new Request("https://x/api/ai/oauth/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const list = await (await owner({ action: "list", owner_pin: "agar-pin-1234" })).json();
  assert.ok(list.clients.some((c) => c.client_id === client.client_id && !c.revoked));
  assert.equal((await owner({ action: "revoke", owner_pin: "fel", client_id: client.client_id })).status, 401);
  assert.equal((await owner({ action: "revoke", owner_pin: "agar-pin-1234", client_id: client.client_id, reason: "test" })).status, 200);
  assert.equal((await call("/api/ai/whoami", { token: tokens.access_token })).status, 401, "åtkomsttoken avvisas trots giltig signatur");
  assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id })).status, 400);
  assert.equal((await handler(new Request(`https://x/api/ai/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(client.redirect_uris[0])}&code_challenge=${"a".repeat(43)}&code_challenge_method=S256`))).status, 400, "ingen ny kod");
  assert.equal((await (await owner({ action: "list", owner_pin: "agar-pin-1234" })).json()).clients.find((c) => c.client_id === client.client_id).revoked, true);
  delete process.env.AI_GATEWAY_OWNER_SECRET;
});

test("rate limit: returnerade fel (storage_error, unversioned) nekar lika hårt som kastade undantag", async (t) => {
  await setup(t);
  const { checkRateLimit } = await import("../netlify/functions/_shared/ai-audit.mjs");
  assert.equal((await checkRateLimit({ client: "k", limit: 5 })).allowed, true);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : (init.headers || {});
    if (method === "PUT" && String(input).includes("ai-gateway-ratelimit") && (headers["if-match"] || headers["If-Match"])) throw new Error("ECONNRESET (simulerat)");
    return realFetch(input, init);
  };
  try {
    const r = await checkRateLimit({ client: "k", limit: 5 });
    assert.equal(r.allowed, false);
    assert.equal(r.unavailable, true);
    assert.equal(r.reason, "storage_error", "fel som resultatobjekt från commitJson");
  } finally { globalThis.fetch = realFetch; }
  resetVerification();
  setProbeStoreFactory(() => ({ async setJSON() { return undefined; }, async get() { return null; }, async delete() {} }));
  try {
    const r2 = await checkRateLimit({ client: "k2", limit: 5 });
    assert.equal(r2.allowed, false, "unversioned nekar");
    assert.equal(r2.unavailable, true);
  } finally { resetVerification(); setProbeStoreFactory(() => getStore({ name: "case-store-probe", consistency: "strong" })); }
  globalThis.fetch = async (input, init = {}) => { if (String(input).includes("ai-gateway-ratelimit")) throw new Error("ECONNRESET"); return realFetch(input, init); };
  try {
    const r3 = await checkRateLimit({ client: "k3", limit: 5 });
    assert.equal(r3.allowed, false);
    assert.equal(r3.reason, "threw");
  } finally { globalThis.fetch = realFetch; }
});

test("konfiguration i Blobs: utan miljövariabler sätts register, signeringsnyckel och ägar-PIN via admin-token; hemligheter läcker aldrig i status", async (t) => {
  const { call, handler } = await setup(t);
  const { resetConfigCache } = await import("../netlify/functions/_shared/ai-config.mjs");
  const { hashSecret: hs } = await import("../netlify/functions/_shared/ai-auth.mjs");
  for (const k of ["AI_GATEWAY_CLIENTS", "AI_GATEWAY_SIGNING_SECRET", "AI_GATEWAY_OWNER_SECRET", "AI_GATEWAY_OAUTH_SCOPES"]) delete process.env[k];
  resetConfigCache();
  const admin = (method, body) => handler(new Request("https://x/api/ai/config", { method, headers: { "x-admin-token": "adm", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

  assert.equal((await call("/api/ai/whoami", { token: "claude.hemlig" })).status, 503, "ingen konfiguration → fail-closed");
  assert.equal((await handler(new Request("https://x/api/ai/config"))).status, 401, "config kräver admin-token");
  assert.equal((await handler(new Request("https://x/api/ai/config", { headers: { Authorization: `Bearer claude.${SECRET}` } }))).status, 401, "AI-nyckel duger inte för config");
  const empty = await (await admin("GET")).json();
  assert.equal(empty.ready, false);
  assert.equal(empty.source, "env");

  assert.equal((await admin("POST", { ownerPin: "kort" })).status, 400);
  assert.equal((await admin("POST", { clients: [{ id: "x", secretHash: "fel", scopes: ["cases:read"] }] })).status, 400);
  const saved = await admin("POST", {
    clients: [{ id: "claude", label: "Claude", secretHash: hs("nyckel-1"), scopes: ["cases:read", "presence:read"] }, { id: "rapport", secret: "rapport-hemlighet", scopes: ["overview:read"] }],
    signingSecret: "generate",
    ownerPin: "agar-pin-1234-lang",
    oauthScopes: ["cases:read", "overview:read"],
  });
  const status = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(status));
  assert.equal(status.ready, true);
  assert.equal(status.oauthReady, true);
  assert.equal(status.source, "blobs");
  assert.deepEqual(status.clients.map((c) => c.id), ["claude", "rapport"]);
  const text = JSON.stringify(status);
  assert.equal(text.includes("sha256:"), false, "inga hashar i status");
  assert.equal(text.includes("agar-pin"), false);
  assert.equal(/signingSecret"\s*:\s*"[^"]{10,}/.test(text), false);
  const stored = await getStore({ name: "ai-gateway-config", consistency: "strong" }).get("current", { type: "json" });
  assert.equal(stored.ownerSecretHash, `sha256:${(await import("../netlify/functions/_shared/ai-auth.mjs")).sha256Hex("agar-pin-1234-lang")}`, "PIN lagras bara som hash");
  assert.ok(stored.signingSecret.length >= 32);
  assert.equal(stored.clients[1].secretHash, hs("rapport-hemlighet"), "secret i patchen blev hash i lagringen");

  // Klienterna fungerar direkt (ingen deploy, ingen env).
  const who = await (await call("/api/ai/whoami", { token: "claude.nyckel-1" })).json();
  assert.deepEqual(who.scopes, ["cases:read", "presence:read"]);
  assert.equal((await call("/api/ai/whoami", { token: "rapport.rapport-hemlighet" })).status, 200);
  assert.equal((await call("/api/ai/whoami", { token: "claude.fel" })).status, 401);
  // OAuth: client credentials-token signeras med den lagrade nyckeln, samtycke med PIN-hashen.
  const tok = await (await handler(new Request("https://x/api/ai/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials&client_id=rapport&client_secret=rapport-hemlighet" }))).json();
  assert.equal(tok.token_type, "Bearer", JSON.stringify(tok));
  assert.equal((await call("/api/ai/whoami", { token: tok.access_token })).status, 200);
  const session = await oauthSession(handler, call, "agar-pin-1234-lang");
  assert.equal(session.tokens.token_type, "Bearer", JSON.stringify(session.tokens));
  assert.equal(session.tokens.scope, "cases:read", "scope-taket från konfigurationen");
  // Uppdatering av enbart PIN behåller resten; fel PIN nekas.
  assert.equal((await admin("POST", { ownerPin: "ny-pin-som-ar-lang" })).status, 200);
  const consentOld = await handler(new Request("https://x/api/ai/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams([["client_id", session.client.client_id], ["redirect_uri", session.client.redirect_uris[0]], ["code_challenge", "a".repeat(43)], ["owner_pin", "agar-pin-1234-lang"], ["scope", "cases:read"]]).toString() }));
  assert.equal(consentOld.status, 401);
  assert.equal((await (await admin("GET")).json()).clients.length, 2);
  // Miljövariabeln har företräde om den sätts.
  process.env.AI_GATEWAY_CLIENTS = JSON.stringify([{ id: "envklient", secretHash: hs("e"), scopes: ["cases:read"] }]);
  resetConfigCache();
  assert.equal((await call("/api/ai/whoami", { token: "envklient.e" })).status, 200);
  assert.equal((await call("/api/ai/whoami", { token: "claude.nyckel-1" })).status, 401);
});
