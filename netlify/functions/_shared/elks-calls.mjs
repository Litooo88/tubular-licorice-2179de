// Läsning av 46elks samtalshistorik med korrekt paginering (delad modul).
//
// Samma mönster som call-dashboard.fetchCalls (som lämnas orörd): 46elks ger
// max 100 samtal per sida, nyast först, och `next` är en tidsstämpel-cursor
// som skickas som ?start= – inte en URL. Vi paginerar tills fönstret är
// täckt eller sidtaket nås. Klassificeringen (vem svarade) återanvänder
// comm-overview.callAnsweredBy.

import { callAnsweredBy } from "./comm-overview.mjs";
import { normalizePhone } from "./sms.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

export const MAX_PAGES = 30;

// Hämtar samtal från 46elks mellan sinceMs och untilMs. { ok, calls, pages, truncated } – kastar aldrig.
export const fetchElksCalls = async ({ sinceMs, untilMs = Date.now(), maxPages = MAX_PAGES, fetchImpl = fetch } = {}) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  if (!username || !password) return { ok: false, status: "not_configured", calls: [], pages: 0, truncated: false };
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const calls = [];
  let url = "https://api.46elks.com/a1/calls?limit=100";
  let pages = 0;
  let truncated = false;
  try {
    while (url && pages < maxPages) {
      const response = await fetchImpl(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(12000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, status: "failed", error: clean(body.error || response.statusText, 180), calls, pages, truncated };
      pages += 1;
      const batch = Array.isArray(body.data) ? body.data : [];
      calls.push(...batch);
      const oldest = batch.length ? new Date(batch[batch.length - 1].created || batch[batch.length - 1].start || 0).getTime() : 0;
      if (!batch.length || (Number.isFinite(oldest) && oldest > 0 && oldest < sinceMs)) { url = ""; break; }
      url = body.next ? `https://api.46elks.com/a1/calls?limit=100&start=${encodeURIComponent(body.next)}` : "";
    }
    truncated = Boolean(url);
  } catch (error) {
    return { ok: false, status: "failed", error: clean(error?.message, 180), calls, pages, truncated };
  }
  const within = calls.filter((call) => {
    const created = new Date(call.created || call.start || 0).getTime();
    return Number.isFinite(created) && created >= sinceMs && created <= untilMs;
  });
  return { ok: true, status: "ok", calls: within, pages, truncated };
};

// Normaliserad samtalsrad för AI-svar. `staff` = { sebastian, workshop } (E.164).
export const callRow = (call, staff = {}) => {
  const answered = callAnsweredBy(call, staff);
  const createdAt = clean(call.created || call.start, 40);
  return {
    id: clean(call.id, 80),
    at: createdAt ? new Date(createdAt.endsWith("Z") || /[+-]\d\d:\d\d$/.test(createdAt) ? createdAt : `${createdAt}Z`).toISOString() : "",
    direction: String(call.direction || "").startsWith("out") ? "outgoing" : "incoming",
    from: normalizePhone(call.from) || clean(call.from, 40),
    to: normalizePhone(call.to) || clean(call.to, 40),
    durationSec: Number(call.duration) || 0,
    outcome: answered.key,          // missed | answered | sebastian | workshop | nova | voicemail | noanswer
    outcomeLabel: answered.label,
    hasRecording: Array.isArray(call.recordings) && call.recordings.length > 0,
    legs: (Array.isArray(call.legs) ? call.legs : []).map((l) => ({ to: normalizePhone(l?.to) || clean(l?.to, 60), state: clean(l?.state, 20), durationSec: Number(l?.duration) || 0 })),
  };
};

export const summarizeCalls = (rows) => {
  const summary = { total: rows.length, incoming: 0, outgoing: 0, answered: 0, missed: 0, voicemail: 0, nova: 0, byDay: {} };
  for (const row of rows) {
    summary[row.direction] += 1;
    if (["missed", "noanswer"].includes(row.outcome)) summary.missed += 1;
    else if (row.outcome === "voicemail") summary.voicemail += 1;
    else if (row.outcome === "nova") { summary.nova += 1; summary.answered += 1; }
    else summary.answered += 1;
    const day = row.at.slice(0, 10);
    if (day) summary.byDay[day] = (summary.byDay[day] || 0) + 1;
  }
  return summary;
};
