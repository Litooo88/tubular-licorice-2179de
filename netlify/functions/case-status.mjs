import { getStore } from "@netlify/blobs";

// Publik statusportal för kunder. Ärende-ID:t (servicenumret) fungerar som
// kapabilitetsnyckel — det delas endast med kunden via bekräftelse-SMS/mail.
// Svaret innehåller ALDRIG efternamn, telefonnummer, e-post eller interna
// noteringar. GET = läs status. POST {action:"request_update"} = kunden ber
// om statusuppdatering → SMS till verkstansansvarig (max 1 per 12h/ärende).

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
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

const postSms = async ({ to, message }) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = (env("SMS_FROM") || "NordicEMob").slice(0, 11);
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) return { status: "invalid_phone" };
  if (!username || !password) return { status: "not_configured" };
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
  if (!response.ok) return { status: "failed", error: clean(body.error || response.statusText, 180) };
  return { status: "sent", sentAt: new Date().toISOString() };
};

// Kundvänliga steg. waiting_parts/waiting_customer är flaggor på pågående steg.
const STEPS = [
  { key: "received", label: "Mottagen", statuses: ["new", "contacted"] },
  { key: "checked_in", label: "Inlämnad", statuses: ["checked_in"] },
  { key: "diagnosing", label: "Felsökning", statuses: ["diagnosing"] },
  { key: "repairing", label: "Repareras", statuses: ["repairing", "waiting_parts", "waiting_customer"] },
  { key: "ready", label: "Klar för hämtning", statuses: ["ready"] },
  { key: "done", label: "Utlämnad", statuses: ["done", "archived"] },
];
const NOTES = {
  waiting_parts: "Vi väntar på en reservdel till din reparation.",
  waiting_customer: "Vi väntar på svar från dig — kolla SMS/mail eller ring oss.",
  ready: "Ditt fordon är klart! Hämtning tisdag–lördag kl 15–18. Betalning sker vid hämtning.",
};

const firstNameOf = (item) => clean(item?.customer?.name, 140).split(/\s+/).filter(Boolean)[0] || "";
const REQUEST_COOLDOWN_MS = 12 * 60 * 60 * 1000;

// Lätt rate limit per funktion-instans (read-only-portal, ingen auth).
const hits = [];
const rateLimited = () => {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60 * 60 * 1000) hits.shift();
  if (hits.length >= 600) return true;
  hits.push(now);
  return false;
};

export default async (request, context) => {
  if (rateLimited()) return json({ error: "För många förfrågningar. Försök igen senare." }, 429);
  const id = clean(context.params?.id, 160);
  if (!id || !id.startsWith("case_")) return json({ error: "Ogiltigt servicenummer." }, 404);

  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const item = await store.get(id, { type: "json" }).catch(() => null);
  if (!item) return json({ error: "Servicenumret hittades inte. Kontrollera länken från din bokningsbekräftelse." }, 404);

  const status = clean(item.status, 60) || "new";
  const stepIndex = Math.max(0, STEPS.findIndex((step) => step.statuses.includes(status)));
  const lastRequestAt = new Date(item.statusUpdateRequestedAt || 0).getTime();
  const canRequestUpdate = Date.now() - lastRequestAt > REQUEST_COOLDOWN_MS;

  if (request.method === "GET") {
    return json({
      ok: true,
      firstName: firstNameOf(item),
      model: clean(item.vehicle?.model, 180) || "Ditt fordon",
      service: clean(item.service, 160),
      statusLabel: STEPS[stepIndex].label,
      stepIndex,
      steps: STEPS.map((step) => step.label),
      note: NOTES[status] || "",
      updatedAt: clean(item.updatedAt || item.createdAt, 10),
      canRequestUpdate,
    });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (clean(body.action, 40) !== "request_update") return json({ error: "Okänd åtgärd." }, 400);
    if (!canRequestUpdate) {
      return json({ ok: true, alreadyRequested: true, message: "Vi har redan fått din förfrågan — vi återkommer så snart vi kan." });
    }
    const now = new Date().toISOString();
    const daysSince = Math.floor((Date.now() - new Date(item.updatedAt || item.createdAt || now).getTime()) / (24 * 60 * 60 * 1000));
    const sms = await postSms({
      to: env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO"),
      message: `Statusförfrågan: ${firstNameOf(item) || "kund"} (${clean(item.vehicle?.model, 80) || "okänd modell"}), ärende ${id.replace(/^case_/, "").slice(0, 18).toUpperCase()} — senast uppdaterad för ${daysSince} dagar sedan. Öppna: https://www.nordicemobility.se/admin/?case=${encodeURIComponent(id)}&tab=overview`,
    });
    const next = {
      ...item,
      statusUpdateRequestedAt: now,
      timeline: [...(Array.isArray(item.timeline) ? item.timeline : []), { at: now, event: "Kunden begärde statusuppdatering via statusportalen." }],
    };
    await store.setJSON(id, next);
    if (sms.status !== "sent") console.warn("case-status request_update sms not sent", { id, smsStatus: sms.status });
    return json({ ok: true, message: "Tack! Din förfrågan är skickad — vi återkommer så snart vi kan." });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/case-status/:id",
};
