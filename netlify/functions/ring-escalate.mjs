// Schemalagd eskalering av obesvarade RING-svar.
//
// Kör oberoende av admin-trafik: felet vi larmar om ÄR att ingen tittar på
// dashboarden, så ett larm som kräver en sidladdning hade varit meningslöst.
// Detektionslogiken bor i _shared/ring-escalation.mjs och delas med
// call-dashboard.mjs så tröskeln inte glider isär mellan larm och admin-vy.
//
// Scheduled functions går inte att anropa via HTTP i produktion. Vill du se
// vad som skulle larmas: admin-dashboardens GET returnerar samma lista i
// fältet `ringUnhandled`.

import { getStore } from "@netlify/blobs";
import { postSms, smsConfigured } from "./_shared/sms.mjs";
import {
  buildAlertMessage,
  findStaleRingReplies,
  isQuietHours,
  realertAfterHours,
} from "./_shared/ring-escalation.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const STATE_STORE = "ops-warnings";
const STATE_KEY = "ring-unhandled";

export default async () => {
  const now = Date.now();

  let stale;
  try {
    stale = await findStaleRingReplies({ now });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }

  const stateStore = getStore({ name: STATE_STORE, consistency: "strong" });
  const prior = await stateStore.get(STATE_KEY, { type: "json" }).catch(() => null);

  // Inget försenat kvar: nolla staten så nästa RING-svar larmar direkt istället
  // för att fastna bakom en gammal påminnelse-throttle.
  if (!stale.length) {
    if (prior) await stateStore.delete(STATE_KEY).catch(() => {});
    return json({ ok: true, stale: 0, alerted: false, reason: "inga_forsenade" });
  }

  const priorKeys = new Set(Array.isArray(prior?.keys) ? prior.keys : []);
  const keys = stale.map((item) => item.key);
  const hasNew = keys.some((key) => !priorKeys.has(key));
  const sinceLast = prior?.at ? now - new Date(prior.at).getTime() : Infinity;
  const dueForRealert = sinceLast >= realertAfterHours() * 60 * 60 * 1000;

  if (!hasNew && !dueForRealert) {
    return json({ ok: true, stale: stale.length, alerted: false, reason: "throttlad", lastAlertAt: prior?.at || null });
  }
  // Nya poster får hellre vänta till dagtid än väcka någon nattetid.
  if (isQuietHours()) {
    return json({ ok: true, stale: stale.length, alerted: false, reason: "tysta_timmar" });
  }

  const to = env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO") || env("VOICE_NOTIFY_TO");
  if (!to || !smsConfigured()) {
    return json({ ok: true, stale: stale.length, alerted: false, reason: "not_configured" });
  }

  const result = await postSms({ to, message: buildAlertMessage(stale) });
  if (result.status !== "sent") {
    return json(
      { ok: false, stale: stale.length, alerted: false, smsStatus: result.status, error: result.error || null },
      502,
    );
  }
  await stateStore
    .setJSON(STATE_KEY, { at: new Date(now).toISOString(), keys, count: stale.length })
    .catch(() => {});

  return json({ ok: true, stale: stale.length, alerted: true, reason: hasNew ? "ny_post" : "paminnelse" });
};

export const config = {
  // Minut 7 för att inte krocka med outbox-flush/elks-webhook-sync (*/15).
  schedule: "7 * * * *",
};
