// Svenska helgdagar — uppdatera årligen i december för nästa år.
// Bygger in 2026 + 2027 nu. Sätt påminnelse i kalender 2027-12-15 för 2028-listan.
const SWEDISH_PUBLIC_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", // Nyårsdagen
  "2026-01-06", // Trettondedag jul
  "2026-04-03", // Långfredag
  "2026-04-05", // Påskdagen
  "2026-04-06", // Annandag påsk
  "2026-05-01", // Första maj
  "2026-05-14", // Kristi himmelsfärds dag
  "2026-05-24", // Pingstdagen
  "2026-06-06", // Sveriges nationaldag
  "2026-06-19", // Midsommarafton (klämdag)
  "2026-06-20", // Midsommardagen
  "2026-10-31", // Alla helgons dag
  "2026-12-24", // Julafton
  "2026-12-25", // Juldagen
  "2026-12-26", // Annandag jul
  "2026-12-31", // Nyårsafton
  // 2027
  "2027-01-01", // Nyårsdagen
  "2027-01-06", // Trettondedag jul
  "2027-03-26", // Långfredag
  "2027-03-28", // Påskdagen
  "2027-03-29", // Annandag påsk
  "2027-05-01", // Första maj (lördag)
  "2027-05-06", // Kristi himmelsfärds dag
  "2027-05-16", // Pingstdagen
  "2027-06-06", // Sveriges nationaldag (söndag)
  "2027-06-25", // Midsommarafton
  "2027-06-26", // Midsommardagen
  "2027-11-06", // Alla helgons dag
  "2027-12-24", // Julafton
  "2027-12-25", // Juldagen
  "2027-12-26", // Annandag jul
  "2027-12-31"  // Nyårsafton
]);

export function stockholmParts(now: Date, tz = "Europe/Stockholm") {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: get("weekday").toLowerCase(),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute"))
  };
}

export function isOfficeHours(now: Date, tz = "Europe/Stockholm"): boolean {
  const local = stockholmParts(now, tz);
  if (local.weekday === "lör" || local.weekday === "sön") return false;
  if (SWEDISH_PUBLIC_HOLIDAYS.has(local.date)) return false;
  const minutes = local.hour * 60 + local.minute;
  return minutes >= 9 * 60 && minutes < 18 * 60;
}

export function stockholmTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);
}
