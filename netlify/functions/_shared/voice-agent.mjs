// Röstassistenten: rena hjälpfunktioner (testade) för det verktygs-API som
// samtalsplattformen anropar under pågående samtal. All formatering av vad
// assistenten FÅR säga ligger här, så att gränsen mellan kundsäkert och
// internt är en kodrad, inte en promptformulering.
//
// Principer (Sebastians design 2026-10-06):
// - Sekreterare, inte tekniker: samlar fakta, ger status, lovar inget.
// - Säger aldrig priser utöver listans "från"-pris, aldrig betalstatus,
//   aldrig interna anteckningar, aldrig andra kunders uppgifter.
// - Kan inte boka in verkstadsjobb själv; den bokar ett telefonmöte med
//   Sebastian eller hänvisar till bokningssidan (tis/tors 10–16).

import { normalizePhone } from "./sms.mjs";

const clean = (value, max = 400) => String(value || "").trim().slice(0, max);

// Samma kundvänliga steg som statusportalen (case-status.mjs). Dubbleras med
// flit: portalen är publik och får inte börja importera från en modul som
// också känner till interna fält.
const STEP_BY_STATUS = {
  new: "mottagen", contacted: "mottagen",
  checked_in: "inlämnad",
  diagnosing: "under felsökning",
  repairing: "under reparation", waiting_parts: "under reparation", waiting_customer: "under reparation",
  ready: "klar för hämtning",
  done: "utlämnad", archived: "avslutad",
};
const STATUS_NOTE = {
  waiting_parts: "Vi väntar på en reservdel.",
  waiting_customer: "Vi väntar på svar från kunden, kolla SMS eller mail.",
  ready: "Fordonet är klart. Hämtning tisdag eller torsdag klockan 10 till 16, betalning vid hämtning.",
};
export const ACTIVE_STATUSES = new Set(["contacted", "checked_in", "diagnosing", "repairing", "waiting_parts", "waiting_customer", "ready"]);

const phoneOf = (item) => normalizePhone(item?.customer?.phone || item?.customerPhone || "");
const firstName = (item) => clean(item?.customer?.name || item?.customerName, 140).split(/\s+/).filter(Boolean)[0] || "";
const vehicleOf = (item) => {
  const v = item?.vehicle || {};
  return clean([v.brand, v.model].filter(Boolean).join(" ") || item?.vehicleModel, 80);
};
const dateOnly = (value) => clean(value, 10);

// Vad assistenten får säga om ETT ärende. Inga priser, ingen betalstatus,
// inga notes, inga interna flaggor.
export const customerSafeCase = (item) => {
  if (!item || typeof item !== "object") return null;
  const status = clean(item.status, 40);
  const updates = Array.isArray(item.customerUpdates) ? item.customerUpdates : [];
  const latest = updates.length ? updates[updates.length - 1] : null;
  return {
    serviceNumber: clean(item.serviceNumber, 40),
    firstName: firstName(item),
    vehicle: vehicleOf(item),
    service: clean(item.service, 120),
    step: STEP_BY_STATUS[status] || "mottagen",
    active: ACTIVE_STATUSES.has(status),
    note: STATUS_NOTE[status] || "",
    promisedDate: dateOnly(item.promisedAt),
    receivedDate: dateOnly(item.intakeAt || item.createdAt),
    latestUpdate: latest ? { date: dateOnly(latest.at), text: clean(latest.text, 400) } : null,
  };
};

// Slår upp alla ärenden på ett nummer. Aktiva först, sedan senaste avslutade
// (max ett) så att assistenten kan säga "din förra reparation är utlämnad".
export const lookupByPhone = (cases, phone) => {
  const wanted = normalizePhone(phone);
  if (!wanted) return { found: false, active: [], recent: null };
  const mine = (Array.isArray(cases) ? cases : []).filter((c) => phoneOf(c) === wanted);
  const active = mine.filter((c) => ACTIVE_STATUSES.has(c.status)).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const closed = mine.filter((c) => !ACTIVE_STATUSES.has(c.status) && c.status !== "new").sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return {
    found: mine.length > 0,
    firstName: firstName(active[0] || closed[0] || mine[0]) || "",
    active: active.slice(0, 3).map(customerSafeCase),
    recent: closed[0] ? customerSafeCase(closed[0]) : null,
  };
};

// Publik prislista: "från"-pris och vanligt spann. Assistenten får säga
// spannet men aldrig lova ett slutpris; allt över approvalThreshold kräver
// att Sebastian hör av sig.
export const matchPrices = (rules, query, { limit = 5 } = {}) => {
  const list = Array.isArray(rules) ? rules : [];
  const q = clean(query, 80).toLowerCase();
  const words = q.split(/[^a-zåäö0-9]+/).filter((w) => w.length > 2);
  const scored = list.map((r) => {
    const hay = `${r.name || ""} ${r.category || ""} ${r.id || ""}`.toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    return { r, score };
  }).filter((x) => !q || x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ r }) => ({
    id: clean(r.id, 60),
    name: clean(r.name, 80),
    fromPrice: Number(r.startPrice) || Number(r.likelyMin) || null,
    likelyMin: Number(r.likelyMin) || null,
    likelyMax: Number(r.likelyMax) || null,
    requiresDiagnosis: Boolean(r.requiresDiagnosis),
    say: sayPrice(r),
  }));
};

export const sayPrice = (r) => {
  const from = Number(r.startPrice) || Number(r.likelyMin);
  const max = Number(r.likelyMax);
  if (!from) return `${r.name}: pris efter felsökning.`;
  const spann = max && max !== from ? `, oftast mellan ${from} och ${max} kronor` : "";
  const diag = r.requiresDiagnosis ? " Exakt pris efter felsökning." : "";
  return `${r.name} från ${from} kronor${spann}.${diag}`;
};

// Komprimerar bokningssidans slot-svar till något som går att läsa upp:
// de närmaste dagarna med lediga tider, max fyra dagar, max sex tider per dag.
export const compactSlots = (payload, { maxDays = 4, maxTimes = 6 } = {}) => {
  const days = Array.isArray(payload?.days) ? payload.days : [];
  const out = [];
  for (const day of days) {
    const free = (Array.isArray(day.slots) ? day.slots : []).filter((s) => s && s.available !== false && s.busy !== true).map((s) => clean(s.time, 5)).filter(Boolean);
    if (!free.length) continue;
    out.push({ date: clean(day.date, 10), weekday: weekdayName(day.date), times: free.slice(0, maxTimes) });
    if (out.length >= maxDays) break;
  }
  return { status: clean(payload?.status, 20) || "ok", days: out, hours: "tisdag och torsdag klockan 10 till 16", bookingUrl: "nordicemobility.se/book-online" };
};

const weekdayName = (date) => {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"][d.getUTCDay()];
};

// Telefonmötet: det enda assistenten får "boka". Valideras hårt så att en
// hallucinerad tid eller ett påhittat nummer inte blir ett SMS.
export const normalizeMeeting = (body) => {
  const phone = normalizePhone(body?.phone);
  const name = clean(body?.name, 80);
  const topic = clean(body?.topic, 300);
  const preferredTime = clean(body?.preferredTime, 80);
  const vehicle = clean(body?.vehicle, 80);
  const errors = [];
  if (!/^\+46\d{8,10}$/.test(phone)) errors.push("phone");
  if (!topic) errors.push("topic");
  return { ok: errors.length === 0, errors, meeting: { phone, name, topic, preferredTime, vehicle } };
};

export const meetingSmsToSebastian = (m) =>
  `Telefonmöte bokat av röstassistenten: ${m.name || "okänt namn"} ${m.phone}${m.vehicle ? `, ${m.vehicle}` : ""}. Ämne: ${m.topic}. Önskad tid: ${m.preferredTime || "ingen angiven"}.`.slice(0, 480);

export const meetingSmsToCustomer = (m) =>
  `Hej${m.name ? ` ${m.name.split(/\s+/)[0]}` : ""}! Tack för samtalet. Sebastian på Nordic E-Mobility ringer upp dig${m.preferredTime ? ` ${m.preferredTime}` : " så snart han kan"} angående ${m.topic.slice(0, 60)}. Svara på detta SMS om något ändras.`.slice(0, 320);

// Sammanfattningen efter samtalet: vad som sparas och vad Sebastian får.
export const normalizeCallSummary = (body) => ({
  callId: clean(body?.callId || body?.call_id || body?.conversation_id, 120),
  phone: normalizePhone(body?.phone || body?.from || body?.caller),
  startedAt: clean(body?.startedAt || body?.started_at, 40),
  durationSec: Number(body?.durationSec || body?.duration_sec || body?.duration) || 0,
  outcome: clean(body?.outcome, 60),
  summary: clean(body?.summary, 1200),
  transcript: clean(body?.transcript, 12000),
  meetingBooked: Boolean(body?.meetingBooked),
});

export const summarySmsToSebastian = (s, lookup) => {
  const vem = lookup?.firstName ? `${lookup.firstName} ${s.phone}` : s.phone || "okänt nummer";
  const kund = lookup?.found ? (lookup.active?.length ? `kund med ${lookup.active.length} aktivt ärende` : "tidigare kund") : "ny kontakt";
  return `Röstassistent ${Math.round(s.durationSec / 60) || "<1"} min: ${vem} (${kund}). ${s.summary || "Ingen sammanfattning."}${s.meetingBooked ? " Telefonmöte bokat." : ""}`.slice(0, 480);
};
