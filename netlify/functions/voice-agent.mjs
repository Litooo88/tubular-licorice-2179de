// Verktygs-API för röstassistenten (dag 1). Samtalsplattformen (ElevenLabs
// Agents eller Retell, se docs/VOICE_AGENT.md) anropar de här endpointsen
// som "tools" under ett pågående samtal och som webhook efter samtalet.
//
//   POST /api/voice-agent/lookup        { phone }                → kundsäker status
//   POST /api/voice-agent/prices        { query }                → publik prislista
//   POST /api/voice-agent/slots         {}                       → lediga inlämningstider
//   POST /api/voice-agent/book-meeting  { phone, name, topic, preferredTime, vehicle }
//   POST /api/voice-agent/summary       { callId, phone, summary, transcript, ... }
//   GET  /api/voice-agent/health
//
// Säkerhet: header x-voice-agent-secret måste matcha VOICE_AGENT_SECRET.
// Saknas variabeln svarar allt 503 not_configured — ingenting läcker och
// ingenting skickas. Assistenten kan aldrig ändra ett ärende, sätta pris,
// markera betalning eller skicka fri text till kunden: det enda den
// "bokar" är ett telefonmöte med Sebastian, och det enda kund-SMS den
// utlöser är bekräftelsen på det (nivå 1). Samtalssammanfattningen går till
// Sebastian; ett eventuellt kund-SMS med sammanfattning läggs som utkast för
// godkännande, aldrig direkt.

import { getStore } from "@netlify/blobs";
import { postSms } from "./_shared/sms.mjs";
import {
  compactSlots,
  fromElevenLabsWebhook,
  lookupByPhone,
  matchPrices,
  meetingSmsToCustomer,
  meetingSmsToSebastian,
  normalizeCallSummary,
  normalizeMeeting,
  summarySmsToSebastian,
  verifyElevenLabsSignature,
} from "./_shared/voice-agent.mjs";
// Publika prisregler. Statisk JSON-import så att esbuild bundlar filen in i
// funktionen; en dynamisk require gav "Cannot find module" i produktion
// (data/ följer inte med i funktionspaketet).
import priceRules from "../../data/workshop/price-rules.json" with { type: "json" };

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const clean = (value, max = 400) => String(value || "").trim().slice(0, max);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const siteBase = () => (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
const sebastianTo = () => env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO");

const authorized = (request) => {
  const expected = env("VOICE_AGENT_SECRET");
  if (!expected) return { ok: false, status: 503, error: "not_configured" };
  const provided = request.headers.get("x-voice-agent-secret") || "";
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (provided !== expected && bearer !== expected) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
};

const loadCases = async () => {
  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  const items = await Promise.all((blobs || []).map((b) => store.get(b.key, { type: "json" }).catch(() => null)));
  return items.filter(Boolean);
};

// Internt ärende via den vanliga API:n (samma mönster som sms-inbound):
// duplicerar ingen ärendelogik och syns i admin som vilket ärende som helst.
const createMeetingCase = async (m) => {
  const token = env("ADMIN_TOKEN");
  if (!token) return { status: "not_configured" };
  try {
    const response = await fetch(`${siteBase()}/api/cases`, {
      method: "POST",
      headers: { "x-admin-token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: m.name || "Okänt namn (röstassistent)",
        customerPhone: m.phone,
        vehicleModel: m.vehicle,
        source: "voice-agent",
        note: `Telefonmöte bokat av röstassistenten. Ämne: ${m.topic}. Önskad tid: ${m.preferredTime || "ingen angiven"}.`,
        operatorName: "röstassistent",
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? { status: "created", id: data?.item?.id || data?.id || "" } : { status: "failed", error: clean(data.error, 160) };
  } catch (error) {
    return { status: "failed", error: clean(error?.message, 160) };
  }
};

const sendMail = async (subject, text) => {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  const to = env("WORKSHOP_EMAIL") || env("EMAIL_REPLY_TO");
  if (!apiKey || !from || !to) return { status: "not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.ok ? "sent" : "failed" };
  } catch {
    return { status: "failed" };
  }
};

export default async (request) => {
  const url = new URL(request.url);
  const tool = clean(url.pathname.split("/").filter(Boolean).pop(), 40);
  // Post-call-webhooken kan inte sätta egna headers; ElevenLabs signerar i
  // stället med HMAC (VOICE_AGENT_WEBHOOK_SECRET). Den delade hemligheten i
  // header accepteras fortfarande, för tester och för andra plattformar.
  let rawBody = "";
  let webhookOk = false;
  if (tool === "summary" && request.method === "POST") {
    rawBody = await request.text().catch(() => "");
    const webhookSecret = env("VOICE_AGENT_WEBHOOK_SECRET");
    webhookOk = Boolean(webhookSecret) && (await verifyElevenLabsSignature(request.headers.get("elevenlabs-signature"), rawBody, webhookSecret));
  }
  const auth = webhookOk ? { ok: true } : authorized(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  if (request.method === "GET" && tool === "health") {
    return json({
      ok: true,
      tools: ["lookup", "prices", "slots", "book-meeting", "summary"],
      sms: Boolean(sebastianTo()),
      cases: Boolean(env("ADMIN_TOKEN")),
      mail: Boolean(env("RESEND_API_KEY") && env("EMAIL_FROM")),
    });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = rawBody
    ? (() => { try { return JSON.parse(rawBody); } catch { return {}; } })()
    : await request.json().catch(() => ({}));

  if (tool === "lookup") {
    const cases = await loadCases();
    return json(lookupByPhone(cases, body.phone));
  }

  if (tool === "prices") {
    return json({
      threshold: Number(priceRules.approvalThreshold) || 995,
      items: matchPrices(priceRules.rules, body.query),
      policy: "Säg från-pris och spann. Lova aldrig slutpris. Allt över tröskeln bekräftas av Sebastian.",
    });
  }

  if (tool === "slots") {
    try {
      const response = await fetch(`${siteBase()}/api/bookings?view=slots`, { signal: AbortSignal.timeout(10000) });
      const payload = await response.json().catch(() => ({}));
      return json(compactSlots(payload));
    } catch {
      return json(compactSlots({ status: "unchecked", days: [] }));
    }
  }

  if (tool === "book-meeting") {
    const { ok, errors, meeting } = normalizeMeeting(body);
    if (!ok) return json({ ok: false, error: "invalid_meeting", fields: errors }, 400);
    const at = new Date().toISOString();
    const store = getStore({ name: "voice-agent-meetings", consistency: "strong" });
    const id = `meeting-${at.replace(/[:.]/g, "-")}-${meeting.phone.replace(/\D/g, "").slice(-6)}`;
    const caseResult = await createMeetingCase(meeting);
    const staff = sebastianTo() ? await postSms({ to: sebastianTo(), message: meetingSmsToSebastian(meeting) }) : { status: "not_configured" };
    const customer = await postSms({ to: meeting.phone, message: meetingSmsToCustomer(meeting) });
    await store.setJSON(id, { id, at, ...meeting, case: caseResult, staffSms: staff.status, customerSms: customer.status }).catch(() => {});
    return json({ ok: true, id, caseId: caseResult.id || "", confirmationSms: customer.status, say: `Då har jag bokat att Sebastian ringer dig${meeting.preferredTime ? ` ${meeting.preferredTime}` : " så snart han kan"}. Du får en bekräftelse på SMS.` });
  }

  if (tool === "summary") {
    const s = normalizeCallSummary(fromElevenLabsWebhook(body));
    if (!s.callId && !s.phone) return json({ ok: false, error: "missing_call" }, 400);
    const cases = s.phone ? await loadCases() : [];
    const lookup = s.phone ? lookupByPhone(cases, s.phone) : null;
    const at = new Date().toISOString();
    const store = getStore({ name: "voice-agent-calls", consistency: "strong" });
    const id = s.callId || `call-${at.replace(/[:.]/g, "-")}`;
    await store.setJSON(id, { id, at, ...s, customer: lookup ? { found: lookup.found, firstName: lookup.firstName, activeCases: lookup.active.map((c) => c.serviceNumber) } : null }).catch(() => {});
    const sms = sebastianTo() ? await postSms({ to: sebastianTo(), message: summarySmsToSebastian(s, lookup) }) : { status: "not_configured" };
    const mail = await sendMail(
      `Röstassistent: samtal ${s.phone || id}`,
      `${summarySmsToSebastian(s, lookup)}\n\nUtfall: ${s.outcome || "-"}\n\nTranskript:\n${s.transcript || "(saknas)"}`,
    );
    return json({ ok: true, id, staffSms: sms.status, mail: mail.status });
  }

  return json({ error: "unknown_tool" }, 404);
};

export const config = {
  path: ["/api/voice-agent/:tool", "/api/voice-agent"],
};
