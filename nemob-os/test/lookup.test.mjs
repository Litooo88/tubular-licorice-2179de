import test from "node:test";
import assert from "node:assert/strict";
import { compactCase, normalizePhoneDigits, openCasesPrioritized, searchCases } from "../lib/lookup.mjs";
import { fetchAdminCases, resetCasesCache } from "../lib/admin-cases.mjs";

const NOW = new Date("2026-07-14T12:00:00+02:00");
const CASES = [
  {
    id: "case_2026-07-01_abc123",
    serviceNumber: "S-1042",
    customer: { name: "Per Andersson", phone: "070-123 45 67" },
    vehicle: { model: "NAVEE GT3 Max" },
    service: "Motorfel bakhjul",
    status: "in_progress",
    payment: { status: "unpaid" },
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-10T09:00:00.000Z",
    internalNote: "FÅR EJ LÄCKA",
  },
  {
    id: "case_2026-06-20_def456",
    customer: { name: "Anna Berg", phone: "+46705554433" },
    vehicle: { model: "Xiaomi Pro 2" },
    service: "Punktering",
    status: "done",
    createdAt: "2026-06-20T09:00:00.000Z",
    updatedAt: "2026-06-22T09:00:00.000Z",
  },
  {
    id: "case_2026-05-01_ghi789",
    customer: { name: "Johan Ek", phone: "0736669988" },
    vehicle: { model: "KuKirin G2 Master" },
    service: "Vikmekanism",
    status: "waiting_customer",
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-02T09:00:00.000Z",
  },
];

test("namnsökning är skiftlägesokänslig och matchar delsträng", () => {
  const hits = searchCases(CASES, "per", { now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Per Andersson");
  assert.equal(hits[0].serviceNumber, "S-1042");
});

test("telefonsökning matchar oavsett format", () => {
  assert.equal(normalizePhoneDigits("+46 70-123 45 67"), "701234567");
  assert.equal(normalizePhoneDigits("0701234567"), "701234567");
  for (const query of ["070-123 45 67", "0701234567", "+46701234567", "123 45 67"]) {
    const hits = searchCases(CASES, query, { now: NOW });
    assert.equal(hits.length, 1, query);
    assert.equal(hits[0].name, "Per Andersson", query);
  }
});

test("modellsökning hittar rätt ärende", () => {
  const hits = searchCases(CASES, "gt3 max", { now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].vehicle, "NAVEE GT3 Max");
});

test("whitelisten läcker aldrig extra fält till telefonen", () => {
  const compact = compactCase(CASES[0], NOW);
  assert.deepEqual(Object.keys(compact).sort(), [
    "daysOpen", "id", "name", "paymentStatus", "phone",
    "serviceNumber", "service", "status", "updatedAt", "vehicle",
  ].sort());
  assert.ok(!JSON.stringify(compact).includes("FÅR EJ LÄCKA"));
});

test("tom sökfråga ger tom lista, aldrig hela databasen", () => {
  assert.deepEqual(searchCases(CASES, "", { now: NOW }), []);
  assert.deepEqual(searchCases(CASES, "   ", { now: NOW }), []);
});

test("pågående arbeten exkluderar avslutade och sorterar äldst först", () => {
  const open = openCasesPrioritized(CASES, { now: NOW });
  assert.deepEqual(open.map((c) => c.name), ["Johan Ek", "Per Andersson"]);
  assert.ok(open[0].daysOpen > open[1].daysOpen);
});

test("admin-proxy: utan token => not_configured, fel => generisk kod utan tokenläckage", async () => {
  resetCasesCache();
  assert.equal((await fetchAdminCases({ env: {} })).status, "not_configured");

  const down = await fetchAdminCases({
    env: { NORDIC_ADMIN_TOKEN: "hemligtoken123" },
    fetchImpl: async () => { throw new Error("connect fail hemligtoken123"); },
  });
  assert.equal(down.status, "down");
  assert.equal(down.code, "unreachable");
  assert.ok(!JSON.stringify(down).includes("hemligtoken123"));

  const unauthorized = await fetchAdminCases({
    env: { NORDIC_ADMIN_TOKEN: "hemligtoken123" },
    fetchImpl: async () => new Response("nope", { status: 401 }),
  });
  assert.equal(unauthorized.code, "unauthorized");
});

test("admin-proxy: lyckat svar cachas och stale cache används vid avbrott", async () => {
  resetCasesCache();
  let time = 1_000_000;
  const env = { NORDIC_ADMIN_TOKEN: "tok_test_123" };
  const ok = await fetchAdminCases({
    env, now: () => time,
    fetchImpl: async (url, opts) => {
      assert.equal(opts.method, "GET", "proxyn får ALDRIG göra annat än GET");
      return new Response(JSON.stringify({ cases: CASES }), { status: 200 });
    },
  });
  assert.equal(ok.status, "ok");
  assert.equal(ok.cases.length, 3);

  time += 30_000; // inom TTL => cache, ingen ny fetch
  const cached = await fetchAdminCases({ env, now: () => time, fetchImpl: async () => { throw new Error("ska inte anropas"); } });
  assert.equal(cached.fromCache, true);

  time += 120_000; // TTL passerad, källan nere => stale cases returneras
  const stale = await fetchAdminCases({ env, now: () => time, fetchImpl: async () => { throw new Error("nere"); } });
  assert.equal(stale.status, "down");
  assert.equal(stale.cases.length, 3);
});
