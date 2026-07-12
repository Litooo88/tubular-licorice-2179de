// Prioriteringsmotor för NEMOB OS.
// Ren funktion utan I/O så att den kan testas isolerat.
//
// Prioritetsordning (lägre tier = viktigare):
//   0. Manuellt fastnålad (pin) — användarens uttryckliga prioritering vinner.
//   1. Akut risk om uppgiften missas.
//   2. LVU-, myndighets- eller kalenderdeadline (idag/passerad, LVU inom 48h).
//   3. Kund som väntar och riskerar att tappas.
//   4. Uppgift som ger intäkt idag.
//   5. Uppgift som blockerar flera andra.
//   6. Snabb uppgift (≤30 min) med hög effekt.
//   7. Övrigt.

import { ACTIVE_STATUSES, AREAS, stockholmDate, toNumberOrNull } from "./constants.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const deadlineDatePart = (deadline) => {
  const match = String(deadline || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const daysWaiting = (task, now) => {
  const since = task.customerWaitingSince || task.createdAt || "";
  const ts = new Date(since).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return Math.max(0, Math.floor((now.getTime() - ts) / DAY_MS));
};

const dayWord = (n) => {
  const words = ["noll", "en", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio"];
  return n >= 0 && n < words.length ? words[n] : String(n);
};

// Är uppgiften kandidat för dagens plan just nu?
export const isCandidate = (task, today) => {
  if (ACTIVE_STATUSES.has(task.status)) return true;
  // Flyttade uppgifter kommer tillbaka när deras datum är inne (eller saknas).
  if (task.status === "flyttad") {
    const moved = deadlineDatePart(task.movedToDate);
    return !moved || moved <= today;
  }
  return false;
};

export const classify = (task, now) => {
  const today = stockholmDate(now);
  const deadline = deadlineDatePart(task.deadline);
  const revenue = toNumberOrNull(task.revenueSek);
  const minutes = toNumberOrNull(task.estimatedMinutes);
  const waited = task.customerWaiting ? daysWaiting(task, now) : null;

  if (task.pinned) {
    return { tier: 0, reason: "Manuellt prioriterad överst." };
  }

  if (task.riskLevel === "akut") {
    return {
      tier: 1,
      reason: task.riskNote
        ? `Akut risk om den missas: ${task.riskNote}`
        : "Akut risk om uppgiften missas.",
    };
  }

  const isAuthority = task.area === "lvu";
  const deadlineSoon = deadline && deadline <= stockholmDate(new Date(now.getTime() + 2 * DAY_MS));
  if ((isAuthority && deadlineSoon) || (deadline && deadline <= today)) {
    let when;
    if (deadline < today) when = `deadline passerad (${deadline})`;
    else if (deadline === today) when = "deadline idag";
    else when = `deadline ${deadline}`;
    const label = isAuthority ? AREAS.lvu : "Kalender";
    return { tier: 2, reason: `${label}: ${when}. Kan inte flyttas utan konsekvens.` };
  }

  if (task.customerWaiting) {
    const waitPart = waited !== null && waited > 0
      ? `Kund har väntat ${dayWord(waited)} dag${waited === 1 ? "" : "ar"}`
      : "Kund väntar på besked";
    const revenuePart = revenue && revenue > 0
      ? ` och jobbet kan faktureras idag (${revenue} kr).`
      : " och riskerar att tappas.";
    return { tier: 3, reason: `${waitPart}${revenuePart}` };
  }

  if (revenue && revenue > 0) {
    return { tier: 4, reason: `Ger intäkt idag: ${revenue} kr.` };
  }

  if (task.blocksOthers) {
    return { tier: 5, reason: "Blockerar flera andra uppgifter — frigör mest framdrift." };
  }

  if (minutes !== null && minutes > 0 && minutes <= 30) {
    const effect = task.impact ? ` Effekt: ${task.impact}` : "";
    return { tier: 6, reason: `Snabb uppgift (~${minutes} min) med hög effekt.${effect}` };
  }

  return { tier: 7, reason: "Övrig uppgift — tas när viktigare är klara." };
};

// Returnerar aktiva kandidater rangordnade, var och en med tier + motivering.
export const prioritize = (tasks, now = new Date()) => {
  const today = stockholmDate(now);
  return (tasks || [])
    .filter((task) => isCandidate(task, today))
    .map((task) => ({ task, ...classify(task, now) }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const da = deadlineDatePart(a.task.deadline) || "9999-99-99";
      const db = deadlineDatePart(b.task.deadline) || "9999-99-99";
      if (da !== db) return da.localeCompare(db);
      const ma = toNumberOrNull(a.task.estimatedMinutes) ?? Infinity;
      const mb = toNumberOrNull(b.task.estimatedMinutes) ?? Infinity;
      if (ma !== mb) return ma - mb;
      return String(a.task.createdAt || "").localeCompare(String(b.task.createdAt || ""));
    });
};

export const topFive = (tasks, now = new Date()) => prioritize(tasks, now).slice(0, 5);
