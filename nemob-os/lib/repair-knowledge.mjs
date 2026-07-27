import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const REVIEW_STATUSES = new Set(["needs_review", "approved", "rejected", "imported"]);
export const KNOWLEDGE_STATUSES = new Set([
  "confirmed_fix", "likely_cause", "disproven", "diagnostic_step", "parts_candidate", "unknown",
]);
export const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
export const ROOT_CAUSES = new Set([
  "battery_cell", "bms", "controller", "wiring", "hall_sensor", "motor",
  "puncture", "brake", "wear", "water_damage", "user_error", "unknown",
]);

const clean = (value, max = 2000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const cleanList = (value, maxItems = 30, maxLength = 500) =>
  [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems);

export const stableKnowledgeHash = (record) => createHash("sha256")
  .update(JSON.stringify({
    source: record.source,
    sourceConversationId: record.sourceConversationId || null,
    sourceMessageIds: record.sourceMessageIds || [],
    brand: record.brand,
    model: record.model,
    errorCodes: record.errorCodes,
    symptoms: record.symptoms,
    testsPerformed: record.testsPerformed,
    likelyRootCause: record.likelyRootCause,
    confirmedRootCause: record.confirmedRootCause,
    resolution: record.resolution,
  }))
  .digest("hex");

export function normalizeKnowledgeRecord(input, { importedAt = null } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "record_not_object" };

  const reviewStatus = clean(input.reviewStatus, 30) || "needs_review";
  const status = clean(input.status, 40) || "unknown";
  const confidence = clean(input.confidence, 20) || "low";
  const likelyRootCause = clean(input.likelyRootCause, 50) || "unknown";
  const confirmedRootCause = input.confirmedRootCause == null ? null : clean(input.confirmedRootCause, 50) || null;

  if (!REVIEW_STATUSES.has(reviewStatus)) return { error: "invalid_review_status" };
  if (!KNOWLEDGE_STATUSES.has(status)) return { error: "invalid_status" };
  if (!CONFIDENCE_LEVELS.has(confidence)) return { error: "invalid_confidence" };
  if (!ROOT_CAUSES.has(likelyRootCause)) return { error: "invalid_likely_root_cause" };
  if (confirmedRootCause !== null && !ROOT_CAUSES.has(confirmedRootCause)) return { error: "invalid_confirmed_root_cause" };

  const id = clean(input.id, 160);
  if (!id) return { error: "missing_id" };

  const record = {
    id,
    source: clean(input.source, 80) || "unknown",
    sourceConversationId: clean(input.sourceConversationId, 200) || null,
    sourceMessageIds: cleanList(input.sourceMessageIds, 30, 200),
    sourceTitle: clean(input.sourceTitle, 500),
    createTime: input.createTime ? clean(input.createTime, 80) : null,
    updateTime: input.updateTime ? clean(input.updateTime, 80) : null,
    brand: clean(input.brand, 80) || "unknown",
    model: clean(input.model, 160) || "unknown",
    errorCodes: cleanList(input.errorCodes, 30, 40).map((code) => code.toUpperCase()),
    symptoms: cleanList(input.symptoms, 20, 500),
    testsPerformed: cleanList(input.testsPerformed, 30, 700),
    likelyRootCause,
    confirmedRootCause,
    resolution: input.resolution == null ? null : clean(input.resolution, 1600) || null,
    partsMentioned: cleanList(input.partsMentioned, 40, 200),
    diagnosticLesson: input.diagnosticLesson == null ? null : clean(input.diagnosticLesson, 1600) || null,
    confidence,
    status,
    reviewStatus,
    keywordHits: cleanList(input.keywordHits, 50, 120),
    voltages: cleanList(input.voltages, 40, 50),
    prices: cleanList(input.prices, 40, 50),
    timeMentions: cleanList(input.timeMentions, 40, 50),
    privacyCleaned: input.privacyCleaned === true,
    redactionWarnings: cleanList(input.redactionWarnings, 30, 180),
    excerpt: clean(input.excerpt, 5000),
    reviewedAt: input.reviewedAt ? clean(input.reviewedAt, 80) : null,
    reviewedBy: input.reviewedBy ? clean(input.reviewedBy, 120) : null,
    importedAt: importedAt || (input.importedAt ? clean(input.importedAt, 80) : null),
  };
  record.contentHash = stableKnowledgeHash(record);
  return { record };
}

export function parseJsonl(raw) {
  const records = [];
  const errors = [];
  String(raw ?? "").split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try { records.push(JSON.parse(trimmed)); }
    catch { errors.push({ line: index + 1, error: "invalid_json" }); }
  });
  return { records, errors };
}

const tokens = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .split(/\s+/)
  .filter((token) => token.length >= 2);

const searchableText = (record) => [
  record.brand, record.model, ...(record.errorCodes || []), ...(record.symptoms || []),
  ...(record.testsPerformed || []), record.likelyRootCause, record.confirmedRootCause,
  record.resolution, ...(record.partsMentioned || []), record.diagnosticLesson, record.sourceTitle,
].filter(Boolean).join(" ");

export function scoreKnowledge(record, query, filters = {}) {
  const queryText = clean(query, 500).toLowerCase();
  const queryTokens = [...new Set(tokens(query))];
  if (!queryTokens.length && !filters.brand && !filters.errorCode && !filters.rootCause) return 0;
  if (filters.brand && record.brand !== filters.brand) return 0;
  if (filters.errorCode && !(record.errorCodes || []).includes(String(filters.errorCode).toUpperCase())) return 0;
  if (filters.rootCause && ![record.likelyRootCause, record.confirmedRootCause].includes(filters.rootCause)) return 0;

  const haystack = searchableText(record).toLowerCase();
  const haystackTokens = new Set(tokens(haystack));
  let score = 0;
  if (queryText && haystack.includes(queryText)) score += 25;
  for (const token of queryTokens) {
    if (haystackTokens.has(token)) score += 3;
    if ((record.errorCodes || []).some((code) => code.toLowerCase() === token)) score += 20;
    if (String(record.brand).toLowerCase() === token) score += 10;
    if (tokens(record.model).includes(token)) score += 6;
    if (tokens(record.confirmedRootCause || record.likelyRootCause).includes(token)) score += 5;
    if ((record.symptoms || []).some((item) => tokens(item).includes(token))) score += 4;
    if ((record.partsMentioned || []).some((item) => tokens(item).includes(token))) score += 3;
  }
  if (record.status === "confirmed_fix") score += 5;
  if (record.confidence === "high") score += 3;
  else if (record.confidence === "medium") score += 1;
  return score;
}

export function compactKnowledge(record, score = null) {
  return {
    id: record.id,
    brand: record.brand,
    model: record.model,
    errorCodes: record.errorCodes,
    symptoms: record.symptoms,
    testsPerformed: record.testsPerformed,
    likelyRootCause: record.likelyRootCause,
    confirmedRootCause: record.confirmedRootCause,
    resolution: record.resolution,
    partsMentioned: record.partsMentioned,
    diagnosticLesson: record.diagnosticLesson,
    confidence: record.confidence,
    status: record.status,
    sourceTitle: record.sourceTitle,
    score,
  };
}

export class RepairKnowledgeStore {
  constructor(filePath) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    this.records = this.#load();
  }

  #load() {
    try {
      const { records } = parseJsonl(readFileSync(this.filePath, "utf8"));
      return records.flatMap((input) => {
        const normalized = normalizeKnowledgeRecord(input);
        return normalized.record && ["approved", "imported"].includes(normalized.record.reviewStatus)
          ? [normalized.record]
          : [];
      });
    } catch { return []; }
  }

  save() {
    const tmpPath = `${this.filePath}.${randomBytes(4).toString("hex")}.tmp`;
    const body = this.records.map((record) => JSON.stringify(record)).join("\n") + (this.records.length ? "\n" : "");
    writeFileSync(tmpPath, body, "utf8");
    renameSync(tmpPath, this.filePath);
  }

  importRecords(inputs, { dryRun = false, reviewer = null } = {}) {
    const existingById = new Map(this.records.map((record) => [record.id, record]));
    const next = [...this.records];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];
    const now = new Date().toISOString();

    inputs.forEach((input, index) => {
      const result = normalizeKnowledgeRecord({
        ...input,
        reviewStatus: input.reviewStatus === "approved" ? "imported" : input.reviewStatus,
        reviewedBy: input.reviewedBy || reviewer || null,
      }, { importedAt: now });
      if (!result.record) {
        errors.push({ index, id: input?.id || null, error: result.error });
        return;
      }
      const record = result.record;
      if (record.reviewStatus !== "imported") { skipped += 1; return; }
      if (!record.privacyCleaned) {
        errors.push({ index, id: record.id, error: "privacy_not_cleaned" });
        return;
      }
      const existing = existingById.get(record.id);
      if (!existing) {
        next.push(record);
        existingById.set(record.id, record);
        inserted += 1;
      } else if (existing.contentHash !== record.contentHash) {
        const position = next.findIndex((item) => item.id === record.id);
        next[position] = record;
        existingById.set(record.id, record);
        updated += 1;
      } else skipped += 1;
    });

    if (!dryRun && !errors.length) {
      this.records = next;
      this.save();
    }
    return { inserted, updated, skipped, errors, total: dryRun || errors.length ? this.records.length : next.length };
  }

  search(query, { limit = 10, brand = null, errorCode = null, rootCause = null } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    return this.records
      .map((record) => ({ record, score: scoreKnowledge(record, query, { brand, errorCode, rootCause }) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || String(b.record.updateTime || "").localeCompare(String(a.record.updateTime || "")))
      .slice(0, safeLimit)
      .map(({ record, score }) => compactKnowledge(record, score));
  }

  stats() {
    const group = (field) => this.records.reduce((acc, record) => {
      const key = record[field] || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const errors = this.records.reduce((acc, record) => {
      for (const code of record.errorCodes || []) acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});
    return {
      total: this.records.length,
      brands: group("brand"),
      statuses: group("status"),
      rootCauses: group("likelyRootCause"),
      errorCodes: errors,
    };
  }
}

export const defaultRepairKnowledgePath = (baseDir) => join(baseDir, "data", "repair-knowledge.jsonl");
