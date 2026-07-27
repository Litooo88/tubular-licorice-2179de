import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { normalizePhone, postSms } from "./_shared/sms.mjs";

// POST /api/cases/:id/sms — skickar kund-SMS via 46elks-API:t i stället för
// telefonens sms:-länk, så att alla utskick loggas på ärendet (spårbar
// kundkommunikation) och går från företagsavsändaren.
//
// Body: { message: string, kind?: "generic"|"ready"|"receipt", operator?: string }
// Svar: { status: "sent"|"not_configured"|..., sms?, case? }
// - not_configured => UI:t faller tillbaka till sms:-länk (safe-läge).
// - Dubblettskydd: identiskt meddelande till samma ärende inom 2 min => 409.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 2000) => String(value || "").trim().slice(0, max);

const KINDS = new Set(["generic", "ready", "receipt"]);
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export default async (request, context) => {
  const auth = requireAdminToken(request, json, "ADMIN_TOKEN saknas i Netlify miljovariabler.");
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const id = context.params?.id;
  if (!id) return json({ error: "Missing case id" }, 400);

  const body = await request.json().catch(() => ({}));
  const message = clean(body.message, 1600);
  if (!message) return json({ error: "Meddelandetext saknas." }, 400);
  const kind = KINDS.has(body.kind) ? body.kind : "generic";
  const operator = clean(body.operator || body.operatorName, 80);

  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const item = await store.get(id, { type: "json" });
  if (!item) return json({ error: "Ärendet finns inte." }, 404);

  const phone = normalizePhone(item?.customer?.phone);
  if (!phone) return json({ error: "Kundtelefon saknas på ärendet." }, 400);

  // Dubblettskydd: exakt samma text nyligen skickad till samma ärende.
  const log = Array.isArray(item.smsLog) ? item.smsLog : [];
  const last = log[log.length - 1];
  if (
    last &&
    last.message === message &&
    last.status === "sent" &&
    Date.now() - new Date(last.at || 0).getTime() < DUPLICATE_WINDOW_MS
  ) {
    return json({ error: "Identiskt SMS skickades nyss till detta ärende (dubblettskydd)." }, 409);
  }

  const sms = await postSms({ to: phone, message });
  if (sms.status === "not_configured") return json({ status: "not_configured" });
  if (sms.status !== "sent") {
    return json({ status: sms.status, error: sms.error || "SMS kunde inte skickas." }, 502);
  }

  const now = new Date().toISOString();
  const kindLabel = { generic: "kundinfo", ready: "klar för hämtning", receipt: "betalkvitto" }[kind];
  const next = {
    ...item,
    smsLog: [
      ...log,
      { at: now, kind, to: phone, message, status: "sent", providerId: sms.id || "", operator },
    ].slice(-50),
    timeline: [
      ...(Array.isArray(item.timeline) ? item.timeline : []),
      { at: now, event: `SMS (${kindLabel}) skickat via API${operator ? ` av ${operator}` : ""}.` },
    ],
    updatedAt: now,
  };
  if (kind === "ready") {
    next.completion = {
      ...(item.completion || {}),
      customerNotifiedAt: now,
      customerNotifiedVia: "sms",
    };
  }
  await store.setJSON(id, next);

  return json({ status: "sent", sms: { at: now, to: phone, providerId: sms.id || "" } });
};

export const config = {
  path: "/api/cases/:id/sms",
};
