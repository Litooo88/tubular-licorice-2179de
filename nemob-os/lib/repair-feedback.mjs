import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { containsPii } from "./repair-intelligence.mjs";

export const FEEDBACK_ASSESSMENTS = new Set([
  "helpful",
  "partly_relevant",
  "incorrect_match",
  "no_relevant_knowledge",
  "new_verified_outcome",
]);

const clean = (value, max = 2000) =>
  String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max);

const cleanIds = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map((item) => clean(item, 200))
  .filter(Boolean))].slice(0, 50);

const parseLines = (raw) => String(raw ?? "").split(/\r?\n/)
  .filter((line) => line.trim())
  .flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });

export function validateFeedback(input, { hasKnowledgeUnit = () => false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "INVALID_FEEDBACK", message: "Feedbacken har ogiltigt format." };
  }
  const allowedKeys = new Set([
    "query", "selectedKnowledgeUnits", "assessment", "technicalComment", "proposedKnowledge",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return { error: "UNEXPECTED_FIELD", message: "Feedbacken innehåller ett otillåtet fält." };
  }

  const query = clean(input.query, 500);
  const selectedKnowledgeUnits = cleanIds(input.selectedKnowledgeUnits);
  const assessment = clean(input.assessment, 50);
  const technicalComment = clean(input.technicalComment, 2000);
  const proposedKnowledge = clean(input.proposedKnowledge, 3000);
  if (!query) return { error: "MISSING_QUERY", message: "Sökfrågan saknas." };
  if (!FEEDBACK_ASSESSMENTS.has(assessment)) {
    return { error: "INVALID_ASSESSMENT", message: "Välj en giltig bedömning." };
  }
  if (assessment !== "no_relevant_knowledge" && !selectedKnowledgeUnits.length) {
    return { error: "MISSING_SELECTION", message: "Välj minst en kunskapsenhet." };
  }
  if (selectedKnowledgeUnits.some((id) => !hasKnowledgeUnit(id))) {
    return { error: "UNKNOWN_KNOWLEDGE_UNIT", message: "En vald kunskapsenhet finns inte i kanon." };
  }
  if ([query, technicalComment, proposedKnowledge].some(containsPii)) {
    return {
      error: "PII_DETECTED",
      message: "Feedbacken stoppades eftersom den verkar innehålla kontakt-, person-, adress- eller fordonsuppgifter.",
    };
  }
  return {
    feedback: {
      query,
      selectedKnowledgeUnits,
      assessment,
      technicalComment: technicalComment || null,
      proposedKnowledge: proposedKnowledge || null,
    },
  };
}

export class RepairFeedbackStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.savedCount = this.#loadCount();
  }

  #loadCount() {
    if (!this.filePath || !existsSync(this.filePath)) return 0;
    try { return parseLines(readFileSync(this.filePath, "utf8")).length; }
    catch { return 0; }
  }

  stats() {
    return { count: this.savedCount };
  }

  append(input, options = {}) {
    const result = validateFeedback(input, options);
    if (!result.feedback) return result;
    const record = {
      id: `rif_${randomUUID()}`,
      date: new Date().toISOString(),
      ...result.feedback,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      flag: "a",
    });
    this.savedCount += 1;
    return {
      record: {
        id: record.id,
        date: record.date,
        count: this.savedCount,
      },
    };
  }
}

export const defaultRepairFeedbackPath = (baseDir) =>
  join(baseDir, "data", "repair-intelligence-feedback.jsonl");
