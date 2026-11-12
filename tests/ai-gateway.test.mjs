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
  assert.equal(wk.auth.oauth_authorization_code, false);
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
  assert.equal(last.args.query, "0701112233", "sökfrågan loggas (ingen kunddata från svaret)");
});
