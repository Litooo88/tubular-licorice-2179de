// outbox-flush: köade utkast-SMS skickas en gång även om två körningar
// överlappar (reservation per köpost), loggas via utskicksjournalen och
// köposten tas bort. Klockan fryses till förmiddag (utanför tysta timmar).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./_blobs-test-env.mjs";
import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import { resetVerification, setProbeStoreFactory } from "../netlify/functions/_shared/case-store.mjs";

const FIXED = new Date("2026-11-12T09:30:00.000Z").getTime(); // 10:30 svensk tid
const RealDate = Date;

test("outbox-flush: två överlappande körningar skickar ett köat utkast exakt en gång", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-outbox-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  resetVerification();
  setProbeStoreFactory(() => getStore({ name: "case-store-probe", consistency: "strong" }));
  const oldEnv = { ...process.env };
  Object.assign(process.env, { ELKS_USERNAME: "u", ELKS_PASSWORD: "p" });
  delete process.env.RESEND_API_KEY;
  const realFetch = globalThis.fetch;
  const sent = [];
  const putLocks = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input);
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (u.includes("api.46elks.com")) { sent.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return new Response(JSON.stringify({ id: `s${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } }); }
    if (method === "PUT") { const previous = putLocks.get(u) || Promise.resolve(); const run = previous.catch(() => {}).then(() => realFetch(input, init)); putLocks.set(u, run); return run; }
    return realFetch(input, init);
  };
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [FIXED])); }
    static now() { return FIXED; }
  }
  globalThis.Date = FakeDate;
  t.after(async () => { globalThis.Date = RealDate; globalThis.fetch = realFetch; process.env = oldEnv; await server.stop(); await rm(dir, { recursive: true, force: true }); });

  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  await cases.setJSON("case_7", { id: "case_7", status: "new", customer: { name: "Nour", phone: "0701234567" }, smsLog: [], timeline: [] });
  const outbox = getStore({ name: "outbox", consistency: "strong" });
  await outbox.setJSON("case_7-draft-1", { type: "draft_sms", caseId: "case_7", draftId: "case_7", phone: "+46701234567", message: "Hej Nour! Vi hör av oss i dag.", category: "B", operator: "Sebastian", sendAfter: new RealDate(FIXED - 60000).toISOString(), queuedAt: new RealDate(FIXED - 3600000).toISOString() });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const { default: flush } = await import("../netlify/functions/outbox-flush.mjs");
  const [a, b] = await Promise.all([flush(), flush()]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(sent.length, 1, "exakt ett SMS trots två körningar");
  assert.equal(sent[0].to, "+46701234567");

  const item = await cases.get("case_7", { type: "json" });
  assert.equal(item.status, "contacted");
  assert.equal(item.smsLog.length, 1);
  assert.ok(item.smsLog[0].journalKey);
  assert.equal(item.smsLog[0].providerId, "s1");
  const journal = await getStore({ name: "send-journal", consistency: "strong" }).get(item.smsLog[0].journalKey, { type: "json" });
  assert.equal(journal.status, "committed");
  assert.equal((await outbox.list()).blobs.length, 0, "köposten är borta");

  // En tredje körning hittar inget.
  await flush();
  assert.equal(sent.length, 1);
});
