// Nova: rena hjälpfunktioner (testade) för Ring upp-listan, det dagliga
// samlade SMS:et och uppringningskön.
//
// Varför (Sebastian 2026-10-11): ett SMS per samtal ("ring den här") drunknar,
// han ringer inte direkt. Bättre: en fast tid om dagen och en egen sida i
// admin med alla som vill bli uppringda. Och Nova ska själv ringa upp den
// stora ringlistan, kallaste först, så att bara guldkornen hamnar hos honom.

import { normalizePhone } from "./sms.mjs";

const clean = (v, max = 400) => String(v || "").trim().slice(0, max);

const stockholm = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
};

// Nova ringer bara vardagar 10:00–17:59 svensk tid. Kvällar och helger är
// för påträngande för ett okänt samtal, även från ett företag kunden ringt.
export const isCallingWindow = (now = new Date()) => {
  const { weekday, hour } = stockholm(now);
  if (/lör|sön|sat|sun/i.test(weekday)) return false;
  return hour >= 10 && hour < 18;
};

export const OUTBOUND_MAX_ATTEMPTS = 2;
export const OUTBOUND_RETRY_HOURS = 20;

// Nästa poster att ringa. Testsamtal går först och oavsett tidsfönster.
export const pickNextOutbound = (entries, { now = Date.now(), limit = 1, windowOpen = true } = {}) => {
  const list = Array.isArray(entries) ? entries : [];
  const due = list.filter((e) => {
    if (!e || !e.phone) return false;
    if (e.status === "test") return true;
    if (!windowOpen) return false;
    if (e.status !== "queued") return false;
    if ((e.attempts || 0) >= OUTBOUND_MAX_ATTEMPTS) return false;
    const last = new Date(e.lastAttemptAt || 0).getTime();
    return !last || now - last >= OUTBOUND_RETRY_HOURS * 3600 * 1000;
  });
  due.sort((a, b) => (a.status === "test" ? -1 : 0) - (b.status === "test" ? -1 : 0) || (a.priority ?? 0) - (b.priority ?? 0) || String(a.queuedAt || "").localeCompare(String(b.queuedAt || "")));
  return due.slice(0, limit);
};

const whenText = (iso, now = Date.now()) => {
  const t = new Date(iso || 0).getTime();
  if (!t) return "för en tid sedan";
  const days = Math.floor((now - t) / 86400000);
  if (days <= 1) return "i går";
  if (days <= 7) return "för några dagar sedan";
  if (days <= 21) return "för ett par veckor sedan";
  if (days <= 60) return "för någon månad sedan";
  return "för en tid sedan";
};

// Novas första mening när hon ringer upp. Hon säger direkt att hon är en
// AI-assistent och varför hon ringer; kunden ska kunna säga nej på en gång.
export const outboundFirstMessage = (entry, now = Date.now()) => {
  const namn = clean(entry?.name, 40).split(/\s+/)[0];
  const hej = namn && !/okänd|kund/i.test(namn) ? `Hej ${namn}!` : "Hej!";
  if (entry?.status === "test") return `${hej} Det här är Nova från Nordic E-Mobility, ett testsamtal av uppringningen. Hör du mig bra?`;
  return `${hej} Det här är Nova, AI-assistent på Nordic E-Mobility i Örebro. Du ringde oss ${whenText(entry?.lastCallAt, now)} och vi hann inte svara, förlåt för det. Har du en minut så hjälper jag dig direkt, vad gällde det?`;
};

// Matchar ett inkommande SIP-samtal hos ElevenLabs mot en pågående
// uppringning. Primärt på kundens nummer (vi sätter callerid till kunden);
// om 46elks i stället skickar vårt eget nummer tas den enda aktiva posten.
export const matchOutboundCall = (entries, callerId, { now = Date.now(), ownNumbers = [] } = {}) => {
  const phone = normalizePhone(callerId);
  const fresh = (Array.isArray(entries) ? entries : []).filter((e) => e && e.status === "calling" && now - new Date(e.lastAttemptAt || 0).getTime() < 4 * 60 * 1000);
  const exact = fresh.find((e) => normalizePhone(e.phone) === phone);
  if (exact) return exact;
  const own = new Set(ownNumbers.map(normalizePhone));
  if ((!phone || own.has(phone)) && fresh.length === 1) return fresh[0];
  return null;
};

// Det samlade SMS:et till Sebastian, en gång om dagen. Kort: namn, nummer,
// vad det gäller. Hela listan finns på sidan.
export const buildCallbackDigest = ({ meetings = [], messages = [], ring = [], url = "" } = {}) => {
  const rows = [
    ...meetings.map((m) => ({ who: clean(m.name, 30) || "okänt namn", phone: m.phone, what: clean(m.topic, 70), when: clean(m.preferredTime, 30) })),
    ...ring.map((r) => ({ who: "RING-svar", phone: r.phone, what: clean(r.message, 40) || "vill bli uppringd", when: "" })),
    ...messages.map((m) => ({ who: clean(m.name, 30) || "okänt namn", phone: m.phone, what: `meddelande: ${clean(m.message, 60)}`, when: "" })),
  ];
  if (!rows.length) return "";
  const lines = rows.slice(0, 8).map((r, i) => `${i + 1}. ${r.who} ${r.phone}: ${r.what}${r.when ? ` (${r.when})` : ""}`);
  const more = rows.length > 8 ? `\n+${rows.length - 8} till.` : "";
  return `[Nordic] Ring upp idag (${rows.length}):\n${lines.join("\n")}${more}${url ? `\nAllt: ${url}` : ""}`.slice(0, 900);
};
