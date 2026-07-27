#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsonl, RepairKnowledgeStore } from "../nemob-os/lib/repair-knowledge.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TARGET = path.join(REPO_ROOT, "nemob-os", "data", "repair-knowledge.jsonl");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const filtered = args.filter((arg) => arg !== "--dry-run");
const [inputPath, targetPath = DEFAULT_TARGET] = filtered;

if (!inputPath || ["-h", "--help"].includes(inputPath)) {
  console.log(`Usage:
  node scripts/import-repair-knowledge.mjs <approved_repair_knowledge.jsonl> [target.jsonl] [--dry-run]

Only records with reviewStatus=approved are imported. The target defaults to:
  nemob-os/data/repair-knowledge.jsonl
`);
  process.exit(inputPath ? 0 : 1);
}

const raw = await readFile(inputPath, "utf8");
const parsed = parseJsonl(raw);
if (parsed.errors.length) {
  console.error(`Import avbruten: ${parsed.errors.length} ogiltiga JSON-rader.`);
  console.error(parsed.errors.slice(0, 10));
  process.exit(1);
}

const store = new RepairKnowledgeStore(targetPath);
const result = store.importRecords(parsed.records, { dryRun, reviewer: "Sebastian" });
console.log(JSON.stringify({ dryRun, sourceRecords: parsed.records.length, targetPath, ...result }, null, 2));
if (result.errors.length) process.exitCode = 1;
