import assert from "node:assert/strict";
import test from "node:test";

import {
  compactSlots,
  customerSafeCase,
  lookupByPhone,
  matchPrices,
  meetingSmsToCustomer,
  normalizeCallSummary,
  normalizeMeeting,
  summarySmsToSebastian,
} from "../netlify/functions/_shared/voice-agent.mjs";

const arende = (extra = {}) => ({
  id: "case_1",
  serviceNumber: "NEM-1111-2222-3333",
  status: "repairing",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-05T10:00:00Z",
  customer: { name: "Sören Lindgren", phone: "0760000001" },
  vehicle: { brand: "Kukirin", model: "G2 Master" },
  service: "Batterireparation",
  totalCost: 2500,
  payment: { status: "unpaid" },
  notes: [{ at: "2026-10-02", text: "Kunden gnällig, ge inget gratis" }],
  customerUpdates: [{ at: "2026-10-05T09:00:00Z", text: "Celler bytta, balanserar paketet." }],
  ...extra,
});

test("kundsäker vy läcker varken pris, betalstatus eller interna anteckningar", () => {
  const safe = customerSafeCase(arende());
  const text = JSON.stringify(safe);
  assert.equal(safe.step, "under reparation");
  assert.equal(safe.firstName, "Sören");
  assert.equal(safe.vehicle, "Kukirin G2 Master");
  assert.equal(safe.latestUpdate.text, "Celler bytta, balanserar paketet.");
  assert.doesNotMatch(text, /2500|unpaid|gnällig|totalCost|payment|notes/);
});

test("uppslag på nummer hittar aktiva ärenden oavsett nummerformat", () => {
  const cases = [arende(), arende({ id: "case_2", status: "done", updatedAt: "2026-09-01T10:00:00Z", customer: { name: "Sören Lindgren", phone: "+46760000001" } }), arende({ id: "case_3", customer: { name: "Annan", phone: "0760000002" } })];
  const r = lookupByPhone(cases, "076-000 00 01");
  assert.equal(r.found, true);
  assert.equal(r.active.length, 1);
  assert.equal(r.recent.step, "utlämnad");
  assert.equal(lookupByPhone(cases, "0769999999").found, false);
});

test("prisfrågor ger från-pris och spann, aldrig ett löfte", () => {
  const rules = [
    { id: "puncture_standard_wheel", name: "Punktering vanligt hjul", category: "tires", startPrice: 349, likelyMin: 349, likelyMax: 595 },
    { id: "diagnostics_standard", name: "Grunddiagnos", category: "diagnostics", startPrice: 495, likelyMin: 495, likelyMax: 995, requiresDiagnosis: true },
  ];
  const r = matchPrices(rules, "vad kostar punktering");
  assert.equal(r.length, 1);
  assert.equal(r[0].fromPrice, 349);
  assert.match(r[0].say, /från 349 kronor, oftast mellan 349 och 595/);
  assert.match(matchPrices(rules, "diagnos")[0].say, /Exakt pris efter felsökning/);
  assert.equal(matchPrices(rules, "").length, 2);
});

test("lediga tider komprimeras till uppläsbara dagar", () => {
  const r = compactSlots({ status: "ok", days: [
    { date: "2026-10-08", slots: [{ time: "10:00", available: false }, { time: "10:30" }] },
    { date: "2026-10-13", slots: [{ time: "10:00", busy: true }] },
    { date: "2026-10-15", slots: [{ time: "14:00" }, { time: "14:30" }] },
  ] });
  assert.deepEqual(r.days.map((d) => [d.weekday, d.times]), [["torsdag", ["10:30"]], ["torsdag", ["14:00", "14:30"]]]);
});

test("telefonmöte kräver riktigt nummer och ett ämne", () => {
  assert.equal(normalizeMeeting({ phone: "0760000001", topic: "Batteri till G4" }).ok, true);
  assert.deepEqual(normalizeMeeting({ phone: "123", topic: "" }).errors, ["phone", "topic"]);
  const sms = meetingSmsToCustomer({ name: "Anna Gidmo", phone: "+46760000001", topic: "däckbyte", preferredTime: "i morgon förmiddag" });
  assert.match(sms, /^Hej Anna! .*ringer upp dig i morgon förmiddag angående däckbyte/);
});

test("samtalssammanfattningen till Sebastian säger vem, vad och om möte bokats", () => {
  const s = normalizeCallSummary({ call_id: "abc", from: "0760000001", duration_sec: 95, summary: "Vill ha pris på cellbyte.", meetingBooked: true });
  const text = summarySmsToSebastian(s, { found: true, firstName: "Sören", active: [{}] });
  assert.match(text, /^Röstassistent 2 min: Sören \+46760000001 \(kund med 1 aktivt ärende\)\. Vill ha pris på cellbyte\. Telefonmöte bokat\./);
});

test("ElevenLabs post-call-payload plattas ut till vårt format", async () => {
  const { fromElevenLabsWebhook, verifyElevenLabsSignature } = await import("../netlify/functions/_shared/voice-agent.mjs");
  const s = normalizeCallSummary(fromElevenLabsWebhook({
    type: "post_call_transcription",
    data: {
      conversation_id: "conv_1",
      transcript: [
        { role: "agent", message: "Hej, vad gäller det?" },
        { role: "user", message: "Min G4 laddar inte.", tool_calls: [] },
        { role: "agent", message: "Då bokar jag ett samtal.", tool_calls: [{ tool_name: "book-meeting" }] },
      ],
      metadata: { call_duration_secs: 130, phone_call: { external_number: "+46760000001", direction: "inbound" } },
      analysis: { transcript_summary: "Kund med G4 som inte laddar, telefonmöte bokat.", call_successful: "success" },
    },
  }));
  assert.equal(s.callId, "conv_1");
  assert.equal(s.phone, "+46760000001");
  assert.equal(s.durationSec, 130);
  assert.equal(s.meetingBooked, true);
  assert.match(s.transcript, /^Receptionist: Hej, vad gäller det\?\nKund: Min G4 laddar inte\./);
  assert.equal(fromElevenLabsWebhook({ phone: "0760000001", summary: "x" }).summary, "x");

  // Signaturen: v0 = HMAC-SHA256(secret, `${t}.${body}`), max 30 min gammal.
  const body = JSON.stringify({ type: "post_call_transcription", data: {} });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("wsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyElevenLabsSignature(`t=${t},v0=${sig}`, body, "wsec_test"), true);
  assert.equal(await verifyElevenLabsSignature(`t=${t},v0=${sig}`, body + " ", "wsec_test"), false);
  assert.equal(await verifyElevenLabsSignature(`t=${t - 3600},v0=${sig}`, body, "wsec_test"), false);
  assert.equal(await verifyElevenLabsSignature("", body, "wsec_test"), false);
});
