// Hela kedjan mot lokal Blobs-server: två samtidiga PATCH på samma ärende
// (betalning + anteckning) får inte skriva över varandra, GET ger ETag,
// If-Match ger 412 på gammal version. 46elks/Resend mockas; inget lämnar
// maskinen.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";

const setup = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-cc-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  const realFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  Object.assign(process.env, { ADMIN_TOKEN: "adm", ELKS_USERNAME: "u", ELKS_PASSWORD: "p", SEBASTIAN_SMS_TO: "+46700243319", SMS_INBOUND_SECRET: "inb" });
  delete process.env.RESEND_API_KEY;
  const sent = [];
  // Lokala servern sätter etag på filens mtime (ms). För att få en ÄKTA
  // överlappning fördröjs den första skrivningen mot en nyckel i `slowPut`,
  // så att den andra handlern hinner läsa samma version och skriva först.
  const slowPut = new Set();
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input);
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "PUT" && [...slowPut].some((key) => u.endsWith(`/${key}`))) {
      slowPut.delete([...slowPut].find((key) => u.endsWith(`/${key}`)));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (u.includes("api.46elks.com")) { sent.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return new Response(JSON.stringify({ id: `s${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } }); }
    return realFetch(input, init);
  };
  t.after(async () => { globalThis.fetch = realFetch; process.env = oldEnv; await server.stop(); await rm(dir, { recursive: true, force: true }); });
  return { sent, slowPut };
};

const headers = { "x-admin-token": "adm", "Content-Type": "application/json" };
const patch = (handler, id, body, extra = {}) =>
  handler(new Request(`https://x/api/cases/${id}`, { method: "PATCH", headers: { ...headers, ...extra }, body: JSON.stringify(body) }), { params: { id } });

test("cases: två samtidiga PATCH bevarar båda ändringarna, GET ger ETag, If-Match ger 412", async (t) => {
  const { slowPut } = await setup(t);
  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  await cases.setJSON("case_1", { id: "case_1", status: "repairing", customer: { name: "Erik Ek", phone: "0704444444" }, payment: { status: "unpaid", amount: 1200 }, completion: {}, notes: [], timeline: [] });
  const { default: handler } = await import("../netlify/functions/workshop-cases.mjs");

  const read = await handler(new Request("https://x/api/cases/case_1", { headers }), { params: { id: "case_1" } });
  assert.equal(read.status, 200);
  const etag = read.headers.get("etag");
  assert.ok(etag, "GET /api/cases/:id svarar med ETag");

  slowPut.add("case_1");
  const [a, b] = await Promise.all([
    patch(handler, "case_1", { paymentStatus: "paid", paymentMethod: "swish", operatorName: "A", suppressThankYou: true }),
    patch(handler, "case_1", { note: "Kunden hämtar i morgon", operatorName: "B" }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const da = await a.json();
  const db = await b.json();
  assert.equal([da, db].filter((d) => d.conflictRetries > 0).length, 1, "exakt en PATCH gjorde om på färsk data");

  const final = await cases.get("case_1", { type: "json" });
  assert.equal(final.payment.status, "paid");
  assert.equal(final.notes.length, 1);
  assert.equal(final.notes[0].text, "Kunden hämtar i morgon");
  assert.ok(final.timeline.some((e) => /Betalning: paid/.test(e.event)));
  assert.ok(final.timeline.some((e) => /Uppdaterad av B/.test(e.event)));
  assert.equal(final.notifications.thankYou.status, "suppressed");

  // Gammal version i If-Match → 412, inget skrivs.
  const stale = await patch(handler, "case_1", { note: "gammal flik" }, { "If-Match": etag });
  assert.equal(stale.status, 412);
  assert.equal((await stale.json()).code, "precondition_failed");
  assert.equal((await cases.get("case_1", { type: "json" })).notes.length, 1);

  // Färsk ETag → ok.
  const fresh = await handler(new Request("https://x/api/cases/case_1", { headers }), { params: { id: "case_1" } });
  const ok = await patch(handler, "case_1", { note: "ny flik" }, { "If-Match": fresh.headers.get("etag") });
  assert.equal(ok.status, 200);
  assert.ok(ok.headers.get("etag"));
});

test("cases: send_sms samtidigt med fältändring – SMS:et skickas en gång och loggas på färsk version", async (t) => {
  const { sent, slowPut } = await setup(t);
  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  await cases.setJSON("case_2", { id: "case_2", status: "contacted", customer: { name: "Anna", phone: "0705555555" }, payment: {}, completion: {}, notes: [], timeline: [], outboundMessages: [] });
  const { default: handler } = await import("../netlify/functions/workshop-cases.mjs");
  slowPut.add("case_2");
  const [a, b] = await Promise.all([
    patch(handler, "case_2", { action: "send_sms", message: "Hej Anna! Din scooter är klar.", operatorName: "A" }),
    patch(handler, "case_2", { estimatedValue: 1500, operatorName: "B" }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(sent.length, 1, "exakt ett SMS");
  const final = await cases.get("case_2", { type: "json" });
  assert.equal(final.estimatedValue, 1500);
  assert.equal(final.outboundMessages.length, 1);
  assert.equal(final.status, "waiting_customer");
});

test("sms-inbound: dubblettleverans ignoreras, entydigt ärende får SMS:et på tidslinjen", async (t) => {
  const { sent } = await setup(t);
  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  await cases.setJSON("case_3", { id: "case_3", serviceNumber: "NE-3", status: "repairing", customer: { name: "Omar", phone: "0706666666" }, timeline: [] });
  await cases.setJSON("case_4", { id: "case_4", serviceNumber: "NE-4", status: "done", customer: { name: "Omar", phone: "0706666666" }, timeline: [] });
  await cases.setJSON("case_5", { id: "case_5", serviceNumber: "NE-5", status: "new", customer: { name: "Lisa", phone: "0707777777" }, timeline: [] });
  await cases.setJSON("case_6", { id: "case_6", serviceNumber: "NE-6", status: "repairing", customer: { name: "Lisa", phone: "0707777777" }, timeline: [] });
  const { default: handler } = await import("../netlify/functions/sms-inbound.mjs");
  const post = (params) => handler(new Request("https://x/api/sms-inbound?secret=inb", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() }));
  const base = { to: "+46101385498", direction: "incoming" };

  assert.equal((await handler(new Request("https://x/api/sms-inbound?secret=fel", { method: "POST", body: "" }))).status, 403);

  const r1 = await post({ ...base, id: "s100", from: "+46706666666", message: "Hej, är den klar snart?" });
  assert.equal(r1.status, 200);
  assert.equal(sent.length, 1, "en notis till Sebastian");
  assert.match(sent[0].message, /ärende NE-3/);
  const r2 = await post({ ...base, id: "s100", from: "+46706666666", message: "Hej, är den klar snart?" });
  assert.equal(r2.status, 200);
  assert.equal(sent.length, 1, "samma 46elks-id igen → ingen ny notis");

  const c3 = await cases.get("case_3", { type: "json" });
  assert.equal(c3.inboundMessages.length, 1);
  assert.equal(c3.inboundMessages[0].providerId, "s100");
  assert.match(c3.timeline[0].event, /^SMS från kund mottaget/);
  assert.equal((await cases.get("case_4", { type: "json" })).inboundMessages, undefined, "avslutat ärende rörs inte");

  // Två öppna ärenden → ambiguous, inget kopplas.
  await post({ ...base, id: "s101", from: "+46707777777", message: "Ring mig" });
  assert.equal((await cases.get("case_5", { type: "json" })).inboundMessages, undefined);
  assert.equal((await cases.get("case_6", { type: "json" })).inboundMessages, undefined);
  const inbound = getStore({ name: "sms-inbound", consistency: "strong" });
  const { blobs } = await inbound.list();
  const entries = await Promise.all(blobs.map((b) => inbound.get(b.key, { type: "json" })));
  const lisa = entries.find((e) => e.providerId === "s101");
  assert.equal(lisa.caseMatch.status, "ambiguous");
  assert.equal(lisa.caseId, "");
  assert.deepEqual(lisa.caseMatch.candidates.map((c) => c.serviceNumber).sort(), ["NE-5", "NE-6"]);
  const omar = entries.find((e) => e.providerId === "s100");
  assert.equal(omar.caseId, "case_3");
  assert.equal(omar.caseMatch.status, "matched");
});
