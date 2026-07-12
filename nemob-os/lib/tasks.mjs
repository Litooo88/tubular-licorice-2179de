// Validering och normalisering av uppgifter. All input från UI:t passerar
// hit innan den når storen.

import { randomBytes } from "node:crypto";
import { AREAS, RISK_LEVELS, STATUSES, clean, toNumberOrNull } from "./constants.mjs";

const AREA_KEYS = new Set(Object.keys(AREAS));
const STATUS_KEYS = new Set(Object.keys(STATUSES));
const RISK_KEYS = new Set(Object.keys(RISK_LEVELS));

const dateOrEmpty = (value) => {
  const match = clean(value, 40).match(/^(\d{4}-\d{2}-\d{2})([T\s](\d{2}:\d{2}))?/);
  if (!match) return "";
  return match[3] ? `${match[1]} ${match[3]}` : match[1];
};

export const newTask = (input, now = new Date()) => {
  const title = clean(input.title, 200);
  if (!title) return { error: "Titel krävs." };
  const area = AREA_KEYS.has(input.area) ? input.area : "ovrigt";
  const nowIso = now.toISOString();
  return {
    task: {
      id: `t_${now.getTime().toString(36)}_${randomBytes(3).toString("hex")}`,
      title,
      area,
      deadline: dateOrEmpty(input.deadline),
      estimatedMinutes: toNumberOrNull(input.estimatedMinutes),
      riskLevel: RISK_KEYS.has(input.riskLevel) ? input.riskLevel : "ingen",
      riskNote: clean(input.riskNote, 500),
      impact: clean(input.impact, 500),
      revenueSek: toNumberOrNull(input.revenueSek),
      customerWaiting: input.customerWaiting === true,
      customerWaitingSince: dateOrEmpty(input.customerWaitingSince),
      blocksOthers: input.blocksOthers === true,
      nextStep: clean(input.nextStep, 500),
      status: STATUS_KEYS.has(input.status) ? input.status : "ny",
      blockReason: clean(input.blockReason, 500),
      pinned: input.pinned === true,
      movedToDate: dateOrEmpty(input.movedToDate),
      createdAt: nowIso,
      updatedAt: nowIso,
      startedAt: null,
      completedAt: null,
    },
  };
};

// Tillåtna fält vid uppdatering + statusövergångarnas tidsstämplar.
export const taskPatch = (existing, input, now = new Date()) => {
  const patch = { updatedAt: now.toISOString() };

  if (input.title !== undefined) {
    const title = clean(input.title, 200);
    if (!title) return { error: "Titel kan inte vara tom." };
    patch.title = title;
  }
  if (input.area !== undefined && AREA_KEYS.has(input.area)) patch.area = input.area;
  if (input.deadline !== undefined) patch.deadline = dateOrEmpty(input.deadline);
  if (input.estimatedMinutes !== undefined) patch.estimatedMinutes = toNumberOrNull(input.estimatedMinutes);
  if (input.riskLevel !== undefined && RISK_KEYS.has(input.riskLevel)) patch.riskLevel = input.riskLevel;
  if (input.riskNote !== undefined) patch.riskNote = clean(input.riskNote, 500);
  if (input.impact !== undefined) patch.impact = clean(input.impact, 500);
  if (input.revenueSek !== undefined) patch.revenueSek = toNumberOrNull(input.revenueSek);
  if (input.customerWaiting !== undefined) patch.customerWaiting = input.customerWaiting === true;
  if (input.customerWaitingSince !== undefined) patch.customerWaitingSince = dateOrEmpty(input.customerWaitingSince);
  if (input.blocksOthers !== undefined) patch.blocksOthers = input.blocksOthers === true;
  if (input.nextStep !== undefined) patch.nextStep = clean(input.nextStep, 500);
  if (input.blockReason !== undefined) patch.blockReason = clean(input.blockReason, 500);
  if (input.pinned !== undefined) patch.pinned = input.pinned === true;
  if (input.movedToDate !== undefined) patch.movedToDate = dateOrEmpty(input.movedToDate);

  if (input.status !== undefined) {
    if (!STATUS_KEYS.has(input.status)) return { error: "Ogiltig status." };
    patch.status = input.status;
    if (input.status === "pagar" && !existing.startedAt) patch.startedAt = now.toISOString();
    if (input.status === "klar") patch.completedAt = now.toISOString();
    if (input.status !== "klar" && existing.status === "klar") patch.completedAt = null;
    if (input.status === "blockerad" && !clean(input.blockReason ?? existing.blockReason, 500)) {
      return { error: "Blockeringsorsak krävs när en uppgift markeras blockerad." };
    }
    if (input.status === "flyttad" && !dateOrEmpty(input.movedToDate ?? existing.movedToDate)) {
      // Flyttad utan datum = flyttad till imorgon.
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      patch.movedToDate = tomorrow.toISOString().slice(0, 10);
    }
  }

  return { patch };
};
