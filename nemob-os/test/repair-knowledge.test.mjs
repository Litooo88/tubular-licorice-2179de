import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepairKnowledgeStore, normalizeKnowledgeRecord } from "../lib/repair-knowledge.mjs";

const base = {
  id: "chatgpt_test_1",
  source: "chatgpt_history",
  sourceTitle: "Ninebot E16",
  brand: "ninebot",
  model: "Ninebot G30",
  errorCodes: ["E16"],
  symptoms: ["Hjulet snurrar inte"],
  testsPerformed: ["Testade gasreglaget"],
  likelyRootCause: "wiring",
  confirmedRootCause: "wiring",
  resolution: "Bytte skadad kabel och felet försvann.",
  partsMentioned: ["kabel"],
  diagnosticLesson: "Kontrollera kablage före controllerbyte.",
  confidence: "high",
  status: "confirmed_fix",
  reviewStatus: "approved",
  privacyCleaned: true,
  excerpt: "Rensat utdrag",
};

test("normalisering avvisar ogiltiga enumvärden", () => {
  assert.equal(normalizeKnowledgeRecord({ ...base, likelyRootCause: "magiskt_fel" }).error, "invalid_likely_root_cause");
});

test("import är atomisk, idempotent och bara godkänd data tas in", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemob-knowledge-"));
  const file = join(dir, "repair-knowledge.jsonl");
  const store = new RepairKnowledgeStore(file);
  const first = store.importRecords([base]);
  assert.equal(first.inserted, 1);
  assert.equal(store.records.length, 1);
  const second = store.importRecords([base]);
  assert.equal(second.skipped, 1);
  assert.equal(store.records.length, 1);
  assert.match(readFileSync(file, "utf8"), /chatgpt_test_1/);
});

test("sökning prioriterar exakt felkod och bekräftad lösning", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemob-knowledge-search-"));
  const store = new RepairKnowledgeStore(join(dir, "repair-knowledge.jsonl"));
  store.importRecords([
    base,
    { ...base, id: "chatgpt_test_2", errorCodes: ["E14"], model: "Xiaomi Pro 2", brand: "xiaomi", confidence: "medium", status: "likely_cause", confirmedRootCause: null },
  ]);
  const hits = store.search("E16 hjulet snurrar inte");
  assert.equal(hits[0].id, "chatgpt_test_1");
  assert.equal(hits[0].confirmedRootCause, "wiring");
});
