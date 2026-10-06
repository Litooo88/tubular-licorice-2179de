// Inkommande SMS-webhook för 46elks (sms_url på 010-numret).
// RING → callback-kö + direkt-SMS till Sebastian + autosvar till kunden.
// STOPP → optout-store (respekteras av kampanjmotorn) + bekräftelse.
// Övrigt → loggas i svars-inkorgen + notis till Sebastian, inget autosvar.
// 46elks skickar svaret i response-body som SMS-reply till kunden.
import { getStore } from "@netlify/blobs";
import { tokenMatches } from "./_shared/admin-auth.mjs";
import { parseApprovalReply } from "./_shared/customer-contact.mjs";
import { isBlockedCaller } from "./_shared/call-blocklist.mjs";

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

// ELKS_SMS_NUMBER = det virtuella SMS-kapabla mobilnumret (010-numret är
// Fixed/Voice-only och kan aldrig ta emot SMS). Faller tillbaka på
// ELKS_NUMBER för bakåtkompatibilitet tills env-varn är satt.
const OUR_NUMBER = () => normalizePhone(env("ELKS_SMS_NUMBER") || env("ELKS_NUMBER") || "+46101385498");

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

// Vara egna nummer. Ett SMS fran dem ar inte ett kundsvar utan ett
// godkannande av ett utkast ("1 ok"), och ska aldrig hamna i svars-inkorgen.
const staffNumbers = () => {
  const set = new Set();
  for (const key of ["SEBASTIAN_SMS_TO", "WORKSHOP_SMS_TO", "VOICE_PRIMARY_NUMBER", "VOICE_SEBASTIAN_PHONE"]) {
    const nummer = normalizePhone(env(key));
    if (nummer) set.add(nummer);
  }
  return set;
};

// Godkannandet gar via den BEFINTLIGA approve-rutten i sms-draft-inbox, som
// redan kontrollerar optout, skickar, loggar pa arendet och tar bort utkastet.
// Att anropa den over HTTP kostar en extra rundtur men duplicerar ingen logik -
// och det ar en manniska som vantar, inte en loop.
const kallaApprove = async (draftId, action, message) => {
  const bas = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
  const token = env("ADMIN_TOKEN");
  if (!token) return { ok: false, fel: "ADMIN_TOKEN saknas" };
  try {
    const response = await fetch(`${bas}/api/sms-drafts/${encodeURIComponent(draftId)}/${action}`, {
      method: "POST",
      headers: { "x-admin-token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ operatorName: "Sebastian via SMS", ...(message ? { message } : {}) }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, fel: clean(data.error || `HTTP ${response.status}`, 120) };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, fel: clean(error?.message, 120) };
  }
};

const hanteraGodkannande = async (kommando) => {
  const state = getStore({ name: "contact-queue", consistency: "strong" });
  const kon = await state.get("current", { type: "json" }).catch(() => null);
  const items = Array.isArray(kon?.items) ? kon.items : [];
  if (!items.length) return "Ingen ko just nu - inga utkast vantar.";

  const valda = kommando.all ? items : items.filter((i) => Number(i.nr) === Number(kommando.index));
  if (!valda.length) return `Hittade inget utkast med nummer ${kommando.index}. Kon har ${items.length} rader.`;

  const resultat = [];
  for (const rad of valda) {
    if (kommando.kind === "nej") {
      const svar = await kallaApprove(rad.draftId, "skip");
      resultat.push(`${rad.nr} ${svar.ok ? "kastat" : `FEL: ${svar.fel}`}`);
      continue;
    }
    const svar = await kallaApprove(rad.draftId, "approve", kommando.kind === "andra" ? kommando.text : undefined);
    resultat.push(`${rad.nr} ${rad.namn || rad.telefon || ""} ${svar.ok ? "skickat" : `FEL: ${svar.fel}`}`.trim());
  }
  // Ta bort hanterade rader ur kon sa att samma nummer inte kan skickas tva ganger.
  const kvar = items.filter((i) => !valda.some((v) => v.nr === i.nr));
  await state.setJSON("current", { ...(kon || {}), items: kvar, uppdaterad: new Date().toISOString() }).catch(() => {});
  return clean(resultat.join(", "), 300) + (kvar.length ? ` | ${kvar.length} kvar` : " | kon tom");
};

const reply = (text) =>
  new Response(text || "", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export default async (request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Delad hemlighet i webhookens URL (?secret=...), fail-closed.
  //
  // Tidigare validerades hemligheten BARA om env-variabeln råkade vara satt —
  // och den var inte satt i produktion (kontrollerat 2026-09-07). Endpointen
  // tog alltså emot vad som helst från vem som helst. Avsändare, mottagare och
  // riktning i bodyn är inget äkthetsbevis: de skrivs av den som gör anropet.
  // Konsekvensen var påhittade kundsvar i inkorgen och — värre — att någon
  // kunde registrera en optout som tyst stänger av SMS till ett riktigt
  // kundnummer.
  //
  // 46elks sms_url bär hemligheten (sätts av elks-webhook-sync och av
  // nummerkonfigurationen i call-dashboard), så ett äkta inkommande SMS har
  // den alltid med sig. Saknas env-variabeln avvisar vi hellre trafiken än tar
  // emot overifierade meddelanden — samma hållning som voice-webhookarna.
  const secret = clean(env("SMS_INBOUND_SECRET"), 240);
  if (!secret) {
    console.error("sms-inbound: SMS_INBOUND_SECRET saknas - avvisar inkommande SMS i stallet for overifierad trafik.");
    return new Response("Not configured", { status: 503 });
  }
  const provided = clean(new URL(request.url).searchParams.get("secret"), 240);
  if (!tokenMatches(secret, provided)) return new Response("Forbidden", { status: 403 });

  const bodyText = await request.text();
  const params = new URLSearchParams(bodyText);
  const from = normalizePhone(params.get("from"));
  const to = normalizePhone(params.get("to"));
  const message = clean(params.get("message"), 900);
  const direction = clean(params.get("direction"), 40) || "incoming";

  if (!from || to !== OUR_NUMBER() || direction !== "incoming") return reply("");

  // Spärrade nummer: meddelandet tas inte emot, inget autosvar skickas.
  if (await isBlockedCaller(from)) {
    console.log("sms_inbound_blocked_sender", {});
    return reply("");
  }

  // Sebastians godkannanden gar fore all kundlogik: "1 ok", "alla ok",
  // "2 nej", "1 andra: ny text". Ett sadant SMS ar inget kundsvar.
  if (staffNumbers().has(from)) {
    const kommando = parseApprovalReply(message);
    if (kommando) {
      const svar = await hanteraGodkannande(kommando);
      console.log("sms_inbound_approval", { kind: kommando.kind, all: Boolean(kommando.all) });
      return reply(svar);
    }
  }

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
