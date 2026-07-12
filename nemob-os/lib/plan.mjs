// Dagsplansmotor: bygger morgonbrief, topp 5, förmiddags- och eftermiddagsblock
// från prioriteringsmotorns rangordning. Ren funktion utan I/O.

import { prioritize } from "./priority.mjs";
import { stockholmDate, toNumberOrNull } from "./constants.mjs";

const BLOCK_BUDGET_MINUTES = 180;
const DEFAULT_TASK_MINUTES = 45;

const minutesOf = (task) => {
  const minutes = toNumberOrNull(task.estimatedMinutes);
  return minutes && minutes > 0 ? minutes : DEFAULT_TASK_MINUTES;
};

// Fyller FM- och EM-block i prioritetsordning tills tidsbudgeten är slut.
const fillBlocks = (ranked) => {
  const fm = { label: "Förmiddag", budgetMinutes: BLOCK_BUDGET_MINUTES, usedMinutes: 0, taskIds: [] };
  const em = { label: "Eftermiddag", budgetMinutes: BLOCK_BUDGET_MINUTES, usedMinutes: 0, taskIds: [] };
  const unscheduled = [];
  for (const entry of ranked) {
    const minutes = minutesOf(entry.task);
    if (fm.usedMinutes + minutes <= fm.budgetMinutes) {
      fm.taskIds.push(entry.task.id);
      fm.usedMinutes += minutes;
    } else if (em.usedMinutes + minutes <= em.budgetMinutes) {
      em.taskIds.push(entry.task.id);
      em.usedMinutes += minutes;
    } else {
      unscheduled.push(entry.task.id);
    }
  }
  return { fm, em, unscheduled };
};

const buildMorningBrief = (ranked, tasks) => {
  const urgent = ranked.filter((entry) => entry.tier <= 2).map((entry) => entry.task.title);
  const byValue = [...ranked].sort((a, b) => {
    const ra = toNumberOrNull(a.task.revenueSek) || 0;
    const rb = toNumberOrNull(b.task.revenueSek) || 0;
    return rb - ra;
  });
  const mostValue = byValue[0] && (toNumberOrNull(byValue[0].task.revenueSek) || 0) > 0
    ? `${byValue[0].task.title} (${toNumberOrNull(byValue[0].task.revenueSek)} kr)`
    : ranked[0]?.task.title || null;
  const blocked = (tasks || [])
    .filter((task) => task.status === "blockerad")
    .map((task) => ({ title: task.title, reason: task.blockReason || "" }));
  return {
    urgent,
    mostValue,
    first: ranked[0]?.task.title || null,
    blocked,
  };
};

export const generatePlan = (tasks, now = new Date()) => {
  const ranked = prioritize(tasks, now);
  const top5 = ranked.slice(0, 5).map((entry) => ({
    taskId: entry.task.id,
    title: entry.task.title,
    tier: entry.tier,
    reason: entry.reason,
    nextStep: entry.task.nextStep || "",
    estimatedMinutes: toNumberOrNull(entry.task.estimatedMinutes),
  }));
  const { fm, em, unscheduled } = fillBlocks(ranked);
  const morningBrief = buildMorningBrief(ranked, tasks);
  return {
    date: stockholmDate(now),
    generatedAt: now.toISOString(),
    morningBrief,
    top5,
    fmBlock: fm,
    emBlock: em,
    unscheduled,
    candidateCount: ranked.length,
  };
};

// Kvällssammanfattningens beräknade del: vad hände idag, oavsett plan.
export const summarizeDay = (tasks, now = new Date()) => {
  const today = stockholmDate(now);
  const sameDay = (iso) => iso && stockholmDate(new Date(iso)) === today;
  const doneToday = (tasks || []).filter((task) => task.status === "klar" && sameDay(task.completedAt));
  const movedToday = (tasks || []).filter((task) => task.status === "flyttad" && sameDay(task.updatedAt));
  const blocked = (tasks || []).filter((task) => task.status === "blockerad");
  const addedToday = (tasks || []).filter((task) => sameDay(task.createdAt));
  const stillOpen = (tasks || []).filter((task) => ["ny", "planerad", "pagar"].includes(task.status));
  return {
    date: today,
    doneToday: doneToday.map((task) => task.title),
    movedToday: movedToday.map((task) => ({ title: task.title, movedToDate: task.movedToDate || "" })),
    blocked: blocked.map((task) => ({ title: task.title, reason: task.blockReason || "" })),
    addedToday: addedToday.map((task) => task.title),
    stillOpenCount: stillOpen.length,
  };
};
