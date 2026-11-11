// Miljövariabler med skydd mot pensionerade personalnummer.
//
// Bakgrund (2026-10-27): när Sebastians mobil var trasig i augusti sattes
// VOICE_PRIMARY_NUMBER, VOICE_NOTIFY_TO och WORKSHOP_SMS_TO till ett tillfälligt
// nummer (+46725751086) i Netlify. Det ändrades aldrig tillbaka: i månader
// kopplades alla samtal på kontorstid till en död röstbrevlåda och alla larm
// gick till en telefon ingen hade. Nova fick aldrig samtalen.
//
// Här filtreras därför kända pensionerade nummer bort ur de env-nycklar som
// pekar på personal, så att koden faller tillbaka på det aktuella numret även
// om miljön är gammal. Rätta ändå miljön i Netlify - det här är ett skyddsnät.

export const RETIRED_STAFF_NUMBERS = Object.freeze(["+46725751086"]);
export const SEBASTIAN_MOBILE = "+46700243319";

// Nycklar som får innehålla personalens nummer (ett eller en kommalista).
const STAFF_PHONE_KEYS = new Set([
  "VOICE_PRIMARY_NUMBER", "VOICE_SEBASTIAN_PHONE", "VOICE_NOTIFY_TO", "VOICE_MISSED_SMS_TO",
  "WORKSHOP_SMS_TO", "SEBASTIAN_SMS_TO", "VOICE_FALLBACK_NUMBER", "VOICE_WORKSHOP_PHONE", "WORKSHOP_CHAT_SMS_TO",
]);

const normalize = (phone) => {
  const compact = String(phone || "").trim().replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact;
};

export const isRetiredStaffNumber = (phone) => RETIRED_STAFF_NUMBERS.includes(normalize(phone));

export const rawEnv = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

// Som rawEnv, men pensionerade nummer plockas bort ur personalnycklarna.
// Var nyckeln satt men pekade BARA på pensionerade nummer ersätts den med
// Sebastians mobil - annars skulle larm och samtal tyst försvinna.
export const readEnv = (name) => {
  const value = rawEnv(name);
  if (!STAFF_PHONE_KEYS.has(name) || !value) return value;
  const kept = String(value).split(/[,;]/).map((part) => part.trim()).filter((part) => part && !isRetiredStaffNumber(part));
  return kept.length ? kept.join(",") : SEBASTIAN_MOBILE;
};
