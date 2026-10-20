// Kommunikationsöversikt: alla samtal, SMS och chattar till/från kunder på
// ett ställe, per person, rangordnat efter relevans.
//
// Sebastian 2026-10-19/20: "Nova kan ha ringt och smsat folk kors och tvärs,
// jag har ingen koll". Önskemål: befintliga kunder med pågående ärenden
// först, sedan nya kontakter; egna listor för samtal, chatt och SMS; en
// översikt över vad Nova gjort i dag. Rangordning efter relevans i det som
// sagts/skrivits, där den som väntat längst på svar lyfts och gammalt
// sjunker (relevans × färskhet + väntetid).
//
// Rena funktioner, testade i tests/comm-overview.test.mjs. kommunikation.mjs
// hämtar data och anropar buildOverview().

import { normalizePhone } from "./sms.mjs";
import { callOutcome, classifyNovaCall, KIND_LABELS } from "./nova.mjs";

const clean = (v, max = 400) => String(v ?? "").trim().slice(0, max);
const ms = (v) => {
  if (!v) return 0;
  // 46elks: "2026-10-13T08:00:05.123000" utan zon = UTC.
  const s = String(v);
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : 0;
};
const iso = (t) => (t ? new Date(t).toISOString() : "");
const HOUR = 3600e3;
const DAY = 24 * HOUR;

export const ACTIVE_CASE_STATUSES = new Set(["contacted", "checked_in", "diagnosing", "repairing", "waiting_parts", "waiting_customer", "ready"]);

// --------------------------------------------------------------------------
// Avsändaretiketter
// --------------------------------------------------------------------------
export const sourceLabel = (source, labels = {}) => {
  const s = clean(source, 60);
  if (s.startsWith("campaign:")) return `Kampanj (${s.slice(9)})`;
  return labels[s] || (s ? s : "Okänd avsändare");
};

// --------------------------------------------------------------------------
// Samtal från 46elks: vem svarade?
// --------------------------------------------------------------------------
export const callAnsweredBy = (call, staff = {}) => {
  const legs = Array.isArray(call?.legs) ? call.legs : [];
  const success = legs.find((l) => l && l.state === "success");
  if (!success) {
    if (Array.isArray(call?.recordings) && call.recordings.length) return { key: "voicemail", label: "Röstbrevlåda" };
    const dur = Number(call?.duration) || 0;
    if (String(call?.direction || "").startsWith("out")) return dur > 0 ? { key: "answered", label: "Svarade" } : { key: "noanswer", label: "Svarade inte" };
    return { key: "missed", label: "Missat – ingen svarade" };
  }
  const to = String(success.to || "");
  if (/sip:|elevenlabs/i.test(to)) return { key: "nova", label: "Nova svarade" };
  const n = normalizePhone(to);
  if (staff.workshop && n === staff.workshop) return { key: "workshop", label: "Verkstaden svarade" };
  if (staff.sebastian && n === staff.sebastian) return { key: "sebastian", label: "Sebastian svarade" };
  return { key: "answered", label: "Besvarat" };
};

// --------------------------------------------------------------------------
// Innehållssignaler: vad kunden faktiskt sagt/skrivit.
// --------------------------------------------------------------------------
export const SIGNALS = [
  { key: "safety", label: "Säkerhet (brand/batteri)", tone: "bad", points: 50, re: /\b(brand|brinn|brann|rök|ryker|rykte|gnist|explo|svulln|sväll|uppsvälld|smält|överhett|luktar bränt|het(t)? batteri|batteriet blir varmt)/i },
  { key: "complaint", label: "Klagomål/reklamation", tone: "bad", points: 35, re: /(missnöjd|besviken|\barg\b|reklamation|reklamera|garanti|pengarna tillbaka|återbetal|anmäl|\barn\b|konsumentverket|bedr[aä]g|oseriös|skandal|inte nöjd)/i },
  { key: "urgent", label: "Brådskande", tone: "warn", points: 20, re: /(akut|bråttom|snarast|omgående|\bi ?dag\b|kan inte ta mig|till jobbet|strandsatt|står still)/i },
  { key: "callback", label: "Vill bli uppringd", tone: "warn", points: 20, re: /(^\s*ring\b|ring mig|ringa upp|ring tillbaka|ringa tillbaka|kontakta mig|hör av er)/i },
  { key: "buy", label: "Köp/bokning/pris", tone: "info", points: 15, re: /(köpa|beställ|boka|offert|vad kostar|\bpris|kostnad|reservdel|ny scooter)/i },
];

export const textSignals = (text) => {
  const t = clean(text, 4000);
  if (!t) return [];
  return SIGNALS.filter((s) => s.re.test(t)).map(({ key, label, tone, points }) => ({ key, label, tone, points }));
};

// Kundens egna rader ur ett Nova-transkript ("Kund: ...").
const customerLines = (transcript) => clean(transcript, 12000).split("\n").filter((l) => /^Kund:/.test(l)).join("\n");

// --------------------------------------------------------------------------
// Normalisering av källor till händelser
// --------------------------------------------------------------------------
// Händelse: { id, at, channel: call|sms|chat, dir: in|out, phone, text,
//   textKnown, source, nova, status, durationSec, answeredBy, outcome,
//   summary, transcript, costSek, internal, kind }

const near = (a, b, windowMs) => Math.abs(a - b) <= windowMs;

export const buildEvents = (input = {}, opts = {}) => {
  const {
    elksCalls = [], elksSms = [], smsLog = [], cases = [], followups = [],
    novaCalls = [], novaMeetings = [], outboundEntries = [], smsInbound = [], ringList = [],
  } = input;
  const { ownNumbers = [], staff = {}, labels = {}, infoSmsText = "", meetingSmsText = () => "", sinceMs = 0 } = opts;
  const own = new Set(ownNumbers.map(normalizePhone).filter(Boolean));
  const isOwn = (p) => own.has(normalizePhone(p));
  const events = [];
  const push = (e) => { if (e.at >= sinceMs) events.push(e); };

  // ---- Kända SMS-texter (för att fylla i 46elks-rader utan text) ----
  const known = [];
  for (const l of smsLog) known.push({ at: ms(l.at), phone: normalizePhone(l.to), text: l.message, source: l.source, id: l.providerId, status: l.status, from: "sms-log" });
  for (const c of cases) {
    for (const l of Array.isArray(c?.smsLog) ? c.smsLog : []) known.push({ at: ms(l.at), phone: normalizePhone(l.to || c?.customer?.phone), text: l.message, source: l.kind === "draft-inbox" ? "sms-draft" : "case-sms", id: l.providerId, status: l.status, from: "case" });
  }
  for (const f of followups) known.push({ at: ms(f.sentAt), phone: normalizePhone(f.phone), text: f.message, source: "call-dashboard", id: f.result?.id, status: f.result?.status, from: "followup" });
  for (const r of ringList) if (r?.infoSmsAt && infoSmsText) known.push({ at: ms(r.infoSmsAt), phone: normalizePhone(r.phone), text: infoSmsText, source: "ring-list-scan", from: "ringlist" });
  for (const m of novaMeetings) if (m?.customerSms === "sent") known.push({ at: ms(m.at), phone: normalizePhone(m.phone), text: meetingSmsText(m), source: "nova", from: "meeting" });
  const used = new Set();
  const findKnown = (id, phone, at) => {
    let hit = id ? known.findIndex((k, i) => !used.has(i) && k.id && k.id === id) : -1;
    if (hit < 0) hit = known.findIndex((k, i) => !used.has(i) && k.phone === phone && near(k.at, at, 3 * 60e3));
    if (hit >= 0) used.add(hit);
    return hit >= 0 ? known[hit] : null;
  };

  // ---- SMS från 46elks (facit för vem och när) ----
  for (const s of elksSms) {
    const at = ms(s.created);
    const out = String(s.direction || "").startsWith("out");
    const phone = normalizePhone(out ? s.to : s.from);
    if (!phone) continue;
    if (out) {
      const k = findKnown(s.id, phone, at);
      const text = clean(s.message, 2000) || clean(k?.text, 2000);
      push({
        id: `sms-${s.id || at}`, at, channel: "sms", dir: "out", phone, text, textKnown: Boolean(text),
        source: k?.source || "", nova: k?.source === "nova", status: clean(s.status, 30) || "sent",
        costSek: (Number(s.cost) || 0) / 10000, internal: isOwn(phone),
      });
    } else {
      push({ id: `sms-${s.id || at}`, at, channel: "sms", dir: "in", phone, text: clean(s.message, 2000), textKnown: true, source: "kund", status: "received", internal: isOwn(phone), costSek: (Number(s.cost) || 0) / 10000 });
    }
  }
  // Loggade utskick som inte syns hos 46elks (t.ex. om hämtningen misslyckades).
  known.forEach((k, i) => {
    if (used.has(i) || !k.phone || k.from === "ringlist" || k.from === "meeting") return;
    push({ id: `log-${i}-${k.at}`, at: k.at, channel: "sms", dir: "out", phone: k.phone, text: clean(k.text, 2000), textKnown: Boolean(k.text), source: k.source, nova: k.source === "nova", status: k.status || "sent", internal: isOwn(k.phone), costSek: 0 });
  });
  // Inkommande SMS i vår egen store (RING/STOPP) som 46elks-listan saknar.
  for (const r of smsInbound) {
    const at = ms(r.at);
    const phone = normalizePhone(r.phone);
    if (!phone || events.some((e) => e.channel === "sms" && e.dir === "in" && e.phone === phone && near(e.at, at, 2 * 60e3))) continue;
    push({ id: `in-${r.key || at}`, at, channel: "sms", dir: "in", phone, text: clean(r.message, 2000), textKnown: true, source: "kund", status: "received", internal: isOwn(phone) });
  }
  // Märk RING/STOPP på inkommande.
  for (const e of events) if (e.channel === "sms" && e.dir === "in") e.kind = /^\s*(stopp|stop)\s*$/i.test(e.text) ? "stopp" : /^\s*(ring|1)\b/i.test(e.text) ? "ring" : "";

  // ---- Samtal ----
  const novaById = new Map();
  const novaUsed = new Set();
  for (const c of novaCalls) {
    const cls = classifyNovaCall(c, outboundEntries, { ownNumbers });
    novaById.set(c.id || c.key, { ...c, ...cls, at: ms(c.startedAt) || ms(c.at), result: callOutcome(c) });
  }
  const novaList = [...novaById.values()];
  for (const call of elksCalls) {
    const at = ms(call.created || call.start);
    const out = String(call.direction || "").startsWith("out");
    const phone = normalizePhone(out ? call.to : call.from);
    if (!phone) continue;
    const ans = callAnsweredBy(call, staff);
    // Nova-samtal: koppla transkriptet till 46elks-raden (nummer + tid).
    const nova = novaList.find((n) => !novaUsed.has(n.id) && n.kind !== "web" && normalizePhone(n.phone) === phone && near(n.at, at, 10 * 60e3));
    const isNovaOut = out && outboundEntries.some((e) => normalizePhone(e.phone) === phone && near(ms(e.lastAttemptAt), at, 5 * 60e3));
    if (nova) novaUsed.add(nova.id);
    push({
      id: `call-${call.id || at}`, at, channel: "call", dir: out ? "out" : "in", phone,
      durationSec: Number(call.duration) || 0, answeredBy: nova ? { key: "nova", label: out ? "Nova pratade" : "Nova svarade" } : ans,
      nova: Boolean(nova) || ans.key === "nova" || isNovaOut, source: isNovaOut || nova?.kind === "outbound" || nova?.kind === "test" ? "nova" : "",
      kind: nova?.kind || "", summary: clean(nova?.summary, 1200), transcript: clean(nova?.transcript, 12000), outcome: nova?.result || null,
      text: clean(nova?.summary, 1200), textKnown: Boolean(nova?.summary), costSek: (Number(call.cost) || 0) / 10000, internal: isOwn(phone),
      status: ans.key, customerName: nova?.customer?.firstName || "",
    });
  }
  // Nova-samtal utan 46elks-rad (t.ex. om hämtningen misslyckades) och webbchattar.
  for (const n of novaList) {
    if (novaUsed.has(n.id)) continue;
    const web = n.kind === "web";
    push({
      id: `nova-${n.id}`, at: n.at, channel: web ? "chat" : "call", dir: n.kind === "outbound" || n.kind === "test" ? "out" : "in",
      phone: web ? normalizePhone(n.phone) : normalizePhone(n.phone), webId: web ? n.id : "",
      durationSec: Number(n.durationSec) || 0, answeredBy: { key: "nova", label: web ? "Nova (webbchatt)" : "Nova" }, nova: true, source: "nova",
      kind: n.kind, summary: clean(n.summary, 1200), transcript: clean(n.transcript, 12000), outcome: n.result,
      text: clean(n.summary, 1200), textKnown: Boolean(n.summary), internal: false, status: n.result?.key || "",
      customerName: n.customer?.firstName || "",
    });
  }

  // ---- Chatt på hemsidan (skapar ärenden) ----
  for (const c of cases) {
    if (c?.source !== "website_chat" && c?.channel !== "chat") continue;
    const phone = normalizePhone(c?.customer?.phone);
    for (const [i, m] of (Array.isArray(c?.chat?.messages) ? c.chat.messages : []).entries()) {
      push({
        id: `chat-${c.id}-${i}`, at: ms(m.at), channel: "chat", dir: m.from === "customer" ? "in" : "out", phone,
        webId: phone ? "" : `case-${c.id}`, text: clean(m.text, 2000), textKnown: true, source: m.from === "customer" ? "kund" : "workshop-chat",
        caseId: c.id, internal: false, status: c?.chat?.status || "",
      });
    }
  }

  for (const e of events) {
    e.sourceLabel = e.dir === "in" ? (e.channel === "chat" ? "Kund (chatt)" : "Kund") : e.source === "nova" ? "Nova" : sourceLabel(e.source, labels);
    if (e.channel === "sms" && e.dir === "out" && !e.textKnown) e.sourceLabel = "Okänd (skickat innan loggen fanns)";
    e.atIso = iso(e.at);
  }
  return events.sort((a, b) => b.at - a.at);
};

// --------------------------------------------------------------------------
// Kunder från ärenden
// --------------------------------------------------------------------------
const paidAmount = (c) => (c?.payment?.status === "paid" ? Number(c.payment.amount) || Number(c?.completion?.totalCost) || 0 : 0);

export const indexCases = (cases = []) => {
  const byPhone = new Map();
  for (const c of cases) {
    const phone = normalizePhone(c?.customer?.phone || c?.customerPhone);
    if (!phone) continue;
    const row = byPhone.get(phone) || { name: "", active: [], past: 0, newCases: [], paidTotal: 0 };
    row.name = row.name || clean(c?.customer?.name || c?.customerName, 80);
    const summary = { id: c.id, serviceNumber: clean(c.serviceNumber, 30), status: clean(c.status, 30), service: clean(c?.service?.name || c?.service, 80), vehicle: clean([c?.vehicle?.brand, c?.vehicle?.model].filter(Boolean).join(" "), 80), updatedAt: c.updatedAt || c.createdAt || "" };
    if (ACTIVE_CASE_STATUSES.has(c.status)) row.active.push(summary);
    else if (c.status === "new") row.newCases.push(summary);
    else if (!["archived", "cancelled", "spam"].includes(c.status)) row.past += 1;
    row.paidTotal += paidAmount(c);
    byPhone.set(phone, row);
  }
  return byPhone;
};

// --------------------------------------------------------------------------
// Kontakter + relevans
// --------------------------------------------------------------------------
// Poäng = (grund + signaler) × färskhet + väntetid.
//   färskhet: halveras per vecka sedan senaste händelsen.
//   väntetid: om kundens senaste kontakt är obesvarad lyfts den, mer ju
//   längre den väntat (taket 4 dygn) – och den delen bleknar inte.
export const FRESH_HALF_LIFE_DAYS = 7;

export const scoreContact = (contact, now = Date.now()) => {
  const signals = [];
  const add = (s) => { if (!signals.some((x) => x.key === s.key)) signals.push(s); };
  const inbound = contact.events.filter((e) => e.dir === "in");
  for (const e of inbound) {
    const text = e.channel === "call" ? `${e.summary || ""}\n${customerLines(e.transcript)}` : e.text;
    for (const s of textSignals(text)) add(s);
    if (e.kind === "ring") add({ key: "callback", label: "Vill bli uppringd (svarade RING)", tone: "warn", points: 20 });
    if (e.kind === "stopp") add({ key: "stopp", label: "Avregistrerad (STOPP)", tone: "dim", points: -200 });
  }
  for (const e of contact.events) {
    if (e.outcome?.key === "meeting") add({ key: "nova-meeting", label: "Nova bokade telefonmöte", tone: "good", points: 25 });
    if (e.outcome?.key === "message") add({ key: "nova-message", label: "Lämnade meddelande till Nova", tone: "info", points: 20 });
    if (e.outcome?.key === "failed") add({ key: "nova-failed", label: "Nova-samtalet misslyckades", tone: "bad", points: 25 });
  }
  const missed = inbound.filter((e) => e.channel === "call" && ["missed", "voicemail"].includes(e.answeredBy?.key));
  const lastOutAt = Math.max(0, ...contact.events.filter((e) => isRealReply(e)).map((e) => e.at));
  if (missed.some((e) => e.at > lastOutAt)) add({ key: "missed", label: `Missat samtal${missed.length > 1 ? ` (${missed.length} st)` : ""}`, tone: "warn", points: 15 + Math.min((missed.length - 1) * 5, 20) });

  const base = contact.tier === "active" ? 100 : contact.tier === "past" ? 10 : 0;
  const pts = signals.reduce((s, x) => s + x.points, 0);
  const ageDays = Math.max(0, (now - contact.lastAt) / DAY);
  const fresh = Math.pow(0.5, ageDays / FRESH_HALF_LIFE_DAYS);
  const waitingBoost = contact.waiting ? 30 + (Math.min(contact.waitingHours, 96) / 96) * 40 : 0;
  const score = Math.round((10 + base + pts) * fresh + waitingBoost);
  const reasons = [];
  if (contact.tier === "active") reasons.push(`Pågående ärende ${contact.cases.active.map((c) => c.serviceNumber || c.id).join(", ")}`);
  if (contact.waiting) reasons.push(`Väntar på svar sedan ${Math.round(contact.waitingHours)} h`);
  reasons.push(...signals.filter((s) => s.points > 0).map((s) => s.label));
  return { score, signals, reasons, fresh: Math.round(fresh * 100) / 100 };
};

// Automatiska utskick är inget svar till kunden: kunden väntar fortfarande på
// att någon faktiskt hör av sig.
export const AUTO_SOURCES = new Set(["ring-list-scan", "sms-inbound", "nova", "booking", "ring-escalate", "case-status", "contact-digest", "nova-digest", "voice-start", "voice-simple", "voice-private", "voice-notify", "voicemail-digest", "elks-balance-guard"]);
const isAutoSource = (src) => AUTO_SOURCES.has(src) || String(src || "").startsWith("campaign:");
// Räknas som att vi faktiskt svarat kunden.
export const isRealReply = (e) => {
  if (e.dir !== "out") return false;
  if (e.channel === "call") return !["noanswer"].includes(e.answeredBy?.key) && !e.nova;
  if (e.channel === "chat") return true;
  return Boolean(e.textKnown) && !isAutoSource(e.source);
};
// Inkommande som ännu kräver svar: missat samtal, SMS, chatt, eller ett
// Nova-samtal där kunden bad om återkoppling eller det gick fel.
export const needsReply = (e) => {
  if (e.dir !== "in" || e.kind === "stopp") return false;
  // Samtal och webbchatt som Nova tog: bara om kunden bad om återkoppling eller det gick fel.
  if (e.nova) return ["meeting", "message", "failed"].includes(e.outcome?.key);
  if (e.channel !== "call") return true;
  if (["missed", "voicemail"].includes(e.answeredBy?.key)) return true;
  return ["meeting", "message", "failed"].includes(e.outcome?.key);
};

export const buildContacts = (events, { cases = [], handled = {}, now = Date.now() } = {}) => {
  const caseIndex = indexCases(cases);
  const groups = new Map();
  for (const e of events) {
    if (e.internal) continue;
    const key = e.phone || e.webId || e.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const contacts = [];
  for (const [key, evs] of groups) {
    const phone = evs[0].phone || "";
    const caseRow = phone ? caseIndex.get(phone) : null;
    const tier = caseRow?.active.length ? "active" : caseRow && (caseRow.past || caseRow.paidTotal) ? "past" : "new";
    const lastAt = Math.max(...evs.map((e) => e.at));
    const lastIn = Math.max(0, ...evs.filter((e) => e.dir === "in").map((e) => e.at));
    // Ett inkommande samtal som en människa tog räknas också som svar.
    const lastHumanIn = Math.max(0, ...evs.filter((e) => e.dir === "in" && e.channel === "call" && ["workshop", "sebastian", "answered"].includes(e.answeredBy?.key)).map((e) => e.at));
    const lastReply = Math.max(0, lastHumanIn, ...evs.filter(isRealReply).map((e) => e.at));
    const handledAt = ms(handled[String(phone).replace(/\D/g, "")]?.at);
    const lastNeedsReply = Math.max(0, ...evs.filter(needsReply).map((e) => e.at));
    const waiting = lastNeedsReply > Math.max(lastReply, handledAt);
    const lastUnansweredIn = lastNeedsReply;
    const name = caseRow?.name || evs.find((e) => e.customerName)?.customerName || "";
    const contact = {
      key, phone, name, tier,
      cases: caseRow ? { active: caseRow.active, newCases: caseRow.newCases, past: caseRow.past, paidTotal: caseRow.paidTotal } : { active: [], newCases: [], past: 0, paidTotal: 0 },
      events: evs.sort((a, b) => b.at - a.at), lastAt, lastAtIso: iso(lastAt), lastInIso: iso(lastIn),
      waiting, waitingHours: waiting ? (now - lastUnansweredIn) / HOUR : 0,
      handledAtIso: iso(handledAt),
      channels: [...new Set(evs.map((e) => e.channel))],
      novaInvolved: evs.some((e) => e.nova),
    };
    Object.assign(contact, scoreContact(contact, now));
    contacts.push(contact);
  }
  return contacts.sort((a, b) => b.score - a.score || b.lastAt - a.lastAt);
};

// --------------------------------------------------------------------------
// Översikt: listor + "Nova i dag" + utskick per avsändare
// --------------------------------------------------------------------------
const stockholmDay = (t) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));

export const smsBySource = (events, inRange) => {
  const rows = new Map();
  for (const e of events) {
    if (e.channel !== "sms" || e.dir !== "out" || !inRange(e.at)) continue;
    const label = e.sourceLabel;
    const r = rows.get(label) || { label, count: 0, customers: 0, internal: 0, costSek: 0, unknownText: 0 };
    r.count += 1;
    if (e.internal) r.internal += 1; else r.customers += 1;
    if (!e.textKnown) r.unknownText += 1;
    r.costSek += e.costSek || 0;
    rows.set(label, r);
  }
  return [...rows.values()].map((r) => ({ ...r, costSek: Math.round(r.costSek * 100) / 100 })).sort((a, b) => b.count - a.count);
};

export const buildOverview = ({ events, contacts, now = Date.now(), days = 30 }) => {
  const today = stockholmDay(now);
  const isToday = (t) => stockholmDay(t) === today;
  // Kontakterna skickas en gång; listorna är nycklar i rangordning (sidan
  // filtrerar händelserna per kanal själv).
  const keys = (list) => list.map((c) => c.key);
  const forChannel = (ch) => keys(contacts.filter((c) => c.events.some((e) => e.channel === ch)));
  const novaToday = events.filter((e) => e.nova && isToday(e.at));
  return {
    generatedAt: iso(now), days,
    contacts,
    lists: {
      active: keys(contacts.filter((c) => c.tier === "active")),
      new: keys(contacts.filter((c) => c.tier !== "active")),
      calls: forChannel("call"),
      chat: forChannel("chat"),
      sms: forChannel("sms"),
    },
    counts: {
      contacts: contacts.length,
      waiting: contacts.filter((c) => c.waiting).length,
      activeWaiting: contacts.filter((c) => c.tier === "active" && c.waiting).length,
    },
    today: {
      novaEvents: novaToday,
      nova: {
        callsIn: novaToday.filter((e) => e.channel === "call" && e.dir === "in").length,
        callsOut: novaToday.filter((e) => e.channel === "call" && e.dir === "out").length,
        chats: novaToday.filter((e) => e.channel === "chat").length,
        smsOut: novaToday.filter((e) => e.channel === "sms" && e.dir === "out").length,
        meetings: novaToday.filter((e) => e.outcome?.key === "meeting").length,
        messages: novaToday.filter((e) => e.outcome?.key === "message").length,
        failed: novaToday.filter((e) => e.outcome?.key === "failed").length,
      },
      smsBySource: smsBySource(events, isToday),
      inbound: {
        calls: events.filter((e) => isToday(e.at) && e.channel === "call" && e.dir === "in" && !e.internal).length,
        missed: events.filter((e) => isToday(e.at) && e.channel === "call" && e.dir === "in" && !e.internal && ["missed", "voicemail"].includes(e.answeredBy?.key)).length,
        sms: events.filter((e) => isToday(e.at) && e.channel === "sms" && e.dir === "in" && !e.internal).length,
        chats: events.filter((e) => isToday(e.at) && e.channel === "chat" && e.dir === "in").length,
      },
    },
    period: { smsBySource: smsBySource(events, () => true) },
    kindLabels: KIND_LABELS,
  };
};
