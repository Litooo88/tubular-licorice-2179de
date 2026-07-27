#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { extractRepairKnowledge } from "./lib/chatgpt-repair-extractor.mjs";

const DEFAULT_OUTPUT_DIR = "repair-knowledge-export";

const csvEscape = (value) => {
  const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (rows, columns) => `${[
  columns.join(";"),
  ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(";")),
].join("\n")}\n`;

const usage = () => console.log(`Usage:
  node scripts/extract-chatgpt-repair-knowledge.mjs <conversations.json> [output-dir]

Output:
  repair_knowledge_seed.jsonl
  repair_cases_candidates.csv
  error_code_index.csv
  extraction_summary.json

Next:
  node scripts/build-repair-knowledge-review.mjs <output-dir>/repair_knowledge_seed.jsonl
`);

export async function runExtraction(inputPath, outputDir = DEFAULT_OUTPUT_DIR) {
  const raw = await readFile(inputPath, "utf8");
  const conversations = JSON.parse(raw);
  const candidates = extractRepairKnowledge(conversations);
  await mkdir(outputDir, { recursive: true });

  const jsonl = candidates.map((candidate) => JSON.stringify(candidate)).join("\n") + (candidates.length ? "\n" : "");
  await writeFile(path.join(outputDir, "repair_knowledge_seed.jsonl"), jsonl, "utf8");

  const columns = [
    "id", "sourceTitle", "updateTime", "brand", "model", "errorCodes", "symptoms",
    "testsPerformed", "likelyRootCause", "confirmedRootCause", "resolution", "partsMentioned",
    "diagnosticLesson", "status", "confidence", "reviewStatus", "redactionWarnings", "excerpt",
  ];
  await writeFile(path.join(outputDir, "repair_cases_candidates.csv"), toCsv(candidates, columns), "utf8");

  const errorRows = candidates.flatMap((candidate) => candidate.errorCodes.map((errorCode) => ({
    errorCode,
    brand: candidate.brand,
    model: candidate.model,
    sourceId: candidate.id,
    sourceTitle: candidate.sourceTitle,
    likelyRootCause: candidate.likelyRootCause,
    status: candidate.status,
    confidence: candidate.confidence,
  })));
  await writeFile(
    path.join(outputDir, "error_code_index.csv"),
    toCsv(errorRows, ["errorCode", "brand", "model", "sourceId", "sourceTitle", "likelyRootCause", "status", "confidence"]),
    "utf8",
  );

  const countBy = (field) => candidates.reduce((acc, candidate) => {
    const key = candidate[field] || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    generatedAt: new Date().toISOString(),
    totalConversations: conversations.length,
    candidateCount: candidates.length,
    confirmedFixes: candidates.filter((candidate) => candidate.status === "confirmed_fix").length,
    privacyWarnings: candidates.filter((candidate) => candidate.redactionWarnings.length).length,
    errorCodeMentions: errorRows.length,
    statusCounts: countBy("status"),
    brandCounts: countBy("brand"),
    confidenceCounts: countBy("confidence"),
  };
  await writeFile(path.join(outputDir, "extraction_summary.json"), JSON.stringify(summary, null, 2), "utf8");
  return summary;
}

const [, , inputPath, outputArg] = process.argv;
if (!inputPath || ["--help", "-h"].includes(inputPath)) {
  usage();
  process.exit(inputPath ? 0 : 1);
}

runExtraction(inputPath, outputArg || DEFAULT_OUTPUT_DIR)
  .then((summary) => {
    console.log(`Extraherade ${summary.candidateCount} repair-kandidater från ${summary.totalConversations} konversationer.`);
    console.log(`Nästa steg: npm run knowledge:review -- ${(outputArg || DEFAULT_OUTPUT_DIR)}/repair_knowledge_seed.jsonl`);
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
