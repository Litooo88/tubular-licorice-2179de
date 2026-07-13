// Inkommande SMS-webhook för 46elks (sms_url på 010-numret).
// RING → callback-kö + direkt-SMS till Sebastian + autosvar till kunden.
// STOPP → optout-store (respekteras av kampanjmotorn) + bekräftelse.
// Övrigt → loggas i svars-inkorgen + notis till Sebastian, inget autosvar.
// 46elks skickar svaret i response-body som SMS-reply till kunden.
import { getStore } from "@netlify/blobs";
import { tokenMatches } from "./_shared/admin-auth.mjs";

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);
const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const OUR_NUMBER = () => normalizePhone(env("ELKS_NUMBER") || "+46101385498");

const postSms = async ({ to, message }) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = (env("SMS_FROM") || "NordicEMob").slice(0, 11);
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo || !username || !password) return { status: "not_configured" };
  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from, to: normalizedTo, message, dontlog: "message" }),
      signal: AbortSignal.timeout(8000),
    });
    return { status: response.ok ? "sent" : "failed" };
  } catch {
    return { status: "failed" };
  }
};

// Notis-spärr per avsändarnummer så ett SMS-flöde inte spammar Sebastian.
const notifyLog = new Map();
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;
const shouldNotify = (phone) => {
  const last = notifyLog.get(phone) || 0;
  if (Date.now() - last < NOTIFY_COOLDOWN_MS) return false;
  notifyLog.set(phone, Date.now());
  if (notifyLog.size > 500) notifyLog.clear();
  return true;
};

const reply = (text) =>
  new Response(text || "", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export default async (request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Valfri delad hemlighet i webhookens URL (?secret=...). Sätts när
  // sms_url konfigureras. Saknas env-variabeln är webhooken öppen men
  // validerar fortfarande mottagarnummer + riktning nedan.
  const secret = clean(env("SMS_INBOUND_SECRET"), 240);
  if (secret) {
    const provided = clean(new URL(request.url).searchParams.get("secret"), 240);
    if (!tokenMatches(secret, provided)) return new Response("Forbidden", { status: 403 });
  }

  const bodyText = await request.text();
  const params = new URLSearchParams(bodyText);
  const from = normalizePhone(params.get("from"));
  const to = normalizePhone(params.get("to"));
  const message = clean(params.get("message"), 900);
  const direction = clean(params.get("direction"), 40) || "incoming";

  if (!from || to !== OUR_NUMBER() || direction !== "incoming") return reply("");

  const now = new Date().toISOString();
  const normalized = message.toLowerCase().replace(/[^a-zåäö0-9]/g, "");
  const isStop = /^(stopp|stop)$/.test(normalized);
  const isRing = /^ring/.test(normalized) || normalized === "1";
  const type = isStop ? "stopp" : isRing ? "ring" : "other";

  if (isStop) {
    await getStore({ name: "sms-optout", consistency: "strong" })
      .setJSON(from, { phone: from, at: now, message })
      .catch(() => {});
  }

  await getStore({ name: "sms-inbound", consistency: "strong" })
    .setJSON(`${now}_${from.replace(/\D/g, "")}`, { phone: from, message, at: now, type, handled: isStop })
    .catch(() => {});

  const sebastianTo = env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO");
  if (!isStop && sebastianTo && shouldNotify(from)) {
    const label = isRing ? "RING-svar (vill bli uppringd inom 24h)" : "SMS-svar";
    await postSms({ to: sebastianTo, message: `${label} från ${from}: "${message.slice(0, 120)}"\nSvars-inkorgen i admin har hela listan.` });
  }

  if (isStop) return reply("Du är nu avregistrerad från utskick från Nordic E-Mobility.");
  if (isRing) return reply("Tack! Vi ringer upp dig inom 24 timmar. /Nordic E-Mobility");
  return reply("");
};

export const config = {
  path: "/api/sms-inbound",
};
