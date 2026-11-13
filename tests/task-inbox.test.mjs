// Uppgiftsinkorgen: datum (Europe/Stockholm, inga påhittade tider), dedup
// (samma käll-id, samma kundbehov, återkommande kund), samtidiga uppdateringar
// (versionerade skrivningar) och fallerande datakällor (partial, aldrig 500).
// Lokal Blobs-server + minnesstore med etag-semantik. Inga nätanrop, inget skickas.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./_blobs-test-env.mjs";
import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import { pinTestEnv } from "./_test-env.mjs";
import { etagStore } from "./_etag-store.mjs";

import { resetVerification, setProbeStoreFactory } from "../netlify/functions/_shared/case-store.mjs";
import { localToIso, resolveTimePhrase, stockholmParts, timingFor, zonedToUtc } from "../netlify/functions/_shared/time-phrase.mjs";
import {
  buildCallList, buildTask, deriveFromCases, deriveFromInboundSms, deriveFromMissedCalls, deriveFromNova, deriveFromRingList, mergeProposals, prioritize,
  setCallWorkStatus, syncProposals, taskIdFor, transitionTask, listTasks,
} from "../netlify/functions/_shared/task-inbox.mjs";

const RECEIVED = "2026-11-12T09:30:00.000Z"; // torsdag 10:30 i Stockholm
const NOW = Date.parse(RECEIVED);

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------
test("tidsuttryck: bara entydiga dag+klockslag blir absoluta; resten flaggas för kontroll", () => {
  const r = (s, now = NOW) => resolveTimePhrase(s, { receivedAt: RECEIVED, now });
  assert.deepEqual([r("imorgon kl 14").status, r("imorgon kl 14").local, r("imorgon kl 14").at], ["resolved", "2026-11-13 14:00", "2026-11-13T13:00:00.000Z"]);
  assert.equal(r("måndag klockan 9").local, "2026-11-16 09:00", "veckodag = nästa förekomst");
  assert.equal(r("torsdag 15:30").local, "2026-11-19 15:30", "samma veckodag som i dag = nästa vecka");
  assert.equal(r("20/11 kl 10").local, "2026-11-20 10:00", "datum före klockslag läses inte som timme");
  assert.equal(r("20 november 18.30").local, "2026-11-20 18:30");
  assert.equal(r("imorgon kl 2 på eftermiddagen").local, "2026-11-13 14:00");
  const dateOnly = r("i morgon eftermiddag");
  assert.equal(dateOnly.status, "date_only");
  assert.equal(dateOnly.date, "2026-11-13");
  assert.equal(dateOnly.at, null, "ingen påhittad tid");
  assert.equal(dateOnly.needsReview, true);
  assert.match(dateOnly.reason, /eftermiddag/);
  assert.equal(r("på måndag").needsReview, true);
  assert.equal(r("halv tre imorgon").status, "ambiguous");
  assert.equal(r("förmiddag").status, "ambiguous");
  assert.equal(r("så snart som möjligt").status, "asap");
  assert.equal(r("så snart som möjligt").needsReview, false);
  assert.equal(r("ingen aning").status, "none");
  assert.equal(r("ingen aning").needsReview, true);
  assert.equal(r("").status, "none");
  const past = r("idag kl 9");
  assert.equal(past.status, "past");
  assert.equal(past.needsReview, true);
  const laterToday = r("kl 16");
  assert.equal(laterToday.local, "2026-11-12 16:00");
  assert.equal(laterToday.needsReview, true, "antagen dag ska kontrolleras");
  // Referensen är när det sades, inte nu: "imorgon" sagt i går = i dag.
  const yesterday = resolveTimePhrase("imorgon kl 11", { receivedAt: "2026-11-11T15:00:00.000Z", now: NOW });
  assert.equal(yesterday.local, "2026-11-12 11:00");
});

test("Stockholm-tid: sommar-/vintertid och lokala ärendetider", () => {
  assert.equal(localToIso("2026-07-01T10:00"), "2026-07-01T08:00:00.000Z");
  assert.equal(localToIso("2026-01-01T10:00"), "2026-01-01T09:00:00.000Z");
  assert.equal(localToIso("2026-13-01T10:00"), "");
  assert.equal(zonedToUtc({ year: 2026, month: 3, day: 29, hour: 12, minute: 0 }).toISOString(), "2026-03-29T10:00:00.000Z", "efter omställningen");
  assert.equal(stockholmParts("2026-11-12T23:30:00.000Z").day, 13, "lokal dag efter midnatt");
  const t = timingFor({ receivedAt: RECEIVED, requestedLocal: "2026-11-20T18:30", confirmedLocal: "2026-11-20T18:30", now: NOW });
  assert.equal(t.requested.at, "2026-11-20T17:30:00.000Z");
  assert.equal(t.confirmed.local, "2026-11-20 18:30");
  const onlyWish = timingFor({ receivedAt: RECEIVED, requestedRaw: "nästa vecka", now: NOW });
  assert.equal(onlyWish.confirmed, null, "önskad tid blir aldrig bekräftad tid");
  assert.equal(onlyWish.needsReview, true);
});

// ---------------------------------------------------------------------------
// Härledning, dedup och prioritet (rena funktioner)
// ---------------------------------------------------------------------------
const cases = () => [
  { id: "case_a", serviceNumber: "NE-1", status: "repairing", customer: { name: "Anna Ask", phone: "0701111111" }, vehicle: { model: "Kukirin G2" }, service: "Batteri", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-11T10:00:00.000Z" },
  { id: "case_req", serviceNumber: "NE-2", status: "new", bookingMode: "request", bookingRequest: { status: "pending", requestedAt: "2026-11-12T07:00:00.000Z" }, preferredDate: "2026-11-18T17:00", service: "Punktering", customer: { name: "Erik Ek", phone: "0702222222" }, createdAt: "2026-11-12T07:00:00.000Z" },
  { id: "case_stale", serviceNumber: "NE-3", status: "new", customer: { name: "Nour N", phone: "0703333333" }, service: "Broms", message: "bromsen skriker", createdAt: "2026-11-10T07:00:00.000Z", updatedAt: "2026-11-10T07:00:00.000Z" },
  { id: "case_fresh", status: "new", customer: { name: "Ny", phone: "0704444444" }, createdAt: "2026-11-12T09:00:00.000Z", updatedAt: "2026-11-12T09:00:00.000Z" },
];

test("härledning: ringlista, RING-svar och missat samtal från samma nummer blir EN uppgift med tre källor", () => {
  const ctx = { cases: cases(), now: NOW };
  const ring = deriveFromRingList([{ phone: "0701111111", name: "Anna Ask", status: "new", attempts: 2, lastCustomerCallAt: "2026-11-11T12:00:00.000Z", reason: "Ringde om batteriet" }, { phone: "0709999999", status: "watch" }], ctx);
  assert.equal(ring.length, 1, "bara status new");
  assert.equal(ring[0].caseId, "case_a", "kopplad till kundens enda öppna ärende");
  const sms = deriveFromInboundSms([
    { key: "k1", phone: "0701111111", message: "RING", type: "ring", at: "2026-11-12T08:00:00.000Z" },
    { key: "k2", phone: "0705555555", message: "Hej, vad kostar en slang?", type: "other", at: "2026-11-12T08:10:00.000Z" },
    { key: "k3", phone: "0705555555", message: "STOPP", type: "stopp", at: "2026-11-12T08:11:00.000Z", handled: true },
    { key: "k4", phone: "0706666666", message: "gammalt", type: "other", at: "2026-10-01T08:10:00.000Z" },
  ], ctx);
  assert.deepEqual(sms.map((p) => [p.source, p.kind]), [["sms-ring", "callback"], ["sms-inbound", "sms_reply"]]);
  const missed = deriveFromMissedCalls([
    { id: "c1", direction: "incoming", from: "+46701111111", to: "+46101385498", created: "2026-11-12T09:00:00", legs: [{ state: "busy" }] },
    { id: "c2", direction: "incoming", from: "+46701111111", to: "+46101385498", created: "2026-11-12T09:05:00", legs: [] },
    { id: "c3", direction: "incoming", from: "+46707777777", to: "+46101385498", created: "2026-11-12T09:06:00", legs: [{ state: "success" }] },
    { id: "c4", direction: "outgoing", from: "+46101385498", to: "+46708888888", created: "2026-11-12T09:07:00", legs: [] },
    { id: "c5", direction: "incoming", from: "+46700000001", created: "2026-11-12T09:08:00", legs: [] },
  ], { ...ctx, blocked: new Set(["+46700000001"]) });
  assert.equal(missed.length, 1);
  assert.equal(missed[0].attempts, 2);
  const merged = mergeProposals([...ring, ...sms, ...missed]);
  const anna = merged.find((p) => p.customer.phone === "+46701111111");
  assert.equal(merged.filter((p) => p.customer.phone === "+46701111111").length, 1, "ett behov per kund och typ");
  assert.deepEqual(anna.sources.map((s) => s.source).sort(), ["elks-missed", "ring-list", "sms-ring"]);
  assert.equal(anna.aliases.length, 2);
  assert.equal(anna.attempts, 5, "försöken summeras");
  assert.equal(anna.receivedAt, "2026-11-11T12:00:00.000Z", "tidigaste mottagningen");
  assert.equal(anna.caseId, "case_a");
  const task = buildTask(anna, { now: NOW });
  assert.equal(task.id, taskIdFor("ring-list", anna.sourceId));
  assert.equal(task.priority.level, "high", `score ${task.priority.score}: ${task.priority.reason}`);
  assert.match(task.priority.reason, /hört av sig 5 gånger/);
  assert.match(task.priority.reason, /3 källor/);
  assert.equal(task.estimatedMinutes, 10);
  assert.equal(task.status, "proposed");
  assert.equal(task.assignee, "sebastian");
  assert.equal(task.domain, "business");
  assert.equal(task.receivedLocal, "2026-11-11 13:00");
});

test("härledning: Nova skiljer mottagen, önskad och bekräftad tid; bokningsförfrågan och väntande ärende", () => {
  const ctx = { cases: cases(), now: NOW };
  const nova = deriveFromNova({
    meetings: [
      { id: "m1", at: RECEIVED, phone: "0702222222", name: "Erik Ek", topic: "Punktering", preferredTime: "imorgon kl 14", vehicle: "Xiaomi" },
      { id: "m2", at: RECEIVED, phone: "0706666666", name: "Oklar", topic: "Pris", preferredTime: "nån gång nästa vecka" },
      { id: "m3", at: RECEIVED, phone: "0707777777", done: true, preferredTime: "imorgon kl 9" },
    ],
    messages: [{ id: "n1", at: "2026-11-12T06:00:00.000Z", phone: "0703333333", name: "Nour", message: "Batteriet luktar bränt, ring mig" }],
    calls: [
      { id: "v1", at: "2026-11-12T08:00:00.000Z", phone: "0708888888", kind: "inbound", summary: "Kunden vill prata med Sebastian om garanti.", outcome: "callback" },
      { id: "v2", at: "2026-11-12T08:00:00.000Z", phone: "0708888889", kind: "inbound", summary: "Bokade service.", meetingBooked: true },
    ],
  }, ctx);
  const m1 = nova.find((p) => p.sourceId === "m1");
  assert.equal(m1.kind, "meeting_call");
  assert.equal(m1.timing.receivedLocal, "2026-11-12 10:30");
  assert.equal(m1.timing.requested.local, "2026-11-13 14:00");
  assert.equal(m1.timing.confirmed, null, "önskemål är inte bekräftelse");
  assert.equal(m1.dueAt, "2026-11-13T13:00:00.000Z", "deadline = önskad tid när den är entydig");
  assert.equal(m1.title, "Ring Erik 2026-11-13 14:00");
  const m2 = nova.find((p) => p.sourceId === "m2");
  assert.equal(m2.timing.requested.status, "date_only");
  assert.equal(m2.timing.needsReview, true);
  assert.match(m2.description, /KONTROLLERA TIDEN/);
  assert.equal(m2.dueAt, "2026-11-13T09:30:00.000Z", "oklar tid → 24 tim efter mottagning, inte en gissning");
  assert.equal(nova.some((p) => p.sourceId === "m3"), false, "klara möten hoppas över");
  const n1 = nova.find((p) => p.sourceId === "n1");
  assert.deepEqual(n1.signals.map((s) => s.key), ["safety", "callback"]);
  assert.equal(prioritize(n1, NOW).level, "high");
  assert.deepEqual(nova.filter((p) => p.source === "nova-call").map((p) => p.sourceId), ["v1"]);

  const fromCases = deriveFromCases(cases(), ctx);
  const booking = fromCases.find((p) => p.kind === "booking_decision");
  assert.equal(booking.caseId, "case_req");
  assert.equal(booking.timing.requested.local, "2026-11-18 17:00");
  assert.equal(booking.timing.confirmed, null);
  assert.equal(booking.action.confirm.body.action, "confirm_booking_request");
  assert.equal(booking.dueAt, "2026-11-12T11:00:00.000Z", "beslut inom 4 tim");
  const stale = fromCases.find((p) => p.kind === "case_followup");
  assert.equal(stale.caseId, "case_stale");
  assert.match(stale.title, /Nytt ärende utan kontakt: Nour \(NE-3\)/);
  assert.equal(stale.estimatedMinutes, 10, "broms: 30 min/3");
  assert.equal(fromCases.some((p) => p.caseId === "case_fresh"), false, "nytt ärende < 4 tim är inte försenat");
  assert.equal(fromCases.some((p) => p.caseId === "case_a"), false, "repairing är inte en väntande status");
});

// ---------------------------------------------------------------------------
// Lagring: lokal Blobs-server
// ---------------------------------------------------------------------------
const setup = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-tasks-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  resetVerification();
  setProbeStoreFactory(() => getStore({ name: "case-store-probe", consistency: "strong" }));
  const restoreEnv = pinTestEnv();
  const realFetch = globalThis.fetch;
  const net = { elks: { data: [] }, elksFail: false, blobsFailPrefix: "", blobsFailLeft: 0, putLocks: new Map() };
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input instanceof Request ? input.url : input);
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (u.includes("api.46elks.com/a1/calls")) {
      if (net.elksFail) return new Response(JSON.stringify({ error: "upstream down" }), { status: 500 });
      return new Response(JSON.stringify({ data: net.elks.data }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (net.blobsFailPrefix && u.includes(net.blobsFailPrefix) && net.blobsFailLeft > 0) { net.blobsFailLeft -= 1; throw new TypeError("fetch failed (simulerat)"); }
    if (method === "PUT") { const prev = net.putLocks.get(u) || Promise.resolve(); const run = prev.catch(() => {}).then(() => realFetch(input, init)); net.putLocks.set(u, run); return run; }
    return realFetch(input, init);
  };
  t.after(async () => { globalThis.fetch = realFetch; restoreEnv(); await server.stop(); await rm(dir, { recursive: true, force: true }); });
  const { default: handler } = await import("../netlify/functions/task-inbox.mjs");
  const call = (path, { method = "GET", body, headers = {} } = {}) =>
    handler(new Request(`https://x${path}`, { method, headers: { "x-admin-token": "adm", "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { handler, call, net };
};

test("GET /api/task-inbox: synkar källorna idempotent, dedupar per kundbehov, skapar ny uppgift när kunden återkommer efter avslut", async (t) => {
  const { handler, call, net } = await setup(t);
  assert.equal((await handler(new Request("https://x/api/task-inbox"))).status, 401);
  const cs = getStore({ name: "workshop-cases", consistency: "strong" });
  // case_fresh ska vara färskt i REALTID (handlern använder Date.now()).
  for (const c of cases()) await cs.setJSON(c.id, c.id === "case_fresh" ? { ...c, createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date(Date.now() - 3600000).toISOString() } : c);
  const ring = getStore({ name: "ring-list", consistency: "strong" });
  await ring.setJSON("+46701111111", { phone: "+46701111111", name: "Anna Ask", status: "new", attempts: 2, lastCustomerCallAt: "2026-11-11T12:00:00.000Z", reason: "Ringde om batteriet" });
  await getStore({ name: "sms-inbound", consistency: "strong" }).setJSON("2026-11-12T08-00-00-000Z_46701111111", { phone: "+46701111111", message: "RING", type: "ring", at: "2026-11-12T08:00:00.000Z" });
  await getStore({ name: "voice-agent-meetings", consistency: "strong" }).setJSON("m1", { id: "m1", at: "2026-11-12T09:30:00.000Z", phone: "0702222222", name: "Erik Ek", topic: "Punktering", preferredTime: "imorgon kl 14" });
  net.elks.data = [{ id: "c1", direction: "incoming", from: "+46701111111", to: "+46101385498", created: new Date(Date.now() - 3600000).toISOString().replace(/\.\d+Z$/, ""), legs: [] }];

  const first = await call("/api/task-inbox");
  assert.equal(first.status, 200);
  const b1 = await first.json();
  assert.equal(b1.partial, false, JSON.stringify(b1.sources));
  assert.equal(b1.sources.email, "not_configured");
  assert.equal(b1.sync.created, 4, JSON.stringify(b1.sync)); // Anna (3 källor → 1), Erik möte, bokning case_req, försenat case_stale
  assert.equal(b1.sync.errors.length, 0);
  const anna = b1.items.find((i) => i.customer.phone === "+46701111111");
  assert.equal(b1.items.filter((i) => i.customer.phone === "+46701111111").length, 1);
  assert.equal(anna.sources.length, 3);
  assert.equal(anna.caseId, "case_a");
  assert.ok(b1.items.every((i) => !("history" in i)), "listan bär inte hela historiken");
  assert.equal(b1.counts.open, 4);
  assert.ok(b1.counts.minutesOpen > 0);

  const second = await call("/api/task-inbox");
  const b2 = await second.json();
  assert.deepEqual([b2.sync.created, b2.sync.merged, b2.sync.errors], [0, 0, []], "omkörning skapar inget");
  assert.equal(b2.items.length, 4);

  // Ny signal från Anna (Nova-meddelande) → slås ihop med den öppna uppgiften, ingen ny.
  await getStore({ name: "voice-agent-messages", consistency: "strong" }).setJSON("n1", { id: "n1", at: new Date().toISOString(), phone: "+46701111111", name: "Anna", message: "ring mig" });
  const b3 = await (await call("/api/task-inbox")).json();
  assert.equal(b3.sync.created, 0);
  // Samma behov i samma körning slås ihop redan i mergeProposals → den befintliga uppgiften uppdateras (refreshed).
  assert.equal(b3.sync.refreshed + b3.sync.merged, 1, JSON.stringify(b3.sync));
  const anna3 = b3.items.find((i) => i.customer.phone === "+46701111111");
  assert.equal(anna3.id, anna.id);
  assert.equal(anna3.sources.length, 4);
  assert.ok(anna3.attempts > anna.attempts);
  // Alias: käll-id:t för meddelandet pekar på Annas uppgift.
  const viaAlias = await call(`/api/task-inbox/${taskIdFor("nova-message", "n1")}`);
  assert.equal(viaAlias.status, 200);
  assert.equal((await viaAlias.json()).id, anna.id);

  // Avsluta Anna. Omkörning väcker inte den avslutade (samma signaler = redan hanterade).
  const done = await call(`/api/task-inbox/${anna.id}/done`, { method: "POST", body: { by: "Sebastian", note: "Ringde, bokade in" } });
  assert.equal(done.status, 200);
  assert.ok(done.headers.get("etag"));
  const b4 = await (await call("/api/task-inbox")).json();
  assert.equal(b4.items.some((i) => i.customer.phone === "+46701111111"), false);
  assert.equal(b4.sync.created, 0);
  assert.ok(b4.sync.suppressed >= 1 || b4.sync.unchanged >= 1);
  // Kunden ringer IGEN efter avslutet → ny uppgift.
  await ring.setJSON("+46701111111", { phone: "+46701111111", name: "Anna Ask", status: "new", attempts: 3, lastCustomerCallAt: new Date(Date.now() + 60000).toISOString(), reason: "Ringde igen" });
  const b5 = await (await call("/api/task-inbox")).json();
  const again = b5.items.find((i) => i.customer.phone === "+46701111111");
  assert.ok(again, "ny uppgift för nytt behov");
  assert.notEqual(again.id, anna.id);
  assert.equal(again.status, "proposed");
  // Filter och validering.
  assert.equal((await call("/api/task-inbox?kind=fel")).status, 400);
  assert.equal((await call("/api/task-inbox?status=fel")).status, 400);
  const onlyBooking = await (await call("/api/task-inbox?kind=booking_decision&sync=0")).json();
  assert.equal(onlyBooking.sync, null);
  assert.deepEqual(onlyBooking.items.map((i) => i.caseId), ["case_req"]);
  assert.equal(onlyBooking.items[0].action.confirm.url, "/api/cases/case_req");
  const allDone = await (await call("/api/task-inbox?status=done&sync=0")).json();
  assert.deepEqual(allDone.items.map((i) => i.id), [anna.id]);
});

test("manuella uppgifter och övergångar: idempotent skapande, idempotenta done/reject, If-Match, snooze som väcks", async (t) => {
  const { call } = await setup(t);
  assert.equal((await call("/api/task-inbox", { method: "POST", body: { title: "Utan nyckel" } })).status, 400);
  assert.equal((await call("/api/task-inbox", { method: "POST", body: { idempotencyKey: "k-12345678" } })).status, 400);
  const c1 = await call("/api/task-inbox", { method: "POST", body: { idempotencyKey: "k-12345678", title: "Beställ slangar", description: "2 st 8.5\"", dueAt: "2026-11-13T12:00", estimatedMinutes: 5, priority: "high" } });
  assert.equal(c1.status, 201);
  const task = (await c1.json()).task;
  assert.equal(task.kind, "manual");
  assert.equal(task.dueAt, "2026-11-13T11:00:00.000Z");
  assert.equal(task.priority.level, "high");
  const c2 = await call("/api/task-inbox", { method: "POST", body: { idempotencyKey: "k-12345678", title: "Beställ slangar (igen)" } });
  assert.equal(c2.status, 200, "samma idempotencyKey = samma uppgift");
  assert.equal((await c2.json()).task.title, "Beställ slangar");

  const sel = await call(`/api/task-inbox/${task.id}/select`, { method: "POST", body: { by: "Sebastian" } });
  assert.equal(sel.status, 200);
  const etag = sel.headers.get("etag");
  assert.ok(etag);
  const selAgain = await (await call(`/api/task-inbox/${task.id}/select`, { method: "POST", body: {} })).json();
  assert.equal(selAgain.unchanged, true);
  const stale = await call(`/api/task-inbox/${task.id}/start`, { method: "POST", body: {}, headers: { "If-Match": '"nagot-gammalt"' } });
  assert.equal(stale.status, 412);
  const fresh = await call(`/api/task-inbox/${task.id}/start`, { method: "POST", body: {}, headers: { "If-Match": etag } });
  assert.equal(fresh.status, 200);
  assert.equal((await fresh.json()).task.status, "in_progress");
  assert.equal((await call(`/api/task-inbox/${task.id}/snooze`, { method: "POST", body: { until: "2020-01-01T10:00" } })).status, 400);
  const snoozed = await call(`/api/task-inbox/${task.id}/snooze`, { method: "POST", body: { until: new Date(Date.now() + 1500).toISOString(), note: "Efter lunch" } });
  assert.equal((await snoozed.json()).task.status, "snoozed");
  const listed = await (await call("/api/task-inbox?sync=0")).json();
  assert.equal(listed.items.find((i) => i.id === task.id).status, "snoozed");
  await new Promise((r) => setTimeout(r, 1600));
  const woken = await (await call("/api/task-inbox?sync=0")).json();
  assert.equal(woken.items.find((i) => i.id === task.id).status, "proposed", "väcks när tiden passerat");
  const d1 = await call(`/api/task-inbox/${task.id}/done`, { method: "POST", body: { by: "Sebastian" } });
  assert.equal((await d1.json()).task.resolvedBy, "Sebastian");
  const d2 = await (await call(`/api/task-inbox/${task.id}/done`, { method: "POST", body: {} })).json();
  assert.equal(d2.unchanged, true, "done är idempotent");
  assert.equal((await call(`/api/task-inbox/${task.id}/select`, { method: "POST", body: {} })).status, 409, "done → select är ogiltigt");
  assert.equal((await call(`/api/task-inbox/${task.id}/reopen`, { method: "POST", body: {} })).status, 200);
  assert.equal((await call(`/api/task-inbox/${task.id}/reject`, { method: "POST", body: { note: "Behövs inte" } })).status, 200);
  assert.equal((await call(`/api/task-inbox/${task.id}/fel`, { method: "POST", body: {} })).status, 404);
  assert.equal((await call("/api/task-inbox/finns-inte/done", { method: "POST", body: {} })).status, 404);
  const full = await (await call(`/api/task-inbox/${task.id}`)).json();
  assert.deepEqual(full.history.map((h) => h.event), ["created", "select", "start", "snooze", "woken", "done", "reopen", "reject"]);
});

test("ringlistan: personlig lista, build väljer topp-N, arbetsstatusar är beständiga och speglas på uppgiften", async (t) => {
  const { call } = await setup(t);
  const ring = getStore({ name: "ring-list", consistency: "strong" });
  await ring.setJSON("+46701111111", { phone: "+46701111111", name: "Anna", status: "new", attempts: 3, lastCustomerCallAt: "2026-11-10T12:00:00.000Z" });
  await ring.setJSON("+46702222222", { phone: "+46702222222", name: "Bo", status: "new", attempts: 1, lastCustomerCallAt: "2026-11-12T06:00:00.000Z" });
  await getStore({ name: "voice-agent-meetings", consistency: "strong" }).setJSON("m1", { id: "m1", at: "2026-11-12T09:30:00.000Z", phone: "0703333333", name: "Cia", topic: "Service", preferredTime: "oklart" });
  await call("/api/task-inbox"); // synk
  const list = await (await call("/api/task-inbox/call-list?max=2")).json();
  assert.equal(list.totalOpen, 3);
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].phone, "+46701111111", "flest försök + längst väntan först");
  assert.equal(list.items[0].work.status, "waiting");
  assert.ok(list.statuses.callback_later);
  const built = await (await call("/api/task-inbox/call-list/build", { method: "POST", body: { max: 2, by: "Sebastian" } })).json();
  assert.equal(built.selected, 2);
  assert.deepEqual(built.items.map((i) => i.status), ["selected", "selected"]);
  const builtAgain = await (await call("/api/task-inbox/call-list/build", { method: "POST", body: { max: 2 } })).json();
  assert.equal(builtAgain.selected, 0, "idempotent");

  assert.equal((await call("/api/task-inbox/call-list/+46701111111/status", { method: "POST", body: { status: "fel" } })).status, 400);
  assert.equal((await call("/api/task-inbox/call-list/+46701111111/status", { method: "POST", body: { status: "callback_later" } })).status, 400, "återkom kräver tid");
  const noAnswer = await (await call("/api/task-inbox/call-list/%2B46701111111/status", { method: "POST", body: { status: "called_no_answer", by: "Sebastian", note: "Röstbrevlåda" } })).json();
  assert.equal(noAnswer.entry.work.status, "called_no_answer");
  assert.equal(noAnswer.entry.work.attempts, 1);
  assert.equal(noAnswer.entry.status, "new", "ligger kvar");
  assert.equal(noAnswer.task.status, "selected", "uppgiften är kvar, med notering");
  const stored = await ring.get("+46701111111", { type: "json" });
  assert.equal(stored.work.history.length, 1);
  assert.match(stored.log.at(-1).event, /Uppringd – inget svar – Röstbrevlåda/);
  const later = await (await call("/api/task-inbox/call-list/+46701111111/status", { method: "POST", body: { status: "callback_later", callbackAt: "2030-01-05T09:00", note: "Bad om måndag" } })).json();
  assert.equal(later.task.status, "snoozed");
  assert.equal(later.task.snoozedUntil, "2030-01-05T08:00:00.000Z");
  assert.equal(later.entry.work.callbackAt, "2030-01-05T08:00:00.000Z");
  const answered = await (await call("/api/task-inbox/call-list/+46702222222/status", { method: "POST", body: { status: "called_answered", note: "Bokade service tisdag" } })).json();
  assert.equal(answered.entry.status, "watch", "svar = klarmarkerad i ringlistans mening, bevakas vidare");
  assert.equal(answered.task.status, "done");
  const smsSent = await (await call("/api/task-inbox/call-list/+46703333333/status", { method: "POST", body: { status: "sms_sent", note: "Skickade tidsförslag" } })).json();
  assert.equal(smsSent.entry.work.status, "sms_sent");
  assert.equal(smsSent.task.kind, "meeting_call", "möte utan ringlistepost: posten skapas och uppgiften hittas på numret");
  const other = await (await call("/api/task-inbox/call-list/+46709999999/status", { method: "POST", body: { status: "handled_other", note: "Mejlade" } })).json();
  assert.equal(other.task, null, "okänt nummer: statusen sparas ändå");
  const after = await (await call("/api/task-inbox/call-list?max=10")).json();
  assert.deepEqual(after.items.map((i) => i.phone), ["+46703333333"], "snoozad och klar syns inte");
  // Hela uppgiftslistan: Anna snoozad, Bo klar, Cia vald.
  const all = await (await call("/api/task-inbox?status=all&sync=0")).json();
  assert.deepEqual(Object.fromEntries(all.items.map((i) => [i.customer.phone, i.status])), { "+46701111111": "snoozed", "+46702222222": "done", "+46703333333": "selected" });
});

test("fallerande datakällor: 46elks 500 och trasig ärendestore ger partial, aldrig 500; källan som fungerar synkas", async (t) => {
  const { call, net } = await setup(t);
  await getStore({ name: "ring-list", consistency: "strong" }).setJSON("+46701111111", { phone: "+46701111111", status: "new", attempts: 1, lastCustomerCallAt: "2026-11-12T06:00:00.000Z" });
  net.elksFail = true;
  const r1 = await call("/api/task-inbox");
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.equal(b1.partial, true);
  assert.match(b1.sources.elksCalls, /upstream down/);
  assert.equal(b1.sources.ringList, "ok");
  assert.equal(b1.sync.created, 1);
  net.elksFail = false;
  // Ärendestoren svarar inte (hela SDK-omförsöksserien) – listan byggs ändå, utan ärendekoppling.
  net.blobsFailPrefix = "/site:workshop-cases"; net.blobsFailLeft = 6;
  const r2 = await call("/api/task-inbox");
  assert.equal(r2.status, 200);
  const b2 = await r2.json();
  assert.equal(b2.partial, true);
  assert.notEqual(b2.sources.cases, "ok");
  assert.equal(b2.sources.elksCalls, "ok");
  assert.equal(b2.items.length, 1, "redan skapade uppgifter visas");
  assert.equal(b2.sync.created, 0);
  const sync = await (await call("/api/task-inbox/sync", { method: "POST" })).json();
  assert.equal(sync.ok, true);
  assert.equal(sync.partial, false);
});

// ---------------------------------------------------------------------------
// Samtidighet: minnesstore med etag-semantik (atomära villkorade skrivningar)
// ---------------------------------------------------------------------------
test("samtidighet: parallell synk skapar en uppgift, parallella övergångar bevarar båda, inget skrivs över", async () => {
  const store = etagStore();
  const proposals = () => [...deriveFromRingList([{ phone: "0701111111", status: "new", attempts: 1, lastCustomerCallAt: RECEIVED }], { now: NOW }), ...deriveFromInboundSms([{ key: "k1", phone: "0701111111", message: "RING", type: "ring", at: RECEIVED }], { now: NOW })];
  const [a, b, c] = await Promise.all([syncProposals(store, proposals(), { now: NOW }), syncProposals(store, proposals(), { now: NOW }), syncProposals(store, proposals(), { now: NOW })]);
  const tasks = await listTasks(store);
  assert.equal(tasks.length, 1, "exakt en uppgift trots tre parallella synkar");
  assert.equal(a.created + b.created + c.created, 1);
  assert.deepEqual([...a.errors, ...b.errors, ...c.errors], []);
  const id = tasks[0].id;
  const [s1, s2, s3] = await Promise.all([
    transitionTask(store, id, { action: "select", by: "A", now: NOW }),
    transitionTask(store, id, { action: "assign", assignee: "verkstad", by: "B", now: NOW }),
    transitionTask(store, id, { action: "note", note: "Ringde, upptaget", by: "C", now: NOW }),
  ]);
  assert.ok(s1.ok && s2.ok && s3.ok, JSON.stringify([s1, s2, s3].map((s) => s.error || "ok")));
  const final = (await listTasks(store))[0];
  assert.equal(final.status, "selected");
  assert.equal(final.assignee, "verkstad");
  assert.deepEqual(final.history.slice(1).map((h) => h.event).sort(), ["assign", "note", "select"], "ingen ändring gick förlorad");
  // Övergång på föråldrad etag nekas; samtidig done/reject: en vinner, den andra får 409 (ogiltig från done).
  const read = await store.getWithMetadata(`task/${id}`);
  const okThenStale = await transitionTask(store, id, { action: "start", etag: read.etag, now: NOW });
  assert.equal(okThenStale.ok, true);
  const stale = await transitionTask(store, id, { action: "done", etag: read.etag, now: NOW });
  assert.equal(stale.error, "precondition_failed");
  const [d, r] = await Promise.all([transitionTask(store, id, { action: "done", now: NOW }), transitionTask(store, id, { action: "reject", now: NOW })]);
  assert.equal([d, r].filter((x) => x.ok).length, 1);
  assert.equal([d, r].find((x) => !x.ok).error, "invalid_transition");
  // Ringlistans arbetsstatus: parallella uppdateringar på samma nummer – båda i historiken.
  const ring = etagStore();
  await ring.setJSON("+46701111111", { phone: "+46701111111", status: "new", attempts: 0, log: [] });
  const [w1, w2] = await Promise.all([setCallWorkStatus(ring, "+46701111111", { status: "called_no_answer", now: NOW }), setCallWorkStatus(ring, "+46701111111", { status: "sms_sent", now: NOW + 1000 })]);
  assert.ok(w1.ok && w2.ok);
  const entry = await ring.get("+46701111111");
  assert.equal(entry.work.history.length, 2);
  assert.equal(entry.work.attempts, 1);
  const list = buildCallList(await listTasks(store), [entry], { now: NOW });
  assert.equal(list.items.length, 0, "avslutad uppgift ingår inte");
});

test("NEMOB OS: Nova proposal, ring status and recoverable daily plan through the real task inbox", async (t) => {
  const { handler } = await setup(t);
  const { createServer } = await import("node:http");
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { mkdir, rename } = await import("node:fs/promises");
  const temp = await mkdtemp(join(tmpdir(), "nemob-inbox-flow-"));
  const dataDir = join(temp, "data");
  await mkdir(dataDir);
  const phone = "+46701111111";
  const now = new Date().toISOString();
  await getStore({ name: "voice-agent-meetings", consistency: "strong" }).setJSON("test-meeting", {
    id: "test-meeting", at: now, phone, name: "Synthetic", topic: "Test",
  });
  const bridge = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, "http://localhost");
    try {
      const response = url.pathname === "/api/cases" ? Response.json({ cases: [] })
        : url.pathname === "/api/nova" ? Response.json({ calls: [{ phone, kind: "inbound", transcript: "Synthetic transcript", at: now }] })
        : url.pathname.startsWith("/api/task-inbox") ? await handler(new Request(url, {
          method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
        })) : new Response(null, { status: 404 });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(500).end();
    }
  });
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  t.after(() => bridge.close());
  const child = spawn(process.execPath, ["nemob-os/server.mjs"], {
    env: { ...process.env, NEMOB_OS_HOST: "127.0.0.1", NEMOB_OS_PORT: "0", NORDIC_ADMIN_TOKEN: "adm",
      NEMOB_OS_STORE_PATH: join(dataDir, "state.json"), NORDIC_SITE_URL: "http://127.0.0.1:" + bridge.address().port },
  });
  t.after(async () => { if (child.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; } await rm(temp, { recursive: true, force: true }); });
  const [line] = await once(child.stdout, "data");
  const port = String(line).match(/127\.0\.0\.1:(\d+)/)?.[1];
  assert.ok(port);
  const app = async (path, body) => (await fetch("http://127.0.0.1:" + port + "/api/unified/" + path,
    body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)).json();
  const { items } = await app("inbox");
  const item = items.find((row) => row.phone === phone);
  assert.ok(item);
  assert.equal((await app("ringlist/" + item.id)).calls[0].transcript, "Synthetic transcript");
  assert.equal((await app("ringlist/" + item.id, { action: "select" })).status, "ok");
  assert.equal((await app("ringlist/" + item.id, { action: "called_no_answer" })).status, "ok");
  assert.equal((await app("ringlist")).rows[0].work.status, "called_no_answer");
  const plan = { action: "plan", id: item.id, title: "Testplan" };
  await rename(dataDir, dataDir + "-offline");
  assert.equal((await app("inbox", plan)).status, "planning_failed");
  assert.equal((await app("planning")).tasks.length, 0);
  await rename(dataDir + "-offline", dataDir);
  assert.equal((await app("inbox", plan)).status, "ok");
  assert.equal((await app("inbox", plan)).status, "ok");
  assert.equal((await app("planning")).tasks.filter((row) => row.title === "Testplan").length, 1);
});
