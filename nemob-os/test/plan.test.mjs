import test from "node:test";
import assert from "node:assert/strict";
import { generatePlan, summarizeDay } from "../lib/plan.mjs";

const NOW = new Date("2026-07-12T08:00:00+02:00");
const task = (id, overrides = {}) => ({
  id,
  title: `Uppgift ${id}`,
  area: "ovrigt",
  deadline: "",
  estimatedMinutes: 60,
  riskLevel: "ingen",
  riskNote: "",
  impact: "",
  revenueSek: null,
  customerWaiting: false,
  customerWaitingSince: "",
  blocksOthers: false,
  nextStep: "",
  status: "ny",
  blockReason: "",
  pinned: false,
  movedToDate: "",
  createdAt: "2026-07-12T06:00:00.000Z",
  updatedAt: "2026-07-12T06:00:00.000Z",
  startedAt: null,
  completedAt: null,
  ...overrides,
});

test("planen innehåller topp 5 med motivering och block inom budget", () => {
  const tasks = Array.from({ length: 8 }, (_, index) => task(`t${index}`));
  const plan = generatePlan(tasks, NOW);
  assert.equal(plan.top5.length, 5);
  assert.ok(plan.top5.every((entry) => entry.reason.length > 0));
  assert.ok(plan.fmBlock.usedMinutes <= plan.fmBlock.budgetMinutes);
  assert.ok(plan.emBlock.usedMinutes <= plan.emBlock.budgetMinutes);
  // 8 x 60 min = 480 min > 360 min budget => några ryms inte.
  assert.equal(
    plan.fmBlock.taskIds.length + plan.emBlock.taskIds.length + plan.unscheduled.length,
    8,
  );
  assert.ok(plan.unscheduled.length >= 2);
});

test("morgonbriefen svarar på morgonfrågorna", () => {
  const tasks = [
    task("akut", { riskLevel: "akut", riskNote: "vite" }),
    task("pengar", { revenueSek: 3000 }),
    task("blockerad", { status: "blockerad", blockReason: "väntar på del" }),
  ];
  const plan = generatePlan(tasks, NOW);
  assert.deepEqual(plan.morningBrief.urgent, ["Uppgift akut"]);
  assert.match(plan.morningBrief.mostValue, /3000 kr/);
  assert.equal(plan.morningBrief.first, "Uppgift akut");
  assert.equal(plan.morningBrief.blocked.length, 1);
  assert.equal(plan.morningBrief.blocked[0].reason, "väntar på del");
});

test("klara och blockerade uppgifter schemaläggs inte", () => {
  const tasks = [
    task("klar", { status: "klar", completedAt: NOW.toISOString() }),
    task("blockerad", { status: "blockerad", blockReason: "x" }),
    task("aktiv"),
  ];
  const plan = generatePlan(tasks, NOW);
  const scheduled = [...plan.fmBlock.taskIds, ...plan.emBlock.taskIds];
  assert.deepEqual(scheduled, ["aktiv"]);
});

test("summarizeDay fångar klart/flyttat/blockerat/tillkommit idag", () => {
  const tasks = [
    task("klar", { status: "klar", completedAt: NOW.toISOString(), createdAt: "2026-07-01T06:00:00.000Z" }),
    task("flyttad", { status: "flyttad", movedToDate: "2026-07-14", updatedAt: NOW.toISOString(), createdAt: "2026-07-01T06:00:00.000Z" }),
    task("blockerad", { status: "blockerad", blockReason: "saknar del", createdAt: "2026-07-01T06:00:00.000Z" }),
    task("nyIdag"),
  ];
  const summary = summarizeDay(tasks, NOW);
  assert.deepEqual(summary.doneToday, ["Uppgift klar"]);
  assert.equal(summary.movedToday[0].movedToDate, "2026-07-14");
  assert.equal(summary.blocked[0].reason, "saknar del");
  assert.deepEqual(summary.addedToday, ["Uppgift nyIdag"]);
  assert.equal(summary.stillOpenCount, 1);
});
