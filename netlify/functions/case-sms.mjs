import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { normalizePhone, postSms as rawPostSms } from "./_shared/sms.mjs";
import { loggedSms } from "./_shared/comm-log.mjs";
import { commitCase, commitFailureResponse, readWithEtag } from "./_shared/case-store.mjs";
import { hasJournalEntry, markCommitted, sendJournaled } from "./_shared/send-journal.mjs";

const postSms = loggedSms("case-sms", rawPostSms);

// POST /api/cases/:id/sms — skickar kund-SMS via 46elks-API:t i stället för
// telefonens sms:-länk, så att alla utskick loggas på ärendet (spårbar
// kundkommunikation) och går från företagsavsändaren.
//
// Body: { message: string, kind?: "generic"|"ready"|"receipt", operator?: string }
// Svar: { status: "sent"|"not_configured"|..., sms?, case? }
// - not_configured => UI:t faller tillbaka till sms:-länk (safe-läge).
// - Dubblettskydd: identiskt meddelande till samma ärende inom 2 min => 409
//   (ärendets smsLog + utskicksjournalen i _shared/send-journal.mjs).
// - body.idempotencyKey (valfri): samma nyckel igen ger sparat resultat, inget nytt SMS.
// - body.force === true: skicka trots dubblettskyddet.

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
  const { item, etag } = await readWithEtag(store, id);
  if (!item) return json({ error: "Ärendet finns inte." }, 404);

  const phone = normalizePhone(item?.customer?.phone);
  if (!phone) return json({ error: "Kundtelefon saknas på ärendet." }, 400);

  // Dubblettskydd: exakt samma text nyligen skickad till samma ärende.
  const log = Array.isArray(item.smsLog) ? item.smsLog : [];
  const last = log[log.length - 1];
  if (
    body.force !== true &&
    last &&
    last.message === message &&
    last.status === "sent" &&
    Date.now() - new Date(last.at || 0).getTime() < DUPLICATE_WINDOW_MS
  ) {
    return json({ error: "Identiskt SMS skickades nyss till detta ärende (dubblettskydd)." }, 409);
  }

  const now = new Date().toISOString();
  const kindLabel = { generic: "kundinfo", ready: "klar för hämtning", receipt: "betalkvitto" }[kind];
  // Reservation i utskicksjournalen före utskicket; resultatet sparas direkt
  // efter. Faller ärendeskrivningen nedan återapplicerar comm-reconcile raden.
  const sent = await sendJournaled({
    caseId: id, channel: "sms", to: phone, message, source: "case-sms", operator, action: `case_sms_${kind}`,
    apply: { log: "smsLog", kind, event: `SMS (${kindLabel}) skickat via API${operator ? ` av ${operator}` : ""}.` },
    idempotencyKey: clean(body.idempotencyKey, 120), force: body.force === true,
    send: () => postSms({ to: phone, message, approved: true }), // manuellt från ärendet
  });
  if (sent.status === "duplicate_recent") return json({ error: "Identiskt SMS skickades nyss till detta ärende (dubblettskydd).", code: "duplicate_recent", journalKey: sent.journalKey }, 409);
  if (sent.status === "in_flight") return json({ error: "Samma utskick pågår redan.", code: "in_flight", journalKey: sent.journalKey }, 409);
  if (sent.status === "unversioned") return json({ error: "Lagringen kan inte garantera versionskontroll just nu. Inget skickades.", code: "storage_unversioned" }, 503);
  const sms = sent.result || {};
  if (sent.replayed && hasJournalEntry(item, sent.journalKey)) {
    return json({ status: "sent", sms: { at: now, to: phone, providerId: sms.id || "" }, caseLogged: true, replayed: true, journalKey: sent.journalKey });
  }
  if (sms.status === "not_configured") return json({ status: "not_configured", journalKey: sent.journalKey });
  if (sms.status !== "sent") {
    return json({ status: sms.status, error: sms.error || "SMS kunde inte skickas.", journalKey: sent.journalKey }, 502);
  }
  // Versionerad skrivning: SMS:et är redan skickat, bara loggningen görs om
  // på färsk version vid konflikt.
  const saved = await commitCase(store, id, (item) => {
    const next = {
      ...item,
      smsLog: [
        ...(Array.isArray(item.smsLog) ? item.smsLog : []),
        { at: now, kind, to: phone, message, status: "sent", providerId: sms.id || "", operator, journalKey: sent.journalKey },
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
    return next;
  }, { current: item, etag });
  if (!saved.ok) {
    // SMS:et gick – svara ändå sent, men tala om att loggningen inte kunde sparas.
    // Journalposten ligger kvar som "sent" utan "committed": comm-reconcile
    // lägger loggraden på ärendet vid nästa körning.
    console.warn("case-sms: log write failed", { id, reason: saved.reason });
    return json({ status: "sent", sms: { at: now, to: phone, providerId: sms.id || "" }, caseLogged: false, caseError: saved.reason, journalKey: sent.journalKey });
  }
  if (!sent.replayed) await markCommitted(sent.journalKey, { caseEtag: saved.etag || "" }).catch(() => {});

  return json({ status: "sent", sms: { at: now, to: phone, providerId: sms.id || "" }, caseLogged: true, journalKey: sent.journalKey });
};

export const config = {
  path: "/api/cases/:id/sms",
};
