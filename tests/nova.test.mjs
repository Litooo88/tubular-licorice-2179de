import assert from "node:assert/strict";
import test from "node:test";

import { buildCallbackDigest, isCallingWindow, matchOutboundCall, outboundFirstMessage, pickNextOutbound } from "../netlify/functions/_shared/nova.mjs";

test("Nova ringer bara vardagar 10–18 svensk tid", () => {
  assert.equal(isCallingWindow(new Date("2026-10-12T08:30:00Z")), true); // mån 10:30
  assert.equal(isCallingWindow(new Date("2026-10-12T07:30:00Z")), false); // mån 09:30
  assert.equal(isCallingWindow(new Date("2026-10-12T16:10:00Z")), false); // mån 18:10
  assert.equal(isCallingWindow(new Date("2026-10-11T10:00:00Z")), false); // söndag
});

test("kön: test först, sedan prioritet; max två försök och 20 h mellan", () => {
  const now = new Date("2026-10-12T09:00:00Z").getTime();
  const h = (n) => new Date(now - n * 3600e3).toISOString();
  const q = [
    { phone: "+46700000001", status: "queued", priority: 5, attempts: 0 },
    { phone: "+46700000002", status: "queued", priority: 1, attempts: 1, lastAttemptAt: h(2) },
    { phone: "+46700000003", status: "queued", priority: 2, attempts: 1, lastAttemptAt: h(30) },
    { phone: "+46700000004", status: "queued", priority: 0, attempts: 2, lastAttemptAt: h(48) },
    { phone: "+46700000005", status: "test" },
    { phone: "+46700000006", status: "done" },
  ];
  assert.deepEqual(pickNextOutbound(q, { now, limit: 3 }).map((e) => e.phone.slice(-1)), ["5", "3", "1"]);
  assert.deepEqual(pickNextOutbound(q, { now, limit: 3, windowOpen: false }).map((e) => e.phone.slice(-1)), ["5"]);
});

test("första meningen: AI direkt, varför hon ringer, ingen gissning om namn", () => {
  const now = new Date("2026-10-12T09:00:00Z").getTime();
  const m = outboundFirstMessage({ name: "Anna Gidmo", lastCallAt: "2026-09-28T10:00:00Z", status: "calling" }, now);
  assert.match(m, /^Hej Anna! Det här är Nova, AI-assistent på Nordic E-Mobility i Örebro\. Du ringde oss för ett par veckor sedan/);
  assert.match(outboundFirstMessage({ name: "", status: "calling" }, now), /^Hej! Det här är Nova/);
  assert.match(outboundFirstMessage({ name: "Sebastian", status: "test" }, now), /testsamtal/);
});

test("init-matchning: kundens nummer, annars den enda aktiva uppringningen", () => {
  const now = Date.now();
  const q = [{ key: "a", phone: "+46701112233", status: "calling", lastAttemptAt: new Date(now - 30e3).toISOString() }];
  assert.equal(matchOutboundCall(q, "0701112233", { now })?.key, "a");
  assert.equal(matchOutboundCall(q, "+46766866103", { now, ownNumbers: ["+46766866103"] })?.key, "a");
  assert.equal(matchOutboundCall(q, "+46709999999", { now }), null);
  assert.equal(matchOutboundCall([{ ...q[0], lastAttemptAt: new Date(now - 10 * 60e3).toISOString() }], "0701112233", { now }), null);
});

test("dagligt SMS: en rad per person, tomt när ingen väntar", () => {
  assert.equal(buildCallbackDigest({}), "");
  const t = buildCallbackDigest({ meetings: [{ name: "Diar", phone: "+46707508105", topic: "Trasig scooter", preferredTime: "efter 15" }], ring: [{ phone: "+46702653678", message: "Ring" }], url: "https://x/admin/ring-upp/" });
  assert.match(t, /^\[Nordic\] Ring upp idag \(2\):\n1\. Diar \+46707508105: Trasig scooter \(efter 15\)\n2\. RING-svar \+46702653678: Ring\nAllt: https:\/\/x\/admin\/ring-upp\/$/);
});

test("rapport: riktning per samtal – uppringning, återringning, eget nummer, test, webb", async () => {
  const { classifyNovaCall } = await import("../netlify/functions/_shared/nova.mjs");
  const own = { ownNumbers: ["+46101385498"] };
  const entries = [
    { key: "out-46700000001", phone: "+46700000001", status: "done", connectedAt: "2026-10-13T08:00:05Z", lastAttemptAt: "2026-10-13T08:00:00Z" },
    { key: "out-46700000002", phone: "+46700000002", status: "queued", attempts: 1, lastAttemptAt: "2026-10-13T09:00:00Z" },
    { key: "test-46700000009", phone: "+46700000009", status: "done", wasTest: true, connectedAt: "2026-10-13T10:00:05Z" },
  ];
  // Nova ringde, kunden svarade: matchas på nummer + connectedAt.
  assert.deepEqual(classifyNovaCall({ phone: "+46700000001", startedAt: "2026-10-13T08:00:10Z", channel: "phone" }, entries, own),
    { kind: "outbound", outboundKey: "out-46700000001", phone: "+46700000001" });
  // 46elks skickade vårt eget nummer: kundens nummer hämtas från köposten.
  assert.equal(classifyNovaCall({ phone: "+46101385498", startedAt: "2026-10-13T08:00:10Z", channel: "phone" }, entries, own).phone, "+46700000001");
  // Kunden missade Novas samtal och ringde själv tillbaka: ingen connectedAt => inkommande.
  assert.equal(classifyNovaCall({ phone: "+46700000002", startedAt: "2026-10-13T09:03:00Z", channel: "phone" }, entries, own).kind, "inbound");
  // init-webhooken sa "inkommande": lita på det även om tiden råkar passa.
  assert.equal(classifyNovaCall({ phone: "+46700000001", startedAt: "2026-10-13T08:00:10Z", callType: "inkommande" }, entries, own).kind, "inbound");
  assert.equal(classifyNovaCall({ phone: "+46700000009", at: "2026-10-13T10:02:00Z" }, entries, own).kind, "test");
  assert.equal(classifyNovaCall({ channel: "web", at: "2026-10-13T10:02:00Z" }, entries, own).kind, "web");
  assert.equal(classifyNovaCall({ phone: "", at: "2026-10-13T12:00:00Z" }, entries, own).kind, "web");
  // Sparad riktning vinner (köposten kan ha skrivits över sedan dess).
  assert.equal(classifyNovaCall({ kind: "outbound", phone: "+46700000005" }, [], own).kind, "outbound");
  assert.equal(classifyNovaCall({ callType: "uppringning", phone: "+46700000005", at: "2026-10-01T10:00:00Z" }, [], own).kind, "outbound");
});

test("rapport: utfall i ordning möte > meddelande > röstbrevlåda > kort > misslyckat > löst", async () => {
  const { callOutcome } = await import("../netlify/functions/_shared/nova.mjs");
  assert.equal(callOutcome({ meetingBooked: true, outcome: "failure" }).key, "meeting");
  assert.equal(callOutcome({ tools: ["lookup", "message"], outcome: "success" }).key, "message");
  assert.equal(callOutcome({ endReason: "voicemail_detected", durationSec: 30 }).key, "voicemail");
  assert.equal(callOutcome({ durationSec: 6, outcome: "success" }).key, "short");
  assert.equal(callOutcome({ durationSec: 90, outcome: "failure" }).tone, "bad");
  assert.equal(callOutcome({ durationSec: 90, outcome: "success" }).key, "resolved");
  assert.equal(callOutcome({ durationSec: 90 }).key, "unknown");
});

test("rapport: siffror per svensk dag, test räknas inte, försök från log och äldre poster", async () => {
  const { buildNovaStats, novaDayLine, buildCallbackDigest } = await import("../netlify/functions/_shared/nova.mjs");
  const now = new Date("2026-10-14T10:00:00Z").getTime(); // ons 12:00 svensk tid
  const calls = [
    // 13/10 kl 00:30 svensk tid = 12/10 22:30 UTC: ska räknas som i går, inte i förrgår.
    { at: "2026-10-12T22:30:00Z", phone: "+46700000003", channel: "phone", durationSec: 120, meetingBooked: true },
    { startedAt: "2026-10-13T08:00:10Z", phone: "+46700000001", durationSec: 60, outcome: "failure", channel: "phone" },
    { at: "2026-10-13T12:00:00Z", channel: "web", durationSec: 0, tools: ["message"] },
    { at: "2026-10-13T10:01:00Z", phone: "+46700000009", durationSec: 40, kind: "test" },
    { at: "2026-10-14T07:00:00Z", phone: "+46700000004", durationSec: 5, channel: "phone" },
  ];
  const entries = [
    { key: "out-46700000001", phone: "+46700000001", status: "done", attempts: 2, connectedAt: "2026-10-13T08:00:05Z",
      log: [{ at: "2026-10-12T08:00:00Z", result: "noanswer", costSek: 0 }, { at: "2026-10-13T08:00:00Z", result: "answered", durationSec: 70, costSek: 0.5 }] },
    { key: "out-46700000002", phone: "+46700000002", status: "noanswer", attempts: 2, lastAttemptAt: "2026-10-13T09:00:00Z" },
    { key: "out-46700000005", phone: "+46700000005", status: "failed", attempts: 1, log: [{ at: "2026-10-13T09:30:00Z", result: "failed" }] },
    { key: "test-46700000009", phone: "+46700000009", status: "done", wasTest: true, log: [{ at: "2026-10-13T10:00:00Z", result: "answered" }] },
  ];
  const st = buildNovaStats({ calls, entries, now });
  const y = st.yesterday;
  assert.deepEqual([y.conversations, y.inbound, y.outbound, y.web, y.tests], [3, 1, 1, 1, 1]);
  assert.deepEqual([y.meetings, y.messages, y.failed], [1, 1, 1]);
  assert.equal(y.avgSec, 90); // webbchatten utan längd räknas inte i snittet
  assert.deepEqual([y.dialed, y.answered, y.noAnswer, y.dialFailed, y.answerRate, y.costSek], [3, 1, 1, 1, 33, 0.5]);
  assert.deepEqual([st.today.conversations, st.today.short], [1, 1]);
  assert.equal(st.week.dialed, 4);

  const line = novaDayLine(y);
  assert.equal(line, "Nova i går: 3 samtal (1 in, 1 uppringda, 1 webb), snitt 1:30. 1 möte, 1 meddel., 1 MISSLYCKAT. Uppringning: 3 försök, 1 svarade (33 %), 1 fel.");
  assert.equal(novaDayLine({ conversations: 0, dialed: 0 }), "");

  // Digest: skickas med gårdagens rad även när ingen väntar på samtal.
  assert.equal(buildCallbackDigest({ url: "https://x/ring-upp/", summary: line }), `[Nordic] ${line}\nIngen väntar på samtal.\nAllt: https://x/ring-upp/`);
  const both = buildCallbackDigest({ ring: [{ phone: "+46700000007", message: "RING" }], summary: line });
  assert.match(both, /^\[Nordic\] Nova i går: .*\nRing upp idag \(1\):\n1\. RING-svar \+46700000007: RING$/);
});
