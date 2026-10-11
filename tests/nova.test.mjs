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
