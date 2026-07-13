import assert from "node:assert/strict";
import test from "node:test";

import {
  createServiceNumber,
  findCaseByServiceNumber,
  isServiceNumber,
  normalizeServiceNumber,
  reserveServiceNumber,
} from "../netlify/functions/_shared/service-number.mjs";

class FakeStore {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async setJSON(key, value) {
    this.values.set(key, value);
  }

  async list(options = {}) {
    const keys = [...this.values.keys()].sort();
    const start = Number(options.cursor || 0);
    const page = keys.slice(start, start + 2);
    return {
      blobs: page.map((key) => ({ key })),
      cursor: start + 2 < keys.length ? String(start + 2) : undefined,
    };
  }
}

test("creates human-readable service numbers with enough random data", () => {
  const values = new Set(Array.from({ length: 50 }, () => createServiceNumber()));
  assert.equal(values.size, 50);
  for (const value of values) assert.match(value, /^NEM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test("normalizes spaces and separators without accepting arbitrary input", () => {
  assert.equal(normalizeServiceNumber(" nem a1b2 c3d4 e5f6 "), "NEM-A1B2-C3D4-E5F6");
  assert.equal(normalizeServiceNumber("2026-07-13T08-34"), "");
  assert.equal(isServiceNumber("NEM-A1B2-C3D4-E5F6"), true);
  assert.equal(isServiceNumber("NEM-A1B2-C3D4-E5FG"), false);
});

test("reserves a preferred number only for its owning case", async () => {
  const indexStore = new FakeStore();
  const first = await reserveServiceNumber(indexStore, "case_one", "NEM-A1B2-C3D4-E5F6");
  const second = await reserveServiceNumber(indexStore, "case_two", "NEM-A1B2-C3D4-E5F6");
  assert.equal(first, "NEM-A1B2-C3D4-E5F6");
  assert.notEqual(second, first);
  assert.equal(indexStore.values.get(first).caseId, "case_one");
  assert.equal(indexStore.values.get(second).caseId, "case_two");
});

test("finds indexed cases and repairs a missing index by scanning cases", async () => {
  const indexedCase = { id: "case_indexed", serviceNumber: "NEM-1111-2222-3333" };
  const scannedCase = { id: "case_scanned", serviceNumber: "NEM-AAAA-BBBB-CCCC" };
  const caseStore = new FakeStore({
    case_indexed: indexedCase,
    case_other: { id: "case_other" },
    case_scanned: scannedCase,
  });
  const indexStore = new FakeStore({
    "NEM-1111-2222-3333": { caseId: "case_indexed" },
  });

  assert.deepEqual(
    await findCaseByServiceNumber({ caseStore, indexStore, serviceNumber: "NEM-1111-2222-3333" }),
    indexedCase,
  );
  assert.deepEqual(
    await findCaseByServiceNumber({ caseStore, indexStore, serviceNumber: "nem aaaa bbbb cccc" }),
    scannedCase,
  );
  assert.equal(indexStore.values.get("NEM-AAAA-BBBB-CCCC").caseId, "case_scanned");
});
