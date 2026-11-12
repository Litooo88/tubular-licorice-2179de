// Svenska tidsuttryck → absolut tid i Europe/Stockholm, eller en flagga för
// manuell kontroll. Ren modul utan I/O.
//
// Regel (Sebastian): hitta ALDRIG på tider. Ett uttryck ges en absolut tid
// bara när både dag och klockslag är entydiga. Annars returneras det som går
// att säga (t.ex. bara datumet) och `needsReview: true`.
//
//   resolveTimePhrase("imorgon kl 14", { receivedAt })
//     → { raw, status: "resolved", at: "2026-11-13T13:00:00.000Z", local: "2026-11-13 14:00",
//         date: "2026-11-13", needsReview: false, reason: "" }
//   status: resolved | date_only | ambiguous | asap | none | past
//
// Referensen är alltid tidpunkten uttrycket yttrades (`receivedAt`), inte
// "nu": "imorgon" i ett samtal i går betyder i dag.

export const TIME_ZONE = "Europe/Stockholm";
const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const pad = (n) => String(n).padStart(2, "0");

const partsFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23",
});
const WEEKDAY_INDEX = { "mån": 1, "tis": 2, "ons": 3, "tors": 4, "fre": 5, "lör": 6, "sön": 0 };

// Lokala delar (Stockholm) för en tidpunkt.
export const stockholmParts = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = WEEKDAY_INDEX[String(parts.weekday || "").toLowerCase().replace(".", "").slice(0, 4)] ?? WEEKDAY_INDEX[String(parts.weekday || "").toLowerCase().replace(".", "").slice(0, 3)];
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday };
};

// Offset (minuter) för Stockholm vid en given tidpunkt.
const offsetMinutesAt = (utcMs) => {
  const p = stockholmParts(new Date(utcMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  return Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000);
};

// Lokal Stockholm-tid → UTC-instans (hanterar sommar-/vintertid).
export const zonedToUtc = ({ year, month, day, hour = 0, minute = 0 }) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ms = guess - offsetMinutesAt(guess) * 60000;
  ms = guess - offsetMinutesAt(ms) * 60000;
  return new Date(ms);
};

export const formatLocal = ({ year, month, day, hour, minute }, withTime = true) =>
  `${year}-${pad(month)}-${pad(day)}${withTime ? ` ${pad(hour)}:${pad(minute)}` : ""}`;

export const isoToLocal = (iso) => { const p = stockholmParts(iso); return p ? formatLocal(p) : ""; };

// "YYYY-MM-DDTHH:MM" (ärendenas preferredDate, lokal tid) → ISO. "" om ogiltig.
export const localToIso = (value) => {
  const m = clean(value, 40).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return "";
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return "";
  const at = zonedToUtc({ year: y, month: mo, day: d, hour: h, minute: mi });
  return Number.isFinite(at.getTime()) ? at.toISOString() : "";
};

const addDays = (parts, n) => {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
};

const WEEKDAYS = [
  [/\bs[öo]ndag(en)?\b/, 0], [/\bm[åa]ndag(en)?\b/, 1], [/\btisdag(en)?\b/, 2], [/\bonsdag(en)?\b/, 3],
  [/\btorsdag(en)?\b/, 4], [/\bfredag(en)?\b/, 5], [/\bl[öo]rdag(en)?\b/, 6],
];
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const PERIODS = [
  [/\b(tidig[t]? )?morgon(en)?\b|\bbitti\b/, "morgon"], [/\bf[öo]rmiddag(en)?\b|\bfm\b/, "förmiddag"], [/\blunch(tid|en)?\b/, "lunch"],
  [/\beftermiddag(en)?\b|\bem\b/, "eftermiddag"], [/\bkv[äa]ll(en)?\b/, "kväll"],
];

// Dag ur uttrycket relativt referensdagen. null = ingen dag nämnd.
const parseDay = (text, ref) => {
  const lower = text.toLowerCase();
  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { parts: { year: +iso[1], month: +iso[2], day: +iso[3] }, explicit: true };
  const slash = lower.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*[-/]?\s*(\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : (Number(slash[2]) < ref.month || (Number(slash[2]) === ref.month && Number(slash[1]) < ref.day) ? ref.year + 1 : ref.year);
    return { parts: { year, month: +slash[2], day: +slash[1] }, explicit: true };
  }
  const named = lower.match(/\b(\d{1,2})(?::e|:a)?\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/);
  if (named) {
    const month = MONTHS.indexOf(named[2]) + 1;
    const year = month < ref.month || (month === ref.month && Number(named[1]) < ref.day) ? ref.year + 1 : ref.year;
    return { parts: { year, month, day: +named[1] }, explicit: true };
  }
  if (/\b(i\s*)?[öo]vermorgon\b/.test(lower)) return { parts: addDays(ref, 2), explicit: false };
  if (/\bi\s*morgon\b|\bimorgon\b|\bimorn\b/.test(lower)) return { parts: addDays(ref, 1), explicit: false };
  if (/\bi\s*dag\b|\bidag\b|\bikv[äa]ll\b|\bi kv[äa]ll\b|\bnu\b/.test(lower)) return { parts: addDays(ref, 0), explicit: false };
  for (const [re, wd] of WEEKDAYS) {
    if (!re.test(lower)) continue;
    let diff = (wd - ref.weekday + 7) % 7;
    if (diff === 0) diff = 7; // "på måndag" sagt en måndag = nästa måndag
    if (/\bn[äa]sta\s+(vecka\s+)?\w*dag/.test(lower) && diff < 7 && /\bn[äa]sta vecka\b/.test(lower)) diff += 7;
    return { parts: addDays(ref, diff), explicit: false };
  }
  if (/\bn[äa]sta vecka\b/.test(lower)) return { parts: addDays(ref, ((1 - ref.weekday + 7) % 7) || 7), explicit: false, vague: "nästa vecka" };
  if (/\bi helgen\b|\bhelgen\b/.test(lower)) return { parts: addDays(ref, ((6 - ref.weekday + 7) % 7) || 7), explicit: false, vague: "helgen" };
  return null;
};

// Klockslag ur uttrycket. { hour, minute } | { period } | null.
// Datum- och dagord tas bort innan klockslaget letas upp, så att "20/11 kl 10"
// inte läser "11" som timme och "i morgon" inte blir perioden "morgon".
const DAY_WORDS_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*[-/]?\s*\d{2,4})?\b|\b\d{1,2}(?::e|:a)?\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b|\b(?:i\s*)?[öo]vermorgon\b|\bi\s*morgon\b|\bimorgon\b|\bimorn\b|\bi\s*dag\b|\bidag\b/g;
const parseClock = (text) => {
  const lower = text.toLowerCase().replace(DAY_WORDS_RE, " ");
  const m = lower.match(/\b(?:kl\.?|klockan|vid|runt|ca|cirka|ungef[äa]r)?\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*-?\s*tiden)?\b(?!\s*\/|\s*(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)|\d*\s*(?:dagar|veckor|min))/);
  let hour = null, minute = 0;
  if (m) {
    const h = Number(m[1]);
    const explicitClock = /\b(kl\.?|klockan|tiden|vid|runt)\b/.test(lower) || m[2] !== undefined;
    if (h >= 0 && h <= 23 && (explicitClock || h >= 7)) { hour = h; minute = Number(m[2] || 0); }
    if (minute > 59) return null;
  }
  const period = PERIODS.find(([re]) => re.test(lower))?.[1] || "";
  if (hour !== null) {
    // "kl 2 på eftermiddagen" → 14; "halv tre" hanteras inte (ambiguous).
    if (period === "eftermiddag" && hour < 12) hour += 12;
    if (period === "kväll" && hour < 12) hour += 12;
    return { hour, minute, period };
  }
  if (/\bhalv\s+(\d{1,2}|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|elva|tolv)\b/.test(lower)) return { ambiguous: "halv-uttryck" };
  return period ? { period } : null;
};

const ASAP_RE = /\bs[åa] snart som m[öo]jligt\b|\bsnarast\b|\bn[äa]r som helst\b|\bn[äa]r (ni|du) kan\b|\bn[äa]r det passar\b|\bvilken tid som helst\b|\basap\b|\bomg[åa]ende\b/i;

// Huvudfunktion. receivedAt = när uttrycket yttrades (ISO). now = för "past"-flaggan.
export const resolveTimePhrase = (raw, { receivedAt, now = Date.now() } = {}) => {
  const text = clean(raw, 200);
  const base = { raw: text, status: "none", at: null, local: null, date: null, needsReview: false, reason: "" };
  if (!text) return base;
  const refParts = stockholmParts(receivedAt || now);
  if (!refParts) return { ...base, needsReview: true, reason: "ogiltig referenstid" };
  const dayHit = parseDay(text, refParts);
  const clock = parseClock(text);
  if (ASAP_RE.test(text) && !dayHit && !clock?.hour && clock?.hour !== 0) return { ...base, status: "asap", reason: "så snart som möjligt – ingen bestämd tid" };
  if (!dayHit && !clock) return { ...base, status: "none", needsReview: true, reason: "ingen tolkningsbar tid i uttrycket" };
  if (clock?.ambiguous) return { ...base, status: "ambiguous", date: dayHit ? formatLocal(dayHit.parts, false) : null, needsReview: true, reason: `oklart klockslag (${clock.ambiguous})` };
  if (!dayHit) {
    // Bara klockslag: samma dag om det inte redan passerat vid mottagningen, annars oklart.
    if (clock.hour === undefined) return { ...base, status: "ambiguous", needsReview: true, reason: `bara "${clock.period}" utan dag` };
    const sameDay = zonedToUtc({ ...refParts, hour: clock.hour, minute: clock.minute });
    const refMs = new Date(receivedAt || now).getTime();
    if (sameDay.getTime() > refMs) return finish(sameDay, { ...refParts, hour: clock.hour, minute: clock.minute }, now, "dag antagen = samma dag", true);
    return { ...base, status: "ambiguous", date: null, needsReview: true, reason: "klockslag utan dag, tiden har passerat samma dag" };
  }
  const date = formatLocal(dayHit.parts, false);
  if (!clock || clock.hour === undefined) {
    const why = dayHit.vague ? `vagt (${dayHit.vague})` : clock?.period ? `bara "${clock.period}" utan klockslag` : "dag utan klockslag";
    return { ...base, status: "date_only", date, needsReview: true, reason: why, period: clock?.period || "" };
  }
  const parts = { ...dayHit.parts, hour: clock.hour, minute: clock.minute };
  const at = zonedToUtc(parts);
  if (!Number.isFinite(at.getTime()) || stockholmParts(at).day !== parts.day) return { ...base, status: "ambiguous", date, needsReview: true, reason: "ogiltigt datum/klockslag" };
  return finish(at, parts, now, dayHit.vague ? `vagt (${dayHit.vague})` : "", Boolean(dayHit.vague));
};

const finish = (at, parts, now, reason, needsReview) => {
  const past = at.getTime() < Number(now);
  return {
    raw: undefined, status: past ? "past" : "resolved", at: at.toISOString(), local: formatLocal(parts), date: formatLocal(parts, false),
    needsReview: needsReview || past, reason: past ? [reason, "tiden har passerat"].filter(Boolean).join("; ") : reason,
  };
};

// Tre separata tidpunkter för ett samtal/möte: mottaget, önskat, bekräftat.
// Bekräftat sätts bara från en faktisk bekräftelse (bokning/kalender) – aldrig från önskemålet.
export const timingFor = ({ receivedAt, requestedRaw = "", requestedLocal = "", confirmedLocal = "", confirmedAt = "", now = Date.now() } = {}) => {
  const received = clean(receivedAt, 40);
  let requested = null;
  if (requestedLocal) {
    const iso = localToIso(requestedLocal);
    requested = iso ? { raw: clean(requestedLocal, 40), status: "resolved", at: iso, local: isoToLocal(iso), date: isoToLocal(iso).slice(0, 10), needsReview: false, reason: "" }
      : { raw: clean(requestedLocal, 40), status: "ambiguous", at: null, local: null, date: null, needsReview: true, reason: "ogiltigt datumformat" };
  } else if (requestedRaw) {
    requested = { ...resolveTimePhrase(requestedRaw, { receivedAt: received, now }), raw: clean(requestedRaw, 200) };
  }
  let confirmed = null;
  const confirmedIso = confirmedAt ? clean(confirmedAt, 40) : confirmedLocal ? localToIso(confirmedLocal) : "";
  if (confirmedIso) confirmed = { at: confirmedIso, local: isoToLocal(confirmedIso) };
  return { receivedAt: received, receivedLocal: received ? isoToLocal(received) : "", requested, confirmed, needsReview: Boolean(requested?.needsReview) };
};
