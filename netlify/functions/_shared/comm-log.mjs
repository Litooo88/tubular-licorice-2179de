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
import { normalizePhone } from "./sms.mjs";

const SMS_LOG = "sms-log";
const HANDLED = "comm-handled";
const PENDING = "sms-pending";
const CONFIG = "comm-config";
const env = (n) => { try { return globalThis.Netlify?.env?.get?.(n) || process.env[n] || ""; } catch { return process.env[n] || ""; } };
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

// ---------------------------------------------------------------------------
// Godkännandespärr (Sebastian 2026-10-23: "jag vill inte att sms går ut innan
// jag godkänt dem"). Alla SMS till kunder läggs i kön sms-pending och skickas
// först när Sebastian godkänner på /admin/kommunikation/. Går direkt:
//   - utskick med approved: true (han tryckte själv på knappen i admin),
//   - SMS till personalens egna nummer (larm och notiser till honom).
// Spärren är PÅ om inget annat sparats (comm-config/sms-approval).
// ---------------------------------------------------------------------------

const STAFF_ENV = ["SEBASTIAN_SMS_TO", "WORKSHOP_SMS_TO", "VOICE_NOTIFY_TO", "VOICE_MISSED_SMS_TO", "VOICE_PRIMARY_NUMBER", "VOICE_SEBASTIAN_PHONE", "VOICE_WORKSHOP_PHONE", "VOICE_FALLBACK_NUMBER", "ELKS_SMS_NUMBER", "ELKS_NUMBER", "PRIVATE_LINE_NUMBER"];
// Sebastians mobil och växeln hårdkodade som fallback: en spärr som släpper
// igenom kund-SMS för att en env-variabel saknas är ingen spärr åt andra hållet
// heller – men ett larm till Sebastian får aldrig fastna i kön.
const STAFF_FALLBACK = ["+46700243319", "+46101385498"];
export const staffNumbers = () => {
  const set = new Set(STAFF_FALLBACK);
  for (const key of STAFF_ENV) for (const part of String(env(key) || "").split(/[,;\s]+/)) { const n = normalizePhone(part); if (n) set.add(n); }
  return set;
};
export const isStaffNumber = (phone) => staffNumbers().has(normalizePhone(phone));

export const readSmsApproval = async () => {
  try {
    const v = await getStore({ name: CONFIG, consistency: "strong" }).get("sms-approval", { type: "json" });
    return v && typeof v.enabled === "boolean" ? v : { enabled: true, updatedAt: null, by: "standard" };
  } catch {
    return { enabled: true, updatedAt: null, by: "standard" };
  }
};
export const setSmsApproval = async (enabled, by = "admin") => {
  const v = { enabled: Boolean(enabled), updatedAt: new Date().toISOString(), by: clean(by, 60) };
  await getStore({ name: CONFIG, consistency: "strong" }).setJSON("sms-approval", v);
  return v;
};

// Lägger ett SMS i kön. Returnerar resultatobjektet avsändaren får tillbaka.
export const queuePendingSms = async ({ source, to, message, from = "" } = {}) => {
  const at = new Date().toISOString();
  const phone = normalizePhone(to);
  const id = keyFor(at, phone);
  const entry = { id, at, to: phone, from: clean(from, 30), message: clean(message, 2000), source: clean(source, 60) || "okand", status: "pending" };
  await getStore({ name: PENDING, consistency: "strong" }).setJSON(id, entry);
  await logSms({ source, to: phone, message, from, result: { status: "pending_approval", to: phone } });
  return { status: "pending_approval", to: phone, pendingId: id };
};

// null = skicka som vanligt, annars resultatet som ska returneras i stället.
const gateSms = async (source, args) => {
  if (args?.approved === true) return null;
  const to = normalizePhone(args?.to);
  if (!to || !clean(args?.message)) return null; // avsändaren svarar själv invalid_phone/missing_message
  if (isStaffNumber(to)) return null;
  if (!(await readSmsApproval()).enabled) return null;
  return queuePendingSms({ source, to, message: args.message, from: args.from });
};

export const readPendingSms = async () => {
  try {
    const store = getStore({ name: PENDING, consistency: "strong" });
    const keys = await listKeys(store, "");
    const items = await Promise.all(keys.map((k) => store.get(k, { type: "json" }).catch(() => null)));
    return items.filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  } catch {
    return [];
  }
};

// Skickar ett köat SMS. send = den riktiga avsändaren (postSms från _shared/sms.mjs).
export const approvePendingSms = async (id, send, { by = "admin" } = {}) => {
  const store = getStore({ name: PENDING, consistency: "strong" });
  const entry = await store.get(id, { type: "json" }).catch(() => null);
  if (!entry) return { status: "not_found" };
  const result = await send({ to: entry.to, message: entry.message, from: entry.from || undefined, approved: true });
  await logSms({ source: `approved:${entry.source}`, to: entry.to, message: entry.message, from: entry.from, result });
  if (result?.status === "sent") await store.delete(id).catch(() => {});
  else await store.setJSON(id, { ...entry, lastError: clean(result?.error || result?.status, 200), lastTriedAt: new Date().toISOString(), by }).catch(() => {});
  return result;
};

export const rejectPendingSms = async (id, { by = "admin" } = {}) => {
  const store = getStore({ name: PENDING, consistency: "strong" });
  const entry = await store.get(id, { type: "json" }).catch(() => null);
  if (!entry) return { status: "not_found" };
  await logSms({ source: `rejected:${entry.source}`, to: entry.to, message: entry.message, from: entry.from, result: { status: "rejected", to: entry.to } });
  await store.delete(id).catch(() => {});
  return { status: "rejected", by };
};

// Omsluter en avsändarfunktion med signaturen ({ to, message, from, approved })
// => result: spärren först, sedan utskicket, sedan loggen. Själva utskicket
// ändras inte.
export const loggedSms = (source, send) => async (args = {}) => {
  const gated = await gateSms(source, args);
  if (gated) return gated;
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
