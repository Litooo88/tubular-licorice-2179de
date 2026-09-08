import { getStore } from "@netlify/blobs";

// Repair Intelligence Loop, steg 1: varje avslutat ärende blir en datarad.
//
// Blob-store "repair-index", nyckel = caseId (idempotent — ett avslut som
// uppdateras skriver om samma rad). Raden innehåller INGEN kund-PII: bara
// teknik, tid och pris. Konsumeras av case-similar.mjs ("Liknande fall",
// prisintervall, mätning).

const clean = (value, max = 300) => String(value || "").trim().slice(0, max);

// Grundorsaker — samma valideringsmönster som JOB_TYPES. Nyckel lagras,
// etikett visas i UI. "okant_ej_funnet" är ett ärligt svar och bättre data
// än en gissning.
export const ROOT_CAUSES = {
  punktering_vasst: "Punktering — vasst föremål",
  dack_slitage: "Däck/slang — slitage",
  batteri_cell: "Batteri — cell/kapacitet",
  batteri_bms: "Batteri — BMS/skyddskrets",
  laddare_port: "Laddare/laddport",
  motor: "Motor/drivning",
  kontroller: "Styrenhet/controller",
  kablage_kontakt: "Kablage/kontakt/glapp",
  reglage_display: "Reglage/display",
  broms_mek: "Broms — mekanisk",
  styrlager_chassi: "Styrlager/chassi/mekanik",
  fukt_vatten: "Fukt-/vattenskada",
  mjukvara_lasning: "Mjukvara/låsning/inställning",
  yttre_skada: "Yttre skada/olycka",
  normalt_underhall: "Normalt underhåll (service)",
  okant_ej_funnet: "Okänt — felet ej återfunnet",
  annat: "Annat (skriv i noteringen)",
};

const BRAND_PATTERNS = [
  ["Xiaomi", /xiaomi|mi\s?(electric|scooter)|m365|1s\b|pro\s?2|4\s?(lite|pro|ultra)/i],
  ["Ninebot/Segway", /ninebot|segway|\bes[1-4]\b|\bg30\b|\bmax\b.*g|f2\b|e2\s?(pro|plus)?\b/i],
  ["KuKirin", /kukirin|kugoo|kukrin/i],
  ["NAVEE", /navee|\bgt3\b|\bv25\b|\bg3t?\b/i],
  ["E-Wheels", /e-?wheels?|\be2s\b|\be7\b|ewheel/i],
  ["E-Way", /e-?way|\be-?25[0-9]{2}\b/i],
  ["VSETT", /vsett/i],
  ["Dualtron", /dualtron/i],
  ["iScooter", /iscooter/i],
  ["NIU", /\bniu\b|kqi/i],
  ["Lyfco", /lyfco/i],
  ["Denver", /denver/i],
  ["Pure", /\bpure\b/i],
  ["Teverun", /teverun/i],
  ["Viron", /viron/i],
  ["Blade", /\bblade\b/i],
  ["Inokim", /inokim/i],
  ["Emove", /emove/i],
  ["Vässla", /v[aä]ssla/i],
  ["Voi", /\bvoi\b/i],
  ["OOTD", /ootd|\bt10\b/i],
  ["Apex", /\bapex\b/i],
];

export const normalizeBrand = (model) => {
  const text = clean(model, 200);
  if (!text) return "";
  for (const [brand, pattern] of BRAND_PATTERNS) if (pattern.test(text)) return brand;
  return "";
};

// Indexera när avslutet börjar bära data eller ärendet faktiskt stängs.
export const shouldIndex = (caseItem) =>
  Boolean(
    caseItem?.completion?.rootCause ||
    caseItem?.completion?.readyAt ||
    ["ready", "done", "archived"].includes(String(caseItem?.status || "")),
  );

// Fritextfälten (symptom, grundorsaksnotering, delar, arbetssammanfattning)
// skrivs av en människa i verkstaden och innehåller ibland kundens namn,
// telefon eller mejl mitt i den tekniska texten. Whitelisten av fält räckte
// därför inte för att kommentaren "INGEN kund-PII" skulle vara sann — här
// redigeras uppenbar PII bort innan raden hamnar i kunskapsindexet.
const PII_PATTERNS = [
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[mejl]"],
  // Personnummer ÅÅÅÅMMDD-XXXX / ÅÅMMDD-XXXX (även med + som skiljetecken).
  // Måste testas FÖRE telefonmönstret, annars äter telefonregeln inledningen.
  [/\b(?:19|20)?\d{6}[-+]\d{4}\b/g, "[personnummer]"],
  // Svenska mobil-/fastnummer i vanliga skrivsätt, inkl. +46 och mellanslag.
  [/(?:\+46[\s-]?|0)(?:7[\s-]?\d|\d{1,3})(?:[\s-]?\d){6,9}\b/g, "[telefon]"],
];

export const redactPii = (value) =>
  PII_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value || ""));

export const buildIndexRow = (caseItem, now = new Date()) => {
  const completion = caseItem.completion || {};
  const model = clean(caseItem.vehicle?.model, 160);
  return {
    caseId: clean(caseItem.id, 120),
    at: completion.readyAt || caseItem.updatedAt || now.toISOString(),
    jobType: clean(completion.jobType, 40) || "service",
    brand: clean(caseItem.vehicle?.brand, 60) || normalizeBrand(model),
    model,
    symptom: redactPii(clean(completion.symptom, 300) || clean(caseItem.service, 160)),
    rootCause: ROOT_CAUSES[completion.rootCause] ? completion.rootCause : "",
    rootCauseNote: redactPii(clean(completion.rootCauseNote, 500)),
    laborMinutes: Number.isFinite(Number(completion.laborMinutes)) && Number(completion.laborMinutes) > 0
      ? Number(completion.laborMinutes) : null,
    totalCost: Number.isFinite(Number(completion.totalCost)) && Number(completion.totalCost) > 0
      ? Number(completion.totalCost) : null,
    parts: redactPii(clean(caseItem.workshop?.partsUsed, 300)),
    workSummary: redactPii(clean(completion.workSummary, 300)),
    serviceActions: Array.isArray(completion.serviceActions) ? completion.serviceActions.slice(0, 12) : [],
    status: clean(caseItem.status, 40),
  };
};

export const upsertRepairIndex = async (caseItem) => {
  const row = buildIndexRow(caseItem);
  if (!row.caseId) return null;
  await getStore({ name: "repair-index", consistency: "strong" }).setJSON(row.caseId, row);
  return row;
};
