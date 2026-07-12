import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../lib/store.mjs";
import { newTask, taskPatch } from "../lib/tasks.mjs";

const tempStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "nemob-os-test-"));
  return { dir, path: join(dir, "state.json") };
};

test("persistens överlever omstart (round-trip)", () => {
  const { dir, path } = tempStore();
  try {
    const store = new Store(path);
    const { task } = newTask({ title: "Ring kund", area: "nordic", riskLevel: "hog" });
    store.addTask(task);
    store.setPlan("2026-07-12", { date: "2026-07-12", top5: [] });
    store.setCheckin("2026-07-12", "midday", { done: "två saker" }, "2026-07-12T12:00:00.000Z");

    const reloaded = new Store(path);
    assert.equal(reloaded.tasks.length, 1);
    assert.equal(reloaded.tasks[0].title, "Ring kund");
    assert.equal(reloaded.day("2026-07-12").plan.date, "2026-07-12");
    assert.equal(reloaded.day("2026-07-12").checkins.midday.answers.done, "två saker");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("statusövergångar sätter tidsstämplar och kräver blockeringsorsak", () => {
  const { dir, path } = tempStore();
  try {
    const store = new Store(path);
    const { task } = newTask({ title: "Fixa broms" });
    store.addTask(task);

    const started = taskPatch(task, { status: "pagar" });
    assert.ok(started.patch.startedAt);
    store.updateTask(task.id, started.patch);

    const blockedWithout = taskPatch(store.taskById(task.id), { status: "blockerad" });
    assert.ok(blockedWithout.error, "blockerad utan orsak ska ge fel");

    const blocked = taskPatch(store.taskById(task.id), { status: "blockerad", blockReason: "väntar reservdel" });
    assert.equal(blocked.patch.blockReason, "väntar reservdel");
    store.updateTask(task.id, blocked.patch);

    const done = taskPatch(store.taskById(task.id), { status: "klar" });
    assert.ok(done.patch.completedAt);

    const moved = taskPatch(store.taskById(task.id), { status: "flyttad" });
    assert.match(moved.patch.movedToDate, /^\d{4}-\d{2}-\d{2}$/, "flyttad utan datum defaultar till imorgon");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("newTask validerar och normaliserar input", () => {
  assert.ok(newTask({ title: "" }).error);
  const { task } = newTask({
    title: "  Offert till kund  ",
    area: "påhittat",
    status: "påhittad",
    riskLevel: "påhittad",
    deadline: "2026-07-15T14:30",
    estimatedMinutes: "45",
    revenueSek: "1200",
  });
  assert.equal(task.title, "Offert till kund");
  assert.equal(task.area, "ovrigt");
  assert.equal(task.status, "ny");
  assert.equal(task.riskLevel, "ingen");
  assert.equal(task.deadline, "2026-07-15 14:30");
  assert.equal(task.estimatedMinutes, 45);
  assert.equal(task.revenueSek, 1200);
});
