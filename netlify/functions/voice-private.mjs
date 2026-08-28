// Privatlinjen (godkänd av Sebastian 2026-08-08 "kör på"): voice_start för det
// virtuella mobilnumret (ELKS_SMS_NUMBER, +46766867131) som Sebastian ger ut
// till kunder i stället för sitt privata nummer.
//
//   1. Inom ringtider (PRIVATE_LINE_START–PRIVATE_LINE_END, Sthlm-tid,
//      default 09–20 alla dagar; PRIVATE_LINE_WEEKDAYS_ONLY=true begränsar
//      till vardagar) → SMS-notis till Sebastian med kunduppslag
//      ("Erika Axelsson — G2 Master, väntar delar" eller "okänt nummer")
//      och därefter koppling till VOICE_PRIMARY_NUMBER.
//   2. Utanför ringtider eller vid obesvarat → telefonsvarare (samma prompt
//      som växeln), inspelningen SMS:as till Sebastian med kundidentitet.
//
// VIKTIGT: privatlinjen skickar ALDRIG automatiska SMS till uppringaren —
// detta är en personlig linje, inte kampanjmotorn.

import { getStore } from "@netlify/blobs";
import { tokenMatches } from "./_shared/admin-auth.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);

const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

// Ringtider för privatlinjen — enklare schema än växelns: start-/sluttimme i
// Stockholm-tid (default 09–20), alla dagar. PRIVATE_LINE_WEEKDAYS_ONLY=true
// stänger helger (mån–fre; helgdagar hanteras inte av privatlinjen).
const isRingTime = (now = new Date()) => {
  const start = Math.min(Math.max(Number(env("PRIVATE_LINE_START")) || 9, 0), 23);
  const end = Math.min(Math.max(Number(env("PRIVATE_LINE_END")) || 20, 1), 24);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekday = get("weekday").toLowerCase();
  if (env("PRIVATE_LINE_WEEKDAYS_ONLY") === "true" && (weekday === "lör" || weekday === "sön")) {
    return false;
  }
  const hour = Number(get("hour"));
  return hour >= start && hour < end;
};

// Kunduppslag: matcha uppringarens nummer mot workshop-cases. Fail-open med
// hård tidsbudget — hellre "okänt nummer" i notisen än ett hängande samtal.
const STATUS_LABELS = {
  new: "nytt ärende",
  in_progress: "pågående",
  waiting_parts: "väntar delar",
  waiting_customer: "väntar kund",
  ready: "klar att hämta",
  done: "avslutat",
  archived: "arkiverat",
};

const lookupCustomer = async (caller) => {
  const normalized = normalizePhone(caller);
  if (!normalized) return null;
  const work = (async () => {
    const store = getStore({ name: "workshop-cases", consistency: "strong" });
    const { blobs } = await store.list();
    const items = await Promise.all(
      (blobs || []).map((blob) => store.get(blob.key, { type: "json" }).catch(() => null)),
    );
    const matches = items.filter(
      (item) => item && normalizePhone(item.customer?.phone || item.phone) === normalized,
    );
    if (!matches.length) return null;
    // Senast uppdaterade ärendet vinner — det är det kunden ringer om.
    matches.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const top = matches[0];
    return {
      name: clean(top.customer?.name || top.name, 60) || "namnlös kund",
      model: clean(top.vehicle?.model, 60),
      status: STATUS_LABELS[clean(top.status, 30)] || clean(top.status, 30),
    };
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  return Promise.race([work, timeout]).catch(() => null);
};

const callerLabel = (caller, customer) => {
  if (!customer) return `${caller} (okänt nummer, inget kundkort)`;
  const detail = [customer.model, customer.status].filter(Boolean).join(", ");
  return `${customer.name}${detail ? ` — ${detail}` : ""} (${caller})`;
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

const authorize = (request) => {
  const secret = clean(env("VOICE_WEBHOOK_SECRET"), 240);
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
  const url = new URL("/.netlify/functions/voice-private", origin);
  if (step) url.searchParams.set("step", step);
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

const stockholmTime = () =>
  new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });

export default async (request) => {
  const auth = authorize(request);
  if (!auth.ok) return json({ error: "Unauthorized" }, 401);

  const origin = new URL(request.url).origin;
  const step = clean(new URL(request.url).searchParams.get("step"), 40);
  const timeout = Math.min(Math.max(Number(env("VOICE_TIMEOUT_SECONDS")) || 25, 10), 60);
  const siteUrl = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
  const voicemailPrompt = clean(env("VOICE_VOICEMAIL_MP3_URL"), 400) || `${siteUrl}/audio/voicemail-prompt.mp3`;
  const notifyTo = clean(env("VOICE_NOTIFY_TO") || env("VOICE_MISSED_SMS_TO"), 40);
  const testNow = clean(env("VOICE_TEST_NOW"), 60);
  const now = testNow ? new Date(testNow) : new Date();

  // Obesvarat eller utanför ringtid → telefonsvarare.
  if (step === "voicemail") {
    return json({ play: voicemailPrompt, next: selfUrl(origin, auth, "record") });
  }

  if (step === "record") {
    return json({ record: selfUrl(origin, auth, "saved"), timelimit: 90, silencedetection: "no" });
  }

  if (step === "saved") {
    const payload = await parseForm(request);
    const caller = normalizePhone(payload.from) || "okänt nummer";
    const wav = clean(payload.wav, 400);
    const customer = caller.startsWith("+") ? await lookupCustomer(caller) : null;
    await postSms({
      to: notifyTo,
      message: `[Privatlinjen] ${stockholmTime()} Röstmeddelande från ${callerLabel(caller, customer)}.\nLyssna: ${wav || "inspelning saknas"}\n(kräver 46elks-inloggning)`,
    });
    return json({});
  }

  // Inkommande samtal.
  const payload = await parseForm(request);
  const caller = normalizePhone(payload.from);

  if (!isRingTime(now)) {
    if (caller && notifyTo) {
      const customer = await lookupCustomer(caller);
      await postSms({
        to: notifyTo,
        message: `[Privatlinjen] ${stockholmTime()} Samtal utanför ringtid från ${callerLabel(caller, customer)} — kopplas till telefonsvararen.`,
      });
    }
    return json({ play: voicemailPrompt, next: selfUrl(origin, auth, "record") });
  }

  const target = clean(env("VOICE_PRIMARY_NUMBER"), 40);
  if (!target) return json({ play: voicemailPrompt, next: selfUrl(origin, auth, "record") });

  // Kunduppslags-SMS:et skickas före connect så notisen hinner fram medan
  // luren ringer — fail-open med tidsbudget så samtalet aldrig fördröjs länge.
  if (caller && notifyTo) {
    const customer = await lookupCustomer(caller);
    await postSms({
      to: notifyTo,
      message: `[Privatlinjen] ${stockholmTime()} Inkommande: ${callerLabel(caller, customer)}`,
    });
  }

  return json({ connect: target, timeout, next: selfUrl(origin, auth, "voicemail") });
};
