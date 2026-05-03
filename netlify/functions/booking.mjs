import { getStore } from "@netlify/blobs";
import { createSign } from "node:crypto";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

const htmlEscape = (value) =>
  clean(value, 5000).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const looksLikeResendApiKey = (value) => clean(value, 220).startsWith("re_");
const looksLikeGooglePrivateKey = (value) => {
  const key = clean(value, 5000).replace(/\\n/g, "\n");
  return key.includes("BEGIN PRIVATE KEY") && key.includes("END PRIVATE KEY");
};
const googleCalendarConfig = () => {
  const calendarId = clean(env("GOOGLE_CALENDAR_ID") || WORKSHOP_ORGANIZER, 500);
  const serviceEmail = clean(env("GOOGLE_SERVICE_ACCOUNT_EMAIL"), 240);
  const privateKey = clean(env("GOOGLE_PRIVATE_KEY"), 5000).replace(/\\n/g, "\n");
  const missing = [];
  const invalid = [];

  if (!calendarId) missing.push("GOOGLE_CALENDAR_ID");
  if (!serviceEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!privateKey) missing.push("GOOGLE_PRIVATE_KEY");

  if (calendarId && /^https?:\/\//i.test(calendarId)) {
    invalid.push("GOOGLE_CALENDAR_ID_must_be_calendar_id_not_url");
  }
  if (serviceEmail && !serviceEmail.endsWith(".iam.gserviceaccount.com")) {
    invalid.push("GOOGLE_SERVICE_ACCOUNT_EMAIL_must_be_service_account_email");
  }
  if (privateKey && !looksLikeGooglePrivateKey(privateKey)) {
    invalid.push("GOOGLE_PRIVATE_KEY_must_include_begin_and_end_private_key");
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    calendarId,
    serviceEmail,
  };
};
const WORKSHOP_LOCATION = "Pistolv\u00e4gen 6, \u00d6rebro";
const WORKSHOP_ORGANIZER = "info@nordicemobility.se";
const ICS_TIME_ZONE = "Europe/Stockholm";
const WORKSHOP_ADDRESS = "Pistolv\u00e4gen 6, 702 21 \u00d6rebro";
const MAPS_LINK = "https://www.google.com/maps/place/Pistolv%C3%A4gen+6,+702+21+%C3%96rebro";
const REVIEW_LINK = env("GOOGLE_REVIEW_LINK") || "https://www.google.com/search?q=Nordic+E-Mobility+Pistolv%C3%A4gen+6+%C3%96rebro+recension";
const LOGO_URL = env("SITE_URL") ? `${env("SITE_URL").replace(/\/$/, "")}/nordic_logo_transparent.png` : "https://www.nordicemobility.se/nordic_logo_transparent.png";
const RETRY_DELAY_MS = 30000;

const STAFF = {
  lennart: {
    key: "lennart",
    name: "Lennart",
    role: "Golv, mottagning och snabba jobb",
    phone: "072-260 77 53",
  },
  sebastian: {
    key: "sebastian",
    name: "Sebastian",
    role: "Tung felsokning, batteri och elsystem",
    phone: "070-024 33 19",
  },
};

const LOGISTICS_LABELS = {
  dropoff: "Kund lamnar in pa Pistolvagen 6",
  "pickup-ready": "Upphamtning av fardig scooter",
  "pickup-question": "Fraga om hamtning/lamning",
  "not-sure": "Ej bestamt",
};

const ADDON_OPTIONS = [
  {
    id: "brake-pads-discount",
    label: "Nya bromsbel\u00e4gg vid service",
    price: 150,
  },
  {
    id: "safety-check",
    label: "Extra s\u00e4kerhetskontroll",
    price: 199,
  },
  {
    id: "tire-sealant",
    label: "Punkteringsskydd / t\u00e4tningsv\u00e4tska",
    price: 149,
  },
  {
    id: "contact-clean",
    label: "Reng\u00f6ring av laddport och kontakter",
    price: 149,
  },
];

const ADDON_BY_ID = new Map(ADDON_OPTIONS.map((option) => [option.id, option]));

const logisticsLabel = (value) => LOGISTICS_LABELS[value] || clean(value, 120) || "Ej angivet";
const isReadyPickup = (caseItem) => caseItem.logistics === "pickup-ready";
const preferredTimeLabel = (caseItem) => isReadyPickup(caseItem) ? "Onskad upphamtning" : "Onskad inlamning";
const preferredTimeHtmlLabel = (caseItem) => isReadyPickup(caseItem) ? "&Ouml;nskad upph&auml;mtning" : "&Ouml;nskad inl&auml;mning";

const parseAddons = (value) => {
  let raw = value;

  if (typeof raw === "string") {
    try {
      raw = raw.trim() ? JSON.parse(raw) : [];
    } catch {
      raw = raw.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }

  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const addons = [];

  raw.forEach((item) => {
    const id = typeof item === "string" ? item : item?.id;
    const option = ADDON_BY_ID.get(clean(id, 80));
    if (!option || seen.has(option.id)) return;
    seen.add(option.id);
    addons.push({ ...option });
  });

  return addons;
};

const addonTotal = (addons = []) =>
  addons.reduce((sum, item) => sum + Number(item.price || 0), 0);

const addonSummaryText = (addons = []) => {
  if (!addons.length) return "";
  return [
    `Tillval (${addonTotal(addons)} kr):`,
    ...addons.map((item) => `- ${item.label}: +${item.price} kr`),
  ].join("\n");
};

const addonSummaryHtml = (addons = []) => {
  if (!addons.length) return "";
  const rows = addons
    .map((item) => `${htmlEscape(item.label)} (+${htmlEscape(item.price)} kr)`)
    .join("<br>");
  return `<p style="margin:0 0 8px"><strong>Tillval:</strong><br>${rows}</p>`;
};

const emailFooterHtml = () => `
  <div style="border-top:1px solid #dfe5dc;margin-top:22px;padding-top:18px;color:#53605a;font-size:13px;line-height:1.55">
    <img src="${htmlEscape(LOGO_URL)}" alt="Nordic E-Mobility" style="display:block;max-width:150px;height:auto;margin:0 0 12px">
    <strong style="color:#111">Nordic E-Mobility AB</strong><br>
    ${htmlEscape(WORKSHOP_ADDRESS)}<br>
    <a href="mailto:info@nordicemobility.se" style="color:#067a35">info@nordicemobility.se</a> &middot;
    <a href="tel:+46700243319" style="color:#067a35">070-024 33 19</a><br>
    Lennart: <a href="tel:+46722607753" style="color:#067a35">072-260 77 53</a>
  </div>
`;

const estimateValue = (service) => {
  const normalized = service
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("avancerad felsokning")) return 699;
  if (normalized.includes("controller")) return 699;
  if (normalized.includes("batterireparation")) return 999;
  if (normalized.includes("felsokning")) return 349;
  if (normalized.includes("punktering")) return 349;
  if (normalized.includes("batteridiagnos")) return 349;
  if (normalized.includes("regelradgivning")) return 349;
  if (normalized.includes("service")) return 399;
  return 0;
};

const assignOwner = (service, message = "") => {
  const text = `${service} ${message}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const heavyWords = ["batteri", "bms", "controller", "elsystem", "avancerad", "ladd", "display", "felkod"];
  if (heavyWords.some((word) => text.includes(word))) return STAFF.sebastian;
  return STAFF.lennart;
};

const normalizePhone = (phone) => {
  const compact = clean(phone, 60).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const uniquePhones = (numbers = []) => {
  const seen = new Set();
  const result = [];
  for (const number of numbers) {
    const normalized = normalizePhone(number);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const shortCaseId = (id) => id.replace(/^case_/, "").slice(0, 18).toUpperCase();
const firstName = (name) => clean(name, 120).split(/\s+/).filter(Boolean)[0] || "d\u00e4r";
const isSent = (result) => result?.status === "sent" || result?.status === "created" || result?.status === "checked";
const isWorkshopAlertSent = (staffSms, workshopEmail) =>
  (staffSms?.status === "sent" || staffSms?.status === "partial") && isSent(workshopEmail);
const needsRetry = (result) => ["failed", "not_configured", "invalid_phone"].includes(result?.status);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resultError = (result) => clean(result?.error || result?.reason || result?.status || "okant fel", 240);

const logBookingDelivery = (caseItem, extra = {}) => {
  const smsSent = isSent(caseItem.notifications?.sms);
  const emailSent = isSent(caseItem.notifications?.customerEmail);
  const workshopAlert = isWorkshopAlertSent(caseItem.notifications?.staffSms, caseItem.notifications?.workshopEmail);
  console.log(`[BOOKING ${caseItem.id}] sms_sent=${smsSent} email_sent=${emailSent} workshop_alert=${workshopAlert}`, {
    case_id: caseItem.id,
    sms_sent: smsSent,
    email_sent: emailSent,
    workshop_alert: workshopAlert,
    confirmation_sent: Boolean(caseItem.confirmation_sent),
    confirmation_missing: Boolean(caseItem.confirmation_missing),
    sms_status: caseItem.notifications?.sms?.status,
    email_status: caseItem.notifications?.customerEmail?.status,
    staff_sms_status: caseItem.notifications?.staffSms?.status,
    workshop_email_status: caseItem.notifications?.workshopEmail?.status,
    ...extra,
  });
};

const updateConfirmationFlags = (caseItem) => {
  const smsSent = isSent(caseItem.notifications?.sms);
  const emailSent = isSent(caseItem.notifications?.customerEmail);
  const workshopAlert = isWorkshopAlertSent(caseItem.notifications?.staffSms, caseItem.notifications?.workshopEmail);
  caseItem.confirmation_sent = smsSent && emailSent;
  caseItem.confirmation_missing = !caseItem.confirmation_sent || !workshopAlert;
  caseItem.confirmation = {
    sms_sent: smsSent,
    email_sent: emailSent,
    workshop_alert: workshopAlert,
    missing: caseItem.confirmation_missing,
    updatedAt: new Date().toISOString(),
  };
  return caseItem.confirmation;
};

const formatPreferredDateOnlyForSms = (caseItem) => {
  const raw = clean(caseItem.preferredDate, 120);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return "tid saknas";

  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(date.getTime())) return raw;

  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date).replace(".", "");
};

const formatPreferredDateForSms = (caseItem) => {
  const label = isReadyPickup(caseItem) ? "Upphamtning" : "Inlamning";
  return `${label}: ${formatPreferredDateOnlyForSms(caseItem)}`;
};

const smsMessage = (caseItem) =>
  `Hej ${firstName(caseItem.customer.name)}! Din bokning hos Nordic E-Mobility \u00e4r registrerad.\nTid: ${formatPreferredDateOnlyForSms(caseItem)}\nPlats: Pistolv\u00e4gen 6, 702 21 \u00d6rebro\nVi h\u00f6r av oss om n\u00e5got beh\u00f6ver \u00e4ndras. - Nordic E-Mobility`;

const workshopSmsMessage = (caseItem) => {
  const description = clean(caseItem.message, 80);
  const priority = caseItem.priority === "urgent" ? "Hog" : "Normal";
  return [
    `Ny bokning #${shortCaseId(caseItem.id)}`,
    `Kund: ${caseItem.customer.name} - ${caseItem.customer.phone}`,
    `Modell: ${caseItem.vehicle.model || "Ej angiven"}`,
    `Felbeskrivning: ${description || "Saknas"}`,
    `Inlamning: ${formatPreferredDateOnlyForSms(caseItem)}`,
    `Arende: ${caseItem.service}`,
    `Prio: ${priority}`,
  ].join("\n");
};

const smsConfig = () => ({
  username: env("ELKS_USERNAME") || env("SMS_API_USERNAME"),
  password: env("ELKS_PASSWORD") || env("SMS_API_PASSWORD"),
  from: (env("SMS_FROM") || "NordicEMob").slice(0, 11),
});

const postSms = async ({ to, message }) => {
  const normalizedTo = normalizePhone(to);
  const { username, password, from } = smsConfig();

  if (!normalizedTo) return { status: "invalid_phone", to: "" };
  if (!username || !password) return { status: "not_configured", to: normalizedTo };

  const payload = new URLSearchParams({
    from,
    to: normalizedTo,
    message,
    dontlog: "message",
  });

  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
      signal: AbortSignal.timeout(7000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "failed", provider: "46elks", to: normalizedTo, error: clean(body.error || response.statusText, 180) };
    }
    return { status: "sent", provider: "46elks", to: normalizedTo, id: clean(body.id, 120), sentAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", provider: "46elks", to: normalizedTo, error: clean(error.message, 180) };
  }
};

const pad2 = (number) => String(number).padStart(2, "0");

const parsePreferredLocalParts = (value) => {
  const match = clean(value, 80).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
};

const localPartsFromDate = (date, timeZone = ICS_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
  };
};

const localPartsToUtcIso = (parts, timeZone = ICS_TIME_ZONE) => {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  for (let index = 0; index < 4; index += 1) {
    const local = localPartsFromDate(new Date(guess), timeZone);
    const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const actual = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const delta = wanted - actual;
    if (Math.abs(delta) < 1000) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
};

const addMinutesToLocalParts = (parts, minutes) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
};

const googleLocalDateTime = (parts) =>
  `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:00`;

const icsLocalDateTime = (parts) =>
  `${parts.year}${pad2(parts.month)}${pad2(parts.day)}T${pad2(parts.hour)}${pad2(parts.minute)}00`;

const eventWindow = (caseItem) => {
  const timeZone = env("GOOGLE_CALENDAR_TIMEZONE") || ICS_TIME_ZONE;
  const duration = Math.max(15, Math.min(240, Number(env("GOOGLE_CALENDAR_DURATION_MINUTES") || 30)));
  const startParts = parsePreferredLocalParts(caseItem.preferredDate) || localPartsFromDate(new Date(Date.now() + 5 * 60000), timeZone);
  const endParts = addMinutesToLocalParts(startParts, duration);

  return {
    timeZone,
    start: {
      google: googleLocalDateTime(startParts),
      ics: icsLocalDateTime(startParts),
      utc: localPartsToUtcIso(startParts, timeZone),
    },
    end: {
      google: googleLocalDateTime(endParts),
      ics: icsLocalDateTime(endParts),
      utc: localPartsToUtcIso(endParts, timeZone),
    },
  };
};

const icsStamp = (date = new Date()) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const icsEscape = (value) =>
  clean(value, 5000)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

const foldIcsLine = (line) => {
  if (line.length <= 74) return line;
  const chunks = [];
  let remaining = line;
  while (remaining.length > 74) {
    chunks.push(remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  chunks.push(remaining);
  return chunks.join("\r\n ");
};

const buildIcs = (caseItem) => {
  const window = eventWindow(caseItem);
  const summary = `Nordic E-Mobility: ${caseItem.service}`;
  const description = [
    "Serviceforfragan via nordicemobility.se.",
    "Obs: tiden ar inte bekraftad forran Nordic E-Mobility har aterkommit.",
    "",
    caseSummaryText(caseItem),
  ].join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nordic E-Mobility//Workshop Booking//SV",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${ICS_TIME_ZONE}`,
    `X-LIC-LOCATION:${ICS_TIME_ZONE}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${icsEscape(caseItem.id)}`,
    `DTSTAMP:${icsStamp()}`,
    `DTSTART;TZID=${ICS_TIME_ZONE}:${window.start.ics}`,
    `DTEND;TZID=${ICS_TIME_ZONE}:${window.end.ics}`,
    `SUMMARY:${icsEscape(summary)}`,
    `LOCATION:${icsEscape(WORKSHOP_LOCATION)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `ORGANIZER;CN=Nordic E-Mobility:mailto:${WORKSHOP_ORGANIZER}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
};

const buildIcsAttachment = (caseItem) => ({
  filename: `nordic-emobility-${shortCaseId(caseItem.id).toLowerCase()}.ics`,
  content: Buffer.from(buildIcs(caseItem), "utf8").toString("base64"),
  content_type: "text/calendar; charset=utf-8; method=PUBLISH",
});

const sendSmsConfirmation = async (caseItem, requested) => {
  const to = normalizePhone(caseItem.customer.phone);

  if (!requested) return { status: "not_requested", to };
  return postSms({ to, message: smsMessage(caseItem) });
};

const sendWorkshopSmsNotification = async (caseItem) => {
  const configured = (env("WORKSHOP_SMS_TO") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const recipients = uniquePhones([STAFF.sebastian.phone, STAFF.lennart.phone, ...configured]);
  const results = await Promise.all(recipients.map((recipient) => postSms({ to: recipient, message: workshopSmsMessage(caseItem) })));
  const sentCount = results.filter((result) => result.status === "sent").length;
  const failedCount = results.length - sentCount;

  if (sentCount) {
    return {
      status: failedCount ? "partial" : "sent",
      provider: "46elks",
      requestedRecipients: recipients,
      recipients: results,
      sentCount,
      failedCount,
      sentAt: new Date().toISOString(),
    };
  }

  return {
    status: results.every((result) => result.status === "not_configured") ? "not_configured" : "failed",
    provider: "46elks",
    requestedRecipients: recipients,
    recipients: results,
    sentCount,
    failedCount,
  };
};

const resendEmail = async ({ to, subject, html, text, attachments = [], idempotencyKey }) => {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  const replyTo = env("EMAIL_REPLY_TO") || env("WORKSHOP_EMAIL") || "";

  if (!to || !to.length) return { status: "not_requested" };
  if (!apiKey || !from || !looksLikeResendApiKey(apiKey)) return { status: "not_configured" };

  const payload = {
    from,
    to,
    subject,
    html,
    text,
  };
  if (replyTo) payload.reply_to = replyTo;
  if (attachments.length) payload.attachments = attachments;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "failed", provider: "resend", error: clean(body.message || body.error || response.statusText, 180) };
    }
    return { status: "sent", provider: "resend", id: clean(body.id, 120), sentAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", provider: "resend", error: clean(error.message, 180) };
  }
};

const caseSummaryText = (caseItem) => [
  `Arende: ${shortCaseId(caseItem.id)}`,
  `Kund: ${caseItem.customer.name}`,
  `Telefon: ${caseItem.customer.phone}`,
  caseItem.customer.email ? `E-post: ${caseItem.customer.email}` : "",
  `Tjanst: ${caseItem.service}`,
  caseItem.vehicle.model ? `Modell: ${caseItem.vehicle.model}` : "",
  caseItem.preferredDate ? `${preferredTimeLabel(caseItem)}: ${caseItem.preferredDate}` : "",
  caseItem.preferredContactTime ? `Passar bast: ${caseItem.preferredContactTime}` : "",
  `Kontakt: ${caseItem.contactMethod}`,
  `Logistik: ${logisticsLabel(caseItem.logistics)}`,
  caseItem.discountCode ? `Rabattkod: ${caseItem.discountCode}` : "",
  addonSummaryText(caseItem.addons),
  `Uppskattat startvarde: ${caseItem.estimatedValue} kr`,
  caseItem.message ? `Felbeskrivning: ${caseItem.message}` : "",
].filter(Boolean).join("\n");

const formatPreferredDateForEmail = (value) => {
  const raw = clean(value, 120);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return raw || "Inte angivet";
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const customerEmailHtml = (caseItem) => `
  <div style="margin:0;background:#f4f6f2;padding:24px;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #dfe5dc;border-radius:8px;overflow:hidden">
      <div style="background:#061007;color:#fff;padding:22px 24px">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8ff5ae;font-weight:700">Nordic E-Mobility</div>
        <h1 style="font-size:24px;line-height:1.2;margin:8px 0 0">Din bokning &auml;r registrerad</h1>
      </div>
      <div style="padding:24px;line-height:1.6">
        <p>Hej ${htmlEscape(firstName(caseItem.customer.name))},</p>
        <p>Vi har registrerat din bokning hos Nordic E-Mobility.</p>
        <div style="background:#f7faf6;border:1px solid #dfe8dc;border-radius:8px;padding:16px;margin:18px 0">
          <p style="margin:0 0 8px"><strong>&Auml;rende:</strong> ${htmlEscape(shortCaseId(caseItem.id))}</p>
          <p style="margin:0 0 8px"><strong>Tj&auml;nst:</strong> ${htmlEscape(caseItem.service)}</p>
          <p style="margin:0 0 8px"><strong>${preferredTimeHtmlLabel(caseItem)}:</strong> ${htmlEscape(formatPreferredDateForEmail(caseItem.preferredDate))}</p>
          <p style="margin:0 0 8px"><strong>Plats:</strong> ${htmlEscape(WORKSHOP_ADDRESS)}</p>
          <p style="margin:0 0 8px"><strong>Logistik:</strong> ${htmlEscape(logisticsLabel(caseItem.logistics))}</p>
          <p style="margin:0 0 8px"><strong>Fordon:</strong> ${htmlEscape(caseItem.vehicle.model || "Inte angivet")}</p>
          ${caseItem.discountCode ? `<p style="margin:0 0 8px"><strong>Rabattkod:</strong> ${htmlEscape(caseItem.discountCode)}</p>` : ""}
          ${addonSummaryHtml(caseItem.addons)}
          <p style="margin:0"><strong>Startansvar:</strong> ${htmlEscape(caseItem.assignedTo.name)}</p>
        </div>
        <p><a href="${MAPS_LINK}" style="display:inline-block;background:#061007;color:#fff;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700">Visa p&aring; Google Maps</a></p>
        <p><strong>Vad h&auml;nder nu?</strong><br>Vi kontrollerar bokningen och kontaktar dig inom 24 timmar om tiden, prisbed&ouml;mningen eller underlaget beh&ouml;ver justeras. Inget arbete p&aring;b&ouml;rjas utan att du f&aring;tt en prisbed&ouml;mning f&ouml;rst.</p>
        <p>Efter bes&ouml;ket betyder en recension mycket f&ouml;r oss: <a href="${htmlEscape(REVIEW_LINK)}" style="color:#067a35">l&auml;mna en Google-recension</a>.</p>
        ${emailFooterHtml()}
      </div>
    </div>
  </div>
`;

const sendCustomerEmail = async (caseItem) => {
  if (!caseItem.customer.email) return { status: "not_requested" };
  return resendEmail({
    to: [caseItem.customer.email],
    subject: `Din servicef\u00f6rfr\u00e5gan hos Nordic E-Mobility - ${shortCaseId(caseItem.id)}`,
    html: customerEmailHtml(caseItem),
    text: [
      "Hej " + caseItem.customer.name + ",",
      "",
      "Din bokning hos Nordic E-Mobility ar registrerad.",
      `Tid: ${formatPreferredDateOnlyForSms(caseItem)}`,
      `Plats: ${WORKSHOP_ADDRESS}`,
      "Vi kontaktar dig inom 24 timmar om nagot behover andras och gor alltid prisbedomning innan arbete.",
      `Karta: ${MAPS_LINK}`,
      "",
      "Kalenderfilen \u00e4r prelimin\u00e4r tills tiden \u00e4r bekr\u00e4ftad.",
      "",
      "Detaljer:",
      caseSummaryText(caseItem),
      "",
      "Direktkontakt: Sebastian 070-024 33 19 eller Lennart 072-260 77 53.",
    ].join("\n"),
    attachments: [buildIcsAttachment(caseItem)],
    idempotencyKey: `${caseItem.id}-customer-email`,
  });
};

const sendWorkshopEmail = async (caseItem) => {
  const recipients = (env("WORKSHOP_EMAIL") || env("NOTIFY_EMAIL"))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!recipients.length) return { status: "not_configured" };

  return resendEmail({
    to: recipients,
    subject: `Ny bokning: ${caseItem.customer.name} - ${formatPreferredDateForEmail(caseItem.preferredDate)}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111">
        <h2>Ny bokning / servicef&ouml;rfr&aring;gan</h2>
        <p><strong>${preferredTimeHtmlLabel(caseItem)}:</strong> ${htmlEscape(formatPreferredDateForEmail(caseItem.preferredDate))}</p>
        <pre style="white-space:pre-wrap;background:#f5f5f5;padding:14px;border-radius:8px">${htmlEscape(caseSummaryText(caseItem))}</pre>
      </div>
    `,
    text: caseSummaryText(caseItem),
    attachments: [buildIcsAttachment(caseItem)],
    idempotencyKey: `${caseItem.id}-workshop-email`,
  });
};

const sendBookingNotifications = async (caseItem, smsRequested) => {
  const [sms, staffSms, customerEmail, workshopEmail] = await Promise.all([
    sendSmsConfirmation(caseItem, smsRequested),
    sendWorkshopSmsNotification(caseItem),
    sendCustomerEmail(caseItem),
    sendWorkshopEmail(caseItem),
  ]);

  return { sms, staffSms, customerEmail, workshopEmail };
};

const addNotificationTimeline = (caseItem, notifications, prefix = "") => {
  const at = new Date().toISOString();
  if (notifications.sms?.status === "sent") {
    caseItem.timeline.push({ at: notifications.sms.sentAt || at, event: `${prefix}SMS-bekraftelse skickad till kund.` });
  } else if (needsRetry(notifications.sms)) {
    caseItem.timeline.push({ at, event: `${prefix}SMS-bekraftelse misslyckades: ${resultError(notifications.sms)}.` });
  }
  if (notifications.staffSms?.status === "sent" || notifications.staffSms?.status === "partial") {
    caseItem.timeline.push({ at: notifications.staffSms.sentAt || at, event: `${prefix}Intern SMS-avisering skickad.` });
  } else if (needsRetry(notifications.staffSms)) {
    caseItem.timeline.push({ at, event: `${prefix}Intern SMS-avisering misslyckades: ${resultError(notifications.staffSms)}.` });
  }
  if (notifications.customerEmail?.status === "sent") {
    caseItem.timeline.push({ at: notifications.customerEmail.sentAt || at, event: `${prefix}E-postbekraftelse skickad till kund.` });
  } else if (needsRetry(notifications.customerEmail)) {
    caseItem.timeline.push({ at, event: `${prefix}E-postbekraftelse misslyckades: ${resultError(notifications.customerEmail)}.` });
  }
  if (notifications.workshopEmail?.status === "sent") {
    caseItem.timeline.push({ at: notifications.workshopEmail.sentAt || at, event: `${prefix}Intern e-post skickad till verkstaden.` });
  } else if (needsRetry(notifications.workshopEmail)) {
    caseItem.timeline.push({ at, event: `${prefix}Intern e-post misslyckades: ${resultError(notifications.workshopEmail)}.` });
  }
};

const retryFailedBookingNotifications = async ({ caseItem, store, smsRequested }) => {
  if (!caseItem.confirmation_missing) return;
  await delay(RETRY_DELAY_MS);

  const retryResult = {};
  if (needsRetry(caseItem.notifications.sms)) retryResult.sms = await sendSmsConfirmation(caseItem, smsRequested);
  if (needsRetry(caseItem.notifications.staffSms)) retryResult.staffSms = await sendWorkshopSmsNotification(caseItem);
  if (needsRetry(caseItem.notifications.customerEmail)) retryResult.customerEmail = await sendCustomerEmail(caseItem);
  if (needsRetry(caseItem.notifications.workshopEmail)) retryResult.workshopEmail = await sendWorkshopEmail(caseItem);

  if (!Object.keys(retryResult).length) return;

  caseItem.notifications = { ...caseItem.notifications, ...retryResult };
  addNotificationTimeline(caseItem, retryResult, "Retry: ");
  updateConfirmationFlags(caseItem);
  caseItem.updatedAt = new Date().toISOString();
  await store.setJSON(caseItem.id, caseItem);
  logBookingDelivery(caseItem, { retry: true });
};

const base64Url = (input) =>
  Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

let googleTokenCache = { token: "", expiresAt: 0 };

const getGoogleAccessToken = async () => {
  if (googleTokenCache.token && googleTokenCache.expiresAt > Date.now() + 60000) {
    return googleTokenCache.token;
  }

  const serviceEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n").trim();
  if (!serviceEmail || !looksLikeGooglePrivateKey(privateKey)) return "";

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceEmail,
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(privateKey))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(clean(body.error_description || body.error || response.statusText, 180));
  }
  googleTokenCache = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return googleTokenCache.token;
};

const calendarWindow = (caseItem) => {
  const window = eventWindow(caseItem);
  return {
    start: { dateTime: window.start.google, timeZone: window.timeZone },
    end: { dateTime: window.end.google, timeZone: window.timeZone },
  };
};

const checkCalendarAvailability = async (caseItem) => {
  const calendarConfig = googleCalendarConfig();
  if (!calendarConfig.ok) {
    return {
      status: "failed",
      provider: "google-calendar",
      reason: "not_configured",
      missing: calendarConfig.missing,
      invalid: calendarConfig.invalid,
    };
  }

  try {
    const token = await getGoogleAccessToken();
    if (!token) {
      return { status: "failed", provider: "google-calendar", reason: "no_token" };
    }

    const window = eventWindow(caseItem);
    const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: window.start.utc,
        timeMax: window.end.utc,
        timeZone: window.timeZone,
        items: [{ id: calendarConfig.calendarId }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "failed", provider: "google-calendar", error: clean(body.error?.message || response.statusText, 240) };
    }

    const calendar = body.calendars?.[calendarConfig.calendarId];
    const errors = calendar?.errors || [];
    if (errors.length) {
      return {
        status: "failed",
        provider: "google-calendar",
        error: clean(errors.map((item) => item.reason || item.message).filter(Boolean).join(", "), 240),
      };
    }

    const busy = calendar?.busy || [];
    return {
      status: "checked",
      provider: "google-calendar",
      available: busy.length === 0,
      busy: busy.slice(0, 3).map((item) => ({
        start: clean(item.start, 80),
        end: clean(item.end, 80),
      })),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return { status: "failed", provider: "google-calendar", error: clean(error.message, 240) };
  }
};

const createCalendarEvent = async (caseItem) => {
  const calendarConfig = googleCalendarConfig();
  if (!calendarConfig.ok) {
    console.log("Calendar integration disabled, skipping", {
      missing: calendarConfig.missing,
      invalid: calendarConfig.invalid,
    });
    return {
      status: "disabled",
      provider: "google-calendar",
      reason: "not_configured",
      missing: calendarConfig.missing,
      invalid: calendarConfig.invalid,
    };
  }

  try {
    const token = await getGoogleAccessToken();
    const window = calendarWindow(caseItem);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarConfig.calendarId)}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `${isReadyPickup(caseItem) ? "Upphamtning fardig scooter" : "Ny verkstadsforfragan"}: ${caseItem.customer.name}`,
        location: WORKSHOP_LOCATION,
        description: caseSummaryText(caseItem),
        start: window.start,
        end: window.end,
        reminders: { useDefault: true },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "failed", provider: "google-calendar", error: clean(body.error?.message || response.statusText, 180) };
    }
    return {
      status: "created",
      provider: "google-calendar",
      id: clean(body.id, 160),
      htmlLink: clean(body.htmlLink, 500),
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    return { status: "failed", provider: "google-calendar", error: clean(error.message, 180) };
  }
};

export default async (request, context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await request.json();
    const now = new Date().toISOString();
    const id = `case_${now.replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
    const service = clean(body.service) || "Annat";
    const addons = parseAddons(body.addons);
    const estimatedValue = estimateValue(service) + addonTotal(addons);
    const assignedTo = assignOwner(service, body.message);
    const smsRequested = body.smsConsent === "yes";

    const caseItem = {
      id,
      createdAt: now,
      updatedAt: now,
      status: "new",
      source: "website-booking",
      channel: "website",
      priority: clean(body.urgency, 40) || "normal",
      preferredContactTime: clean(body.preferred, 80) || null,
      preferredDate: clean(body.preferredDate, 80) || null,
      discountCode: clean(body.discountCode, 40) || null,
      contactMethod: clean(body.contactMethod, 40) || "phone",
      logistics: clean(body.logistics, 80) || "dropoff",
      pickup_for_case_id: clean(body.pickupCaseId, 160) || null,
      assignedTo,
      customer: {
        name: clean(body.name),
        phone: clean(body.phone),
        email: clean(body.email),
      },
      vehicle: {
        model: clean(body.scooter || body.vehicle),
      },
      service,
      addons,
      estimatedValue,
      message: clean(body.message),
      intakeAt: null,
      promisedAt: null,
      notes: [],
      notifications: {
        sms: { status: smsRequested ? "pending" : "not_requested", to: normalizePhone(body.phone) },
        staffSms: { status: "pending" },
        customerEmail: { status: body.email ? "pending" : "not_requested" },
        workshopEmail: { status: "pending" },
        calendar: { status: "pending" },
      },
      confirmation_sent: false,
      confirmation_missing: false,
      confirmation: {
        sms_sent: false,
        email_sent: false,
        workshop_alert: false,
        missing: false,
        updatedAt: now,
      },
      timeline: [
        { at: now, event: `Bokning skapad via hemsidan. Startansvar: ${assignedTo.name}` },
        ...(addons.length ? [{ at: now, event: `Tillval valda: ${addons.map((item) => item.label).join(", ")}.` }] : []),
      ],
    };

    if (!caseItem.customer.name || !caseItem.customer.phone) {
      return json({ error: "Namn och telefon kravs." }, 400);
    }
    if (!caseItem.preferredDate) {
      return json({ error: "Valj dag och klockslag for inlamning." }, 400);
    }
    if (body.ownershipConfirm !== "yes") {
      return json({ error: "Du maste intyga att fordonet inte ar stoldgods." }, 400);
    }

    const availability = await checkCalendarAvailability(caseItem);
    caseItem.notifications.calendarAvailability = availability;
    if (availability.status !== "checked") {
      return json({
        error: "Kunde inte kontrollera verkstadskalendern just nu. Ring eller SMS:a oss sa bokar vi tiden manuellt.",
        availability,
      }, 503);
    }
    if (!availability.available) {
      return json({
        error: "Tiden ar redan upptagen i verkstadskalendern. Valj en annan tid eller kontakta oss direkt.",
        availability,
      }, 409);
    }
    caseItem.timeline.push({ at: availability.checkedAt, event: "Kalendern kontrollerad: tiden var ledig." });

    const store = getStore({ name: "workshop-cases", consistency: "strong" });
    await store.setJSON(id, caseItem);
    if (caseItem.pickup_for_case_id) {
      const originalCase = await store.getJSON(caseItem.pickup_for_case_id).catch(() => null);
      if (originalCase) {
        originalCase.pickup_booked_at = now;
        originalCase.pickup_booking_case_id = id;
        originalCase.timeline = Array.isArray(originalCase.timeline) ? originalCase.timeline : [];
        originalCase.timeline.push({ at: now, event: `Kund bokade upphamtning: ${shortCaseId(id)}.` });
        await store.setJSON(originalCase.id, originalCase);
      }
    }

    const calendar = await createCalendarEvent(caseItem);
    caseItem.notifications.calendar = calendar;
    if (calendar.status !== "created") {
      caseItem.timeline.push({ at: new Date().toISOString(), event: `Kalenderhandelse kunde inte skapas: ${calendar.error || calendar.reason || "okant fel"}` });
      await store.setJSON(id, caseItem);
      return json({
        error: "Tiden sag ledig ut men kunde inte bokas i kalendern. Ring eller SMS:a oss sa bokar vi manuellt.",
        calendar,
      }, 503);
    }
    caseItem.timeline.push({ at: calendar.createdAt, event: "Kalenderhandelse skapad for verkstaden." });

    const { sms, staffSms, customerEmail, workshopEmail } = await sendBookingNotifications(caseItem, smsRequested);
    caseItem.notifications = { sms, staffSms, customerEmail, workshopEmail, calendar, calendarAvailability: availability };
    addNotificationTimeline(caseItem, caseItem.notifications);
    updateConfirmationFlags(caseItem);
    await store.setJSON(id, caseItem);
    logBookingDelivery(caseItem);

    if (caseItem.confirmation_missing) {
      const retryTask = retryFailedBookingNotifications({ caseItem, store, smsRequested })
        .catch((error) => console.error(`[BOOKING ${caseItem.id}] retry_failed`, error));
      if (context?.waitUntil) context.waitUntil(retryTask);
    }

    return json({ ok: true, id, case: caseItem }, 201);
  } catch (error) {
    console.error("booking error", error);
    return json({ error: "Kunde inte skapa verkstadsarende." }, 500);
  }
};

export const config = {
  path: "/api/bookings",
};
