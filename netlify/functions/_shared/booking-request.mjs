// Bokningsmodellen (Sebastians beslut 2026-10-27):
//
//   direct  — tisdag/torsdag 15–20 (och tider inom en "Öppet"-händelse i
//             verkstadskalendern). Tiden gäller direkt, ingen separat
//             bekräftelse. Kunden får "Din tid är bokad".
//   request — övriga tider 12–20 alla dagar. Ärendet skapas, kunden får
//             "förfrågan mottagen, vänta på bekräftelse", Sebastian bekräftar
//             eller avböjer i admin (workshop-cases: confirm_booking_request /
//             decline_booking_request). Först då får kunden "tiden är bekräftad".
//
// Texterna här delas av bokningen (mottaget) och admin (bekräftat/avböjt) så
// att kunden får ett och samma budskap i hela kedjan. Ordet "bokad" används
// ALDRIG för en obekräftad förfrågan — spökbokningarna i oktober 2026 kom av
// att kunden inte visste om tiden gällde.

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

export const BOOKING_MODES = Object.freeze({ direct: "direct", request: "request" });
export const REQUEST_EVENT_PREFIX = "FÖRFRÅGAN (obekräftad): ";
export const WORKSHOP_PHONE_DISPLAY = "010-138 54 98";

export const isPendingRequest = (caseItem = {}) =>
  caseItem.bookingMode === BOOKING_MODES.request && clean(caseItem.bookingRequest?.status, 20) === "pending";

export const firstNameOf = (name) => clean(name, 120).split(/\s+/).filter(Boolean)[0] || "där";

// "ons 28 okt 13:00" från "2026-10-28T13:00" (lokal svensk tid, ingen zon-
// konvertering: strängen ÄR redan i Europe/Stockholm).
export const formatRequestedTime = (preferredDate) => {
  const match = clean(preferredDate, 120).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return "tid saknas";
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (Number.isNaN(date.getTime())) return clean(preferredDate, 40);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date).replace(/\./g, "");
};

// Kund: förfrågan mottagen (skickas av bokningen; går via godkännandespärren).
export const requestReceivedSms = ({ name, preferredDate, serviceNumber, statusLink }) =>
  `Hej ${firstNameOf(name)}! Vi har tagit emot din förfrågan om inlämning ${formatRequestedTime(preferredDate)}.\n` +
  `Tiden är INTE bokad ännu: vi bekräftar via SMS när vi kollat att vi kan ta emot dig. Kom inte förrän du fått bekräftelsen.\n` +
  `Servicenummer: ${serviceNumber}\nFölj ärendet: ${statusLink}\n/Nordic E-Mobility`;

// Kund: Sebastian har bekräftat tiden (skickas från admin, approved).
export const requestConfirmedSms = ({ name, preferredDate, serviceNumber, statusLink }) =>
  `Hej ${firstNameOf(name)}! Din tid hos Nordic E-Mobility är nu bekräftad: ${formatRequestedTime(preferredDate)}. Kom då — vi hör av oss bara om tiden behöver flyttas.\n` +
  `Ingen reparation är beställd ännu: du godkänner alltid pris innan arbete.\n` +
  `Servicenummer: ${serviceNumber}\nFölj din reparation: ${statusLink}\n/Nordic E-Mobility`;

// Kund: Sebastian kan inte ta emot den tiden (skickas från admin, approved).
export const requestDeclinedSms = ({ name, preferredDate, bookingUrl }) =>
  `Hej ${firstNameOf(name)}! Tyvärr kan vi inte ta emot dig ${formatRequestedTime(preferredDate)}. ` +
  `Boka en ny tid här: ${bookingUrl} (tisdag och torsdag 15–20 bokas direkt) eller ring ${WORKSHOP_PHONE_DISPLAY} så hittar vi en tid tillsammans.\n/Nordic E-Mobility`;

// Verkstad: rubrikrad i det interna SMS:et så att en förfrågan aldrig läses
// som en färdig bokning.
export const WORKSHOP_REQUEST_HEADLINE = "FÖRFRÅGAN – kräver din bekräftelse i admin (Bekräfta tiden / Avböj)";
