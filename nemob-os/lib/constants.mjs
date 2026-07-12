// Delade enums och etiketter för NEMOB OS. Nycklar är ascii (stabila i
// lagring/API), etiketter är det som visas i UI.

export const AREAS = {
  nordic: "Nordic E-Mobility",
  lvu: "LVU/Myndighet",
  ekonomi: "Ekonomi",
  privat: "Privat",
  halsa: "Hälsa",
  ovrigt: "Övrigt",
};

export const STATUSES = {
  ny: "Ny",
  planerad: "Planerad",
  pagar: "Pågår",
  blockerad: "Blockerad",
  klar: "Klar",
  flyttad: "Flyttad",
};

export const RISK_LEVELS = {
  ingen: "Ingen",
  lag: "Låg",
  medel: "Medel",
  hog: "Hög",
  akut: "Akut",
};

// Statusar som räknas som aktiva kandidater för dagens plan.
export const ACTIVE_STATUSES = new Set(["ny", "planerad", "pagar"]);

export const STOCKHOLM = "Europe/Stockholm";

export const stockholmDate = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: STOCKHOLM,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export const clean = (value, max = 400) => String(value ?? "").trim().slice(0, max);

export const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
