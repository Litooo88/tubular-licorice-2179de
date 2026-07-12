// Filbaserad persistens för NEMOB OS. All data ligger i nemob-os/data/
// (gitignorerad). Skrivningar är atomiska: temp-fil + rename, så en krasch
// mitt i en skrivning aldrig lämnar en halv JSON.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const EMPTY_STATE = () => ({ version: 1, tasks: [], days: {} });

export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    this.state = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object") return EMPTY_STATE();
      return {
        version: 1,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
      };
    } catch {
      return EMPTY_STATE();
    }
  }

  save() {
    const tmpPath = `${this.filePath}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(tmpPath, this.filePath);
  }

  get tasks() {
    return this.state.tasks;
  }

  taskById(id) {
    return this.state.tasks.find((task) => task.id === id) || null;
  }

  addTask(task) {
    this.state.tasks.push(task);
    this.save();
    return task;
  }

  updateTask(id, patch) {
    const task = this.taskById(id);
    if (!task) return null;
    Object.assign(task, patch);
    this.save();
    return task;
  }

  day(date) {
    if (!this.state.days[date]) this.state.days[date] = { plan: null, checkins: {} };
    return this.state.days[date];
  }

  setPlan(date, plan) {
    this.day(date).plan = plan;
    this.save();
    return plan;
  }

  setCheckin(date, type, answers, savedAt) {
    this.day(date).checkins[type] = { answers, savedAt };
    this.save();
    return this.day(date).checkins[type];
  }
}

export const defaultStorePath = (baseDir) => join(baseDir, "data", "nemob-os.json");
