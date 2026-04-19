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
const WORKSHOP_LOCATION = "Pistolv\u00e4gen 6, \u00d6rebro";
const WORKSHOP_ORGANIZER = "info@nordicemobility.se";
const ICS_TIME_ZONE = "Europe/Stockholm";

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

const shortCaseId = (id) => id.replace(/^case_/, "").slice(0, 18).toUpperCase();

const smsMessage = (caseItem) =>
  `Nordic E-Mobility: Bokning mottagen. Arende ${shortCaseId(caseItem.id)}. Ansvarig start: ${caseItem.assignedTo.name}. Vi kontaktar dig med tid och pris.`;

const workshopSmsMessage = (caseItem) =>
  `Nytt Nordic-arende ${shortCaseId(caseItem.id)}: ${caseItem.customer.name}, ${caseItem.service}. Tel ${caseItem.customer.phone}. Ansvar: ${caseItem.assignedTo.name}.`;

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
    },
    end: {
      google: googleLocalDateTime(endParts),
      ics: icsLocalDateTime(endParts),
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
  const recipients = configured.length ? configured : [STAFF.sebastian.phone, STAFF.lennart.phone];
  const results = await Promise.all(recipients.map((recipient) => postSms({ to: recipient, message: workshopSmsMessage(caseItem) })));

  if (results.some((result) => result.status === "sent")) {
    return {
      status: "sent",
      provider: "46elks",
      recipients: results,
      sentAt: new Date().toISOString(),
    };
  }

  return {
    status: results.every((result) => result.status === "not_configured") ? "not_configured" : "failed",
    provider: "46elks",
    recipients: results,
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
  caseItem.preferredDate ? `Onskad tid: ${caseItem.preferredDate}` : "",
  caseItem.preferredContactTime ? `Passar bast: ${caseItem.preferredContactTime}` : "",
  `Kontakt: ${caseItem.contactMethod}`,
  `Inlamning: ${caseItem.logistics}`,
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
        <h1 style="font-size:24px;line-height:1.2;margin:8px 0 0">Din servicef&ouml;rfr&aring;gan &auml;r mottagen</h1>
      </div>
      <div style="padding:24px;line-height:1.6">
        <p>Hej ${htmlEscape(caseItem.customer.name)},</p>
        <p>Vi har registrerat ditt &auml;rende i verkstadssystemet. Sebastian g&aring;r igenom underlaget och vi &aring;terkommer med bekr&auml;ftad inl&auml;mningstid, pris och n&auml;sta steg innan n&aring;got arbete p&aring;b&ouml;rjas.</p>
        <div style="background:#f7faf6;border:1px solid #dfe8dc;border-radius:8px;padding:16px;margin:18px 0">
          <p style="margin:0 0 8px"><strong>&Auml;rende:</strong> ${htmlEscape(shortCaseId(caseItem.id))}</p>
          <p style="margin:0 0 8px"><strong>Tj&auml;nst:</strong> ${htmlEscape(caseItem.service)}</p>
          <p style="margin:0 0 8px"><strong>&Ouml;nskad inl&auml;mning:</strong> ${htmlEscape(formatPreferredDateForEmail(caseItem.preferredDate))}</p>
          <p style="margin:0 0 8px"><strong>Fordon:</strong> ${htmlEscape(caseItem.vehicle.model || "Inte angivet")}</p>
          <p style="margin:0"><strong>Startansvar:</strong> ${htmlEscape(caseItem.assignedTo.name)}</p>
        </div>
        <p><strong>Viktigt:</strong> kalenderfilen som bifogas &auml;r prelimin&auml;r. Den hj&auml;lper dig att komma ih&aring;g din &ouml;nskade tid, men verkstadstiden g&auml;ller f&ouml;rst n&auml;r vi har bekr&auml;ftat den.</p>
        <p>Direktkontakt:<br>
        Sebastian, tekniskt ansvarig: <a href="tel:+46700243319">070-024 33 19</a><br>
        Lennart, mottagning dagtid: <a href="tel:+46722607753">072-260 77 53</a></p>
        <p style="margin-bottom:0">Nordic E-Mobility<br>Pistolv&auml;gen 6, &Ouml;rebro</p>
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
      "Vi har registrerat ditt \u00e4rende i verkstadssystemet.",
      "Sebastian g\u00e5r igenom underlaget och vi \u00e5terkommer med bekr\u00e4ftad inl\u00e4mningstid, pris och n\u00e4sta steg innan n\u00e5got arbete p\u00e5b\u00f6rjas.",
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
        <p><strong>&Ouml;nskad inl&auml;mning:</strong> ${htmlEscape(formatPreferredDateForEmail(caseItem.preferredDate))}</p>
        <pre style="white-space:pre-wrap;background:#f5f5f5;padding:14px;border-radius:8px">${htmlEscape(caseSummaryText(caseItem))}</pre>
      </div>
    `,
    text: caseSummaryText(caseItem),
    attachments: [buildIcsAttachment(caseItem)],
    idempotencyKey: `${caseItem.id}-workshop-email`,
  });
};

const base64Url = (input) =>
  Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

let googleTokenCache = { token: "", expiresAt: 0 };

const getGoogleAccessToken = async () => {
  if (googleTokenCache.token && googleTokenCache.expiresAt > Date.now() + 60000) {
    return googleTokenCache.token;
  }

  const serviceEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!serviceEmail || !looksLikeGooglePrivateKey(privateKey)) return "";

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceEmail,
    scope: "https://www.googleapis.com/auth/calendar.events",
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

const createCalendarEvent = async (caseItem) => {
  const calendarId = env("GOOGLE_CALENDAR_ID");
  const serviceEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY");
  if (!calendarId || !serviceEmail || !looksLikeGooglePrivateKey(privateKey)) {
    console.log("Calendar integration disabled, skipping");
    return { status: "disabled", provider: "google-calendar", reason: "not_configured" };
  }

  try {
    const token = await getGoogleAccessToken();
    const window = calendarWindow(caseItem);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `Ny verkstadsforfragan: ${caseItem.customer.name}`,
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

export default async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await request.json();
    const now = new Date().toISOString();
    const id = `case_${now.replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
    const service = clean(body.service) || "Annat";
    const estimatedValue = estimateValue(service);
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
      contactMethod: clean(body.contactMethod, 40) || "phone",
      logistics: clean(body.logistics, 80) || "dropoff",
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
      timeline: [
        { at: now, event: `Bokning skapad via hemsidan. Startansvar: ${assignedTo.name}` },
      ],
    };

    if (!caseItem.customer.name || !caseItem.customer.phone) {
      return json({ error: "Namn och telefon kravs." }, 400);
    }
    if (body.ownershipConfirm !== "yes") {
      return json({ error: "Du maste intyga att fordonet inte ar stoldgods." }, 400);
    }

    const store = getStore({ name: "workshop-cases", consistency: "strong" });
    await store.setJSON(id, caseItem);

    const [sms, staffSms, customerEmail, workshopEmail, calendar] = await Promise.all([
      sendSmsConfirmation(caseItem, smsRequested),
      sendWorkshopSmsNotification(caseItem),
      sendCustomerEmail(caseItem),
      sendWorkshopEmail(caseItem),
      createCalendarEvent(caseItem),
    ]);
    caseItem.notifications = { sms, staffSms, customerEmail, workshopEmail, calendar };
    if (sms.status === "sent") {
      caseItem.timeline.push({ at: sms.sentAt, event: "SMS-bekraftelse skickad till kund." });
    }
    if (staffSms.status === "sent") {
      caseItem.timeline.push({ at: staffSms.sentAt, event: "Intern SMS-avisering skickad." });
    }
    if (customerEmail.status === "sent") {
      caseItem.timeline.push({ at: customerEmail.sentAt, event: "E-postbekraftelse skickad till kund." });
    }
    if (workshopEmail.status === "sent") {
      caseItem.timeline.push({ at: workshopEmail.sentAt, event: "Intern e-post skickad till verkstaden." });
    }
    if (calendar.status === "created") {
      caseItem.timeline.push({ at: calendar.createdAt, event: "Kalenderhandelse skapad for verkstaden." });
    }
    await store.setJSON(id, caseItem);

    return json({ ok: true, id, case: caseItem }, 201);
  } catch (error) {
    console.error("booking error", error);
    return json({ error: "Kunde inte skapa verkstadsarende." }, 500);
  }
};

export const config = {
  path: "/api/bookings",
};
