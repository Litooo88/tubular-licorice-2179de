// Versionerade ärendeskrivningar: två parallella uppdateringar får aldrig
// skriva över varandra, omförsök kör build på färsk data, och sidoeffekter
// (fångade i closuren) upprepas inte. Dels mot en minnesstore med etag-
// semantik, dels mot @netlify/blobs lokala server (riktig SDK).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commitCase, createIfAbsent, ifMatchSatisfied, readWithEtag, writeIfMatch } from "../netlify/functions/_shared/case-store.mjs";

// Minnesstore som beter sig som @netlify/blobs ≥ 9: etag per version,
// onlyIfMatch/onlyIfNew → { modified }.
export const etagStore = () => {
  const rows = new Map();
  let version = 0;
  const etagOf = (key) => rows.get(key)?.etag;
  return {
    rows,
    writes: 0,
    async get(key) { return structuredClone(rows.get(key)?.value ?? null); },
    async getWithMetadata(key) {
      const row = rows.get(key);
      return row ? { data: structuredClone(row.value), etag: row.etag, metadata: {} } : null;
    },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && rows.has(key)) return { modified: false };
      if (options.onlyIfMatch && etagOf(key) !== options.onlyIfMatch) return { modified: false };
      this.writes += 1;
      const etag = `"v${++version}"`;
      rows.set(key, { value: structuredClone(value), etag });
      return { modified: true, etag };
    },
    async delete(key) { rows.delete(key); },
    async list() { return { blobs: [...rows.keys()].map((key) => ({ key })) }; },
  };
};

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
  // Simulera att ett SMS redan skickats (en gång) och att någon annan hann skriva.
  let smsSent = 0;
  const sms = { status: "sent", id: `sms-${++smsSent}` };
  await store.setJSON("c1", { ...item, timeline: [{ event: "annan ändring" }] });
  const result = await commitCase(store, "c1", (cur) => ({ ...cur, timeline: [...cur.timeline, { event: `SMS ${sms.id}` }] }), { current: item, etag });
  assert.ok(result.ok);
  assert.equal(result.attempts, 2);
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

test("createIfAbsent: andra försöket får vinnaren tillbaka", async () => {
  const store = etagStore();
  const first = await createIfAbsent(store, "k", { id: "k", v: 1 });
  const second = await createIfAbsent(store, "k", { id: "k", v: 2 });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.item.v, 1);
});

test("fallback: store utan villkorade skrivningar skriver ovillkorat och säger conditional=false", async () => {
  const rows = new Map();
  const legacy = {
    async get(key) { return rows.get(key) ?? null; },
    async setJSON(key, value) { rows.set(key, value); },
  };
  await legacy.setJSON("c1", { id: "c1" });
  const read = await readWithEtag(legacy, "c1");
  assert.equal(read.etag, undefined);
  const written = await writeIfMatch(legacy, "c1", { id: "c1", x: 1 }, undefined);
  assert.deepEqual(written, { modified: true, etag: undefined, conditional: false });
  const result = await commitCase(legacy, "c1", (cur) => ({ ...cur, y: 2 }));
  assert.ok(result.ok);
  assert.equal(result.conditional, false);
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

test("riktig SDK: @netlify/blobs lokal server stöder etag + onlyIfMatch", async (t) => {
  const { getStore, setEnvironmentContext } = await import("@netlify/blobs");
  const { BlobsServer } = await import("@netlify/blobs/server");
  const dir = await mkdtemp(join(tmpdir(), "blobs-etag-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  t.after(async () => { await server.stop(); await rm(dir, { recursive: true, force: true }); });

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
