// Central logg för ALLA utgående SMS: mottagare, exakt text, vilken funktion
// som skickade och resultatet.
//
// Varför (Sebastian 2026-10-19): "Nova kan ha ringt och smsat folk kors och
// tvärs och jag har ingen koll". Alla utskick går med dontlog=message, så
// 46elks sparar mottagaren men inte texten. Utan den här loggen går det inte
// att i efterhand se vad som faktiskt stod i ett SMS.
//
// Enda stället som läser/skriver storen "sms-log" och "comm-handled". Allt
// kastar aldrig: ett misslyckat loggskrivande får aldrig stoppa ett utskick.
// Gallras efter 12 månader (comm-log-prune.mjs).

import { getStore } from "@netlify/blobs";

const SMS_LOG = "sms-log";
const HANDLED = "comm-handled";
export const SMS_LOG_RETENTION_DAYS = 365;

const clean = (v, max = 2000) => String(v ?? "").trim().slice(0, max);
const digits = (v) => String(v || "").replace(/\D/g, "");

// Avsändande funktion -> etikett i admin. Nyckeln sparas på varje loggpost.
export const SMS_SOURCES = {
  nova: "Nova (mötesbekräftelse)",
  "nova-digest": "Nova dagligt SMS till Sebastian",
  "ring-list": "Ringlistan (manuellt)",
  "ring-list-scan": "Ringlistan (automatiskt info-SMS)",
  "ring-escalate": "Larm: obesvarade RING",
  "sms-inbound": "Autosvar på inkommande SMS",
  campaign: "Kampanj",
  "call-dashboard": "Samtalsdashboard (kampanj/uppföljning)",
  "outbox-draft": "Godkänt utkast (köat)",
  "sms-draft": "Godkänt utkast",
  "case-sms": "Manuellt SMS från ärende",
  "case-status": "Statussida",
  "workshop-cases": "Ärende (status/leverans/betalning)",
  booking: "Bokningsbekräftelse",
  "workshop-chat": "Chatt på hemsidan",
  "contact-digest": "Daglig kontaktsammanställning",
  "voice-start": "Telefoni: notis om missat samtal",
  "voice-simple": "Telefoni: röstmeddelande-notis",
  "voice-private": "Telefoni: privatlinjen",
  "voice-notify": "Telefoni: notis",
  "voicemail-digest": "Röstbrevlåda: daglig sammanställning",
  "elks-balance-guard": "Larm: lågt 46elks-saldo",
  cases: "Ärende (äldre flöde)",
};

const keyFor = (at, to) => `${at}_${digits(to).slice(-9) || "x"}_${Math.random().toString(36).slice(2, 6)}`;

// Loggar ett utskick. result = svaret från avsändarfunktionen ({status, id, error, to}).
export const logSms = async ({ source, to, message, from = "", result = {} } = {}) => {
  try {
    const status = clean(result?.status, 40) || "unknown";
    // Ingen 46elks-kontakt = inget utskick att logga (saknat nummer, ej konfigurerat).
    if (["invalid_phone", "missing_message", "not_configured", "dry_run_no_credentials"].includes(status)) return null;
    const at = clean(result?.sentAt, 40) || new Date().toISOString();
    const entry = {
      at,
      to: clean(result?.to || to, 30),
      from: clean(from, 30),
      message: clean(message, 2000),
      source: clean(source, 40) || "okand",
      status,
      providerId: clean(result?.id || result?.providerId, 120),
      error: clean(result?.error, 200),
    };
    await getStore({ name: SMS_LOG, consistency: "strong" }).setJSON(keyFor(at, entry.to), entry);
    return entry;
  } catch {
    return null;
  }
};

// Omsluter en avsändarfunktion med signaturen ({ to, message, from }) => result
// så att varje utskick loggas. Själva utskicket ändras inte.
export const loggedSms = (source, send) => async (args = {}) => {
  const result = await send(args);
  await logSms({ source, to: args.to, message: args.message, from: args.from, result });
  return result;
};

const monthPrefixes = (sinceMs, now = Date.now()) => {
  const out = [];
  const d = new Date(sinceMs);
  d.setUTCDate(1);
  while (d.getTime() <= now) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
};

const listKeys = async (store, prefix) => {
  const keys = [];
  let cursor;
  do {
    const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) }).catch(() => ({ blobs: [] }));
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  return keys;
};

// Alla loggade SMS sedan sinceMs. Nycklarna börjar med ISO-tid, så bara de
// månader som behövs listas.
export const readSmsLog = async (sinceMs) => {
  try {
    const store = getStore({ name: SMS_LOG, consistency: "strong" });
    const keys = (await Promise.all(monthPrefixes(sinceMs).map((p) => listKeys(store, p)))).flat()
      .filter((k) => k.slice(0, 24) >= new Date(sinceMs).toISOString().slice(0, 24));
    const items = await Promise.all(keys.map((k) => store.get(k, { type: "json" }).catch(() => null)));
    return items.filter(Boolean);
  } catch {
    return [];
  }
};

export const pruneSmsLog = async (now = Date.now()) => {
  const store = getStore({ name: SMS_LOG, consistency: "strong" });
  const cutoff = new Date(now - SMS_LOG_RETENTION_DAYS * 86400000).toISOString();
  const keys = (await listKeys(store, "")).filter((k) => k < cutoff);
  for (const k of keys) await store.delete(k).catch(() => {});
  return keys.length;
};

// "Hanterad" per telefonnummer: när Sebastian sist gick igenom kontakten.
// Allt som kommer in efter det räknas som nytt igen.
export const readHandled = async () => {
  try {
    const store = getStore({ name: HANDLED, consistency: "strong" });
    const keys = await listKeys(store, "");
    const items = await Promise.all(keys.map(async (k) => [k, await store.get(k, { type: "json" }).catch(() => null)]));
    return Object.fromEntries(items.filter(([, v]) => v));
  } catch {
    return {};
  }
};

export const markHandled = async (phone, { note = "", by = "admin" } = {}) => {
  const key = digits(phone);
  if (!key) return null;
  const value = { phone: clean(phone, 30), at: new Date().toISOString(), note: clean(note, 300), by: clean(by, 60) };
  await getStore({ name: HANDLED, consistency: "strong" }).setJSON(key, value);
  return value;
};
