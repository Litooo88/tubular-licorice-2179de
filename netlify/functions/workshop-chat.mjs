import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);
const CHAT_RATE_WINDOW_MS = 10 * 60 * 1000;
const CHAT_RATE_LIMIT = 5;
const chatRateLimitStore = globalThis.__nordicWorkshopChatRateLimit || new Map();
globalThis.__nordicWorkshopChatRateLimit = chatRateLimitStore;

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const requestIp = (request) => {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return clean(
    request.headers.get("x-nf-client-connection-ip")
      || request.headers.get("client-ip")
      || forwarded.split(",")[0]
      || "unknown",
    120
  );
};

const rateLimitKey = (request, phone) => `${requestIp(request)}|${phone || "missing-phone"}`;

const checkRateLimit = (request, phone) => {
  const now = Date.now();
  const key = rateLimitKey(request, phone);
  const attempts = (chatRateLimitStore.get(key) || []).filter((at) => now - at < CHAT_RATE_WINDOW_MS);
  attempts.push(now);
  chatRateLimitStore.set(key, attempts);
  return {
    ok: attempts.length <= CHAT_RATE_LIMIT,
    attempts: attempts.length,
    retryAfterSeconds: Math.ceil(CHAT_RATE_WINDOW_MS / 1000),
  };
};

const STAFF = {
  workshop: { key: "workshop", name: "Verkstaden", role: "Golv, mottagning och snabba jobb", phone: "010-138 54 98" },
  sebastian: { key: "sebastian", name: "Sebastian", role: "Tung felsokning, batteri och elsystem", phone: "010-138 54 98" },
};

const topicLabels = {
  puncture: "Punktering / däck",
  battery: "Batteri / laddar inte",
  brakes: "Bromsar",
  error: "Felkod / display",
  booking: "Vill boka tid",
  other: "Annat problem",
};

const topicService = {
  puncture: "Chat: Punktering / däck",
  battery: "Chat: Batteri / laddning",
  brakes: "Chat: Bromsar",
  error: "Chat: Felkod / display",
  booking: "Chat: Bokningsfraga",
  other: "Chat: Annat problem",
};

const assigneeFor = (topic, message) => {
  const text = `${topic} ${message}`.toLowerCase();
  if (/battery|batteri|ladd|bms|controller|display|felkod|error|elsystem/.test(text)) return STAFF.sebastian;
  return STAFF.workshop;
};

const uniquePhones = (phones) => {
  const seen = new Set();
  return phones
    .map(normalizePhone)
    .filter(Boolean)
    .filter((phone) => {
      if (seen.has(phone)) return false;
      seen.add(phone);
      return true;
    });
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
  if (!message) return { status: "missing_message", to: normalizedTo };
  if (!username || !password) return { status: "not_configured", to: normalizedTo };
  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from, to: normalizedTo, message, dontlog: "message" }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { status: "failed", provider: "46elks", to: normalizedTo, error: clean(body.error || response.statusText, 180) };
    return { status: "sent", provider: "46elks", to: normalizedTo, id: clean(body.id, 120), sentAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", provider: "46elks", to: normalizedTo, error: clean(error?.message || "sms failed", 180) };
  }
};

const notificationMessage = ({ caseId, topicLabel, customerName, phone, model, message, page }) => {
  const siteUrl = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
  const shortId = caseId.replace(/^case_/, "").slice(0, 18).toUpperCase();
  const adminUrl = `${siteUrl}/admin/?case=${encodeURIComponent(caseId)}&tab=contact`;
  return [
    `Ny chatt ${shortId}`,
    `Typ: ${topicLabel}`,
    `Kund: ${customerName || "Okand"} ${normalizePhone(phone)}`,
    model ? `Modell: ${model}` : "",
    `Text: ${clean(message, 220)}`,
    `Svara: ${adminUrl}`,
    page ? `Sida: ${clean(page, 120)}` : "",
  ].filter(Boolean).join("\n");
};

const sendWorkshopAlert = async (caseItem) => {
  const configured = clean(env("WORKSHOP_CHAT_SMS_TO") || env("WORKSHOP_SMS_TO"), 500)
    .split(/[,\s;]+/)
    .filter(Boolean);
  const recipients = uniquePhones([STAFF.workshop.phone, STAFF.sebastian.phone, ...configured]);
  const message = notificationMessage({
    caseId: caseItem.id,
    topicLabel: caseItem.chat?.topicLabel,
    customerName: caseItem.customer?.name,
    phone: caseItem.customer?.phone,
    model: caseItem.vehicle?.model,
    message: caseItem.message,
    page: caseItem.chat?.page,
  });
  const results = await Promise.all(recipients.map((recipient) => postSms({ to: recipient, message })));
  const sent = results.filter((result) => result.status === "sent").length;
  return {
    status: sent === recipients.length && recipients.length ? "sent" : sent ? "partial" : "failed",
    recipients,
    results,
    sentAt: new Date().toISOString(),
  };
};

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await request.json().catch(() => ({}));
  if (clean(body.company || body.website || body["bot-field"] || body.botField, 80)) {
    return json({ ok: true, ignored: true, reason: "bot_honeypot" });
  }

  const topic = topicLabels[body.topic] ? body.topic : "other";
  const message = clean(body.message, 1200);
  const phone = normalizePhone(body.phone);
  const limit = checkRateLimit(request, phone || clean(body.phone, 80) || "missing-phone");
  if (!limit.ok) {
    return json({
      error: "For manga chattforsok. Vanta en stund och forsok igen.",
      retryAfterSeconds: limit.retryAfterSeconds,
    }, 429);
  }
  const name = clean(body.name, 140) || "Chatkund";
  const model = clean(body.model, 180);
  const page = clean(body.page, 500);
  const title = clean(body.title, 180);

  if (!message) return json({ error: "Skriv vad kunden behover hjalp med." }, 400);
  if (!phone) return json({ error: "Telefonnummer kravs sa verkstaden kan svara." }, 400);

  const now = new Date().toISOString();
  const id = `case_${now.replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
  const assignee = assigneeFor(topic, message);
  const caseItem = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "new",
    source: "website_chat",
    channel: "chat",
    priority: topic === "booking" ? "high" : "normal",
    preferredContactTime: "Svar via chatt/SMS sa snart verkstaden kan.",
    preferredDate: null,
    discountCode: null,
    contactMethod: "sms",
    logistics: "unknown",
    assignedTo: assignee,
    customer: {
      name,
      phone,
      email: "",
    },
    vehicle: {
      model,
    },
    service: topicService[topic] || topicService.other,
    addons: [],
    estimatedValue: 0,
    message,
    intakeAt: null,
    promisedAt: null,
    notes: [],
    chat: {
      topic,
      topicLabel: topicLabels[topic],
      page,
      title,
      status: "needs_reply",
      messages: [
        {
          at: now,
          from: "customer",
          channel: "widget",
          text: message,
        },
      ],
    },
    notifications: {
      chatStaffSms: { status: "pending" },
    },
    confirmation_sent: false,
    confirmation_missing: true,
    completion: {
      totalCost: 0,
      workSummary: "",
      invoiceText: "",
      priceRows: [],
      readyForFortnox: false,
      updatedAt: now,
    },
    payment: {
      status: "unpaid",
      amount: 0,
      method: "",
      reference: "",
      updatedAt: now,
    },
    timeline: [
      { at: now, event: `Ny chatt fran hemsidan: ${topicLabels[topic]}.` },
      { at: now, event: `Tilldelad: ${assignee.name}.` },
    ],
  };

  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  await store.setJSON(id, caseItem);
  const alert = await sendWorkshopAlert(caseItem);
  caseItem.notifications.chatStaffSms = alert;
  caseItem.timeline.push({
    at: alert.sentAt || new Date().toISOString(),
    event: `Intern chattavisering ${alert.status === "sent" ? "skickad" : alert.status === "partial" ? "delvis skickad" : "misslyckades"}.`,
  });
  caseItem.updatedAt = new Date().toISOString();
  await store.setJSON(id, caseItem);

  return json({
    ok: true,
    caseId: id,
    status: "received",
    notification: alert.status,
    assignedTo: assignee.name,
  }, 201);
};

export const config = {
  path: "/api/workshop-chat",
};
