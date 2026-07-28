import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanonicalKnowledgeSource,
  RepairIntelligenceError,
  canonicalPathsConflict,
} from "../lib/repair-intelligence.mjs";
import { RepairFeedbackStore } from "../lib/repair-feedback.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "repair-intelligence-canon.synthetic.json");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const source = () => new CanonicalKnowledgeSource({
  filePath: FIXTURE,
  expectedSha256: sha256(FIXTURE),
});
const first = (knowledge, query) => knowledge.search(query)[0];

test("1. NAVEE H5 kan sökas med märke och modell", () => {
  const result = first(source(), "NAVEE H5");
  assert.equal(result.id, "syn_navee_h5_start");
  assert.ok(result.matchReasons.some((reason) => reason.fields.includes("märke")));
  assert.ok(result.matchReasons.some((reason) => reason.fields.includes("modell")));
});

test("2. Ninebot G30 djupurladdat hittar batterifallet", () => {
  const result = first(source(), "Ninebot G30 djupurladdat");
  assert.equal(result.id, "syn_ninebot_g30_deep");
  assert.equal(result.safetyCritical, true);
  assert.ok(result.measurements.includes("16 V"));
});

test("3. E-Wheels E16 hittar felkod och visar endast verifierad orsak", () => {
  const result = first(source(), "E-Wheels E16");
  assert.equal(result.id, "syn_ewheels_e16");
  assert.deepEqual(result.errorCodes, ["E16"]);
  assert.match(result.confirmedCause, /Hallsensorn/);
  assert.match(result.repairPerformed, /reparerades/);
  assert.deepEqual(result.verifiedOutcome, ["Motorn fungerade efter provkörning."]);
});

test("4. KuKirin G2 broms behåller separat safety-status", () => {
  const result = first(source(), "KuKirin G2 broms");
  assert.equal(result.id, "syn_kukirin_g2_brake");
  assert.equal(result.confidence, "obekräftad");
  assert.equal(result.safetyCritical, true);
  assert.equal(result.confirmedCause, null);
});

test("5. eftermonterat RF-larm matchar komponent och symptom", () => {
  const result = first(source(), "eftermonterat RF-larm");
  assert.equal(result.id, "syn_rf_alarm");
  assert.ok(result.components.includes("RF-larm"));
  assert.ok(result.components.includes("controller"));
  assert.ok(result.components.every((component) => !/\b(?:kr|sek|usd|eur)\b/i.test(component)));
});

test("6. safety-critical batterisökning förstår BMS, P- och låg spänning", () => {
  const result = first(source(), "BMS P- låg spänning");
  assert.equal(result.id, "syn_bms_pminus");
  assert.equal(result.safetyCritical, true);
  assert.deepEqual(result.measurements, ["P- 11,8 V", "B- 41,2 V"]);
});

test("7. sökning utan träff ger en riktig tom resultatlista", () => {
  assert.deepEqual(source().search("Vespa Q99 kvantmotor"), []);
});

test("8. felskriven modellbeteckning tolereras och markeras som fuzzy", () => {
  const result = first(source(), "Ninebot G3O");
  assert.equal(result.id, "syn_ninebot_g30_deep");
  assert.ok(result.matchReasons.some((reason) => reason.term === "g3o" && reason.match === "fuzzy"));
});

test("9. två kombinerade symptom måste finnas i samma kunskapsenhet", () => {
  const results = source().search("rycker tappar kraft");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "syn_combined_symptoms");
  assert.equal(results[0].matchCoverage, 1);
});

test("10. omladdning bevarar feedback utan att ändra kanonfilen", () => {
  const knowledge = source();
  const before = sha256(FIXTURE);
  const dir = mkdtempSync(join(tmpdir(), "nemob-ri-feedback-"));
  const feedbackPath = join(dir, "feedback.jsonl");
  const store = new RepairFeedbackStore(feedbackPath);
  const saved = store.append({
    query: "NAVEE H5",
    selectedKnowledgeUnits: ["syn_navee_h5_start"],
    assessment: "helpful",
    technicalComment: "Spänningsmätningen hjälpte testordningen.",
    proposedKnowledge: "",
  }, { hasKnowledgeUnit: (id) => knowledge.hasUnit(id) });
  assert.ok(saved.record);
  assert.equal(new RepairFeedbackStore(feedbackPath).stats().count, 1);
  assert.equal(sha256(FIXTURE), before);
});

test("saknad kanonfil ger tydligt fel och aldrig falskt tom sökresultat", () => {
  const knowledge = new CanonicalKnowledgeSource({ filePath: join(tmpdir(), "saknas-v1.3.json") });
  assert.equal(knowledge.status().code, "CANON_FILE_MISSING");
  assert.throws(
    () => knowledge.search("NAVEE H5"),
    (error) => error instanceof RepairIntelligenceError && error.code === "CANON_FILE_MISSING",
  );
});

test("hashavvikelse stoppar uppslaget", () => {
  const knowledge = new CanonicalKnowledgeSource({
    filePath: FIXTURE,
    expectedSha256: "0".repeat(64),
  });
  assert.equal(knowledge.status().code, "CANON_HASH_MISMATCH");
  assert.throws(() => knowledge.search("NAVEE H5"), RepairIntelligenceError);
});

test("feedback med PII stoppas och okänd kunskapsenhet avvisas", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemob-ri-pii-"));
  const store = new RepairFeedbackStore(join(dir, "feedback.jsonl"));
  const options = { hasKnowledgeUnit: (id) => id === "syn_navee_h5_start" };
  const pii = store.append({
    query: "NAVEE H5",
    selectedKnowledgeUnits: ["syn_navee_h5_start"],
    assessment: "helpful",
    technicalComment: "Ring 070-123 45 67.",
  }, options);
  assert.equal(pii.error, "PII_DETECTED");
  const unknown = store.append({
    query: "NAVEE H5",
    selectedKnowledgeUnits: ["syn_unknown"],
    assessment: "helpful",
    technicalComment: "Teknisk notering.",
  }, options);
  assert.equal(unknown.error, "UNKNOWN_KNOWLEDGE_UNIT");
});

test("feedbacksökvägen får aldrig vara kanonfilen", () => {
  assert.equal(canonicalPathsConflict(FIXTURE, FIXTURE), true);
  assert.equal(canonicalPathsConflict(FIXTURE, `${FIXTURE}.feedback`), false);
});

test("klienten innehåller båda obligatoriska säkerhetstexterna", () => {
  const html = readFileSync(join(HERE, "..", "public", "knowledge.html"), "utf8");
  const js = readFileSync(join(HERE, "..", "public", "knowledge.js"), "utf8");
  assert.match(html, /Historiskt verkstadsfall – verifiera med mätning innan åtgärd\./);
  assert.match(js, /Säkerhetskritisk åtgärd\. Kräver manuell riskbedömning och dokumenterad kontroll\./);
});
