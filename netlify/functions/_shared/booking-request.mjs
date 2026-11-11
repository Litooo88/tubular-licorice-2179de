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

// ---- Bekräfta annan tid (Sebastian flyttar en förfrågan, 2026-10-30) ----
// Sebastian väljer en ny tid i admin; kunden får SMS + mejl med DEN tiden.

const htmlEscape = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);

export const LOCAL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// "Nu" som lokal svensk tid i formatet YYYY-MM-DDTHH:MM (jämförbar som sträng).
export const stockholmNowLocal = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

// Validerar Sebastians nya tid: giltigt datum och klockslag, inte passerad,
// högst 90 dagar fram. Klocktiden begränsas inte: det är Sebastians beslut.
export const validateNewTime = (value, now = new Date()) => {
  const raw = clean(value, 40);
  const match = raw.match(LOCAL_TIME_RE);
  if (!match) return { ok: false, error: "Välj datum och klockslag." };
  const [, y, mo, d, h, mi] = match.map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59) {
    return { ok: false, error: "Ogiltigt datum eller klockslag." };
  }
  if (raw <= stockholmNowLocal(now)) return { ok: false, error: "Tiden har redan passerat." };
  const limit = stockholmNowLocal(new Date(now.getTime() + 90 * 864e5));
  if (raw > limit) return { ok: false, error: "Tiden ligger mer än 90 dagar fram." };
  return { ok: true, value: raw };
};

// Kalenderfönster för Google Calendar (lokal tid + tidszon, ingen konvertering).
export const calendarWindowFor = (preferredDate, durationMinutes = 30, timeZone = "Europe/Stockholm") => {
  const match = clean(preferredDate, 40).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const start = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const end = new Date(start.getTime() + Math.max(15, Math.min(240, durationMinutes)) * 60000);
  const fmt = (date) => date.toISOString().slice(0, 16) + ":00";
  return { start: { dateTime: fmt(start), timeZone }, end: { dateTime: fmt(end), timeZone } };
};

// Kund: Sebastian har bekräftat en ANNAN tid än den kunden bad om.
export const requestRescheduledSms = ({ name, preferredDate, serviceNumber, statusLink }) =>
  `Hej ${firstNameOf(name)}! Vi har bokat in dig på en ny tid hos Nordic E-Mobility: ${formatRequestedTime(preferredDate)}. Kom då — vi hör av oss bara om tiden behöver flyttas igen.\n` +
  `Passar tiden inte? Svara på detta SMS eller ring ${WORKSHOP_PHONE_DISPLAY}.\n` +
  `Servicenummer: ${serviceNumber}\nFölj din reparation: ${statusLink}\n/Nordic E-Mobility`;

// Kund: bekräftelsemejl (samma för bekräftad och ny tid; changed styr texten).
export const requestConfirmedEmail = ({ name, preferredDate, serviceNumber, statusLink, address, mapsLink, changed = false, previousDate = "" }) => {
  const when = formatRequestedTime(preferredDate);
  const subject = `${changed ? "Ny tid bokad" : "Din tid är bekräftad"}: ${when} - ${serviceNumber} | Nordic E-Mobility`;
  const lead = changed
    ? `Vi har bokat in dig på en ny tid${previousDate ? ` i stället för ${formatRequestedTime(previousDate)}` : ""}. Den nya tiden gäller &mdash; kom d&aring;.`
    : "Din tid &auml;r nu bekr&auml;ftad. Kom d&aring; &mdash; vi h&ouml;r av oss bara om tiden beh&ouml;ver flyttas.";
  const html = `
  <div style="margin:0;background:#f4f6f2;padding:24px;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #dfe5dc;border-radius:8px;overflow:hidden">
      <div style="background:#061007;color:#fff;padding:22px 24px">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8ff5ae;font-weight:700">Nordic E-Mobility</div>
        <h1 style="font-size:24px;line-height:1.2;margin:8px 0 0">${changed ? "Ny tid bokad" : "Din tid &auml;r bekr&auml;ftad"}</h1>
      </div>
      <div style="padding:24px;line-height:1.6">
        <p>Hej ${htmlEscape(firstNameOf(name))},</p>
        <p>${lead}</p>
        <div style="background:#f7faf6;border:1px solid #dfe8dc;border-radius:8px;padding:16px;margin:18px 0">
          <p style="margin:0 0 8px;font-size:18px"><strong>Tid: ${htmlEscape(when)}</strong></p>
          <p style="margin:0 0 8px"><strong>Plats:</strong> ${htmlEscape(address)}</p>
          <p style="margin:0"><strong>Servicenummer:</strong> ${htmlEscape(serviceNumber)}</p>
        </div>
        <p><a href="${htmlEscape(statusLink)}" style="display:inline-block;background:#00c853;color:#021307;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700">F&ouml;lj din reparation</a>&nbsp;&nbsp;<a href="${htmlEscape(mapsLink)}" style="display:inline-block;background:#061007;color:#fff;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700">Visa p&aring; Google Maps</a></p>
        <p>${changed ? "Passar tiden inte? Svara p&aring; detta mejl eller ring " + WORKSHOP_PHONE_DISPLAY + " s&aring; hittar vi en annan." : ""} Ingen reparation &auml;r best&auml;lld &auml;nnu: <strong>du godk&auml;nner alltid priset innan vi b&ouml;rjar</strong>.</p>
        <p style="color:#555;font-size:13px">Nordic E-Mobility &middot; ${htmlEscape(address)} &middot; ${WORKSHOP_PHONE_DISPLAY}</p>
      </div>
    </div>
  </div>`;
  const text = [
    `Hej ${firstNameOf(name)},`,
    "",
    changed ? `Vi har bokat in dig pa en ny tid${previousDate ? ` i stallet for ${formatRequestedTime(previousDate)}` : ""}. Den nya tiden galler - kom da.` : "Din tid ar nu bekraftad. Kom da - vi hor av oss bara om tiden behover flyttas.",
    `Tid: ${when}`,
    `Plats: ${address}`,
    `Servicenummer: ${serviceNumber}`,
    `Folj din reparation: ${statusLink}`,
    changed ? `Passar tiden inte? Svara pa detta mejl eller ring ${WORKSHOP_PHONE_DISPLAY}.` : "",
    "Ingen reparation ar bestalld annu: du godkanner alltid priset innan vi borjar.",
  ].filter((line) => line !== null).join("\n");
  return { subject, html, text };
};
