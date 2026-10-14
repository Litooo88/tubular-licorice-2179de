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
// vad det gäller. Hela listan finns på sidan. summary = novaDayLine(...) för
// gårdagen; då skickas SMS:et även när ingen väntar på samtal.
export const buildCallbackDigest = ({ meetings = [], messages = [], ring = [], url = "", summary = "" } = {}) => {
  const rows = [
    ...meetings.map((m) => ({ who: clean(m.name, 30) || "okänt namn", phone: m.phone, what: clean(m.topic, 70), when: clean(m.preferredTime, 30) })),
    ...ring.map((r) => ({ who: "RING-svar", phone: r.phone, what: clean(r.message, 40) || "vill bli uppringd", when: "" })),
    ...messages.map((m) => ({ who: clean(m.name, 30) || "okänt namn", phone: m.phone, what: `meddelande: ${clean(m.message, 60)}`, when: "" })),
  ];
  const head = summary ? `${summary}\n` : "";
  if (!rows.length) return summary ? `[Nordic] ${head}Ingen väntar på samtal.${url ? `\nAllt: ${url}` : ""}`.slice(0, 900) : "";
  const lines = rows.slice(0, 8).map((r, i) => `${i + 1}. ${r.who} ${r.phone}: ${r.what}${r.when ? ` (${r.when})` : ""}`);
  const more = rows.length > 8 ? `\n+${rows.length - 8} till.` : "";
  return `[Nordic] ${head}Ring upp idag (${rows.length}):\n${lines.join("\n")}${more}${url ? `\nAllt: ${url}` : ""}`.slice(0, 900);
};

// ---------------------------------------------------------------------------
// Rapportering (Sebastian 2026-10-14: "rapporteras inte på ett tydligt sätt").
// Två källor som tidigare aldrig knöts ihop:
//   voice-agent-calls  ElevenLabs efter samtalet: vad som sades och utfall
//   nova-outbound      46elks: att vi ringde, om kunden svarade, kostnad
// Allt nedan är rent och testat; Netlify-funktionerna läser bara in data.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;
const ms = (iso) => new Date(iso || 0).getTime() || 0;

// Svensk kalenderdag "ÅÅÅÅ-MM-DD", så att "i dag" och "i går" följer Örebro, inte UTC.
export const stockholmDay = (value) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

const callTime = (call) => ms(call?.startedAt) || ms(call?.at);
const isTestEntry = (e) => Boolean(e && (e.wasTest || e.status === "test" || String(e.key || "").startsWith("test-")));

// Vilken uppringning hör ett samtal till? Kräver connectedAt, som bara sätts
// när init-webhooken faktiskt kopplade en uppringning till Nova. Så blir en
// kund som själv ringer tillbaka efter ett missat Nova-samtal inte felmärkt.
export const findOutboundForCall = (call, entries, { ownNumbers = [] } = {}) => {
  const t = callTime(call);
  if (!t) return null;
  const phone = normalizePhone(call?.phone);
  // Utan nummer är det webbchatten; den kan aldrig vara en uppringning.
  if (!phone || call?.channel === "web") return null;
  const own = new Set(ownNumbers.map(normalizePhone).filter(Boolean));
  const anyPhone = own.has(phone);
  let best = null;
  for (const e of Array.isArray(entries) ? entries : []) {
    const c = ms(e?.connectedAt);
    if (!c || t < c - 2 * 60 * 1000 || t > c + 45 * 60 * 1000) continue;
    if (!anyPhone && normalizePhone(e.phone) !== phone) continue;
    if (!best || Math.abs(t - c) < Math.abs(t - ms(best.connectedAt))) best = e;
  }
  return best;
};

// inbound = kunden ringde, outbound = Nova ringde upp, web = webbchatten,
// test = Sebastians testsamtal (räknas inte i siffrorna).
export const classifyNovaCall = (call, entries = [], opts = {}) => {
  if (call?.kind) return { kind: call.kind, outboundKey: call.outboundKey || "", phone: call.phone || "" };
  const declaredInbound = call?.callType === "inkommande" && call?.direction !== "outbound";
  const match = declaredInbound ? null : findOutboundForCall(call, entries, opts);
  if (match || call?.callType === "uppringning" || call?.direction === "outbound") {
    const own = new Set((opts.ownNumbers || []).map(normalizePhone).filter(Boolean));
    const phone = normalizePhone(call?.phone);
    return {
      kind: isTestEntry(match) ? "test" : "outbound",
      outboundKey: match?.key || "",
      // 46elks kan ha skickat vårt eget nummer som callerid; då är kundens nummer köpostens.
      phone: match && (!phone || own.has(phone)) ? match.phone : call?.phone || "",
    };
  }
  if (call?.channel === "web" || (!call?.phone && !call?.direction)) return { kind: "web", outboundKey: "", phone: "" };
  return { kind: "inbound", outboundKey: "", phone: call?.phone || "" };
};

export const KIND_LABELS = { inbound: "Inkommande", outbound: "Uppringning", web: "Webbchatt", test: "Test" };

// Ett utfall per samtal, i den ordning som betyder mest för Sebastian.
// tone styr färgen på sidan: good / info / warn / bad / dim.
export const callOutcome = (call) => {
  const tools = Array.isArray(call?.tools) ? call.tools : [];
  const dur = Number(call?.durationSec) || 0;
  if (call?.meetingBooked || tools.includes("book-meeting")) return { key: "meeting", label: "Telefonmöte bokat", tone: "good" };
  if (tools.includes("message")) return { key: "message", label: "Meddelande lämnat", tone: "info" };
  if (/voicemail|röstbrevlåda|answering machine/i.test(call?.endReason || "")) return { key: "voicemail", label: "Röstbrevlåda", tone: "dim" };
  if (dur > 0 && dur < 15) return { key: "short", label: "Lade på direkt (under 15 s)", tone: "warn" };
  if (/fail/i.test(call?.outcome || "")) return { key: "failed", label: "Misslyckat, läs samtalet", tone: "bad" };
  if (/success/i.test(call?.outcome || "")) return { key: "resolved", label: "Nova löste frågan", tone: "good" };
  return { key: "unknown", label: "Utfall okänt", tone: "dim" };
};

// Uppringningsförsök (46elks) per köpost. Nya poster har en log; äldre
// poster har bara senaste försöket, som då räknas en gång.
export const outboundAttempts = (entries) => {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.key === "_config") continue;
    const test = isTestEntry(e);
    if (Array.isArray(e.log) && e.log.length) {
      for (const a of e.log) out.push({ at: a.at, result: a.result, durationSec: Number(a.durationSec) || 0, costSek: Number(a.costSek) || 0, test, phone: e.phone });
      continue;
    }
    if (!e.lastAttemptAt || e.status === "calling") continue;
    const result = e.status === "done" ? "answered" : e.status === "failed" ? "failed" : "noanswer";
    out.push({ at: e.lastAttemptAt, result, durationSec: Number(e.durationSec) || 0, costSek: 0, test, phone: e.phone });
  }
  return out;
};

// Siffrorna för en period. inRange(tidpunkt i ms) -> true/false.
export const summarizeNova = ({ calls = [], entries = [], inRange, ownNumbers = [] } = {}) => {
  const inside = (t) => Boolean(t) && inRange(t);
  const rows = (Array.isArray(calls) ? calls : []).filter((c) => inside(callTime(c))).map((c) => ({ ...c, ...classifyNovaCall(c, entries, { ownNumbers }), result: callOutcome(c) }));
  const real = rows.filter((r) => r.kind !== "test");
  const count = (fn) => real.filter(fn).length;
  const talked = real.filter((r) => (Number(r.durationSec) || 0) > 0);
  const attempts = outboundAttempts(entries).filter((a) => !a.test && inside(ms(a.at)));
  const answered = attempts.filter((a) => a.result === "answered").length;
  return {
    conversations: real.length,
    inbound: count((r) => r.kind === "inbound"),
    outbound: count((r) => r.kind === "outbound"),
    web: count((r) => r.kind === "web"),
    tests: rows.length - real.length,
    totalSec: talked.reduce((s, r) => s + (Number(r.durationSec) || 0), 0),
    avgSec: talked.length ? Math.round(talked.reduce((s, r) => s + (Number(r.durationSec) || 0), 0) / talked.length) : 0,
    meetings: count((r) => r.result.key === "meeting"),
    messages: count((r) => r.result.key === "message"),
    resolved: count((r) => r.result.key === "resolved"),
    failed: count((r) => r.result.key === "failed"),
    short: count((r) => r.result.key === "short" || r.result.key === "voicemail"),
    dialed: attempts.length,
    answered,
    noAnswer: attempts.filter((a) => a.result === "noanswer").length,
    dialFailed: attempts.filter((a) => a.result === "failed").length,
    answerRate: attempts.length ? Math.round((answered / attempts.length) * 100) : null,
    costSek: Math.round(attempts.reduce((s, a) => s + a.costSek, 0) * 100) / 100,
  };
};

// I dag, i går (svenska kalenderdagar) och rullande 7 dagar.
export const buildNovaStats = ({ calls = [], entries = [], now = Date.now(), ownNumbers = [] } = {}) => {
  const today = stockholmDay(now);
  const yesterday = stockholmDay(now - DAY_MS);
  const base = { calls, entries, ownNumbers };
  return {
    today: summarizeNova({ ...base, inRange: (t) => stockholmDay(t) === today }),
    yesterday: summarizeNova({ ...base, inRange: (t) => stockholmDay(t) === yesterday }),
    week: summarizeNova({ ...base, inRange: (t) => t >= now - 7 * DAY_MS && t <= now }),
  };
};

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// En till två rader för det dagliga SMS:et. Tom sträng när Nova inte gjort något.
export const novaDayLine = (s, label = "i går") => {
  if (!s || (!s.conversations && !s.dialed)) return "";
  const parts = [];
  if (s.conversations) {
    const split = [s.inbound && `${s.inbound} in`, s.outbound && `${s.outbound} uppringda`, s.web && `${s.web} webb`].filter(Boolean).join(", ");
    const res = [s.meetings && `${s.meetings} möte`, s.messages && `${s.messages} meddel.`, s.resolved && `${s.resolved} löst`, s.failed && `${s.failed} MISSLYCKAT`, s.short && `${s.short} lade på`].filter(Boolean).join(", ");
    parts.push(`${s.conversations} samtal (${split}), snitt ${mmss(s.avgSec)}${res ? `. ${res}` : ""}.`);
  }
  if (s.dialed) parts.push(`Uppringning: ${s.dialed} försök, ${s.answered} svarade${s.answerRate !== null ? ` (${s.answerRate} %)` : ""}${s.dialFailed ? `, ${s.dialFailed} fel` : ""}.`);
  return `Nova ${label}: ${parts.join(" ")}`;
};

// Våra egna nummer (callerid om 46elks inte släpper igenom kundens nummer).
export const ownNovaNumbers = (env) => [env("ELKS_SMS_NUMBER"), env("ELKS_NUMBER"), "+46101385498"].filter(Boolean);
