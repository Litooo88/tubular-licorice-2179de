const SWEDISH_PUBLIC_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-01-06",
  "2026-04-03",
  "2026-04-05",
  "2026-04-06",
  "2026-05-01",
  "2026-05-14",
  "2026-05-24",
  "2026-06-06",
  "2026-06-19",
  "2026-06-20",
  "2026-10-31",
  "2026-12-24",
  "2026-12-25",
  "2026-12-26",
  "2026-12-31"
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
  if (SWEDISH_PUBLIC_HOLIDAYS_2026.has(local.date)) return false;
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
