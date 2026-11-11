// Utskicksjournalen: reservation före utskick, resultat efter, committed när
// ärendet sparats – och återhämtning när ärendeskrivningen föll. Minnesstore
// med etag-semantik (samma som case-store-testet); inga nätanrop.
import assert from "node:assert/strict";
import test from "node:test";

import { etagStore } from "./_etag-store.mjs";
import { setProbeStoreFactory } from "../netlify/functions/_shared/case-store.mjs";
import {
  applyJournalToCase, markCommitted, reconcileSendJournal, recordSendResult, reserveSend, sendJournaled,
  DUPLICATE_WINDOW_MS, STALE_RESERVATION_MS,
} from "../netlify/functions/_shared/send-journal.mjs";

test.beforeEach(() => { delete process.env.CASE_STORE_ALLOW_UNVERSIONED; setProbeStoreFactory(() => etagStore()); });

const caseFixture = () => ({ id: "case_9", status: "new", customer: { phone: "+46701112233" }, smsLog: [], outboundMessages: [], timeline: [] });

test("reserveSend: identisk text till samma ärende inom två minuter avvisas, force släpper igenom", async () => {
  const store = etagStore();
  const args = { store, caseId: "case_9", to: "+46701112233", message: "Hej! Din scooter är klar.", source: "test" };
  const first = await reserveSend(args);
  assert.ok(first.ok);
  await recordSendResult(first.key, { status: "sent", id: "s1" }, { store });
  const dup = await reserveSend(args);
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, "duplicate_recent");
  assert.equal(dup.existing.providerId, "s1");
  const forced = await reserveSend({ ...args, force: true });
  assert.ok(forced.ok);
  // Annan text eller annat ärende är inte en dublett.
  assert.ok((await reserveSend({ ...args, message: "Annan text" })).ok);
  assert.ok((await reserveSend({ ...args, caseId: "case_10" })).ok);
  // Utanför fönstret är det inte en dublett.
  const later = await reserveSend({ ...args, now: new Date(Date.now() + DUPLICATE_WINDOW_MS + 1000) });
  assert.ok(later.ok);
});

test("sendJournaled: idempotencyKey ger sparat resultat tillbaka utan nytt utskick", async () => {
  const store = etagStore();
  let sends = 0;
  const send = async () => ({ status: "sent", id: `s${++sends}`, sentAt: "2026-11-11T10:00:00.000Z" });
  const base = { store, caseId: "case_9", to: "+46701112233", message: "Hej", source: "test", idempotencyKey: "os2-req-1", send };
  const first = await sendJournaled(base);
  assert.equal(first.status, "sent");
  assert.equal(first.result.id, "s1");
  assert.equal(first.replayed, undefined);
  const again = await sendJournaled(base);
  assert.equal(again.status, "sent");
  assert.equal(again.replayed, true);
  assert.equal(again.result.id, "s1");
  assert.equal(again.journalKey, first.journalKey);
  assert.equal(sends, 1, "exakt ett utskick");
  // Samma nyckel medan utskicket pågår → in_flight.
  const slow = sendJournaled({ ...base, idempotencyKey: "os2-req-2", send: () => new Promise((resolve) => setTimeout(() => resolve({ status: "sent", id: "s9" }), 30)) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const racing = await sendJournaled({ ...base, idempotencyKey: "os2-req-2" });
  assert.equal(racing.status, "in_flight");
  assert.equal((await slow).status, "sent");
});

test("idempotencyKey: misslyckat utskick får försöka igen med samma nyckel, lyckat återspelas", async () => {
  const store = etagStore();
  let calls = 0;
  const flaky = async () => (++calls === 1 ? { status: "failed", error: "46elks 503" } : { status: "sent", id: "s2" });
  const base = { store, caseId: "case_9", to: "+46701112233", message: "Hej", idempotencyKey: "draft-case_9", send: flaky };
  const first = await sendJournaled(base);
  assert.equal(first.status, "failed");
  const second = await sendJournaled(base);
  assert.equal(second.status, "sent", "andra försöket skickar på riktigt");
  assert.equal(second.replayed, undefined);
  assert.equal(calls, 2);
  const row = await store.get(second.journalKey);
  assert.equal(row.previousStatus, "failed");
  assert.equal(row.attempts, 2);
  const third = await sendJournaled(base);
  assert.equal(third.replayed, true);
  assert.equal(calls, 2, "lyckat utskick återspelas utan nytt försök");
  // not_configured räknas också som "försök igen" (credentials kan ha satts).
  let configured = false;
  const maybe = async () => (configured ? { status: "sent", id: "s9" } : { status: "not_configured" });
  const k = { store, caseId: "case_9", to: "+46701112233", message: "Hej", idempotencyKey: "cfg-1", send: maybe };
  assert.equal((await sendJournaled(k)).status, "not_configured");
  configured = true;
  assert.equal((await sendJournaled(k)).status, "sent");
});

test("sendJournaled: avsändare som kastar blir failed i journalen, inte ett okänt tillstånd", async () => {
  const store = etagStore();
  const result = await sendJournaled({ store, caseId: "case_9", to: "+46701112233", message: "Hej", send: async () => { throw new Error("46elks nere"); } });
  assert.equal(result.status, "failed");
  const row = await store.get(result.journalKey);
  assert.equal(row.status, "failed");
  assert.match(row.error, /46elks nere/);
});

test("reconcile: utskick vars ärendeskrivning föll återappliceras exakt en gång", async () => {
  const store = etagStore();
  const cases = etagStore();
  await cases.setJSON("case_9", caseFixture());
  const sent = await sendJournaled({
    store, caseId: "case_9", to: "+46701112233", message: "Hej! Din scooter är klar.", source: "case-sms", operator: "Sebastian", action: "case_sms_ready",
    apply: { log: "smsLog", kind: "ready", statusFrom: ["new"], statusTo: "contacted", event: "SMS (klar för hämtning) skickat via API av Sebastian." },
    send: async () => ({ status: "sent", id: "s1", sentAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() }),
  });
  assert.equal(sent.status, "sent");
  // ...och här föll ärendeskrivningen (inget markCommitted). Ärendet saknar raden.
  assert.equal((await cases.get("case_9")).smsLog.length, 0);

  const first = await reconcileSendJournal({ store, cases, now: Date.now() });
  assert.equal(first.reapplied, 1);
  const item = await cases.get("case_9");
  assert.equal(item.smsLog.length, 1);
  assert.equal(item.smsLog[0].journalKey, sent.journalKey);
  assert.equal(item.smsLog[0].providerId, "s1");
  assert.equal(item.status, "contacted", "statusövergången följer med");
  assert.match(item.timeline.at(-1).event, /återställt från utskicksjournalen/);
  assert.equal((await store.get(sent.journalKey)).status, "committed");

  // Andra körningen: inget mer att göra, inga dubbletter.
  const second = await reconcileSendJournal({ store, cases, now: Date.now() });
  assert.equal(second.reapplied, 0);
  assert.equal((await cases.get("case_9")).smsLog.length, 1);
});

test("reconcile: markCommitted efter lyckad ärendeskrivning → reconcile rör inte ärendet", async () => {
  const store = etagStore();
  const cases = etagStore();
  await cases.setJSON("case_9", caseFixture());
  const sent = await sendJournaled({ store, caseId: "case_9", to: "+46701112233", message: "Hej", apply: { log: "smsLog", kind: "generic" }, send: async () => ({ status: "sent", id: "s1", sentAt: new Date(Date.now() - 120000).toISOString() }) });
  await markCommitted(sent.journalKey, { store, caseEtag: '"v9"' });
  const counts = await reconcileSendJournal({ store, cases, now: Date.now() });
  assert.equal(counts.reapplied, 0);
  assert.equal((await cases.get("case_9")).smsLog.length, 0);
});

test("reconcile: färska utskick lämnas (anroparen hinner skriva), unga reservationer lämnas", async () => {
  const store = etagStore();
  const cases = etagStore();
  await cases.setJSON("case_9", caseFixture());
  await sendJournaled({ store, caseId: "case_9", to: "+46701112233", message: "Hej", apply: { log: "smsLog" }, send: async () => ({ status: "sent", id: "s1" }) });
  await reserveSend({ store, caseId: "case_9", to: "+46701112233", message: "Annan", force: true });
  const counts = await reconcileSendJournal({ store, cases, now: Date.now() });
  assert.equal(counts.reapplied, 0);
  assert.equal(counts.unknown, 0);
  assert.equal(counts.skipped, 2);
});

test("reconcile: reservation utan resultat (krasch) blir unknown med en tidslinjerad på ärendet – en gång", async () => {
  const store = etagStore();
  const cases = etagStore();
  await cases.setJSON("case_9", caseFixture());
  const reserved = await reserveSend({ store, caseId: "case_9", to: "+46701112233", message: "Hej", now: new Date(Date.now() - STALE_RESERVATION_MS - 1000) });
  const counts = await reconcileSendJournal({ store, cases, now: Date.now() });
  assert.equal(counts.unknown, 1);
  assert.equal((await store.get(reserved.key)).status, "unknown");
  const item = await cases.get("case_9");
  assert.equal(item.timeline.length, 1);
  assert.match(item.timeline[0].event, /aldrig ett resultat/);
  await reconcileSendJournal({ store, cases, now: Date.now() });
  assert.equal((await cases.get("case_9")).timeline.length, 1);
});

test("reconcile: ärendet borta → orphan, gamla committed-poster gallras", async () => {
  const store = etagStore();
  const cases = etagStore();
  const sent = await sendJournaled({ store, caseId: "case_borta", to: "+46701112233", message: "Hej", apply: { log: "smsLog" }, send: async () => ({ status: "sent", id: "s1", sentAt: new Date(Date.now() - 120000).toISOString() }) });
  const old = await sendJournaled({ store, caseId: "case_9", to: "+46701112233", message: "Gammal", apply: { log: "smsLog" }, send: async () => ({ status: "sent", id: "s0", sentAt: new Date(Date.now() - 40 * 86400000).toISOString() }) });
  await markCommitted(old.journalKey, { store });
  const counts = await reconcileSendJournal({ store, cases, now: Date.now() });
  assert.equal(counts.orphaned, 1);
  assert.equal((await store.get(sent.journalKey)).status, "orphan");
  assert.equal(counts.pruned, 1);
  assert.equal(await store.get(old.journalKey), null);
});

test("applyJournalToCase: idempotent på journalKey, outboundMessages-variant, misslyckat utskick flyttar inte status", () => {
  const record = { key: "j1", channel: "sms", to: "+46701112233", message: "Hej", sentAt: "2026-11-11T10:00:00.000Z", status: "sent", sendStatus: "sent", providerId: "s1", provider: "46elks", apply: { log: "outboundMessages", type: "manual_sms", statusFrom: ["new"], statusTo: "waiting_customer", event: "Manuellt SMS skickat till kund." } };
  const once = applyJournalToCase(caseFixture(), record);
  assert.equal(once.outboundMessages[0].type, "manual_sms");
  assert.equal(once.outboundMessages[0].journalKey, "j1");
  assert.equal(once.status, "waiting_customer");
  assert.equal(applyJournalToCase(once, record), null);
  const failed = applyJournalToCase(caseFixture(), { ...record, status: "failed", sendStatus: "failed" });
  assert.equal(failed.status, "new");
  assert.equal(failed.outboundMessages[0].status, "failed");
  assert.equal(applyJournalToCase(caseFixture(), { ...record, apply: null }), null);
});
