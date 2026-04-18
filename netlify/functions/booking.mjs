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

const sendSmsConfirmation = async (caseItem, requested) => {
  const to = normalizePhone(caseItem.customer.phone);
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = (env("SMS_FROM") || "NordicEMob").slice(0, 11);

  if (!requested) return { status: "not_requested", to };
  if (!to) return { status: "invalid_phone", to: "" };
  if (!username || !password) return { status: "not_configured", to };

  const payload = new URLSearchParams({
    from,
    to,
    message: smsMessage(caseItem),
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
      return { status: "failed", provider: "46elks", to, error: clean(body.error || response.statusText, 180) };
    }
    return { status: "sent", provider: "46elks", to, id: clean(body.id, 120), sentAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", provider: "46elks", to, error: clean(error.message, 180) };
  }
};

const resendEmail = async ({ to, subject, html, text, idempotencyKey }) => {
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

const customerEmailHtml = (caseItem) => `
  <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111">
    <h2>Vi har tagit emot din serviceforfragan</h2>
    <p>Hej ${htmlEscape(caseItem.customer.name)},</p>
    <p>Tack. Vi har tagit emot uppgifterna om din elscooter eller elcykel.</p>
    <p><strong>Viktigt:</strong> detta ar inte en bekraftad verkstadstid forran vi har aterkommit med tid och nasta steg.</p>
    <p><strong>Arende:</strong> ${htmlEscape(shortCaseId(caseItem.id))}<br>
    <strong>Tjanst:</strong> ${htmlEscape(caseItem.service)}<br>
    <strong>Startansvar:</strong> ${htmlEscape(caseItem.assignedTo.name)}</p>
    <p>For snabbast hantering kan du ringa eller SMS:a:<br>
    Sebastian: <a href="tel:+46700243319">070-024 33 19</a><br>
    Lennart: <a href="tel:+46722607753">072-260 77 53</a></p>
    <p>Nordic E-Mobility<br>Pistolvagen 6, Orebro</p>
  </div>
`;

const sendCustomerEmail = async (caseItem) => {
  if (!caseItem.customer.email) return { status: "not_requested" };
  return resendEmail({
    to: [caseItem.customer.email],
    subject: `Vi har tagit emot din serviceforfragan - ${shortCaseId(caseItem.id)}`,
    html: customerEmailHtml(caseItem),
    text: [
      "Vi har tagit emot din serviceforfragan hos Nordic E-Mobility.",
      "Detta ar inte en bekraftad verkstadstid forran vi har aterkommit med tid och nasta steg.",
      "",
      caseSummaryText(caseItem),
      "",
      "For snabbast hantering: Sebastian 070-024 33 19 eller Lennart 072-260 77 53.",
    ].join("\n"),
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
    subject: `Ny verkstadsforfragan: ${caseItem.customer.name} - ${caseItem.service}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111">
        <h2>Ny verkstadsforfragan</h2>
        <pre style="white-space:pre-wrap;background:#f5f5f5;padding:14px;border-radius:8px">${htmlEscape(caseSummaryText(caseItem))}</pre>
      </div>
    `,
    text: caseSummaryText(caseItem),
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

const formatLocalDateTime = (date) => {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`;
};

const calendarWindow = (caseItem) => {
  const timeZone = env("GOOGLE_CALENDAR_TIMEZONE") || "Europe/Stockholm";
  const duration = Math.max(15, Math.min(240, Number(env("GOOGLE_CALENDAR_DURATION_MINUTES") || 30)));
  const preferred = clean(caseItem.preferredDate, 80);
  const match = preferred.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute] = match.map(Number);
    const start = new Date(Date.UTC(year, month - 1, day, hour, minute));
    const end = new Date(start.getTime() + duration * 60000);
    return {
      start: { dateTime: formatLocalDateTime(start), timeZone },
      end: { dateTime: formatLocalDateTime(end), timeZone },
    };
  }

  const start = new Date(Date.now() + 5 * 60000);
  const end = new Date(start.getTime() + duration * 60000);
  return {
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
};

const createCalendarEvent = async (caseItem) => {
  const calendarId = env("GOOGLE_CALENDAR_ID");
  const serviceEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY");
  if (!calendarId || !serviceEmail || !looksLikeGooglePrivateKey(privateKey)) return { status: "not_configured" };

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
        location: "Pistolvagen 6, Orebro",
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

    const [sms, customerEmail, workshopEmail, calendar] = await Promise.all([
      sendSmsConfirmation(caseItem, smsRequested),
      sendCustomerEmail(caseItem),
      sendWorkshopEmail(caseItem),
      createCalendarEvent(caseItem),
    ]);
    caseItem.notifications = { sms, customerEmail, workshopEmail, calendar };
    if (sms.status === "sent") {
      caseItem.timeline.push({ at: sms.sentAt, event: "SMS-bekraftelse skickad till kund." });
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
