// Gemensam uppgiftsinkorg (NEMOB OS 2.0): härleder uppgiftsförslag ur
// företagets system och lagrar dem versionerat i storen "task-inbox".
//
// Nycklar:
//   task/<id>        uppgiften (id = t_<sha1(source:sourceId)>, deterministiskt)
//   need/<hash>      behovsindex: samma kundbehov (t.ex. callback:+46…) → en öppen uppgift
//   alias/<id>       käll-id som slagits ihop med en annan uppgift (→ { taskId })
//
// Dedupliceringen är tvåstegs: (1) samma källa+käll-id ger alltid samma id
// (synk är idempotent), (2) samma behovsnyckel medan uppgiften är öppen ger
// ingen ny uppgift – källan läggs till i `sources[]`. Är behovet redan
// avslutat och kunden hör av sig IGEN (nyare mottagningstid) skapas en ny.
//
// Enbart företagsdata. Privata planeringsuppgifter (nemob-os lokala server,
// LVU m.m.) läses aldrig här och får aldrig läggas i denna store.
//
// Ren logik (derive*, prioritize, dedupe-nycklar) är exporterad och testbar
// utan lagring; lagringsfunktionerna tar storen som argument.

import { createHash } from "node:crypto";
import { commitJson, createIfAbsent, readWithEtag } from "./case-store.mjs";
import { textSignals } from "./comm-overview.mjs";
import { detectTopic, TOPIC_ECONOMY } from "./lead-priority.mjs";
import { normalizePhone } from "./sms.mjs";
import { isoToLocal, localToIso, timingFor } from "./time-phrase.mjs";

export const TASK_STORE = "task-inbox";
export const TASK_PREFIX = "task/";
export const NEED_PREFIX = "need/";
export const ALIAS_PREFIX = "alias/";

export const KINDS = Object.freeze({
  callback: "callback",            // kund vill bli uppringd / har ringt utan svar
  meeting_call: "meeting_call",    // Nova bokade telefonmöte med önskad tid
  booking_decision: "booking_decision", // bokningsförfrågan väntar på bekräfta/avböj
  case_followup: "case_followup",  // verkstadsärende som väntar på åtgärd
  sms_reply: "sms_reply",          // inkommande SMS utan svar
  email: "email",                  // viktigt mejl (ej aktiv källa än)
  manual: "manual",                // manuell uppgift
});
export const KIND_LABELS = Object.freeze({
  callback: "Ring upp", meeting_call: "Telefonmöte", booking_decision: "Bokningsbeslut", case_followup: "Ärende", sms_reply: "Svara på SMS", email: "Mejl", manual: "Uppgift",
});
export const STATUSES = Object.freeze(["proposed", "selected", "in_progress", "snoozed", "done", "rejected"]);
export const OPEN_STATUSES = new Set(["proposed", "selected", "in_progress", "snoozed"]);
export const SOURCES = Object.freeze(["nova-call", "nova-meeting", "nova-message", "sms-ring", "sms-inbound", "ring-list", "elks-missed", "booking-request", "case", "email", "manual"]);
export const SOURCE_LABELS = Object.freeze({
  "nova-call": "Nova-samtal", "nova-meeting": "Nova-möte", "nova-message": "Nova-meddelande", "sms-ring": "RING-svar", "sms-inbound": "Inkommande SMS",
  "ring-list": "Ringlistan", "elks-missed": "Missat samtal", "booking-request": "Bokningsförfrågan", case: "Verkstadsärende", email: "E-post", manual: "Manuell",
});
// Standardtid per uppgiftstyp (minuter) – justeras av ämnet för ärenden.
export const DEFAULT_MINUTES = Object.freeze({ callback: 10, meeting_call: 20, booking_decision: 5, case_followup: 15, sms_reply: 5, email: 10, manual: 15 });
export const DEFAULT_ASSIGNEE = "sebastian";
const HOUR = 3600000;
const DAY = 24 * HOUR;

const clean = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const sha = (s) => createHash("sha1").update(String(s)).digest("hex");
export const taskIdFor = (source, sourceId) => `t_${sha(`${clean(source, 40)}:${clean(sourceId, 200)}`).slice(0, 20)}`;
export const needKeyFor = (kind, subject) => (subject ? `${kind}:${clean(subject, 80)}` : "");
const needStoreKey = (needKey) => `${NEED_PREFIX}${sha(needKey).slice(0, 24)}`;
const taskKey = (id) => `${TASK_PREFIX}${id}`;
const aliasKey = (id) => `${ALIAS_PREFIX}${id}`;
const ms = (iso) => { const t = new Date(iso || 0).getTime(); return Number.isFinite(t) ? t : 0; };
const iso = (t) => new Date(t).toISOString();
const firstName = (name) => clean(name, 120).split(/\s+/).filter(Boolean)[0] || "";

// ---------------------------------------------------------------------------
// Prioritet: poäng 0–100 + läsbar motivering. Ren funktion.
// ---------------------------------------------------------------------------
export const prioritize = (p, now = Date.now()) => {
  const reasons = [];
  let score = { callback: 40, meeting_call: 50, booking_decision: 45, case_followup: 30, sms_reply: 35, email: 25, manual: 30 }[p.kind] ?? 30;
  reasons.push(`${KIND_LABELS[p.kind] || p.kind} (grund ${score})`);
  const waitingH = p.receivedAt ? Math.max(0, (now - ms(p.receivedAt)) / HOUR) : 0;
  if (waitingH >= 48) { score += 20; reasons.push(`väntat ${Math.round(waitingH / 24)} dygn`); }
  else if (waitingH >= 24) { score += 15; reasons.push("väntat över ett dygn"); }
  else if (waitingH >= 4) { score += 8; reasons.push(`väntat ${Math.round(waitingH)} tim`); }
  const attempts = Number(p.attempts) || 0;
  if (attempts >= 2) { score += Math.min(25, attempts * 8); reasons.push(`kunden har hört av sig ${attempts} gånger`); }
  else if (attempts === 1 && p.kind === "callback") { score += 5; }
  for (const s of p.signals || []) { score += Math.min(50, s.points || 0) / 2; reasons.push(s.label.toLowerCase()); }
  if (p.dueAt) {
    const left = ms(p.dueAt) - now;
    if (left < 0) { score += 20; reasons.push("deadline passerad"); }
    else if (left < 4 * HOUR) { score += 15; reasons.push("deadline inom 4 tim"); }
    else if (left < DAY) { score += 8; reasons.push("deadline i dag/i morgon"); }
  }
  if (p.timing?.needsReview) { score += 5; reasons.push("tidsuppgift behöver kontrolleras"); }
  if (p.caseActive) { score += 5; reasons.push("aktivt ärende"); }
  if ((p.sources || []).length > 1) { score += 5; reasons.push(`${p.sources.length} källor pekar på samma behov`); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  return { level, score, reason: reasons.join(" · ") };
};

const estimateMinutes = (kind, text = "") => {
  const topic = detectTopic(text);
  if (kind === "case_followup" && topic && TOPIC_ECONOMY[topic]) return Math.min(60, Math.round(TOPIC_ECONOMY[topic].minutes / 3));
  return DEFAULT_MINUTES[kind] || 15;
};

// ---------------------------------------------------------------------------
// Härledning per källa → förslag. Alla är rena funktioner över redan lästa rader.
// Förslag: { source, sourceId, kind, title, description, customer: { phone, name },
//            caseId, serviceNumber, receivedAt, dueAt, timing, signals, attempts,
//            estimatedMinutes, needKey, action? }
// ---------------------------------------------------------------------------
const base = (over) => ({
  source: "", sourceId: "", kind: KINDS.callback, title: "", description: "", customer: { phone: "", name: "" }, caseId: "", serviceNumber: "",
  receivedAt: "", dueAt: "", timing: null, signals: [], attempts: 0, estimatedMinutes: 10, needKey: "", caseActive: false, action: null, ...over,
});

const caseIndexByPhone = (cases = []) => {
  const map = new Map();
  for (const c of cases) {
    const phone = normalizePhone(c?.customer?.phone);
    if (!phone) continue;
    if (!map.has(phone)) map.set(phone, []);
    map.get(phone).push(c);
  }
  return map;
};
const OPEN_CASE = new Set(["new", "contacted", "checked_in", "diagnosing", "repairing", "waiting_parts", "waiting_customer", "ready"]);
const linkCase = (byPhone, phone) => {
  const open = (byPhone.get(phone) || []).filter((c) => OPEN_CASE.has(c.status));
  if (open.length === 1) return { caseId: clean(open[0].id, 120), serviceNumber: clean(open[0].serviceNumber, 40), caseActive: true, ambiguous: false };
  return { caseId: "", serviceNumber: "", caseActive: open.length > 0, ambiguous: open.length > 1 };
};

// Ringlistan (status new = kunden har ringt utan att nås).
export const deriveFromRingList = (entries = [], { cases = [], now = Date.now() } = {}) => {
  const byPhone = caseIndexByPhone(cases);
  return entries.filter((e) => e && e.status === "new" && normalizePhone(e.phone)).map((e) => {
    const phone = normalizePhone(e.phone);
    const receivedAt = clean(e.lastCustomerCallAt || e.updatedAt || e.addedAt, 40) || iso(now);
    const link = linkCase(byPhone, phone);
    return base({
      source: "ring-list", sourceId: `${phone}:${receivedAt}`, kind: KINDS.callback,
      title: `Ring upp ${e.name ? firstName(e.name) : phone}`,
      description: [e.reason ? clean(e.reason, 160) : "Har ringt utan att nå oss.", e.attempts > 1 ? `${e.attempts} försök.` : ""].filter(Boolean).join(" "),
      customer: { phone, name: clean(e.name, 140) }, caseId: e.caseId ? clean(e.caseId, 120) : link.caseId, serviceNumber: link.serviceNumber, caseActive: link.caseActive,
      receivedAt, dueAt: iso(ms(receivedAt) + DAY), attempts: Number(e.attempts) || 1,
      signals: textSignals(e.reason), estimatedMinutes: DEFAULT_MINUTES.callback, needKey: needKeyFor("callback", phone),
    });
  });
};

// RING-svar och obesvarade inkommande SMS (store sms-inbound).
export const deriveFromInboundSms = (rows = [], { cases = [], now = Date.now(), maxAgeDays = 14 } = {}) => {
  const byPhone = caseIndexByPhone(cases);
  const since = now - maxAgeDays * DAY;
  const out = [];
  for (const r of rows) {
    if (!r || r.handled || ms(r.at) < since) continue;
    const phone = normalizePhone(r.phone);
    if (!phone || r.type === "stopp") continue;
    const link = r.caseId ? { caseId: clean(r.caseId, 120), serviceNumber: "", caseActive: true } : linkCase(byPhone, phone);
    const isRing = r.type === "ring";
    out.push(base({
      source: isRing ? "sms-ring" : "sms-inbound", sourceId: clean(r.key || r.providerId || `${r.at}_${phone}`, 200), kind: isRing ? KINDS.callback : KINDS.sms_reply,
      title: isRing ? `Ring upp ${phone} (svarade RING)` : `Svara ${phone} på SMS`,
      description: isRing ? "Kunden svarade RING – lovad uppringning inom 24 tim." : clean(r.message, 200),
      customer: { phone, name: "" }, caseId: link.caseId, serviceNumber: link.serviceNumber, caseActive: link.caseActive,
      receivedAt: clean(r.at, 40), dueAt: iso(ms(r.at) + (isRing ? DAY : 2 * DAY)), attempts: 1,
      signals: textSignals(r.message), estimatedMinutes: isRing ? DEFAULT_MINUTES.callback : DEFAULT_MINUTES.sms_reply,
      needKey: needKeyFor(isRing ? "callback" : "sms_reply", phone),
    }));
  }
  return out;
};

// Nova: telefonmöten (önskad tid i fri text) och meddelanden till Sebastian.
export const deriveFromNova = ({ meetings = [], messages = [], calls = [] } = {}, { cases = [], now = Date.now(), maxAgeDays = 14 } = {}) => {
  const byPhone = caseIndexByPhone(cases);
  const since = now - maxAgeDays * DAY;
  const out = [];
  for (const m of meetings) {
    if (!m || m.done || ms(m.at) < since) continue;
    const phone = normalizePhone(m.phone);
    const caseId = clean(m.case?.id, 120);
    const link = caseId ? { caseId, serviceNumber: "", caseActive: true } : linkCase(byPhone, phone);
    const timing = timingFor({ receivedAt: m.at, requestedRaw: m.preferredTime, now });
    const due = timing.requested?.at && timing.requested.status === "resolved" ? timing.requested.at : iso(ms(m.at) + DAY);
    out.push(base({
      source: "nova-meeting", sourceId: clean(m.id, 200), kind: KINDS.meeting_call,
      title: `Ring ${m.name ? firstName(m.name) : phone}${timing.requested?.local ? ` ${timing.requested.local}` : timing.requested?.date ? ` ${timing.requested.date} (tid oklar)` : ""}`,
      description: [m.topic ? `Ämne: ${clean(m.topic, 160)}.` : "", m.vehicle ? `Fordon: ${clean(m.vehicle, 80)}.` : "", m.preferredTime ? `Önskad tid enligt kunden: "${clean(m.preferredTime, 80)}".` : "Ingen önskad tid angiven.", timing.needsReview ? "KONTROLLERA TIDEN." : ""].filter(Boolean).join(" "),
      customer: { phone, name: clean(m.name, 140) }, caseId: link.caseId, serviceNumber: link.serviceNumber, caseActive: link.caseActive,
      receivedAt: clean(m.at, 40), dueAt: due, timing, attempts: 1, signals: textSignals(m.topic), estimatedMinutes: DEFAULT_MINUTES.meeting_call,
      needKey: needKeyFor("meeting", phone),
    }));
  }
  for (const n of messages) {
    if (!n || n.done || ms(n.at) < since) continue;
    const phone = normalizePhone(n.phone);
    const link = linkCase(byPhone, phone);
    out.push(base({
      source: "nova-message", sourceId: clean(n.id, 200), kind: KINDS.callback,
      title: `Ring upp ${n.name ? firstName(n.name) : phone} (meddelande via Nova)`, description: clean(n.message, 200),
      customer: { phone, name: clean(n.name, 140) }, caseId: link.caseId, serviceNumber: link.serviceNumber, caseActive: link.caseActive,
      receivedAt: clean(n.at, 40), dueAt: iso(ms(n.at) + DAY), attempts: 1, signals: textSignals(n.message), estimatedMinutes: DEFAULT_MINUTES.callback,
      needKey: needKeyFor("callback", phone),
    }));
  }
  // Inkommande Nova-samtal som slutade utan lösning (ingen bokning, inget möte, inget meddelande).
  for (const c of calls) {
    if (!c || c.done || ms(c.startedAt || c.at) < since) continue;
    const phone = normalizePhone(c.phone);
    if (!phone || c.meetingBooked || /^(outbound|test|web)$/.test(String(c.kind || ""))) continue;
    const needsHuman = /vill (bli uppringd|prata med)|ring(a)? (upp|tillbaka)|återkom|kunde inte hjälpa|hänvisa|sebastian/i.test(`${c.summary || ""} ${c.outcome || ""}`) || /transfer|escalat|callback|human/i.test(String(c.outcome || c.endReason || ""));
    if (!needsHuman) continue;
    const link = linkCase(byPhone, phone);
    out.push(base({
      source: "nova-call", sourceId: clean(c.id, 200), kind: KINDS.callback,
      title: `Följ upp Nova-samtal med ${c.customer?.firstName || phone}`, description: clean(c.summary, 200) || "Samtalet slutade utan lösning.",
      customer: { phone, name: clean(c.customer?.firstName, 140) }, caseId: link.caseId, serviceNumber: link.serviceNumber, caseActive: link.caseActive,
      receivedAt: clean(c.startedAt || c.at, 40), dueAt: iso(ms(c.startedAt || c.at) + DAY), attempts: 1, signals: textSignals(c.summary), estimatedMinutes: DEFAULT_MINUTES.callback,
      needKey: needKeyFor("callback", phone),
    }));
  }
  return out;
};

// Missade inkommande samtal från 46elks (samtalslistan), senaste 48 tim, ett per nummer.
export const deriveFromMissedCalls = (rows = [], { cases = [], ownNumbers = [], blocked = new Set(), now = Date.now(), maxAgeHours = 48 } = {}) => {
  const byPhone = caseIndexByPhone(cases);
  const own = new Set(ownNumbers.map(normalizePhone).filter(Boolean));
  const since = now - maxAgeHours * HOUR;
  const perPhone = new Map();
  for (const call of rows) {
    if (!call || call.direction !== "incoming") continue;
    const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(call.created || "")) ? call.created : `${call.created}Z`);
    if (!Number.isFinite(at) || at < since) continue;
    const phone = normalizePhone(call.from);
    if (!phone || own.has(phone) || blocked.has(phone)) continue;
    const answered = (Array.isArray(call.legs) ? call.legs : []).some((leg) => leg.state === "success") || call.state === "success";
    if (answered) continue;
    const cur = perPhone.get(phone) || { phone, count: 0, firstId: clean(call.id, 120), lastAt: 0 };
    cur.count += 1;
    if (at > cur.lastAt) { cur.lastAt = at; cur.lastId = clean(call.id, 120); }
    perPhone.set(phone, cur);
  }
  return [...perPhone.values()].map((m) => {
    const link = linkCase(byPhone, m.phone);
    return base({
      source: "elks-missed", sourceId: m.lastId || m.firstId, kind: KINDS.callback,
      title: `Ring upp ${m.phone} (missat samtal)`, description: m.count > 1 ? `${m.count} obesvarade samtal senaste ${maxAgeHours} tim.` : "Obesvarat inkommande samtal.",
      customer: { phone: m.phone, name: "" }, caseId: link.caseId, serviceNumber: link.serviceNumber, caseActive: link.caseActive,
      receivedAt: iso(m.lastAt), dueAt: iso(m.lastAt + DAY), attempts: m.count, estimatedMinutes: DEFAULT_MINUTES.callback, needKey: needKeyFor("callback", m.phone),
    });
  });
};

// Verkstadsärenden: bokningsförfrågningar att besluta + ärenden som väntar på oss.
const STALE_HOURS = Object.freeze({ new: 4, contacted: 72, waiting_customer: 72, ready: 48, waiting_parts: 7 * 24 });
export const deriveFromCases = (cases = [], { now = Date.now() } = {}) => {
  const out = [];
  for (const c of cases) {
    if (!c || !c.id) continue;
    const phone = normalizePhone(c.customer?.phone);
    const name = clean(c.customer?.name, 140);
    const id = clean(c.id, 120);
    const sn = clean(c.serviceNumber, 40);
    const text = `${c.service || ""} ${c.message || ""}`;
    if (c.bookingMode === "request" && c.bookingRequest?.status === "pending") {
      const receivedAt = clean(c.bookingRequest.requestedAt || c.createdAt, 40);
      const timing = timingFor({ receivedAt, requestedLocal: c.preferredDate, now });
      const reqMs = timing.requested?.at ? ms(timing.requested.at) : 0;
      const due = reqMs ? iso(Math.min(reqMs - DAY, ms(receivedAt) + 4 * HOUR)) : iso(ms(receivedAt) + 4 * HOUR);
      out.push(base({
        source: "booking-request", sourceId: id, kind: KINDS.booking_decision,
        title: `Bekräfta eller avböj ${firstName(name) || phone}${timing.requested?.local ? ` ${timing.requested.local}` : ""}`,
        description: [clean(c.service, 80), clean(c.vehicle?.model, 60), clean(c.message, 120)].filter(Boolean).join(" · ") || "Bokningsförfrågan väntar.",
        customer: { phone, name }, caseId: id, serviceNumber: sn, caseActive: true, receivedAt, dueAt: due, timing, attempts: 1,
        signals: textSignals(text), estimatedMinutes: DEFAULT_MINUTES.booking_decision, needKey: needKeyFor("booking", id),
        action: { confirm: { method: "PATCH", url: `/api/cases/${encodeURIComponent(id)}`, body: { action: "confirm_booking_request" } }, decline: { method: "PATCH", url: `/api/cases/${encodeURIComponent(id)}`, body: { action: "decline_booking_request" } } },
      }));
      continue;
    }
    const staleH = STALE_HOURS[c.status];
    if (!staleH) continue;
    const since = clean(c.updatedAt || c.createdAt, 40);
    if (!since || now - ms(since) < staleH * HOUR) continue;
    const what = { new: "Nytt ärende utan kontakt", contacted: "Kontaktad – ingen bokning än", waiting_customer: "Väntar på kundens svar", ready: "Klar – kunden har inte hämtat", waiting_parts: "Väntar på delar" }[c.status];
    const confirmed = c.bookingMode === "direct" || c.bookingRequest?.status === "confirmed" ? c.preferredDate : "";
    out.push(base({
      source: "case", sourceId: `${id}:${c.status}`, kind: KINDS.case_followup,
      title: `${what}: ${firstName(name) || phone}${sn ? ` (${sn})` : ""}`,
      description: [clean(c.service, 80), clean(c.vehicle?.model, 60), c.status === "waiting_parts" ? "Kolla leverans." : "", c.status === "ready" ? "Påminn om upphämtning." : ""].filter(Boolean).join(" · "),
      customer: { phone, name }, caseId: id, serviceNumber: sn, caseActive: true, receivedAt: since, dueAt: iso(ms(since) + staleH * HOUR + DAY),
      timing: confirmed ? timingFor({ receivedAt: c.createdAt, confirmedLocal: confirmed, now }) : null, attempts: 1,
      signals: textSignals(text), estimatedMinutes: estimateMinutes(KINDS.case_followup, text), needKey: needKeyFor("case", id),
    }));
  }
  return out;
};

// Sammanfogar förslag med samma behovsnyckel INOM en körning (t.ex. ringlista +
// missat samtal + RING från samma nummer): den tidigast mottagna blir primär,
// de andra blir `sources[]`. Returnerar förslag med `sources` och `aliases`.
export const mergeProposals = (proposals = []) => {
  const byNeed = new Map();
  const out = [];
  for (const p of proposals) {
    const id = taskIdFor(p.source, p.sourceId);
    const entry = { id, source: p.source, sourceId: p.sourceId, receivedAt: p.receivedAt, label: SOURCE_LABELS[p.source] || p.source };
    if (!p.needKey) { out.push({ ...p, id, sources: [entry], aliases: [], latestAt: p.receivedAt }); continue; }
    const cur = byNeed.get(p.needKey);
    if (!cur) { const item = { ...p, id, sources: [entry], aliases: [], latestAt: p.receivedAt }; byNeed.set(p.needKey, item); out.push(item); continue; }
    cur.sources.push(entry);
    cur.aliases.push(id);
    cur.attempts = Math.max(Number(cur.attempts) || 0, 0) + (Number(p.attempts) || 1);
    // receivedAt = tidigaste signalen (hur länge kunden väntat), latestAt = senaste (är behovet nytt efter ett avslut?).
    if (ms(p.receivedAt) < ms(cur.receivedAt)) { cur.receivedAt = p.receivedAt; }
    if (ms(p.receivedAt) > ms(cur.latestAt)) { cur.latestAt = p.receivedAt; }
    if (ms(p.dueAt) && (!ms(cur.dueAt) || ms(p.dueAt) < ms(cur.dueAt))) cur.dueAt = p.dueAt;
    if (!cur.customer.name && p.customer.name) cur.customer.name = p.customer.name;
    if (!cur.caseId && p.caseId) { cur.caseId = p.caseId; cur.serviceNumber = p.serviceNumber; cur.caseActive = true; }
    if (!cur.timing && p.timing) cur.timing = p.timing;
    for (const s of p.signals || []) if (!cur.signals.some((x) => x.key === s.key)) cur.signals.push(s);
    if (p.source === "nova-meeting" || p.source === "nova-message") { cur.title = p.title; cur.description = p.description; }
  }
  return out;
};

// Uppgiftsobjektet som lagras / returneras.
export const buildTask = (p, { now = Date.now(), by = "system" } = {}) => {
  const priority = prioritize(p, now);
  const at = iso(now);
  return {
    id: p.id || taskIdFor(p.source, p.sourceId), kind: p.kind, kindLabel: KIND_LABELS[p.kind] || p.kind,
    title: clean(p.title, 140), description: clean(p.description, 400),
    source: p.source, sourceId: clean(p.sourceId, 200), sourceLabel: SOURCE_LABELS[p.source] || p.source, sources: p.sources || [{ id: p.id, source: p.source, sourceId: p.sourceId, receivedAt: p.receivedAt }],
    customer: { phone: normalizePhone(p.customer?.phone), name: clean(p.customer?.name, 140) }, caseId: clean(p.caseId, 120), serviceNumber: clean(p.serviceNumber, 40),
    receivedAt: clean(p.receivedAt, 40), receivedLocal: p.receivedAt ? isoToLocal(p.receivedAt) : "", dueAt: clean(p.dueAt, 40), dueLocal: p.dueAt ? isoToLocal(p.dueAt) : "",
    timing: p.timing || null, needsReview: Boolean(p.timing?.needsReview), signals: (p.signals || []).map(({ key, label }) => ({ key, label })),
    attempts: Number(p.attempts) || 0, priority, estimatedMinutes: Number(p.estimatedMinutes) || DEFAULT_MINUTES[p.kind] || 15,
    status: "proposed", assignee: DEFAULT_ASSIGNEE, action: p.action || null, needKey: p.needKey || "", domain: "business",
    createdAt: at, updatedAt: at, history: [{ at, by, event: "created", note: `Förslag från ${SOURCE_LABELS[p.source] || p.source}` }],
  };
};

// Fält som synken får uppdatera på en befintlig öppen uppgift (aldrig status/historik/manuella fält).
const refreshFields = (task, p, now) => {
  const next = { ...task };
  next.attempts = Math.max(Number(task.attempts) || 0, Number(p.attempts) || 0);
  next.dueAt = p.dueAt || task.dueAt; next.dueLocal = next.dueAt ? isoToLocal(next.dueAt) : "";
  next.timing = p.timing || task.timing; next.needsReview = Boolean(next.timing?.needsReview);
  next.signals = (p.signals || []).map(({ key, label }) => ({ key, label }));
  if (!task.caseId && p.caseId) { next.caseId = p.caseId; next.serviceNumber = p.serviceNumber || ""; }
  if (!task.customer?.name && p.customer?.name) next.customer = { ...task.customer, name: clean(p.customer.name, 140) };
  next.action = p.action || task.action || null;
  const known = new Set((task.sources || []).map((s) => s.id));
  next.sources = [...(task.sources || []), ...(p.sources || []).filter((s) => !known.has(s.id))];
  next.priority = prioritize({ ...p, attempts: next.attempts, sources: next.sources }, now);
  const changed = JSON.stringify({ a: next.attempts, d: next.dueAt, t: next.timing, s: next.signals, c: next.caseId, n: next.customer, src: next.sources.length, p: next.priority.score, ac: next.action })
    !== JSON.stringify({ a: task.attempts, d: task.dueAt, t: task.timing, s: task.signals, c: task.caseId, n: task.customer, src: (task.sources || []).length, p: task.priority?.score, ac: task.action });
  if (!changed) return null;
  next.updatedAt = iso(now);
  return next;
};

// ---------------------------------------------------------------------------
// Lagring
// ---------------------------------------------------------------------------
export const listTasks = async (store) => {
  const keys = [];
  let cursor;
  do {
    const page = await store.list({ prefix: TASK_PREFIX, ...(cursor ? { cursor } : {}) });
    keys.push(...(page.blobs || []).map((b) => { try { return decodeURIComponent(b.key); } catch { return b.key; } }));
    cursor = page.cursor;
  } while (cursor);
  const items = [];
  for (let i = 0; i < keys.length; i += 40) {
    const part = await Promise.all(keys.slice(i, i + 40).map((key) => store.get(key, { type: "json" }).catch(() => null)));
    items.push(...part.filter(Boolean));
  }
  return items;
};

export const getTask = async (store, id) => {
  const read = await readWithEtag(store, taskKey(id), { allowMissingEtag: true });
  if (read.item) return read;
  const alias = await store.get(aliasKey(id), { type: "json" }).catch(() => null);
  if (alias?.taskId) return readWithEtag(store, taskKey(alias.taskId), { allowMissingEtag: true });
  return read;
};

// Synkar förslag in i storen. Idempotent: samma förslag igen skriver inget.
// Returnerar { created, merged, refreshed, suppressed, skipped, errors }.
export const syncProposals = async (store, proposals = [], { now = Date.now(), by = "sync" } = {}) => {
  const stats = { created: 0, merged: 0, refreshed: 0, suppressed: 0, unchanged: 0, errors: [] };
  const merged = mergeProposals(proposals);
  for (const p of merged) {
    try {
      // 1) Finns uppgiften (eller ett alias) redan?
      const existing = await getTask(store, p.id);
      if (existing.item) {
        if (!OPEN_STATUSES.has(existing.item.status)) { stats.unchanged += 1; continue; }
        const result = await commitJson(store, taskKey(existing.item.id), (cur) => OPEN_STATUSES.has(cur.status) ? refreshFields(cur, p, now) : null, { current: existing.item, etag: existing.etag });
        if (result.ok) stats.refreshed += 1; else if (result.reason === "aborted") stats.unchanged += 1; else stats.errors.push(`${p.id}:${result.reason}`);
        await writeAliases(store, p, existing.item.id);
        continue;
      }
      // 2) Behovsindex: samma kundbehov redan öppet → slå ihop.
      if (p.needKey) {
        const needKey = needStoreKey(p.needKey);
        const claim = await createIfAbsent(store, needKey, { needKey: p.needKey, taskId: p.id, at: iso(now) });
        if (!claim.created && claim.item?.taskId && claim.item.taskId !== p.id) {
          const owner = await readWithEtag(store, taskKey(claim.item.taskId), { allowMissingEtag: true });
          if (owner.item && OPEN_STATUSES.has(owner.item.status)) {
            const result = await commitJson(store, taskKey(owner.item.id), (cur) => {
              if (!OPEN_STATUSES.has(cur.status)) return null;
              const next = refreshFields(cur, { ...p, sources: [...(p.sources || [])], attempts: (Number(cur.attempts) || 0) + (Number(p.attempts) || 1) }, now) || { ...cur };
              next.history = [...(cur.history || []), { at: iso(now), by, event: "merged", note: `Ny signal: ${SOURCE_LABELS[p.source] || p.source}` }].slice(-60);
              next.updatedAt = iso(now);
              return next;
            }, { current: owner.item, etag: owner.etag });
            if (result.ok) stats.merged += 1; else stats.errors.push(`${p.id}:merge:${result.reason}`);
            await writeAliases(store, p, owner.item.id, true);
            continue;
          }
          // Ägaren är avslutad. Nyare signal än avslutet → nytt behov; annars redan hanterat.
          const closedAt = ms(owner.item?.resolvedAt || owner.item?.updatedAt);
          if (owner.item && ms(p.latestAt || p.receivedAt) <= closedAt) { stats.suppressed += 1; await writeAliases(store, p, owner.item.id, true); continue; }
          const took = await commitJson(store, needKey, (cur) => ({ ...cur, taskId: p.id, at: iso(now), previousTaskId: cur.taskId }), { current: claim.item, etag: claim.etag });
          if (!took.ok) { stats.errors.push(`${p.id}:need:${took.reason}`); continue; }
        }
      }
      // 3) Skapa.
      const created = await createIfAbsent(store, taskKey(p.id), buildTask(p, { now, by }));
      if (created.created) stats.created += 1; else stats.unchanged += 1;
      await writeAliases(store, p, p.id);
    } catch (error) {
      stats.errors.push(`${p.id}:${clean(error?.message, 80)}`);
    }
  }
  return stats;
};
const writeAliases = async (store, p, ownerId, includeSelf = false) => {
  const ids = [...(p.aliases || []), ...(includeSelf && p.id !== ownerId ? [p.id] : [])];
  for (const id of ids) await createIfAbsent(store, aliasKey(id), { taskId: ownerId }).catch(() => {});
};

// Manuell uppgift (idempotent på idempotencyKey). { created, task, etag }.
export const createManualTask = async (store, input = {}, { now = Date.now(), by = "admin" } = {}) => {
  const key = clean(input.idempotencyKey, 120);
  if (key.length < 8) return { ok: false, error: "idempotency_key_required", description: "idempotencyKey (≥ 8 tecken) krävs." };
  const title = clean(input.title, 140);
  if (!title) return { ok: false, error: "title_required", description: "title krävs." };
  const dueAt = input.dueAt ? (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(String(input.dueAt)) ? localToIso(input.dueAt) : clean(input.dueAt, 40)) : "";
  if (input.dueAt && !ms(dueAt)) return { ok: false, error: "invalid_due", description: "dueAt ska vara ISO eller YYYY-MM-DDTHH:MM (Stockholm)." };
  const phone = normalizePhone(input.phone || input.customer?.phone);
  const p = base({
    source: "manual", sourceId: key, kind: KINDS.manual, title, description: clean(input.description, 400),
    customer: { phone, name: clean(input.name || input.customer?.name, 140) }, caseId: clean(input.caseId, 120), serviceNumber: clean(input.serviceNumber, 40),
    receivedAt: iso(now), dueAt, attempts: 0, estimatedMinutes: Math.min(480, Math.max(1, Number(input.estimatedMinutes) || DEFAULT_MINUTES.manual)), needKey: "",
  });
  const task = buildTask({ ...p, id: taskIdFor("manual", key) }, { now, by });
  if (["high", "medium", "low"].includes(input.priority)) task.priority = { level: input.priority, score: { high: 80, medium: 55, low: 25 }[input.priority], reason: "satt manuellt" };
  if (input.assignee) task.assignee = clean(input.assignee, 60);
  const created = await createIfAbsent(store, taskKey(task.id), task);
  return { ok: true, created: created.created, task: created.item, etag: created.etag };
};

// ---------------------------------------------------------------------------
// Statusövergångar (idempotenta, versionerade).
// ---------------------------------------------------------------------------
export const ACTIONS = Object.freeze({
  select: { to: "selected", from: ["proposed", "snoozed", "selected"] },
  start: { to: "in_progress", from: ["proposed", "selected", "snoozed", "in_progress"] },
  done: { to: "done", from: ["proposed", "selected", "in_progress", "snoozed", "done"] },
  reject: { to: "rejected", from: ["proposed", "selected", "in_progress", "snoozed", "rejected"] },
  snooze: { to: "snoozed", from: ["proposed", "selected", "in_progress", "snoozed"] },
  reopen: { to: "proposed", from: ["done", "rejected", "snoozed", "proposed"] },
  assign: { to: null, from: STATUSES },
  note: { to: null, from: STATUSES },
});
export const transitionTask = async (store, id, { action, by = "admin", note = "", until = "", assignee = "", etag, now = Date.now() } = {}) => {
  const spec = ACTIONS[action];
  if (!spec) return { ok: false, error: "unknown_action", status: 400 };
  const read = await getTask(store, id);
  if (!read.item) return { ok: false, error: "not_found", status: 404 };
  const current = read.item;
  if (etag && read.etag && String(etag).replace(/^W\//, "").replace(/^"|"$/g, "") !== String(read.etag).replace(/^W\//, "").replace(/^"|"$/g, "")) {
    return { ok: false, error: "precondition_failed", status: 412, task: current, etag: read.etag };
  }
  if (!spec.from.includes(current.status)) return { ok: false, error: "invalid_transition", status: 409, description: `${current.status} → ${action} är inte tillåtet.`, task: current, etag: read.etag };
  let untilIso = "";
  if (action === "snooze") {
    untilIso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(String(until)) ? localToIso(until) : clean(until, 40);
    if (!ms(untilIso) || ms(untilIso) <= now) return { ok: false, error: "invalid_until", status: 400, description: "until måste vara en framtida tid (ISO eller YYYY-MM-DDTHH:MM)." };
  }
  const same = (spec.to === null || current.status === spec.to) && !note && !assignee && (action !== "snooze" || current.snoozedUntil === untilIso);
  if (same && spec.to !== null) return { ok: true, task: current, etag: read.etag, unchanged: true };
  const result = await commitJson(store, taskKey(current.id), (cur) => {
    if (!spec.from.includes(cur.status)) return null;
    const at = iso(now);
    const next = { ...cur, updatedAt: at, updatedBy: clean(by, 60) };
    if (spec.to) next.status = spec.to;
    if (action === "snooze") next.snoozedUntil = untilIso; else if (spec.to && spec.to !== "snoozed") next.snoozedUntil = "";
    if (spec.to === "done" || spec.to === "rejected") { next.resolvedAt = at; next.resolvedBy = clean(by, 60); }
    if (action === "reopen") { next.resolvedAt = ""; next.resolvedBy = ""; }
    if (action === "assign" && assignee) next.assignee = clean(assignee, 60);
    if (spec.to === "selected" && !cur.selectedAt) next.selectedAt = at;
    next.history = [...(cur.history || []), { at, by: clean(by, 60), event: action, note: clean(note, 300), ...(untilIso ? { until: untilIso } : {}), ...(assignee ? { assignee: clean(assignee, 60) } : {}) }].slice(-60);
    return next;
  }, { current, etag: read.etag });
  if (!result.ok) {
    if (result.reason === "aborted") return { ok: false, error: "invalid_transition", status: 409, task: current };
    if (result.reason === "conflict") return { ok: false, error: "conflict", status: 409 };
    return { ok: false, error: result.reason === "unversioned" ? "storage_unversioned" : "storage_error", status: 503 };
  }
  return { ok: true, task: result.item, etag: result.etag, unchanged: false };
};

// Väcker snoozade uppgifter vars tid passerat (körs vid listning). Returnerar antal väckta.
export const wakeSnoozed = async (store, tasks, now = Date.now()) => {
  let woken = 0;
  for (const t of tasks) {
    if (t.status !== "snoozed" || !t.snoozedUntil || ms(t.snoozedUntil) > now) continue;
    const r = await commitJson(store, taskKey(t.id), (cur) => cur.status === "snoozed" && ms(cur.snoozedUntil) <= now
      ? { ...cur, status: "proposed", snoozedUntil: "", updatedAt: iso(now), history: [...(cur.history || []), { at: iso(now), by: "system", event: "woken", note: "Återkom-tiden har passerat." }].slice(-60) }
      : null);
    if (r.ok) { woken += 1; Object.assign(t, r.item); }
  }
  return woken;
};

// Sortering: prioritet, sedan deadline, sedan äldst mottagen.
export const sortTasks = (tasks) => [...tasks].sort((a, b) => (b.priority?.score || 0) - (a.priority?.score || 0) || (ms(a.dueAt) || Infinity) - (ms(b.dueAt) || Infinity) || ms(a.receivedAt) - ms(b.receivedAt));

// ---------------------------------------------------------------------------
// Ringlistans arbetsstatus (beständig i ring-list-posten, fält `work`).
// ---------------------------------------------------------------------------
export const CALL_WORK_STATUSES = Object.freeze({
  waiting: "Väntar", called_answered: "Uppringd – svar", called_no_answer: "Uppringd – inget svar", sms_sent: "SMS skickat", handled_other: "Hanterad på annat sätt", callback_later: "Återkom senare",
});
// Vilken uppgiftsövergång en ringstatus motsvarar.
export const CALL_STATUS_TASK_ACTION = Object.freeze({
  waiting: null, called_answered: "done", called_no_answer: "note", sms_sent: "note", handled_other: "done", callback_later: "snooze",
});
export const setCallWorkStatus = async (ringStore, phone, { status, note = "", callbackAt = "", by = "admin", now = Date.now() } = {}) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: "invalid_phone", status: 400 };
  if (!CALL_WORK_STATUSES[status]) return { ok: false, error: "invalid_status", status: 400, description: `Tillåtna: ${Object.keys(CALL_WORK_STATUSES).join(", ")}` };
  let untilIso = "";
  if (status === "callback_later") {
    untilIso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(String(callbackAt)) ? localToIso(callbackAt) : clean(callbackAt, 40);
    if (!ms(untilIso) || ms(untilIso) <= now) return { ok: false, error: "invalid_callback_at", status: 400, description: "callbackAt måste vara en framtida tid." };
  }
  const at = iso(now);
  const apply = (cur) => {
    const prev = cur.work || {};
    const attempts = (Number(prev.attempts) || 0) + (status === "called_no_answer" || status === "called_answered" ? 1 : 0);
    return {
      ...cur,
      // Klarmarkering i ringlistans mening: svar/hanterad → watch (bevakas vidare), annars oförändrat.
      status: status === "called_answered" || status === "handled_other" ? (cur.status === "new" ? "watch" : cur.status || "watch") : cur.status || "new",
      work: { status, label: CALL_WORK_STATUSES[status], at, by: clean(by, 60), note: clean(note, 300), callbackAt: untilIso, attempts, history: [...(prev.history || []), { at, by: clean(by, 60), status, note: clean(note, 300), ...(untilIso ? { callbackAt: untilIso } : {}) }].slice(-40) },
      updatedAt: at,
      log: [...(cur.log || []), { at, event: `Ringstatus: ${CALL_WORK_STATUSES[status]}${note ? ` – ${clean(note, 80)}` : ""}` }].slice(-30),
    };
  };
  const read = await readWithEtag(ringStore, normalized, { allowMissingEtag: true });
  if (!read.item) {
    const created = await createIfAbsent(ringStore, normalized, apply({ phone: normalized, addedAt: at, attempts: 0, log: [], status: "new", reason: "Tillagd via uppgiftsinkorgen" }));
    if (created.created) return { ok: true, entry: created.item, created: true };
  }
  const result = await commitJson(ringStore, normalized, apply);
  if (!result.ok) return { ok: false, error: result.reason === "unversioned" ? "storage_unversioned" : result.reason === "conflict" ? "conflict" : "storage_error", status: result.reason === "conflict" ? 409 : 503 };
  return { ok: true, entry: result.item, created: false };
};

// Personlig ringlista: öppna ring-uppgifter med arbetsstatus från ringlistan.
export const buildCallList = (tasks = [], ringEntries = [], { now = Date.now(), max = 15 } = {}) => {
  const work = new Map(ringEntries.filter((e) => e?.phone).map((e) => [normalizePhone(e.phone), e.work || null]));
  const rows = sortTasks(tasks.filter((t) => OPEN_STATUSES.has(t.status) && [KINDS.callback, KINDS.meeting_call].includes(t.kind) && t.customer?.phone))
    .filter((t) => t.status !== "snoozed" || ms(t.snoozedUntil) <= now)
    .map((t) => ({
      taskId: t.id, phone: t.customer.phone, name: t.customer.name, title: t.title, kind: t.kind, priority: t.priority, dueAt: t.dueAt, dueLocal: t.dueLocal,
      receivedAt: t.receivedAt, receivedLocal: t.receivedLocal, attempts: t.attempts, caseId: t.caseId, serviceNumber: t.serviceNumber, estimatedMinutes: t.estimatedMinutes,
      timing: t.timing, needsReview: t.needsReview, status: t.status, work: work.get(t.customer.phone) || { status: "waiting", label: CALL_WORK_STATUSES.waiting },
      setStatus: { method: "POST", url: `/api/task-inbox/call-list/${encodeURIComponent(t.customer.phone)}/status`, body: { status: "called_answered|called_no_answer|sms_sent|handled_other|callback_later", note: "", callbackAt: "", taskId: t.id } },
    }));
  const selected = rows.filter((r) => r.status === "selected" || r.status === "in_progress");
  const rest = rows.filter((r) => !selected.includes(r));
  return { items: [...selected, ...rest].slice(0, max), totalOpen: rows.length, totalMinutes: [...selected, ...rest].slice(0, max).reduce((s, r) => s + (r.estimatedMinutes || 0), 0) };
};
