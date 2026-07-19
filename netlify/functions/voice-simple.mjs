// eLks voice routing:
//   1. Utanför öppettider → spela outside-hours-prompt.mp3 (gamla televäxelns
//      besked) och avsluta.
//   2. Öppettider → koppla Sebastian (VOICE_PRIMARY_NUMBER). Om obesvarat →
//      ?step=fallback → koppla VOICE_FALLBACK_NUMBER om satt (t.ex. Sara),
//      annars avslutas samtalet (voice-notify skickar missat-samtal-SMS via
//      whenhangup när VOICE_WEBHOOK_SECRET är konfigurerad).

import { tokenMatches } from "./_shared/admin-auth.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);
const EMERGENCY_PRIMARY_NUMBER = "+46700243319";

// Telefontider: mån–fre 09–18 svensk tid, stängt helger och svenska helgdagar
// (samma schema som gamla televäxeln i nemob-callflow/src/officeHours.ts).
// Uppdatera helgdagslistan i december varje år.
const SWEDISH_PUBLIC_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-06", "2026-04-03", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-14", "2026-05-24", "2026-06-06", "2026-06-19",
  "2026-06-20", "2026-10-31", "2026-12-24", "2026-12-25", "2026-12-26",
  "2026-12-31",
  // 2027
  "2027-01-01", "2027-01-06", "2027-03-26", "2027-03-28", "2027-03-29",
  "2027-05-01", "2027-05-06", "2027-05-16", "2027-06-06", "2027-06-25",
  "2027-06-26", "2027-11-06", "2027-12-24", "2027-12-25", "2027-12-26",
  "2027-12-31",
]);

export const isOfficeHours = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekday = get("weekday").toLowerCase();
  if (weekday === "lör" || weekday === "sön") return false;
  if (SWEDISH_PUBLIC_HOLIDAYS.has(`${get("year")}-${get("month")}-${get("day")}`)) return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 9 * 60 && minutes < 18 * 60;
};

const authorizeVoiceWebhook = (request) => {
  const secret = clean(env("VOICE_WEBHOOK_SECRET"), 240);
  // Keep the production call route available while the optional shared secret
  // is being rolled out in both Netlify and the 46elks number configuration.
  if (!secret) return { ok: true, configured: false };
  const url = new URL(request.url);
  const provided = clean(
    request.headers.get("x-nordic-webhook-secret") ||
      url.searchParams.get("secret") ||
      url.searchParams.get("token"),
    240,
  );
  return { ok: tokenMatches(secret, provided), configured: true, secret };
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const selfUrl = (origin, auth, step) => {
  const url = new URL("/.netlify/functions/voice-simple", origin);
  if (step) url.searchParams.set("step", step);
  if (auth.configured) url.searchParams.set("secret", auth.secret);
  return url.toString();
};

const callbackUrl = (origin, auth) => {
  const url = new URL("/.netlify/functions/voice-notify", origin);
  if (auth.configured) url.searchParams.set("secret", auth.secret);
  return url.toString();
};

const parseForm = async (request) => {
  try {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return {};
  }
};

const postSms = async ({ to, message }) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = (env("SMS_FROM") || "NordicEMob").slice(0, 11);
  if (!to || !username || !password) return { status: "not_configured" };
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
    return { status: response.ok ? "sent" : "failed" };
  } catch {
    return { status: "failed" };
  }
};

export default async (request) => {
  const auth = authorizeVoiceWebhook(request);
  if (!auth.ok) return json(auth.body || { error: "Unauthorized" }, auth.status || 401);

  const origin = new URL(request.url).origin;
  const step = clean(new URL(request.url).searchParams.get("step"), 40);
  // 46elks tillåter 10-60 sekunder för connect-timeout.
  const timeout = Math.min(Math.max(Number(env("VOICE_TIMEOUT_SECONDS")) || 25, 10), 60);
  const siteUrl = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
  const closedPrompt = clean(env("VOICE_CLOSED_MP3_URL"), 400) || `${siteUrl}/audio/outside-hours-prompt.mp3`;
  const voicemailPrompt = clean(env("VOICE_VOICEMAIL_MP3_URL"), 400) || `${siteUrl}/audio/voicemail-prompt.mp3`;
  const testNow = clean(env("VOICE_TEST_NOW"), 60);
  const now = testNow ? new Date(testNow) : new Date();

  if (!auth.configured) {
    console.warn("voice_simple_secret_not_configured", { route: "public_fallback" });
  }

  // Steg 2: Sebastian svarade inte → ring fallback-numret om ett är satt,
  // annars direkt till telefonsvararen.
  if (step === "fallback") {
    const fallback = clean(env("VOICE_FALLBACK_NUMBER"), 40);
    if (!fallback) return json({ play: voicemailPrompt, next: selfUrl(origin, auth, "record") });
    const action = { connect: fallback, timeout, next: selfUrl(origin, auth, "voicemail") };
    if (auth.configured) action.whenhangup = callbackUrl(origin, auth);
    return json(action);
  }

  // Steg 3: inte heller fallback-numret svarade → telefonsvararens prompt.
  if (step === "voicemail") {
    return json({ play: voicemailPrompt, next: selfUrl(origin, auth, "record") });
  }

  // Steg 4: spela in meddelandet (max 90 s, samma gräns som gamla växeln).
  if (step === "record") {
    return json({ record: selfUrl(origin, auth, "saved"), timelimit: 90, silencedetection: "no" });
  }

  // Steg 5: inspelningen klar → SMS till Sebastian med länk till ljudfilen.
  if (step === "saved") {
    const payload = await parseForm(request);
    const caller = clean(payload.from, 40) || "okänt nummer";
    const wav = clean(payload.wav, 400);
    const notifyTo = clean(env("VOICE_NOTIFY_TO") || env("VOICE_MISSED_SMS_TO"), 40);
    const time = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
    await postSms({
      to: notifyTo,
      message: `[Nordic] ${time} Röstmeddelande från ${caller}.\nLyssna: ${wav || "inspelning saknas"}\n(kräver 46elks-inloggning)`,
    });
    return json({});
  }

  // Utanför telefontid → gamla televäxelns besked, sedan telefonsvararen.
  if (!isOfficeHours(now)) {
    return json({ play: closedPrompt, next: selfUrl(origin, auth, "record") });
  }

  const sebastian = clean(
    env("VOICE_PRIMARY_NUMBER") || env("VOICE_SEBASTIAN_PHONE") || EMERGENCY_PRIMARY_NUMBER,
    40,
  );
  if (!sebastian) {
    return json({ hangup: "reject", reason: "voice_primary_not_configured" });
  }

  const action = {
    connect: sebastian,
    timeout,
    next: selfUrl(origin, auth, "fallback"),
  };
  if (auth.configured) action.whenhangup = callbackUrl(origin, auth);

  return json(action);
};
