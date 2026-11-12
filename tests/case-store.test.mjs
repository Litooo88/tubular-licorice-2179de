// Versionerade ärendeskrivningar: två parallella uppdateringar får aldrig
// skriva över varandra, omförsök kör build på färsk data, och sidoeffekter
// (fångade i closuren) upprepas inte. Dels mot en minnesstore med etag-
// semantik, dels mot @netlify/blobs lokala server (riktig SDK).
//
// Fail-closed: saknas etag, saknar SDK:n { modified }, eller ignorerar
// backend villkorshuvudena (verifieras med probe), stoppas skrivningen
// (reason "unversioned") i stället för att tyst skriva "sist vinner".
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  claimJson, commitCase, createIfAbsent, ensureConditionalWrites, ifMatchSatisfied, readWithEtag, resetVerification,
  setProbeStoreFactory, UnversionedStoreError, verifyConditionalWrites, writeIfMatch,
} from "../netlify/functions/_shared/case-store.mjs";

import { etagStore } from "./_etag-store.mjs";

const withEnv = async (vars, fn) => {
  const before = { ...process.env };
  Object.assign(process.env, vars);
  try { return await fn(); } finally { process.env = before; resetVerification(); }
};

test.beforeEach(() => { delete process.env.CASE_STORE_ALLOW_UNVERSIONED; setProbeStoreFactory(() => etagStore()); });

test("commitCase: parallella uppdateringar bevarar båda ändringarna", async () => {
  const store = etagStore();
  await store.setJSON("c1", { id: "c1", status: "repairing", payment: { status: "unpaid" }, notes: [] });
  const { item, etag } = await readWithEtag(store, "c1");
  assert.equal(item.status, "repairing");
  assert.ok(etag);

  // A läser, B läser (samma version). A skriver betalning, B skriver status.
  const a = commitCase(store, "c1", (cur) => ({ ...cur, payment: { ...cur.payment, status: "paid" } }), { current: item, etag });
  const b = commitCase(store, "c1", (cur) => ({ ...cur, status: "done", notes: [...cur.notes, { text: "klar" }] }), { current: item, etag });
  const [ra, rb] = await Promise.all([a, b]);
  assert.ok(ra.ok && rb.ok);
  assert.equal([ra, rb].filter((r) => r.conflict).length, 1, "exakt en av dem fick göra om på färsk data");
  assert.ok(ra.conditional && rb.conditional);
  const final = await store.get("c1");
  assert.equal(final.payment.status, "paid");
  assert.equal(final.status, "done");
  assert.equal(final.notes.length, 1);
});

test("commitCase: ger upp efter omförsöken och rapporterar konflikt", async () => {
  const store = etagStore();
  await store.setJSON("c1", { id: "c1", n: 0 });
  // Någon annan skriver mellan varje läsning och skrivning.
  let hostile = 0;
  const original = store.getWithMetadata.bind(store);
  store.getWithMetadata = async (key) => {
    const read = await original(key);
    await store.setJSON(key, { ...read.data, n: ++hostile });
    return read;
  };
  const result = await commitCase(store, "c1", (cur) => ({ ...cur, mine: true }), { retries: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "conflict");
  assert.equal(result.attempts, 3);
  assert.equal((await store.get("c1")).mine, undefined);
});

test("commitCase: build körs igen på färsk data, sidoeffekten i closuren upprepas inte", async () => {
  const store = etagStore();
  await store.setJSON("c1", { id: "c1", timeline: [] });
  const { item, etag } = await readWithEtag(store, "c1");
  // Sidoeffekten görs EN gång före commit och fångas i closuren; build läser
  // bara resultatet. Räknaren inne i build visar att build kördes två gånger
  // utan att utskicket upprepades.
  let smsSent = 0;
  let buildRuns = 0;
  const sendOnce = () => ({ status: "sent", id: `sms-${++smsSent}` });
  const sms = sendOnce();
  await store.setJSON("c1", { ...item, timeline: [{ event: "annan ändring" }] });
  const result = await commitCase(store, "c1", (cur) => { buildRuns += 1; return { ...cur, timeline: [...cur.timeline, { event: `SMS ${sms.id}` }] }; }, { current: item, etag });
  assert.ok(result.ok);
  assert.equal(result.attempts, 2);
  assert.equal(buildRuns, 2);
  assert.equal(smsSent, 1);
  assert.deepEqual((await store.get("c1")).timeline.map((t) => t.event), ["annan ändring", "SMS sms-1"]);
});

test("commitCase: not_found och aborted", async () => {
  const store = etagStore();
  assert.equal((await commitCase(store, "saknas", (cur) => cur)).reason, "not_found");
  await store.setJSON("c1", { id: "c1" });
  const aborted = await commitCase(store, "c1", () => null);
  assert.equal(aborted.reason, "aborted");
  assert.equal(store.writes, 1);
});

test("createIfAbsent: andra försöket får vinnaren tillbaka, verifierat", async () => {
  const store = etagStore();
  const first = await createIfAbsent(store, "k", { id: "k", v: 1 });
  const second = await createIfAbsent(store, "k", { id: "k", v: 2 });
  assert.equal(first.created, true);
  assert.equal(first.verified, true);
  assert.equal(second.created, false);
  assert.equal(second.verified, true);
  assert.equal(second.item.v, 1);
});

test("fail-closed: gammal etag skriver inte", async () => {
  const store = etagStore();
  await store.setJSON("c1", { id: "c1", n: 1 });
  const { etag } = await readWithEtag(store, "c1");
  await store.setJSON("c1", { id: "c1", n: 2 });
  const stale = await writeIfMatch(store, "c1", { id: "c1", n: 99 }, etag);
  assert.equal(stale.modified, false);
  assert.equal(stale.conditional, true);
  assert.equal((await store.get("c1")).n, 2);
});

test("fail-closed: saknat etag stoppar skrivningen (ingen 'sist vinner')", async () => {
  const store = etagStore();
  await store.setJSON("c1", { id: "c1", n: 1 });
  // Store som inte ger etag vare sig på GET eller list.
  store.getWithMetadata = async (key) => ({ data: await store.get(key), etag: "", metadata: {} });
  store.list = async () => ({ blobs: [] });
  const read = await readWithEtag(store, "c1");
  assert.equal(read.etag, undefined);
  await assert.rejects(() => writeIfMatch(store, "c1", { id: "c1", n: 2 }, undefined), UnversionedStoreError);
  const result = await commitCase(store, "c1", (cur) => ({ ...cur, n: 2 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unversioned");
  assert.equal(result.code, "etag_missing");
  assert.equal((await store.get("c1")).n, 1, "inget skrevs");
});

test("fail-closed: SDK utan { modified } (8.x) stoppar skrivning och dedup", async () => {
  const rows = new Map();
  const legacy = {
    async get(key) { return rows.get(key) ?? null; },
    async setJSON(key, value) { rows.set(key, value); },
  };
  await legacy.setJSON("c1", { id: "c1" });
  await assert.rejects(() => readWithEtag(legacy, "c1"), UnversionedStoreError);
  const result = await commitCase(legacy, "c1", (cur) => ({ ...cur, y: 2 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unversioned");
  assert.equal(result.code, "sdk_without_metadata_read");
  assert.equal(rows.get("c1").y, undefined);
  // createIfAbsent får aldrig rapportera en verifierad dedup utan { modified }.
  setProbeStoreFactory(() => ({ ...legacy, async delete() {} }));
  await assert.rejects(() => createIfAbsent(legacy, "k", { v: 1 }), UnversionedStoreError);
});

test("fail-closed: backend som ignorerar villkoren avslöjas av proben", async () => {
  // Svarar modified: true på allt – precis som en server som inte läser If-Match.
  const ignoring = () => {
    const base = etagStore();
    base.setJSON = async (key, value) => { base.rows.set(key, { value: structuredClone(value), etag: `"x${base.rows.size + 1}"` }); return { modified: true, etag: "\"x\"" }; };
    return base;
  };
  setProbeStoreFactory(ignoring);
  const probe = await verifyConditionalWrites(ignoring());
  assert.equal(probe.ok, false);
  assert.equal(probe.steps.onlyIfNewCreate, true);
  assert.equal(probe.steps.onlyIfNewDuplicate, false);
  assert.equal(probe.steps.onlyIfMatchStale, false);
  await assert.rejects(() => ensureConditionalWrites(), UnversionedStoreError);
  const store = etagStore();
  await store.setJSON("c1", { id: "c1" });
  const result = await commitCase(store, "c1", (cur) => ({ ...cur, y: 1 }));
  assert.equal(result.reason, "unversioned");
  assert.equal(result.code, "conditional_writes_unverified");
  await assert.rejects(() => createIfAbsent(store, "k", { v: 1 }), UnversionedStoreError);
});

test("proben: fungerande store ger ok med alla steg", async () => {
  const probe = await verifyConditionalWrites(etagStore());
  assert.equal(probe.ok, true, JSON.stringify(probe));
  assert.deepEqual(probe.steps, { onlyIfNewCreate: true, onlyIfNewDuplicate: true, etagOnRead: true, onlyIfMatchStale: true, onlyIfMatchFresh: true, valueAfterFresh: true });
  assert.equal(probe.etagSource, "get");
});

test("nödventil CASE_STORE_ALLOW_UNVERSIONED: skriver ovillkorat men säger conditional=false / verified=false", async () => {
  await withEnv({ CASE_STORE_ALLOW_UNVERSIONED: "1" }, async () => {
    const rows = new Map();
    const legacy = {
      async get(key) { return rows.get(key) ?? null; },
      async setJSON(key, value) { rows.set(key, value); },
      async delete(key) { rows.delete(key); },
    };
    setProbeStoreFactory(() => legacy);
    await legacy.setJSON("c1", { id: "c1" });
    const result = await commitCase(legacy, "c1", (cur) => ({ ...cur, y: 2 }));
    assert.ok(result.ok);
    assert.equal(result.conditional, false);
    assert.equal(rows.get("c1").y, 2);
    const created = await createIfAbsent(legacy, "k", { v: 1 });
    assert.equal(created.created, true);
    assert.equal(created.verified, false, "aldrig en verifierad dedup utan stöd");
  });
});

test("claimJson: två samtidiga reservationer – en vinner, övergiven reservation kan tas över", async () => {
  const store = etagStore();
  await store.setJSON("q1", { id: "q1", message: "hej" });
  const [a, b] = await Promise.all([claimJson(store, "q1", { by: "A" }), claimJson(store, "q1", { by: "B" })]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal([a, b].find((r) => !r.ok).reason, "conflict");
  const third = await claimJson(store, "q1", { by: "C" });
  assert.equal(third.reason, "in_flight");
  const later = await claimJson(store, "q1", { by: "C", now: Date.now() + 11 * 60 * 1000 });
  assert.ok(later.ok);
  assert.equal(later.item.claimedBy, "C");
  assert.equal(later.item.claimCount, 2);
  assert.equal((await claimJson(store, "saknas")).reason, "not_found");
});

test("ifMatchSatisfied: tom header = ok, matchande/omatchande etag", () => {
  const req = (value) => new Request("https://x/", { headers: value ? { "If-Match": value } : {} });
  assert.equal(ifMatchSatisfied(req(""), '"abc"'), true);
  assert.equal(ifMatchSatisfied(req("*"), '"abc"'), true);
  assert.equal(ifMatchSatisfied(req('"abc"'), '"abc"'), true);
  assert.equal(ifMatchSatisfied(req('W/"abc"'), '"abc"'), true);
  assert.equal(ifMatchSatisfied(req('"old"'), '"abc"'), false);
  assert.equal(ifMatchSatisfied(req('"abc"'), undefined), false);
});

test("riktig SDK: @netlify/blobs lokal server stöder etag + onlyIfMatch + probe", async (t) => {
  const { getStore, setEnvironmentContext } = await import("@netlify/blobs");
  const { BlobsServer } = await import("@netlify/blobs/server");
  const dir = await mkdtemp(join(tmpdir(), "blobs-etag-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  setProbeStoreFactory(() => getStore({ name: "case-store-probe", consistency: "strong" }));
  t.after(async () => { await server.stop(); await rm(dir, { recursive: true, force: true }); });

  const probe = await verifyConditionalWrites(getStore({ name: "case-store-probe", consistency: "strong" }));
  assert.equal(probe.ok, true, JSON.stringify(probe));
  assert.equal(probe.etagSource, "list", "lokala servern ger etag bara via list");

  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  await store.setJSON("c1", { id: "c1", status: "new" });
  const { item, etag } = await readWithEtag(store, "c1");
  assert.equal(item.status, "new");
  assert.ok(etag, "lokala servern ger etag");
  const stale = await writeIfMatch(store, "c1", { id: "c1", status: "stale" }, '"not-the-etag"');
  assert.equal(stale.modified, false);
  assert.equal(stale.conditional, true);
  const fresh = await writeIfMatch(store, "c1", { id: "c1", status: "contacted" }, etag);
  assert.equal(fresh.modified, true);
  assert.equal((await store.get("c1", { type: "json" })).status, "contacted");
  const dup = await createIfAbsent(store, "c1", { id: "c1", status: "overwritten" });
  assert.equal(dup.created, false);
  assert.equal(dup.item.status, "contacted");
});
