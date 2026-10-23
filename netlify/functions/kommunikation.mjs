// Kommunikationsöversikten (/admin/kommunikation/): alla samtal, SMS och
// chattar till och från kunder, per person, rangordnat efter relevans, plus
// vad Nova gjort i dag och vilka funktioner som skickat SMS.
//
//   GET  /api/kommunikation?days=30            -> översikten + SMS som väntar på godkännande
//   POST /api/kommunikation/handled {phone}    -> markera kontakten som hanterad
//   POST /api/kommunikation/approve {id}       -> skicka ett köat SMS
//   POST /api/kommunikation/approve-all {ids}  -> skicka flera köade SMS
//   POST /api/kommunikation/reject {id}        -> ta bort ett köat SMS utan att skicka
//   POST /api/kommunikation/sms-approval {enabled} -> spärren PÅ/AV
//
// Kräver admin-token. Det enda som skickas härifrån är SMS Sebastian godkänt.
// Logik och poängsättning: _shared/comm-overview.mjs.

import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { approvePendingSms, markHandled, readHandled, readPendingSms, readSmsApproval, readSmsLog, rejectPendingSms, setSmsApproval, SMS_SOURCES } from "./_shared/comm-log.mjs";
import { buildContacts, buildEvents, buildOverview } from "./_shared/comm-overview.mjs";
import { fetchElksBalance, fetchElksHistory } from "./_shared/elks-history.mjs";
import { buildNovaStats, ownNovaNumbers } from "./_shared/nova.mjs";
import { normalizePhone, postSms } from "./_shared/sms.mjs";
import { meetingSmsToCustomer } from "./_shared/voice-agent.mjs";
import { INFO_SMS } from "./ring-list.mjs";

const env = (n) => { try { return globalThis.Netlify?.env?.get?.(n) || process.env[n] || ""; } catch { return process.env[n] || ""; } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

// Läser hela storen, parallellt i bitar (sekventiellt tar 150+ ärenden för lång tid).
const readAll = async (name) => {
  const store = getStore({ name, consistency: "strong" });
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined).catch(() => ({ blobs: [] }));
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  const out = [];
  for (let i = 0; i < keys.length; i += 40) {
    const part = await Promise.all(keys.slice(i, i + 40).map(async (key) => {
      const v = await store.get(key, { type: "json" }).catch(() => null);
      return v && typeof v === "object" ? { key, ...v } : null;
    }));
    out.push(...part.filter(Boolean));
  }
  return out;
};

// Egna nummer: interna utskick (larm till Sebastian m.m.) hålls utanför kundlistorna.
const ownNumbers = () => {
  const keys = ["VOICE_PRIMARY_NUMBER", "VOICE_NOTIFY_TO", "VOICE_MISSED_SMS_TO", "VOICE_WORKSHOP_PHONE", "VOICE_SEBASTIAN_PHONE", "SEBASTIAN_SMS_TO", "WORKSHOP_SMS_TO", "ELKS_SMS_NUMBER", "ELKS_NUMBER", "VOICE_FALLBACK_NUMBER", "PRIVATE_LINE_NUMBER"];
  const set = new Set(["+46700243319", ...ownNovaNumbers(env)].map(normalizePhone));
  for (const k of keys) for (const part of String(env(k) || "").split(/[,;\s]+/)) { const n = normalizePhone(part); if (n) set.add(n); }
  return [...set].filter(Boolean);
};

export default async (request) => {
  const auth = requireAdminToken(request, json);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const action = url.pathname.split("/").filter(Boolean).pop();

  if (request.method === "POST" && action === "handled") {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(body.phone);
    if (!phone) return json({ error: "phone krävs" }, 400);
    const saved = await markHandled(phone, { note: body.note, by: "Kommunikationssidan" });
    return json({ ok: true, handled: saved });
  }
  if (request.method === "POST" && action === "approve") {
    const body = await request.json().catch(() => ({}));
    const result = await approvePendingSms(String(body.id || ""), postSms, { by: "Kommunikationssidan" });
    return json({ ok: result.status === "sent", result }, result.status === "not_found" ? 404 : 200);
  }
  if (request.method === "POST" && action === "approve-all") {
    const body = await request.json().catch(() => ({}));
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 200);
    const results = [];
    for (const id of ids) results.push({ id, ...(await approvePendingSms(id, postSms, { by: "Kommunikationssidan" })) });
    return json({ ok: true, sent: results.filter((r) => r.status === "sent").length, results });
  }
  if (request.method === "POST" && action === "reject") {
    const body = await request.json().catch(() => ({}));
    const result = await rejectPendingSms(String(body.id || ""), { by: "Kommunikationssidan" });
    return json({ ok: result.status === "rejected", result }, result.status === "not_found" ? 404 : 200);
  }
  if (request.method === "POST" && action === "sms-approval") {
    const body = await request.json().catch(() => ({}));
    return json({ ok: true, smsApproval: await setSmsApproval(body.enabled === true, "Kommunikationssidan") });
  }
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 90);
  const now = Date.now();
  const sinceMs = now - days * 864e5;

  const [calls, sms, balance, smsLog, handled, cases, novaCalls, novaMeetings, outbound, smsInbound, ringList, followups, pending, smsApproval] = await Promise.all([
    fetchElksHistory("calls", sinceMs),
    fetchElksHistory("sms", sinceMs),
    fetchElksBalance(),
    readSmsLog(sinceMs),
    readHandled(),
    readAll("workshop-cases"),
    readAll("voice-agent-calls"),
    readAll("voice-agent-meetings"),
    readAll("nova-outbound"),
    readAll("sms-inbound"),
    readAll("ring-list"),
    readAll("call-followups"),
    readPendingSms(),
    readSmsApproval(),
  ]);
  const queue = outbound.filter((x) => x.key !== "_config");
  const own = ownNumbers();
  const staff = { workshop: normalizePhone(env("VOICE_WORKSHOP_PHONE")), sebastian: normalizePhone(env("VOICE_SEBASTIAN_PHONE") || env("VOICE_PRIMARY_NUMBER") || "+46700243319") };

  const events = buildEvents(
    { elksCalls: calls.rows, elksSms: sms.rows, smsLog, cases, followups, novaCalls, novaMeetings, outboundEntries: queue, smsInbound, ringList },
    {
      ownNumbers: own, staff, labels: SMS_SOURCES, sinceMs, infoSmsText: INFO_SMS,
      meetingSmsText: (m) => { try { return meetingSmsToCustomer({ ...m, topic: String(m.topic || "") }); } catch { return ""; } },
    },
  );
  const contacts = buildContacts(events, { cases, handled, now });
  const overview = buildOverview({ events, contacts, now, days });
  const cfg = outbound.find((x) => x.key === "_config") || {};

  const labelFor = (src) => SMS_SOURCES[src] || (String(src).startsWith("campaign:") ? `Kampanj (${String(src).slice(9)})` : src);
  return json({
    ...overview,
    smsApproval,
    pending: pending.map((x) => ({ ...x, sourceLabel: labelFor(x.source) })),
    novaStats: buildNovaStats({ calls: novaCalls, entries: queue, now, ownNumbers: ownNovaNumbers(env) }),
    novaOutbound: { enabled: Boolean(cfg.enabled), queued: queue.filter((x) => x.status === "queued").length },
    balanceSek: balance,
    sources: {
      elksCalls: calls.error || "ok", elksSms: sms.error || "ok",
      smsLogSince: smsLog.length ? smsLog.map((l) => l.at).sort()[0] : null,
    },
  });
};

export const config = { path: ["/api/kommunikation", "/api/kommunikation/:action"] };
