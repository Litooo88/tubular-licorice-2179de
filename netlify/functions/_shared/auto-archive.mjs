// Auto-arkivering av döda webbförfrågningar.
//
// Varför: 101 ärenden låg i status "new" den 6/10, varav 72 var äldre än två
// veckor utan att någon rört dem. De gör att admin visar mer jobb än det
// finns (Sebastians ord 2026-10-03) och drar ned alla nyckeltal. Regeln är
// beslutad av Sebastian 2026-10-07: "new" i mer än 14 dagar utan någon
// kontakt arkiveras tyst. Arkiverat raderas inte och kan återställas i admin.
//
// Vad som räknas som kontakt (ett enda räcker för att INTE arkivera):
// - ett SMS i smsLog (skickat eller mottaget)
// - en kundsynlig uppdatering (customerUpdates)
// - en anteckning som en människa skrivit (notes), utom svep-rensningens
//   egen "Oklart ursprung"
// - en tidslinjehändelse som visar mänsklig handling (uppdatering, samtal,
//   klick-att-ringa, godkänt utkast, SMS via API)
// - kunden har själv bett om status i portalen de senaste 14 dagarna
// - önskad inlämningsdag ligger i framtiden (bokningen är inte död än)
// - betalning eller färdigmarkering finns

export const AUTO_ARCHIVE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const SWEEP_NOTE = /oklart ursprung/i;
const HUMAN_EVENT = /uppdaterad av|kunduppdatering|skickat via sms-api|utkast godk|klick-att-ringa|klick att ringa|ringde|samtal|sms skickat till kund|sms-svar|status ändrad|statusbyte/i;

const parseTime = (value) => {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

export const ageInDays = (item, now = Date.now()) => {
  const created = parseTime(item?.createdAt);
  if (!created) return 0;
  return Math.floor((now - created) / DAY_MS);
};

// Returnerar null om ärendet ska arkiveras, annars en kort orsak till varför
// det lämnas kvar. Orsaken loggas så att en felaktig regel går att se.
export const keepReason = (item, now = Date.now(), days = AUTO_ARCHIVE_DAYS) => {
  if (!item || typeof item !== "object") return "ogiltigt";
  if (item.status !== "new") return "status";
  if (!parseTime(item.createdAt)) return "saknar createdAt";
  if (ageInDays(item, now) < days) return "för ungt";
  if (Array.isArray(item.smsLog) && item.smsLog.length) return "sms";
  if (Array.isArray(item.customerUpdates) && item.customerUpdates.length) return "kunduppdatering";
  const humanNotes = (Array.isArray(item.notes) ? item.notes : []).filter((n) => n && n.text && !SWEEP_NOTE.test(String(n.text)));
  if (humanNotes.length) return "anteckning";
  const humanEvents = (Array.isArray(item.timeline) ? item.timeline : []).filter((e) => e && e.event && HUMAN_EVENT.test(String(e.event)) && !SWEEP_NOTE.test(String(e.event)));
  if (humanEvents.length) return "handling i tidslinjen";
  const requested = parseTime(item.statusUpdateRequestedAt);
  if (requested && now - requested < days * DAY_MS) return "kunden frågade nyss";
  const preferred = parseTime(item.preferredDate);
  if (preferred && preferred > now) return "önskad dag i framtiden";
  if (item.payment && item.payment.status && item.payment.status !== "unpaid") return "betalning";
  if (item.completion && (item.completion.at || item.completion.doneAt)) return "färdigmarkerad";
  return null;
};

export const isAutoArchiveCandidate = (item, now = Date.now(), days = AUTO_ARCHIVE_DAYS) => keepReason(item, now, days) === null;

export const archivedCopy = (item, now = Date.now()) => {
  const at = new Date(now).toISOString();
  const dagar = ageInDays(item, now);
  const text = `Auto-arkiverad: ny i ${dagar} dagar utan kontakt. Återställ via status-menyn om kunden hör av sig.`;
  return {
    ...item,
    status: "archived",
    previousStatus: "new",
    autoArchived: { at, days: dagar, rule: `new>${AUTO_ARCHIVE_DAYS}d-utan-kontakt` },
    updatedAt: at,
    updatedBy: "auto-arkivering",
    notes: [...(Array.isArray(item.notes) ? item.notes : []), { at, text }],
    timeline: [...(Array.isArray(item.timeline) ? item.timeline : []), { at, event: text }],
  };
};
