import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || "";
  } catch {
    return "";
  }
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
    const smsRequested = body.smsConsent !== "no";

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
      },
      timeline: [
        { at: now, event: `Bokning skapad via hemsidan. Startansvar: ${assignedTo.name}` },
      ],
    };

    if (!caseItem.customer.name || !caseItem.customer.phone) {
      return json({ error: "Namn och telefon kravs." }, 400);
    }

    const store = getStore({ name: "workshop-cases", consistency: "strong" });
    await store.setJSON(id, caseItem);

    const sms = await sendSmsConfirmation(caseItem, smsRequested);
    caseItem.notifications.sms = sms;
    if (sms.status === "sent") {
      caseItem.timeline.push({ at: sms.sentAt, event: "SMS-bekraftelse skickad till kund." });
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
