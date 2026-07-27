// Tysta timmar för kundutskick: inga tack-/recensionsutskick nattetid.
// Ärenden som stängs mellan 21:00 och 07:59 (svensk tid) köas i outbox-storen
// och skickas kl 10:00 — statistiskt bra tid för öppning och recensionsklick.

const stockholmParts = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
};

export const isQuietHour = (now = new Date()) => {
  const { hour } = stockholmParts(now);
  return hour >= 21 || hour < 8;
};

// Nästa tidpunkt då Stockholm-klockan slår 10:00: samma dag om det är natt/tidig
// morgon, annars nästa dag. Scannar heltimmar — robust över sommar-/vintertid.
export const nextOptimalSendAt = (now = new Date()) => {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  for (let i = 1; i <= 48; i += 1) {
    const candidate = new Date(start.getTime() + i * 60 * 60 * 1000);
    if (stockholmParts(candidate).hour === 10) return candidate.toISOString();
  }
  return new Date(start.getTime() + 12 * 60 * 60 * 1000).toISOString();
};
