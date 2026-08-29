import { getStore } from "@netlify/blobs";
import { normalizePhone, postSms } from "./_shared/sms.mjs";
import { isQuietHour } from "./_shared/quiet-hours.mjs";
import { INFO_SMS, INFO_SMS_COOLDOWN_MS } from "./ring-list.mjs";

// Schemalagd väktare: "ingen varm kund missas två gånger".
//
// Var 10:e minut: hämta senaste inkommande samtal från 46elks. Ett samtal från
// ett VARMT nummer (finns i ring-list- eller campaign-sent-storen) som inte
// besvarades =>
//   1. numret väcks till status "new" i ringlistan (försök++, tidsstämpel),
//   2. kunden får info-SMS:et om återuppringningslistan (max 1/nummer/7 dgr,
//      aldrig till optout, aldrig under tysta timmar, max 5 per körning),
//   3. Sebastian larmas med SMS (max 1 larm/nummer/6 tim).
//
// Kalla nummer rörs inte — de fångas av det befintliga lost lead-flödet.

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const OUR_NUMBER = () => normalizePhone(env("ELKS_NUMBER") || "+46101385498");
const WINDOW_MS = 25 * 60 * 1000; // överlappar körintervallet med marginal
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_INFO_SMS_PER_RUN = 5;

export default async () => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  if (!username || !password) return new Response("not_configured");

  const response = await fetch("https://api.46elks.com/a1/calls?limit=100", {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response?.ok) return new Response("calls_failed", { status: 502 });
  const body = await response.json().catch(() => ({}));

  const cutoff = Date.now() - WINDOW_MS;
  const missed = (Array.isArray(body.data) ? body.data : []).filter((call) => {
    if (call.direction !== "incoming" || normalizePhone(call.to) !== OUR_NUMBER()) return false;
    const created = new Date(call.created + (String(call.created).endsWith("Z") ? "" : "Z")).getTime();
    if (!Number.isFinite(created) || created < cutoff) return false;
    return !(Array.isArray(call.legs) ? call.legs : []).some((leg) => leg.state === "success");
  });
  if (!missed.length) return new Response("no_missed");

  const list = getStore({ name: "ring-list", consistency: "strong" });
  const campaign = getStore({ name: "campaign-sent", consistency: "strong" });
  const optout = getStore({ name: "sms-optout", consistency: "strong" });
  const quiet = isQuietHour();
  const alertTo = normalizePhone(env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO"));
  let infoSent = 0;
  const handled = new Set();
  const results = [];

  for (const call of missed) {
    const phone = normalizePhone(call.from);
    if (!phone || handled.has(phone)) continue;
    handled.add(phone);

    let entry = await list.get(phone, { type: "json" }).catch(() => null);
    const warmViaCampaign = !entry && (await campaign.get(phone, { type: "json" }).catch(() => null));
    if (!entry && !warmViaCampaign) continue; // kallt nummer — inte vårt jobb

    const now = new Date().toISOString();
    entry = entry || { phone, addedAt: now, attempts: 0, log: [], reason: "Fått kampanj-SMS" };
    // Redan väckt av exakt detta samtal? (körningarna överlappar)
    if (entry.lastSeenCallId === call.id) continue;
    entry.lastSeenCallId = call.id;
    entry.status = "new";
    entry.attempts = (entry.attempts || 0) + 1;
    entry.lastCustomerCallAt = now;
    entry.log = [...(entry.log || []), { at: now, event: "Ringde utan att nå oss (auto-upptäckt)." }].slice(-30);

    // Info-SMS till kunden
    let smsStatus = "skipped";
    const blocked = await optout.get(phone, { type: "json" }).catch(() => null);
    const inCooldown = entry.infoSmsAt && Date.now() - new Date(entry.infoSmsAt).getTime() < INFO_SMS_COOLDOWN_MS;
    if (!quiet && !blocked && !inCooldown && infoSent < MAX_INFO_SMS_PER_RUN) {
      const sms = await postSms({ to: phone, message: INFO_SMS });
      smsStatus = sms.status;
      if (sms.status === "sent") {
        infoSent += 1;
        entry.infoSmsAt = now;
        entry.log = [...entry.log, { at: now, event: "Info-SMS om återuppringningslistan skickat (auto)." }].slice(-30);
      }
    }

    // Larm till Sebastian
    const alertCooldown = entry.alertAt && Date.now() - new Date(entry.alertAt).getTime() < ALERT_COOLDOWN_MS;
    if (!quiet && alertTo && !alertCooldown) {
      const who = entry.name ? `${entry.name} (${phone})` : phone;
      await postSms({
        to: alertTo,
        message: `VARM KUND ringde nyss utan svar: ${who} — försök ${entry.attempts}. Ring tillbaka snarast. Ringlistan i admin har detaljerna.`,
      });
      entry.alertAt = now;
    }

    await list.setJSON(phone, entry);
    results.push(`${phone}:${smsStatus}`);
  }

  return new Response(results.length ? results.join(",") : "no_warm");
};

export const config = {
  schedule: "*/10 * * * *",
};
