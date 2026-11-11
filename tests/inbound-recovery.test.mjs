// Inkommande SMS med beständig behandlingsstatus, mot lokal Blobs-server.
// Avbrott simuleras i olika steg (ärendeskrivning, inkorg, notis) genom att
// låta enskilda PUT-anrop mot lagringen svara 500 eller 46elks kasta. 46elks
// och Resend mockas; inget lämnar maskinen.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./_blobs-test-env.mjs";
import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import { resetVerification, setProbeStoreFactory } from "../netlify/functions/_shared/case-store.mjs";

const setup = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-inb-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  resetVerification();
  setProbeStoreFactory(() => getStore({ name: "case-store-probe", consistency: "strong" }));
  (await import("../netlify/functions/sms-inbound.mjs")).resetNotifyCooldown();
  const realFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  Object.assign(process.env, { ADMIN_TOKEN: "adm", ELKS_USERNAME: "u", ELKS_PASSWORD: "p", SEBASTIAN_SMS_TO: "+46700243319", SMS_INBOUND_SECRET: "inb" });
  delete process.env.RESEND_API_KEY;
  const sent = [];
  // failPut: "store/key" eller "store/*" → antal PUT som ska kasta nätfel.
  // SDK:n gör upp till 6 försök per skrivning, så 6 = "en logisk skrivning faller".
  // elksThrow: antal 46elks-anrop som ska kasta (nätfel).
  const failPut = new Map();
  const putLocks = new Map();
  const state = { elksThrow: 0 };
  // Värdet är ett antal, eller { skip, left }: släpp igenom `skip` PUT först.
  const failing = (u) => {
    for (const [pattern, value] of failPut) {
      const entry = typeof value === "number" ? { skip: 0, left: value } : value;
      if (entry.left <= 0) continue;
      const [store, key] = pattern.split("/");
      if (!new RegExp(`[/:]${store}/`).test(u)) continue; // lokala servern: /site/site:<store>/<key>
      if (key !== "*" && !u.endsWith(`/${key}`)) continue;
      if (entry.skip > 0) { failPut.set(pattern, { ...entry, skip: entry.skip - 1 }); continue; }
      failPut.set(pattern, { ...entry, left: entry.left - 1 });
      return true;
    }
    return false;
  };
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input);
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (u.includes("api.46elks.com")) {
      if (state.elksThrow > 0) { state.elksThrow -= 1; throw new Error("ECONNRESET"); }
      sent.push(Object.fromEntries(new URLSearchParams(String(init.body))));
      return new Response(JSON.stringify({ id: `s${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Nätfel, inte 500: SDK:n räknar ALLA svar utom 412 som lyckad villkorad
    // skrivning (dist/main.js, set/setJSON) – bara ett kastat fel når anroparen.
    if (method === "PUT" && failing(u)) throw new Error("ECONNRESET (simulerat)");
    // Lokala servern kontrollerar If-Match och skriver i två steg utan lås, så
    // två samtidiga PUT med samma etag kan båda passera. Produktionens backend
    // är atomär per nyckel; emulera det genom att köa PUT per URL.
    if (method === "PUT") {
      const previous = putLocks.get(u) || Promise.resolve();
      const run = previous.catch(() => {}).then(() => realFetch(input, init));
      putLocks.set(u, run);
      return run;
    }
    return realFetch(input, init);
  };
  t.after(async () => { globalThis.fetch = realFetch; process.env = oldEnv; await server.stop(); await rm(dir, { recursive: true, force: true }); });
  return { sent, failPut, state };
};

const seed = async () => {
  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  await cases.setJSON("case_3", { id: "case_3", serviceNumber: "NE-3", status: "repairing", customer: { name: "Omar", phone: "0706666666" }, timeline: [] });
  await getStore({ name: "comm-config", consistency: "strong" }).setJSON("sms-approval", { enabled: false, updatedAt: null, by: "test" });
  return cases;
};
const post = (handler, params) => handler(new Request("https://x/api/sms-inbound?secret=inb", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ to: "+46101385498", direction: "incoming", ...params }).toString() }));
const seen = (id) => getStore({ name: "sms-inbound-seen", consistency: "strong" }).get(id, { type: "json" });
const inboxEntries = async () => {
  const inbound = getStore({ name: "sms-inbound", consistency: "strong" });
  const { blobs } = await inbound.list();
  return Promise.all(blobs.map((b) => inbound.get(b.key, { type: "json" })));
};

test("avbrott i ärendeskrivningen: inkorg + notis sker, kopplingen försöks igen vid omleverans utan ny notis", async (t) => {
  const { sent, failPut } = await setup(t);
  const cases = await seed();
  const { default: handler } = await import("../netlify/functions/sms-inbound.mjs");

  failPut.set("workshop-cases/case_3", 6); // en logisk skrivning (inkl. SDK-omförsök) faller
  const r1 = await post(handler, { id: "m1", from: "+46706666666", message: "Är den klar?" });
  assert.equal(r1.status, 200);
  assert.equal(sent.length, 1, "notisen gick");
  let record = await seen("m1");
  assert.equal(record.status, "failed");
  assert.equal(record.steps.link.final, false);
  assert.equal(record.steps.notified, "sent");
  assert.ok(record.steps.inboxKey);
  assert.equal((await cases.get("case_3", { type: "json" })).inboundMessages, undefined);
  assert.equal((await inboxEntries()).length, 1);

  // Omleverans av samma id: tar över den misslyckade posten, kopplar, ingen ny notis.
  const r2 = await post(handler, { id: "m1", from: "+46706666666", message: "Är den klar?" });
  assert.equal(r2.status, 200);
  record = await seen("m1");
  assert.equal(record.status, "done");
  assert.equal(record.attempts, 2);
  assert.equal(record.steps.link.attached, true);
  assert.equal(sent.length, 1, "ingen andra notis");
  const c3 = await cases.get("case_3", { type: "json" });
  assert.equal(c3.inboundMessages.length, 1);
  assert.equal(c3.inboundMessages[0].providerId, "m1");
  const entries = await inboxEntries();
  assert.equal(entries.length, 1, "samma inkorgsnyckel återanvänds");
  assert.equal(entries[0].caseId, "case_3");
  assert.equal(entries[0].caseMatch.status, "matched");

  // Tredje leveransen: klar → ignoreras helt.
  await post(handler, { id: "m1", from: "+46706666666", message: "Är den klar?" });
  assert.equal(sent.length, 1);
  assert.equal((await cases.get("case_3", { type: "json" })).inboundMessages.length, 1);
});

test("krasch i inkorgsskrivningen: 500 till 46elks, comm-reconcile kör klart (notis en gång)", async (t) => {
  const { sent, failPut } = await setup(t);
  const cases = await seed();
  const { default: handler, reprocessInbound } = await import("../netlify/functions/sms-inbound.mjs");

  failPut.set("sms-inbound/*", 6);
  const r1 = await post(handler, { id: "m2", from: "+46706666666", message: "Hej igen" });
  assert.equal(r1.status, 500, "oväntat fel → 46elks får skicka om");
  let record = await seen("m2");
  assert.equal(record.status, "failed");
  assert.match(record.lastError, /ECONNRESET/);
  assert.equal(record.steps.link.attached, true, "kopplingen hann göras");
  assert.equal(record.steps.inboxKey, undefined);
  assert.equal(sent.length, 0, "notisen hade inte skickats än");

  const counts = await reprocessInbound({ now: Date.now() });
  assert.equal(counts.resumed, 1);
  assert.equal(counts.done, 1);
  record = await seen("m2");
  assert.equal(record.status, "done");
  assert.equal(sent.length, 1, "notisen gick exakt en gång");
  assert.equal((await inboxEntries()).length, 1);
  assert.equal((await cases.get("case_3", { type: "json" })).inboundMessages.length, 1, "ärendet fick inte raden två gånger");

  // Ingen ny körning gör något.
  const again = await reprocessInbound({ now: Date.now() });
  assert.equal(again.resumed, 0);
  assert.equal(sent.length, 1);
});

test("behandlingsstatusen kan inte sparas mitt i: 500, inget steg räknas som gjort, omkörning ger en notis", async (t) => {
  const { sent, failPut } = await setup(t);
  const cases = await seed();
  const { default: handler, reprocessInbound } = await import("../netlify/functions/sms-inbound.mjs");
  // PUT mot seen-posten: 1 skapa, 2 blocked, 3 link, 4 inbox → låt #4 falla
  // (SDK:n gör 6 försök) så att inkorgsposten är skriven men inte avbockad.
  failPut.set("sms-inbound-seen/m10", { skip: 3, left: 6 });
  const r1 = await post(handler, { id: "m10", from: "+46706666666", message: "Status?" });
  assert.equal(r1.status, 500);
  let record = await seen("m10");
  assert.equal(record.status, "failed");
  assert.match(record.lastError, /behandlingsstatus kunde inte sparas/);
  assert.equal(record.steps.inboxKey, undefined, "inkorgssteget är inte avbockat");
  assert.equal(record.steps.link.attached, true);
  assert.equal(sent.length, 0, "notisen hade inte skickats");
  assert.equal((await inboxEntries()).length, 1, "men inkorgsposten hann skrivas");

  const counts = await reprocessInbound({ now: Date.now() });
  assert.equal(counts.done, 1);
  record = await seen("m10");
  assert.equal(record.status, "done");
  assert.ok(record.steps.inboxKey);
  assert.equal((await inboxEntries()).length, 1, "samma deterministiska inkorgsnyckel");
  assert.equal(sent.length, 1, "notisen gick en gång");
  assert.equal((await cases.get("case_3", { type: "json" })).inboundMessages.length, 1);
});

test("nätfel mot 46elks i notis-steget: posten blir klar med notified=failed, omleverans skickar inte om notisen", async (t) => {
  const { sent, state } = await setup(t);
  await seed();
  const { default: handler } = await import("../netlify/functions/sms-inbound.mjs");
  state.elksThrow = 1;
  const r1 = await post(handler, { id: "m3", from: "+46706666666", message: "Hallå" });
  assert.equal(r1.status, 200);
  const record = await seen("m3");
  assert.equal(record.status, "done");
  assert.equal(record.steps.notified, "failed");
  await post(handler, { id: "m3", from: "+46706666666", message: "Hallå" });
  assert.equal(sent.length, 0, "ett avbockat notis-steg upprepas inte (notisen är best effort, kunden finns i inkorgen)");
});

test("två parallella leveranser av samma id: en behandlas, en notis, en ärenderad", async (t) => {
  const { sent } = await setup(t);
  const cases = await seed();
  const { default: handler } = await import("../netlify/functions/sms-inbound.mjs");
  const params = { id: "m4", from: "+46706666666", message: "Parallellt" };
  const [a, b] = await Promise.all([post(handler, params), post(handler, params)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(sent.length, 1);
  assert.equal((await cases.get("case_3", { type: "json" })).inboundMessages.length, 1);
  assert.equal((await inboxEntries()).length, 1);
  assert.equal((await seen("m4")).status, "done");
});

test("STOPP, spärrlista och RING-autosvar fungerar som förut – och återupptaget autosvar går via SMS-API:t", async (t) => {
  const { sent, failPut } = await setup(t);
  await seed();
  await getStore({ name: "call-blocklist", consistency: "strong" }).setJSON("+46708888888", { number: "+46708888888", reason: "test" });
  const { default: handler, reprocessInbound } = await import("../netlify/functions/sms-inbound.mjs");

  const stop = await post(handler, { id: "m5", from: "+46706666666", message: "STOPP" });
  assert.match(await stop.text(), /avregistrerad/);
  assert.ok(await getStore({ name: "sms-optout", consistency: "strong" }).get("+46706666666", { type: "json" }));
  const stopRecord = await seen("m5");
  assert.equal(stopRecord.status, "done");
  assert.equal(stopRecord.steps.link.status, "skipped");
  assert.equal(stopRecord.steps.autoreply.via, "webhook_reply");
  assert.equal(sent.length, 0, "STOPP ger ingen notis: " + JSON.stringify(sent));

  const blocked = await post(handler, { id: "m6", from: "+46708888888", message: "Hej" });
  assert.equal(await blocked.text(), "");
  assert.equal((await seen("m6")).outcome, "blocked");
  assert.equal((await inboxEntries()).filter((e) => e.phone === "+46708888888").length, 0, "spärrat nummer hamnar inte i inkorgen");

  // RING utan spärr → autosvar i webhook-svaret + notis.
  const ring = await post(handler, { id: "m7", from: "+46707777777", message: "RING" });
  assert.match(await ring.text(), /ringer upp dig/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /RING-svar/);

  // RING där inkorgsskrivningen kraschar → inget autosvar i webhook-svaret;
  // reconcile skickar det via SMS-API:t i stället (approved: false → går via spärren, som är av här).
  failPut.set("sms-inbound/*", 6);
  const crashed = await post(handler, { id: "m8", from: "+46709999999", message: "ring mig" });
  assert.equal(crashed.status, 500);
  await reprocessInbound({ now: Date.now() });
  const record = await seen("m8");
  assert.equal(record.status, "done");
  assert.match(record.steps.autoreply.via, /^sms_api:sent/);
  assert.equal(sent.filter((s) => s.to === "+46709999999").length, 1, "autosvaret gick via API:t en gång");
  assert.equal(sent.filter((s) => s.to === "+46700243319").length, 2, "notis för m7 och m8");
});

test("RING med godkännandespärren på: autosvaret köas, inte skickas, och köas inte två gånger", async (t) => {
  await setup(t);
  await seed();
  await getStore({ name: "comm-config", consistency: "strong" }).setJSON("sms-approval", { enabled: true, updatedAt: null, by: "test" });
  const { default: handler } = await import("../netlify/functions/sms-inbound.mjs");
  const r = await post(handler, { id: "m9", from: "+46707777777", message: "1" });
  assert.equal(await r.text(), "");
  await post(handler, { id: "m9", from: "+46707777777", message: "1" });
  const pending = getStore({ name: "sms-pending", consistency: "strong" });
  assert.equal((await pending.list()).blobs.length, 1);
  assert.equal((await seen("m9")).steps.autoreply.via, "pending_approval");
});

test("godkännandekö och utkastinkorg: två parallella godkännanden ger ett utskick", async (t) => {
  const { sent } = await setup(t);
  const cases = await seed();
  const { approvePendingSms, queuePendingSms } = await import("../netlify/functions/_shared/comm-log.mjs");
  const { postSms } = await import("../netlify/functions/_shared/sms.mjs");
  const queued = await queuePendingSms({ source: "test", to: "+46706666666", message: "Köat SMS" });
  // Lokala servern sätter etag på filens mtime (ms): vänta så att reservationens
  // skrivning får en annan tidsstämpel än skapandet.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const [a, b] = await Promise.all([approvePendingSms(queued.pendingId, postSms, { by: "A" }), approvePendingSms(queued.pendingId, postSms, { by: "B" })]);
  assert.deepEqual([a.status, b.status].sort(), ["in_flight", "sent"]);
  assert.equal(sent.length, 1);
  assert.equal((await approvePendingSms(queued.pendingId, postSms)).status, "not_found", "skickad post är borta");

  const drafts = getStore({ name: "sms-drafts", consistency: "strong" });
  await drafts.setJSON("case_3", { caseId: "case_3", category: "B", message: "Hej Omar, vi återkommer i morgon.", meta: { namn: "Omar", telefon: "0706666666" } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const { default: draftHandler } = await import("../netlify/functions/sms-draft-inbox.mjs");
  const approve = () => draftHandler(new Request("https://x/api/sms-drafts/case_3/approve", { method: "POST", headers: { "x-admin-token": "adm", "Content-Type": "application/json" }, body: JSON.stringify({ operatorName: "Sebastian" }) }), { params: { id: "case_3", action: "approve" } });
  const [c, d] = await Promise.all([approve(), approve()]);
  assert.deepEqual([c.status, d.status].sort(), [200, 409]);
  const ok = c.status === 200 ? await c.json() : await d.json();
  assert.equal(await drafts.get("case_3", { type: "json" }), null, "utkastet är borta oavsett väg");
  const c3 = await cases.get("case_3", { type: "json" });
  if (ok.status === "queued") {
    // Tysta timmar (21–08 svensk tid) när testet körs: godkännandet köas i
    // outbox i stället – fortfarande exakt EN köpost, inget utskick.
    const outbox = getStore({ name: "outbox", consistency: "strong" });
    assert.equal((await outbox.list()).blobs.length, 1);
    assert.equal(sent.length, 1, "inget utskick under tysta timmar");
    assert.match(c3.timeline.at(-1).event, /köat/i);
  } else {
    assert.equal(ok.status, "sent");
    assert.equal(ok.caseLogged, true);
    assert.ok(ok.journalKey);
    assert.equal(sent.length, 2, "ett utskick för utkastet");
    assert.equal(c3.smsLog.length, 1);
    assert.equal(c3.smsLog[0].journalKey, ok.journalKey);
    assert.equal((await getStore({ name: "send-journal", consistency: "strong" }).get(ok.journalKey, { type: "json" })).status, "committed");
  }
});

test("workshop-cases: lagringen faller EFTER att SMS:et gått → 200 med caseLogged:false, reconcile lägger loggraden", async (t) => {
  const { sent, failPut } = await setup(t);
  const cases = await seed();
  const { default: handler } = await import("../netlify/functions/workshop-cases.mjs");
  const { reconcileSendJournal } = await import("../netlify/functions/_shared/send-journal.mjs");
  failPut.set("workshop-cases/case_3", 6);
  const r = await handler(new Request("https://x/api/cases/case_3", { method: "PATCH", headers: { "x-admin-token": "adm", "Content-Type": "application/json" }, body: JSON.stringify({ action: "send_sms", message: "Hej Omar! Klar nu.", operatorName: "A" }) }), { params: { id: "case_3" } });
  assert.equal(r.status, 200, "utskicket gick – inget 409/503 som får operatören att skicka igen");
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.caseLogged, false);
  assert.equal(body.caseError, "storage_error");
  assert.equal(body.result.status, "sent");
  assert.ok(body.journalKey);
  assert.equal(sent.length, 1);
  assert.equal((await cases.get("case_3", { type: "json" })).outboundMessages, undefined, "ärendet saknar raden");
  const journal = getStore({ name: "send-journal", consistency: "strong" });
  assert.equal((await journal.get(body.journalKey, { type: "json" })).status, "sent");

  const counts = await reconcileSendJournal({ now: Date.now() + 2 * 60 * 1000 });
  assert.equal(counts.reapplied, 1);
  const item = await cases.get("case_3", { type: "json" });
  assert.equal(item.outboundMessages.length, 1);
  assert.equal(item.outboundMessages[0].journalKey, body.journalKey);
  assert.equal(item.status, "repairing", "statusregeln (bara new/contacted → waiting_customer) gäller även vid återställning");
  assert.equal((await journal.get(body.journalKey, { type: "json" })).status, "committed");
  assert.equal(sent.length, 1, "reconcile skickar inget");
});

test("workshop-cases: två samtidiga avslut ger ETT recensions-SMS och ett tackresultat", async (t) => {
  const { sent } = await setup(t);
  const cases = await seed();
  // Fryst klocka utanför tysta timmar (10:30 svensk tid), annars köas tacket i outbox.
  const RealDate = Date;
  const FIXED = new RealDate("2026-11-12T09:30:00.000Z").getTime();
  class FakeDate extends RealDate { constructor(...args) { super(...(args.length ? args : [FIXED])); } static now() { return FIXED; } }
  globalThis.Date = FakeDate;
  t.after(() => { globalThis.Date = RealDate; });
  const { default: handler } = await import("../netlify/functions/workshop-cases.mjs");
  const patch = () => handler(new Request("https://x/api/cases/case_3", { method: "PATCH", headers: { "x-admin-token": "adm", "Content-Type": "application/json" }, body: JSON.stringify({ status: "done", operatorName: "A" }) }), { params: { id: "case_3" } });
  const [a, b] = await Promise.all([patch(), patch()]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const review = sent.filter((s) => /recension/i.test(s.message));
  assert.equal(review.length, 1, "ett recensions-SMS: " + JSON.stringify(sent.map((s) => s.message.slice(0, 30))));
  const item = await cases.get("case_3", { type: "json" });
  assert.equal(item.status, "done");
  assert.equal(item.notifications.thankYou.reviewSms.status, "sent");
  assert.equal(item.timeline.filter((e) => /recension|tack/i.test(e.event)).length, 1, "en tackrad på tidslinjen");
});

test("workshop-cases send_sms: journal committed, dubblettskydd 409, idempotencyKey återspelar utan nytt SMS", async (t) => {
  const { sent } = await setup(t);
  const cases = await seed();
  const { default: handler } = await import("../netlify/functions/workshop-cases.mjs");
  const patch = (body) => handler(new Request("https://x/api/cases/case_3", { method: "PATCH", headers: { "x-admin-token": "adm", "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: { id: "case_3" } });
  const first = await patch({ action: "send_sms", message: "Hej Omar! Klar i morgon.", operatorName: "A" });
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.ok(body.journalKey);
  assert.equal(body.case.outboundMessages[0].journalKey, body.journalKey);
  assert.equal((await getStore({ name: "send-journal", consistency: "strong" }).get(body.journalKey, { type: "json" })).status, "committed");
  const dup = await patch({ action: "send_sms", message: "Hej Omar! Klar i morgon.", operatorName: "A" });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).code, "duplicate_recent");
  assert.equal(sent.length, 1);
  const forced = await patch({ action: "send_sms", message: "Hej Omar! Klar i morgon.", operatorName: "A", force: true });
  assert.equal(forced.status, 200);
  assert.equal(sent.length, 2);
  const idem = await patch({ action: "send_sms", message: "Prisfråga", operatorName: "A", idempotencyKey: "os2-abc" });
  assert.equal(idem.status, 200);
  const replay = await patch({ action: "send_sms", message: "Prisfråga", operatorName: "A", idempotencyKey: "os2-abc" });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(sent.length, 3, "återspelningen skickade inget");
  assert.equal((await cases.get("case_3", { type: "json" })).outboundMessages.length, 3, "och loggas inte en gång till (journalKey finns redan)");
});
