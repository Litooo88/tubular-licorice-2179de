// 46elks whenhangup callback - sends an internal missed/answered call SMS when
// configured, plus an automatic "vi såg att du ringde"-SMS to missed callers
// (throttled per number, optout-aware, only during decent hours).

import { getStore } from "@netlify/blobs";
import { tokenMatches } from "./_shared/admin-auth.mjs";
import { isBlockedCaller } from "./_shared/call-blocklist.mjs";
import { findCustomerMatch } from "./_shared/voicemail-analysis.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);

const authorizeVoiceWebhook = (request) => {
  const secret = clean(env("VOICE_WEBHOOK_SECRET"), 240);
  if (!secret) {
    return {
      ok: false,
      configured: false,
      status: 503,
      body: { error: "VOICE_WEBHOOK_SECRET saknas i Netlify.", code: "VOICE_WEBHOOK_SECRET_MISSING" },
    };
  }
  const url = new URL(request.url);
  const provided = clean(
    request.headers.get("x-nordic-webhook-secret") ||
      url.searchParams.get("secret") ||
      url.searchParams.get("token"),
    240,
  );
  return { ok: tokenMatches(secret, provided), configured: true };
};

const parsePayload = async (request) => {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return request.json().catch(() => ({}));
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      return Object.fromEntries([...form.entries()].map(([key, value]) => [key, clean(value, 2000)]));
    }
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch (error) {
    console.error("voice-notify parse error", { message: clean(error.message, 240) });
    return {};
  }
};

const smsConfig = () => ({
  username: env("ELKS_USERNAME") || env("SMS_API_USERNAME"),
  password: env("ELKS_PASSWORD") || env("SMS_API_PASSWORD"),
  from: clean(env("SMS_FROM") || "NordicEM", 11),
  to: clean(env("VOICE_NOTIFY_TO") || env("VOICE_MISSED_SMS_TO"), 40),
});

const sendSms = async (to, message) => {
  const { username, password, from } = smsConfig();
  if (!username || !password || !to) return { status: "not_configured" };
  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from, to, message, dontlog: "message" }),
      signal: AbortSignal.timeout(7000),
    });
    return { status: response.ok ? "sent" : "failed", httpStatus: response.status };
  } catch (error) {
    console.error("voice-notify SMS error", { message: clean(error.message, 240) });
    return { status: "failed", error: clean(error.message, 240) };
  }
};

const sendInternalSms = (message) => sendSms(smsConfig().to, message);

const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const stockholmHour = (now = new Date()) =>
  Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(now));

// Svenska korta etiketter för ärendestatus i SMS:et. Endast GSM-7-tecken
// (åäö ingår i GSM-7; det dyra är tecken som tankstreck, se smsCost-läxan).
const CASE_STATUS_LABELS = {
  new: "nytt ärende",
  contacted: "kontaktad",
  checked_in: "inlämnad",
  diagnosing: "felsökning pågår",
  ready: "klar för upphämtning",
  waiting_customer: "väntar på kund",
  waiting_parts: "väntar på delar",
  done: "avslutat ärende",
  archived: "arkiverat ärende",
};

// Räknar samtal från numret senaste 30 dagarna i 46elks-loggen (en sida om
// 100 räcker gott för en månads volym). Fail-open: 0 vid fel.
const recentCallCount = async (caller) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  if (!username || !password || !caller) return 0;
  try {
    const response = await fetch("https://api.46elks.com/a1/calls?limit=100", {
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return 0;
    const data = await response.json();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return (data.data || []).filter(
      (call) =>
        normalizePhone(call.from) === caller &&
        Date.parse(call.created || 0) > cutoff,
    ).length;
  } catch {
    return 0;
  }
};

// Vem ringer? KUND med ärende slår ÅTERKOMMANDE som slår NYTT nummer.
const callerContextLabel = async (callerRaw) => {
  const caller = normalizePhone(callerRaw);
  if (!caller) return "";
  try {
    const match = await findCustomerMatch(caller);
    if (match?.matched) {
      const who = match.customerName || "kund utan namn";
      const what = [match.model, CASE_STATUS_LABELS[match.caseStatus] || match.caseStatus]
        .filter(Boolean)
        .join(", ");
      return `KUND: ${who}${what ? ` (${what})` : ""}`;
    }
  } catch {
    // fortsätt till samtalsräknaren
  }
  const count = await recentCallCount(caller);
  if (count > 1) return `ÅTERKOMMANDE: ${count} samtal senaste 30 d, inget ärende`;
  return "NYTT nummer";
};

// Automatiskt SMS till uppringare som inte nådde fram: max 1 per nummer och
// dygn, aldrig till optout-nummer, aldrig nattetid, aldrig till egna nummer.
const notifyMissedCaller = async (callerRaw) => {
  const caller = normalizePhone(callerRaw);
  if (!caller) return { status: "skipped", reason: "no_number" };
  const ownNumbers = new Set(
    [env("VOICE_PRIMARY_NUMBER"), env("VOICE_SEBASTIAN_PHONE"), env("VOICE_WORKSHOP_PHONE"), env("VOICE_FALLBACK_NUMBER"), env("ELKS_NUMBER") || "+46101385498"]
      .map(normalizePhone)
      .filter(Boolean),
  );
  if (ownNumbers.has(caller)) return { status: "skipped", reason: "own_number" };
  const hour = stockholmHour();
  if (hour < 8 || hour >= 21) return { status: "skipped", reason: "night" };
  try {
    const optout = await getStore({ name: "sms-optout", consistency: "strong" }).get(caller, { type: "json" }).catch(() => null);
    if (optout) return { status: "skipped", reason: "optout" };
    const throttleStore = getStore({ name: "caller-autosms", consistency: "strong" });
    const last = await throttleStore.get(caller, { type: "json" }).catch(() => null);
    if (last?.at && Date.now() - new Date(last.at).getTime() < 24 * 60 * 60 * 1000) {
      return { status: "skipped", reason: "throttled" };
    }
    const result = await sendSms(
      caller,
      "Hej! Vi såg att du ringde Nordic E-Mobility men vi kunde tyvärr inte svara just då. Boka tid direkt på https://www.nordicemobility.se/book-online så prioriteras du, eller ring igen vardagar 9-18 på 010-138 54 98. /Nordic E-Mobility",
    );
    await throttleStore.setJSON(caller, { at: new Date().toISOString(), result: result.status }).catch(() => {});
    return result;
  } catch (error) {
    console.error("voice-notify caller SMS error", { message: clean(error?.message, 240) });
    return { status: "failed" };
  }
};

export default async (request) => {
  const auth = authorizeVoiceWebhook(request);
  if (!auth.ok) {
    return new Response(JSON.stringify(auth.body || { error: "Unauthorized" }), {
      status: auth.status || 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const payload = await parsePayload(request);
  const callerNo = clean(payload.from, 80) || "okant nummer";
  // Spärrade nummer: inga interna SMS, inget "vi såg att du ringde".
  if (payload.from && (await isBlockedCaller(payload.from))) {
    console.log("voice_notify_blocked_caller", {});
    return new Response(JSON.stringify({ ok: true, blocked: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const state = clean(payload.state || payload.result, 80);
  const duration = Number(payload.duration || 0) || 0;
  const actions = typeof payload.actions === "string" ? payload.actions : JSON.stringify(payload.actions || "");
  const answered = (state === "success" && duration > 5) || actions.includes("connect");
  const time = new Date().toLocaleTimeString("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  });
  const context = await callerContextLabel(payload.from);
  const contextPart = context ? ` - ${context}` : "";
  const message = answered
    ? `[Nordic] ${time} Besvarat samtal fran ${callerNo} (${duration}s)${contextPart}`
    : `[Nordic] ${time} MISSAT samtal fran ${callerNo}${contextPart}. Ring upp eller skicka SMS.`;
  const sms = await sendInternalSms(message);
  const callerSms = answered ? { status: "skipped", reason: "answered" } : await notifyMissedCaller(payload.from);

  return new Response(JSON.stringify({ ok: true, sms, callerSms, webhookSecretConfigured: auth.configured }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
