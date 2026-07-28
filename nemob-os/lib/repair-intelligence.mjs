import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const FIELD_LABELS = {
  title: "titel",
  brand: "märke",
  model: "modell",
  errorCode: "felkod",
  symptom: "symptom",
  component: "komponent",
  measurement: "mätvärde",
  testOrder: "testordning",
};

const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /(?<!\d)(?:\+46|0046)\s*(?:\(\s*0\s*\))?(?:[\s-]*\d){7,10}(?!\d)/gu,
  /(?<!\d)07(?:[\s-]*\d){8}(?!\d)/gu,
  /(?<!\d)0(?:8|1[135689]|2[0136]|3[1356-8]|4[0246]|5[0246]|6[013]|9\d)(?:[\s-]+\d{2,}){2,}(?!\d)/gu,
  /(?<!\d)(?:19|20)?\d{6}[-+]\d{4}(?!\d)/gu,
  /\b[A-ZÅÄÖ]{3}[ -]?\d{2}[A-Z0-9]\b/gu,
  /\b(?:case|kund)[_-][A-Z0-9-]{4,}\b/giu,
  /\b[A-ZÅÄÖa-zåäö][A-ZÅÄÖa-zåäö-]{2,}(?:gatan|vägen|gränd|allé|väg)\s+\d+[A-Za-z]?\b/gu,
];

const clean = (value, max = 4000) =>
  String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max);

const asList = (value, maxItems = 50, maxLength = 2000) => {
  const input = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(input.map((item) => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems);
};

export const normalizeSearchText = (value) => clean(value, 8000)
  .toLocaleLowerCase("sv-SE")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[–—]/g, "-")
  .replace(/[^a-z0-9+.-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const searchTokens = (value) => {
  const normalized = normalizeSearchText(value);
  const raw = normalized.match(/[pbc][+-]|[a-z0-9]+(?:[+.-][a-z0-9]+)*/g) || [];
  return [...new Set(raw.filter((token) =>
    token.length >= 2 || /^[pbc][+-]$/.test(token) || /\d/.test(token),
  ))];
};

export function redactPii(value) {
  let text = clean(value);
  let redactions = 0;
  for (const [patternIndex, pattern] of PII_PATTERNS.entries()) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, (match) => {
      // Hallsensorsekvenser som 011-001-101 är tekniska binärvärden, inte telefonnummer.
      if (patternIndex === 3 && !/[2-9]/.test(match)) return match;
      redactions += 1;
      return "[REDACTED]";
    });
  }
  return { text, redactions };
}

export function containsPii(value) {
  return redactPii(value).redactions > 0;
}

const safeText = (value, counter, max = 4000) => {
  const result = redactPii(clean(value, max));
  counter.count += result.redactions;
  return result.text;
};

const safeList = (value, counter, maxItems = 50, maxLength = 2000) =>
  asList(value, maxItems, maxLength)
    .map((item) => safeText(item, counter, maxLength))
    .filter(Boolean);

export const stripPriceFragments = (value) => clean(String(value ?? "")
  .replace(/\([^()]{0,180}(?:\b(?:kr|sek|usd|eur)\b|[€$])[^()]{0,180}\)/giu, "")
  .replace(/(?:ca\.?\s*)?\d[\d\s.,]*(?:[-–—]\s*\d[\d\s.,]*)?\s*(?:kr|sek|usd|eur)\b/giu, "")
  .replace(/[€$]\s*\d[\d\s.,]*/gu, ""));

const safeTechnicalText = (value, counter, max = 4000) =>
  stripPriceFragments(safeText(value, counter, max));

const safeTechnicalList = (value, counter, maxItems = 50, maxLength = 2000) =>
  safeList(value, counter, maxItems, maxLength)
    .map(stripPriceFragments)
    .filter(Boolean);

const MEASUREMENT_PATTERN =
  /\b(?:(?:P-|B-|C-)\s*)?(?:-?\d+(?:[.,]\d+)?\s*(?:-|–|—|till)\s*)?-?\d+(?:[.,]\d+)?\s*(?:mV|V|volt|mA|A|ampere|mΩ|kΩ|Ω|ohm|Ah|mAh|Wh|kW|W|°C|bar|psi|mm|%)(?![A-Za-zÅÄÖåäö])/giu;

export function extractMeasurements(values) {
  const measurements = [];
  for (const value of values.flatMap((item) => asList(item))) {
    for (const match of value.matchAll(MEASUREMENT_PATTERN)) {
      const context = value.slice(Math.max(0, (match.index || 0) - 28), match.index || 0);
      const terminal = context.match(/(?:^|[\s(])([PBC]-)(?:\s+\p{L}+){0,3}\s*$/iu)?.[1];
      const normalized = clean(`${terminal ? `${terminal} ` : ""}${match[0]}`, 80);
      if (normalized && !measurements.some((item) =>
        normalizeSearchText(item) === normalizeSearchText(normalized))) {
        measurements.push(normalized);
      }
    }
  }
  return measurements.slice(0, 30);
}

const confirmed = (value) =>
  ["confirmed", "bekraftad"].includes(normalizeSearchText(value));

const confidenceValue = (value) => {
  const normalized = normalizeSearchText(value);
  if (normalized === "bekraftad") return "bekräftad";
  if (normalized === "trolig") return "trolig";
  if (normalized === "obekraftad") return "obekräftad";
  return "obekräftad";
};

const evidenceReferences = (evidence, counter) => (Array.isArray(evidence) ? evidence : [])
  .flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const file = item.file ? safeText(basename(String(item.file)), counter, 240) : null;
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(item.date || ""))
      ? clean(item.date, 32)
      : null;
    const jsonlLine = Number.isSafeInteger(Number(item.jsonlLine))
      ? Number(item.jsonlLine)
      : null;
    const rawLineSha256 = /^[a-f0-9]{64}$/i.test(String(item.rawLineSha256 || ""))
      ? String(item.rawLineSha256).toLowerCase()
      : null;
    const turns = (Array.isArray(item.turns) ? item.turns : [])
      .map(Number)
      .filter(Number.isSafeInteger)
      .slice(0, 20);
    const reference = {
      file,
      date,
      batch: item.batch ? safeText(item.batch, counter, 80) : null,
      role: item.role ? safeText(item.role, counter, 80) : null,
      jsonlLine,
      rawLineSha256,
      turns,
    };
    return Object.values(reference).some((value) =>
      Array.isArray(value) ? value.length : value !== null && value !== "") ? [reference] : [];
  })
  .slice(0, 30);

const verifiedOutcomes = (unit, claimStatuses, counter, legacyConfirmed) => {
  const mayShow = claimStatuses
    ? confirmed(claimStatuses.repair_outcome_status)
    : legacyConfirmed;
  if (!mayShow) return [];
  return [...new Set((Array.isArray(unit.evidence) ? unit.evidence : [])
    .map((item) => item && typeof item === "object" ? safeTechnicalText(item.outcome, counter, 1200) : "")
    .filter(Boolean))].slice(0, 10);
};

const normalizeUnit = (unit, parent = null) => {
  const counter = { count: 0 };
  const confidence = confidenceValue(unit.confidence);
  const claimStatuses = unit.claimStatuses && typeof unit.claimStatuses === "object"
    ? unit.claimStatuses
    : parent?.claimStatuses && typeof parent.claimStatuses === "object"
      ? parent.claimStatuses
      : null;
  const legacyConfirmed = !claimStatuses && confidence === "bekräftad";
  const rootCauseIsConfirmed = claimStatuses
    ? confirmed(claimStatuses.root_cause_status)
    : legacyConfirmed;
  const repairIsConfirmed = claimStatuses
    ? confirmed(claimStatuses.repair_performed_status)
    : legacyConfirmed;

  const title = safeTechnicalText(unit.title, counter, 500);
  const brands = safeTechnicalList(unit.brands, counter, 20, 120);
  const models = safeTechnicalList(unit.models, counter, 30, 180);
  const errorCodes = safeTechnicalList(unit.errorCodes, counter, 30, 80);
  const symptoms = safeTechnicalList(unit.symptom, counter, 30, 1200);
  const testOrder = safeTechnicalList(unit.diagnosisPath, counter, 40, 1600);
  const rootCause = safeTechnicalText(unit.rootCause, counter, 2000);
  const repair = safeTechnicalText(unit.fix, counter, 2000);
  const parts = safeTechnicalList(unit.parts, counter, 40, 300);
  const tags = safeTechnicalList(unit.tags, counter, 50, 200);
  const notes = safeTechnicalText(unit.notes, counter, 2500);
  const measurements = extractMeasurements([
    title, brands, models, errorCodes, symptoms, testOrder, rootCause, repair, parts, tags, notes,
  ]);

  const normalized = {
    id: safeText(unit.id, counter, 200),
    title,
    brands,
    models,
    errorCodes,
    symptoms,
    measurements,
    testOrder,
    components: [...new Set([...parts, ...tags])],
    suspectedCauses: !rootCauseIsConfirmed && rootCause ? [rootCause] : [],
    confirmedCause: rootCauseIsConfirmed && rootCause ? rootCause : null,
    repairPerformed: repairIsConfirmed && repair ? repair : null,
    verifiedOutcome: verifiedOutcomes(unit, claimStatuses, counter, legacyConfirmed),
    confidence,
    safetyCritical: unit.safetyCritical === true || parent?.safetyCritical === true,
    evidenceReferences: evidenceReferences(unit.evidence, counter),
    piiRedactions: counter.count,
  };

  normalized.searchFields = {
    title: [title],
    brand: brands,
    model: models,
    errorCode: errorCodes,
    symptom: symptoms,
    component: [...normalized.components, rootCause],
    measurement: measurements,
    testOrder,
  };
  normalized.searchText = normalizeSearchText(Object.values(normalized.searchFields).flat().join(" "));
  return normalized;
};

const levenshtein = (left, right) => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
};

const tokenMatch = (queryToken, candidateToken) => {
  if (queryToken === candidateToken) return "exact";
  if (queryToken.length >= 6 && candidateToken.length >= 6 &&
      (queryToken.startsWith(candidateToken) || candidateToken.startsWith(queryToken))) {
    return "prefix";
  }
  const numericModel = /\d/.test(queryToken) || /\d/.test(candidateToken);
  const tolerance = Math.max(queryToken.length, candidateToken.length) >= 8 ? 2 : 1;
  if ((numericModel || Math.min(queryToken.length, candidateToken.length) >= 4) &&
      Math.abs(queryToken.length - candidateToken.length) <= tolerance &&
      levenshtein(queryToken, candidateToken) <= tolerance) {
    return "fuzzy";
  }
  return null;
};

const scoreUnit = (unit, query) => {
  const queryTokens = searchTokens(query);
  const normalizedQuery = normalizeSearchText(query);
  if (!queryTokens.length) return null;

  const weights = {
    title: 4,
    brand: 12,
    model: 11,
    errorCode: 14,
    symptom: 8,
    component: 7,
    measurement: 10,
    testOrder: 5,
  };
  const matches = new Map();
  let score = unit.searchText.includes(normalizedQuery) ? 30 : 0;

  for (const token of queryTokens) {
    const fields = [];
    let bestMatch = null;
    for (const [field, values] of Object.entries(unit.searchFields)) {
      const candidateTokens = searchTokens(values.join(" "));
      let fieldMatch = null;
      for (const candidateToken of candidateTokens) {
        const match = tokenMatch(token, candidateToken);
        if (!match) continue;
        if (match === "exact" || !fieldMatch) fieldMatch = match;
        if (match === "exact") break;
      }
      if (!fieldMatch) continue;
      fields.push(field);
      const multiplier = fieldMatch === "exact" ? 1 : fieldMatch === "prefix" ? 0.75 : 0.55;
      score += weights[field] * multiplier;
      if (!bestMatch || fieldMatch === "exact" || (fieldMatch === "prefix" && bestMatch === "fuzzy")) {
        bestMatch = fieldMatch;
      }
    }
    if (fields.length) matches.set(token, { fields, match: bestMatch });
  }

  const requiredMatches = queryTokens.length <= 3
    ? queryTokens.length
    : Math.ceil(queryTokens.length * 0.75);
  if (matches.size < requiredMatches) return null;

  const coverage = matches.size / queryTokens.length;
  score += coverage * 20;
  if (unit.confidence === "bekräftad") score += 2;
  const matchReasons = [...matches.entries()].map(([term, details]) => ({
    term,
    fields: details.fields.map((field) => FIELD_LABELS[field]),
    match: details.match,
  }));
  return { score: Math.round(score * 100) / 100, coverage, matchReasons };
};

const publicUnit = (unit, match) => ({
  id: unit.id,
  title: unit.title,
  brands: unit.brands,
  models: unit.models,
  errorCodes: unit.errorCodes,
  symptoms: unit.symptoms,
  measurements: unit.measurements,
  testOrder: unit.testOrder,
  components: unit.components,
  suspectedCauses: unit.suspectedCauses,
  confirmedCause: unit.confirmedCause,
  repairPerformed: unit.repairPerformed,
  verifiedOutcome: unit.verifiedOutcome,
  confidence: unit.confidence,
  safetyCritical: unit.safetyCritical,
  evidenceReferences: unit.evidenceReferences,
  matchScore: match.score,
  matchCoverage: match.coverage,
  matchReasons: match.matchReasons,
});

export class RepairIntelligenceError extends Error {
  constructor(code, publicMessage, status = 503) {
    super(code);
    this.code = code;
    this.publicMessage = publicMessage;
    this.status = status;
  }
}

export class CanonicalKnowledgeSource {
  constructor({ filePath = "", expectedSha256 = "" } = {}) {
    this.filePath = clean(filePath, 2000);
    this.expectedSha256 = clean(expectedSha256, 128).toUpperCase();
    this.units = [];
    this.metadata = {
      status: "not_configured",
      code: "CANON_NOT_CONFIGURED",
      message: "Kanonsökvägen är inte konfigurerad.",
    };
    this.reload();
  }

  reload() {
    this.units = [];
    if (!this.filePath) return this.metadata;
    if (!existsSync(this.filePath)) {
      this.metadata = {
        status: "error",
        code: "CANON_FILE_MISSING",
        message: "Den lokala kanonfilen saknas. Kontrollera sökvägen och starta om NEMOB OS.",
      };
      return this.metadata;
    }

    try {
      const raw = readFileSync(this.filePath);
      const sha256 = createHash("sha256").update(raw).digest("hex").toUpperCase();
      if (this.expectedSha256 && sha256 !== this.expectedSha256) {
        this.metadata = {
          status: "error",
          code: "CANON_HASH_MISMATCH",
          message: "Kanonfilens SHA-256 stämmer inte. Uppslaget har stoppats.",
          sha256,
        };
        return this.metadata;
      }
      const parsed = JSON.parse(raw.toString("utf8"));
      if (!parsed || !Array.isArray(parsed.posts)) {
        throw new Error("invalid_schema");
      }
      const units = parsed.posts.flatMap((post) =>
        Array.isArray(post?.entries) && post.entries.length
          ? post.entries.map((entry) => normalizeUnit(entry, post))
          : [normalizeUnit(post)]);
      if (!units.length || units.some((unit) => !unit.id)) throw new Error("invalid_units");
      if (new Set(units.map((unit) => unit.id)).size !== units.length) throw new Error("duplicate_ids");

      this.units = Object.freeze(units.map(Object.freeze));
      this.metadata = {
        status: "ready",
        code: "CANON_READY",
        message: "Den lokala kanonfilen är inläst read-only.",
        version: clean(parsed.version, 80) || null,
        sha256,
        postCount: parsed.posts.length,
        unitCount: units.length,
        safetyCriticalCount: units.filter((unit) => unit.safetyCritical).length,
        piiRedactions: units.reduce((sum, unit) => sum + unit.piiRedactions, 0),
        loadedAt: new Date().toISOString(),
      };
    } catch {
      this.metadata = {
        status: "error",
        code: "CANON_INVALID",
        message: "Kanonfilen kunde inte valideras. Uppslaget har stoppats.",
      };
    }
    return this.metadata;
  }

  status() {
    return { ...this.metadata };
  }

  hasUnit(id) {
    return this.units.some((unit) => unit.id === id);
  }

  search(query, { limit = 20 } = {}) {
    if (this.metadata.status !== "ready") {
      throw new RepairIntelligenceError(
        this.metadata.code,
        this.metadata.message,
        this.metadata.code === "CANON_NOT_CONFIGURED" ? 503 : 500,
      );
    }
    const safeQuery = clean(query, 500);
    if (searchTokens(safeQuery).length === 0) {
      throw new RepairIntelligenceError("QUERY_TOO_SHORT", "Skriv minst två tecken.", 400);
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    return this.units
      .flatMap((unit) => {
        const match = scoreUnit(unit, safeQuery);
        return match ? [{ unit, match }] : [];
      })
      .sort((left, right) =>
        right.match.score - left.match.score || left.unit.title.localeCompare(right.unit.title, "sv"))
      .slice(0, safeLimit)
      .map(({ unit, match }) => publicUnit(unit, match));
  }
}

export const canonicalPathsConflict = (canonicalPath, feedbackPath) =>
  Boolean(clean(canonicalPath) && clean(feedbackPath) &&
    resolve(canonicalPath).toLocaleLowerCase("sv-SE") === resolve(feedbackPath).toLocaleLowerCase("sv-SE"));
