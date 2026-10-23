import assert from "node:assert/strict";
import test from "node:test";

import { buildContacts, buildEvents, buildOverview, callAnsweredBy, isRealReply, needsReply, sourceLabel, textSignals } from "../netlify/functions/_shared/comm-overview.mjs";
import { SMS_SOURCES } from "../netlify/functions/_shared/comm-log.mjs";

const NOW = new Date("2026-10-20T12:00:00Z").getTime(); // tis 14:00 svensk tid
const h = (n) => new Date(NOW - n * 3600e3).toISOString();
const elksTime = (n) => h(n).replace("Z", "").replace(/\.\d+$/, ".000000"); // 46elks-format utan zon

const OWN = ["+46101385498", "+46700243319"];
const opts = { ownNumbers: OWN, staff: { sebastian: "+46700243319" }, labels: SMS_SOURCES, infoSmsText: "INFO", meetingSmsText: (m) => `Möte bokat: ${m.preferredTime}`, sinceMs: NOW - 30 * 864e5 };

const cases = [
  { id: "c1", serviceNumber: "NE-1042", status: "repairing", customer: { name: "Erik Ek", phone: "0704444444" }, payment: { status: "unpaid" } },
  { id: "c2", serviceNumber: "NE-0900", status: "done", customer: { name: "Lisa L", phone: "+46706666666" }, payment: { status: "paid", amount: 1890 } },
  { id: "c3", status: "new", source: "website_chat", channel: "chat", customer: { name: "Chatt-Kim", phone: "+46707777777" },
    chat: { status: "needs_reply", messages: [{ at: h(5), from: "customer", text: "Vad kostar ett batteribyte på G2? Batteriet blir varmt." }] } },
];

const input = {
  cases,
  elksSms: [
    // Ringlistans info-SMS: 46elks har ingen text (dontlog), texten fylls i från ringlistan.
    { id: "s1", direction: "outgoing", to: "+46705555555", created: elksTime(30), cost: 3500 },
    // Kunden svarar RING (inkommande har alltid text).
    { id: "s2", direction: "incoming", from: "+46705555555", created: elksTime(29), message: "RING" },
    // Gammalt utskick utan text och utan logg.
    { id: "s3", direction: "outgoing", to: "+46708888888", created: elksTime(200) },
    // Larm till Sebastian = internt.
    { id: "s4", direction: "outgoing", to: "+46700243319", created: elksTime(28) },
    // Erik (aktivt ärende) är arg.
    { id: "s5", direction: "incoming", from: "+46704444444", created: elksTime(20), message: "Jag är missnöjd, scootern har stått i två veckor. Ring mig!" },
  ],
  smsLog: [{ at: h(28), to: "+46700243319", message: "VARM KUND ringde", source: "ring-list-scan", status: "sent" }],
  ringList: [{ phone: "+46705555555", infoSmsAt: h(30) }],
  elksCalls: [
    // Missat samtal från ny kund.
    { id: "k1", direction: "incoming", from: "+46709999999", to: "+46101385498", created: elksTime(3), duration: 0, legs: [] },
    // Nova svarade Lisa (tidigare kund) som lämnade meddelande.
    { id: "k2", direction: "incoming", from: "+46706666666", to: "+46101385498", created: elksTime(50), duration: 95, legs: [{ to: "sip:agent@sip.elevenlabs.io", state: "success" }] },
    // Sebastian tog Eriks samtal innan Erik SMS:ade.
    { id: "k3", direction: "incoming", from: "+46704444444", to: "+46101385498", created: elksTime(40), duration: 120, legs: [{ to: "+46700243319", state: "success" }] },
  ],
  novaCalls: [
    { id: "n1", at: h(49), startedAt: h(50), phone: "+46706666666", channel: "phone", durationSec: 95, tools: ["message"], summary: "Lisa vill ha offert på nytt däck.", transcript: "Nova: Hej!\nKund: Vad kostar ett nytt däck?", customer: { firstName: "Lisa" } },
    { id: "n2", at: h(6), channel: "web", durationSec: 0, summary: "Besökare frågade om öppettider." },
  ],
  smsInbound: [{ key: "x", phone: "+46705555555", message: "RING", at: h(29), type: "ring" }],
};

test("källor slås ihop: text fylls i, interna skiljs ut, Nova kopplas till 46elks-samtalet", () => {
  const ev = buildEvents(input, opts);
  const info = ev.find((e) => e.id === "sms-s1");
  assert.equal(info.text, "INFO");
  assert.equal(info.sourceLabel, "Ringlistan (automatiskt info-SMS)");
  assert.equal(info.costSek, 0.35);
  assert.equal(ev.find((e) => e.id === "sms-s3").sourceLabel, "Okänd (skickat innan loggen fanns)");
  assert.equal(ev.find((e) => e.id === "sms-s4").internal, true);
  // RING finns både hos 46elks och i sms-inbound: bara en händelse.
  assert.equal(ev.filter((e) => e.channel === "sms" && e.dir === "in" && e.phone === "+46705555555").length, 1);
  const lisa = ev.find((e) => e.id === "call-k2");
  assert.equal(lisa.nova, true);
  assert.equal(lisa.answeredBy.key, "nova");
  assert.equal(lisa.outcome.key, "message");
  assert.match(lisa.transcript, /Kund: Vad kostar/);
  assert.equal(ev.filter((e) => e.id.startsWith("nova-n1")).length, 0); // inte dubbelt
  assert.equal(ev.find((e) => e.id === "nova-n2").channel, "chat");
  assert.equal(ev.find((e) => e.id.startsWith("chat-c3")).dir, "in");
});

test("väntar på svar: automatiska SMS och Nova-meddelanden räknas inte som svar", () => {
  const ev = buildEvents(input, opts);
  const contacts = buildContacts(ev, { cases, now: NOW });
  const by = (p) => contacts.find((c) => c.phone === p);
  assert.equal(by("+46705555555").waiting, true); // svarade RING efter info-SMS
  assert.equal(by("+46706666666").waiting, true); // lämnade meddelande till Nova
  assert.equal(by("+46709999999").waiting, true); // missat samtal
  assert.equal(by("+46704444444").waiting, true); // SMS efter Sebastians samtal
  assert.equal(contacts.some((c) => c.phone === "+46700243319"), false); // internt nummer
  // Webbchatt som Nova besvarade utan önskan om återkoppling väntar inte.
  assert.equal(contacts.find((c) => c.key === "n2").waiting, false);
  // "Hanterad" efter senaste inkommande => väntar inte längre.
  const handled = buildContacts(ev, { cases, now: NOW, handled: { 46709999999: { at: h(1) } } });
  assert.equal(handled.find((c) => c.phone === "+46709999999").waiting, false);
});

test("rangordning: pågående ärende och klagomål först, signaler förklarar varför", () => {
  const ev = buildEvents(input, opts);
  const contacts = buildContacts(ev, { cases, now: NOW });
  const ov = buildOverview({ events: ev, contacts, now: NOW });
  const get = (k) => ov.contacts.find((c) => c.key === k);
  const list = (name) => ov.lists[name].map(get);
  assert.deepEqual(list("active").map((c) => c.phone), ["+46704444444"]);
  const erik = list("active")[0];
  assert.equal(erik.tier, "active");
  assert.ok(erik.reasons.some((r) => /NE-1042/.test(r)));
  assert.ok(erik.signals.some((s) => s.key === "complaint"));
  assert.ok(erik.signals.some((s) => s.key === "callback"));
  // Chatt-Kim nämner varmt batteri => säkerhetssignal; ska ligga högst bland nya.
  assert.equal(list("new")[0].phone, "+46707777777");
  assert.ok(list("new")[0].signals.some((s) => s.key === "safety"));
  // Kanallistor innehåller bara kontakter med händelser i kanalen.
  assert.ok(list("chat").every((c) => c.events.some((e) => e.channel === "chat")));
  assert.ok(list("sms").some((c) => c.phone === "+46705555555"));
  assert.equal(list("calls").find((c) => c.phone === "+46706666666").tier, "past");
  assert.equal(list("calls").some((c) => c.phone === "+46707777777"), false);
});

test("färskhet: samma innehåll väger mindre när det är gammalt, men väntetid lyfts", () => {
  const mk = (ageH, waitingFlag) => buildContacts([{ id: "a", at: NOW - ageH * 3600e3, channel: "sms", dir: "in", phone: "+46701000000", text: "Vad kostar en reservdel?", textKnown: true }], { now: NOW, handled: waitingFlag ? {} : { 46701000000: { at: h(0) } } })[0];
  assert.ok(mk(2, false).score > mk(24 * 14, false).score);
  assert.ok(mk(48, true).score > mk(2, true).score - 30); // väntat länge tappar inte allt
  assert.equal(mk(48, true).waiting, true);
});

test("nova i dag och utskick per avsändare", () => {
  const ev = buildEvents({ ...input, elksSms: [...input.elksSms, { id: "s9", direction: "outgoing", to: "+46705550000", created: elksTime(1) }], smsLog: [...input.smsLog, { at: h(1), to: "+46705550000", message: "Möte bokat", source: "nova", status: "sent" }] }, opts);
  const ov = buildOverview({ events: ev, contacts: buildContacts(ev, { cases, now: NOW }), now: NOW });
  assert.equal(ov.today.nova.smsOut, 1);
  assert.equal(ov.today.nova.chats, 1);
  assert.equal(ov.today.inbound.missed, 1);
  assert.deepEqual(ov.today.smsBySource.map((r) => [r.label, r.count]), [["Nova", 1]]);
  assert.ok(ov.period.smsBySource.some((r) => r.label === "Ringlistan (automatiskt info-SMS)"));
});

test("hjälpfunktioner: signaler, svar, avsändare, vem svarade", () => {
  assert.deepEqual(textSignals("Det luktar bränt från batteriet").map((s) => s.key), ["safety"]);
  assert.deepEqual(textSignals("STOPP"), []);
  assert.equal(sourceLabel("campaign:vinter-2026", SMS_SOURCES), "Kampanj (vinter-2026)");
  assert.equal(sourceLabel("approved:ring-list-scan", SMS_SOURCES), "Godkänt av Sebastian: Ringlistan (automatiskt info-SMS)");
  // Köade/avvisade loggposter blir inga "SMS ut"-händelser.
  const evq = buildEvents({ smsLog: [{ at: h(1), to: "+46701000000", message: "x", source: "booking", status: "pending_approval" }, { at: h(1), to: "+46701000000", message: "y", source: "booking", status: "rejected" }] }, opts);
  assert.equal(evq.length, 0);
  assert.equal(isRealReply({ dir: "out", channel: "sms", textKnown: true, source: "ring-list-scan" }), false);
  assert.equal(isRealReply({ dir: "out", channel: "sms", textKnown: true, source: "case-sms" }), true);
  assert.equal(needsReply({ dir: "in", channel: "call", answeredBy: { key: "nova" }, outcome: { key: "resolved" } }), false);
  assert.equal(callAnsweredBy({ direction: "incoming", legs: [], recordings: [{}] }).key, "voicemail");
  assert.equal(callAnsweredBy({ direction: "outgoing", duration: 0, legs: [] }).key, "noanswer");
});
