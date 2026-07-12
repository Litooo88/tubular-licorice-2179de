import test from "node:test";
import assert from "node:assert/strict";
import { prioritize, topFive, classify } from "../lib/priority.mjs";

const NOW = new Date("2026-07-12T08:00:00+02:00");
const baseTask = (overrides = {}) => ({
  id: `t_${Math.random().toString(36).slice(2)}`,
  title: "Testuppgift",
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
  createdAt: "2026-07-10T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
  startedAt: null,
  completedAt: null,
  ...overrides,
});

test("prioritetsordningen följer specens tier-ordning", () => {
  const tasks = [
    baseTask({ id: "ovrig", title: "Övrig" }),
    baseTask({ id: "snabb", title: "Snabb", estimatedMinutes: 20 }),
    baseTask({ id: "blockerare", title: "Blockerare", blocksOthers: true }),
    baseTask({ id: "intakt", title: "Intäkt", revenueSek: 2000 }),
    baseTask({ id: "kund", title: "Kundväntar", customerWaiting: true }),
    baseTask({ id: "lvu", title: "LVU-deadline", area: "lvu", deadline: "2026-07-13" }),
    baseTask({ id: "akut", title: "Akut", riskLevel: "akut", riskNote: "vite" }),
  ];
  const ranked = prioritize(tasks, NOW);
  assert.deepEqual(
    ranked.map((entry) => entry.task.id),
    ["akut", "lvu", "kund", "intakt", "blockerare", "snabb", "ovrig"],
  );
});

test("klara uppgifter kommer aldrig tillbaka som aktiva", () => {
  const tasks = [
    baseTask({ id: "klar", status: "klar", riskLevel: "akut" }),
    baseTask({ id: "aktiv" }),
  ];
  const ranked = prioritize(tasks, NOW);
  assert.deepEqual(ranked.map((entry) => entry.task.id), ["aktiv"]);
});

test("blockerade uppgifter ingår inte i topp 5", () => {
  const ranked = prioritize([baseTask({ status: "blockerad", blockReason: "väntar del" })], NOW);
  assert.equal(ranked.length, 0);
});

test("flyttad uppgift återkommer när datumet är inne, inte före", () => {
  const future = prioritize([baseTask({ status: "flyttad", movedToDate: "2026-07-20" })], NOW);
  assert.equal(future.length, 0);
  const due = prioritize([baseTask({ status: "flyttad", movedToDate: "2026-07-12" })], NOW);
  assert.equal(due.length, 1);
});

test("motiveringen förklarar varför: kund som väntat med fakturerbart belopp", () => {
  const { reason, tier } = classify(
    baseTask({ customerWaiting: true, customerWaitingSince: "2026-07-08", revenueSek: 1500 }),
    NOW,
  );
  assert.equal(tier, 3);
  assert.match(reason, /väntat fyra dagar/);
  assert.match(reason, /kan faktureras idag \(1500 kr\)/);
});

test("deadline passerad ger tier 2 med tydlig motivering", () => {
  const { reason, tier } = classify(baseTask({ deadline: "2026-07-10" }), NOW);
  assert.equal(tier, 2);
  assert.match(reason, /passerad \(2026-07-10\)/);
});

test("pinnad uppgift hamnar överst oavsett annat", () => {
  const ranked = prioritize(
    [baseTask({ id: "akut", riskLevel: "akut" }), baseTask({ id: "pinnad", pinned: true })],
    NOW,
  );
  assert.equal(ranked[0].task.id, "pinnad");
});

test("topFive returnerar max 5", () => {
  const tasks = Array.from({ length: 9 }, (_, index) => baseTask({ id: `t${index}` }));
  assert.equal(topFive(tasks, NOW).length, 5);
});
