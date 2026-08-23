// Rådgivning: "ska jag boka om den här uppgiften, och i så fall hur?"
//
// Två lager:
//  1. ruleAdvice  — deterministiska regler (fungerar alltid, utan nyckel).
//  2. aiAdvice    — Claude förfinar regelrådet med full kontext (dagens topp 5,
//                   belastning, deadlines). Kräver ANTHROPIC_API_KEY i .env,
//                   annars status "not_configured" och regelrådet används.
//
// Rådet är ett FÖRSLAG. Inget ändras förrän Sebastian trycker "Tillämpa".
// Nyckeln läses bara från env, loggas aldrig och når aldrig telefonen.

import { ACTIVE_STATUSES, AREAS, clean, stockholmDate, toNumberOrNull } from "./constants.mjs";
import { classify, prioritize } from "./priority.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const WORKDAY_MINUTES = 300; // realistisk fokustid per dag utöver verkstadsdrift

export const RECOMMENDATIONS = {
  gor_idag: "Gör idag",
  flytta: "Flytta",
  dela_upp: "Dela upp",
  kontakta_forst: "Kontakta först, flytta jobbet",
  delegera: "Delegera",
  slapp: "Släpp",
};

const datePart = (value) => (clean(value, 40).match(/^\d{4}-\d{2}-\d{2}/) || [""])[0];
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T12:00:00+02:00`);
  return stockholmDate(new Date(d.getTime() + days * DAY_MS));
};
const weekday = (isoDate) => new Date(`${isoDate}T12:00:00+02:00`).getUTCDay(); // 0 = sön
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / DAY_MS);

// Belastning per dag de närmaste 7 dagarna: planerade/flyttade uppgifter + deadlines.
export const loadByDay = (tasks, today) => {
  const load = {};
  for (let i = 0; i < 8; i++) load[addDays(today, i)] = 0;
  for (const task of tasks || []) {
    if (!ACTIVE_STATUSES.has(task.status) && task.status !== "flyttad") continue;
    const day = task.status === "flyttad" ? datePart(task.movedToDate) || today : datePart(task.deadline) || today;
    if (day in load) load[day] += toNumberOrNull(task.estimatedMinutes) ?? 45;
  }
  return load;
};

// Första vardag med ledig kapacitet, senast dagen före deadline.
export const suggestDate = (task, tasks, today) => {
  const load = loadByDay(tasks, today);
  const deadline = datePart(task.deadline);
  const latest = deadline ? addDays(deadline, -1) : addDays(today, 7);
  const minutes = toNumberOrNull(task.estimatedMinutes) ?? 45;
  let best = null;
  for (let i = 1; i <= 7; i++) {
    const day = addDays(today, i);
    if (day > latest) break;
    if (weekday(day) === 0 || weekday(day) === 6) continue;
    const free = WORKDAY_MINUTES - (load[day] || 0);
    if (free >= minutes) return day;
    if (!best || (load[day] || 0) < (load[best] || 0)) best = day;
  }
  return best || (latest > today ? latest : null);
};

export const buildContext = (task, tasks, now = new Date()) => {
  const today = stockholmDate(now);
  const ranked = prioritize(tasks, now);
  const rank = ranked.findIndex((entry) => entry.task.id === task.id);
  const deadline = datePart(task.deadline);
  return {
    today,
    task: {
      title: task.title,
      area: AREAS[task.area]?.label || task.area,
      status: task.status,
      deadline: task.deadline || null,
      daysToDeadline: deadline ? daysBetween(today, deadline) : null,
      estimatedMinutes: toNumberOrNull(task.estimatedMinutes),
      riskLevel: task.riskLevel,
      riskNote: task.riskNote || "",
      impact: task.impact || "",
      revenueSek: toNumberOrNull(task.revenueSek),
      customerWaiting: task.customerWaiting === true,
      customerWaitingSince: task.customerWaitingSince || null,
      blocksOthers: task.blocksOthers === true,
      nextStep: task.nextStep || "",
      pinned: task.pinned === true,
      movedToDate: task.movedToDate || null,
      rankToday: rank >= 0 ? rank + 1 : null,
      classification: classify(task, now),
    },
    top5: ranked.slice(0, 5).map((entry) => ({ title: entry.task.title, reason: entry.reason, minutes: toNumberOrNull(entry.task.estimatedMinutes) })),
    loadByDay: loadByDay(tasks, today),
    openCount: (tasks || []).filter((item) => ACTIVE_STATUSES.has(item.status)).length,
  };
};

export const ruleAdvice = (task, tasks, now = new Date()) => {
  const ctx = buildContext(task, tasks, now);
  const t = ctx.task;
  const reasons = [];
  const steps = [];
  let recommendation = "flytta";
  let suggestedDate = suggestDate(task, tasks, ctx.today);

  if (t.pinned) { recommendation = "gor_idag"; reasons.push("Du har själv prioriterat den överst — flytta bara om något viktigare dykt upp."); }
  else if (t.daysToDeadline !== null && t.daysToDeadline <= 0) { recommendation = "gor_idag"; reasons.push(t.daysToDeadline < 0 ? `Deadline passerad med ${-t.daysToDeadline} dag(ar).` : "Deadline är idag."); }
  else if (t.riskLevel === "akut") { recommendation = "gor_idag"; reasons.push(`Akut risk: ${t.riskNote || "se uppgiften"}.`); }
  else if (t.customerWaiting) {
    recommendation = "kontakta_forst";
    reasons.push(`Kund väntar${t.customerWaitingSince ? ` sedan ${t.customerWaitingSince}` : ""} — tystnad kostar mer än väntan.`);
    steps.push("Skicka ett kort SMS/mejl nu (≤ 5 min): vad som händer och när du återkommer.");
    if (suggestedDate) steps.push(`Boka själva jobbet till ${suggestedDate} och skriv det i svaret till kunden.`);
  }
  else if (t.blocksOthers) { recommendation = "gor_idag"; reasons.push("Blockerar andra uppgifter — varje dag den väntar väntar fler."); }
  else if (t.estimatedMinutes !== null && t.estimatedMinutes > 90) {
    recommendation = "dela_upp";
    reasons.push(`${t.estimatedMinutes} min i ett block är svårt att få in en verkstadsdag.`);
    steps.push("Gör bara det första konkreta steget idag (≤ 30 min) — det som låser upp resten.");
    if (suggestedDate) steps.push(`Flytta resten till ${suggestedDate}.`);
  }
  else if (t.daysToDeadline !== null && t.daysToDeadline <= 2) {
    recommendation = suggestedDate ? "flytta" : "gor_idag";
    reasons.push(`Deadline om ${t.daysToDeadline} dag(ar) — sista säkra dag är ${suggestedDate || "idag"}.`);
  }
  else {
    reasons.push(t.rankToday && t.rankToday <= 5 ? `Ligger på plats ${t.rankToday} idag men har inget som tvingar fram den just nu.` : "Inget tvingar fram den idag.");
  }

  if (recommendation === "gor_idag") suggestedDate = null;
  if (recommendation === "flytta" && suggestedDate) {
    const load = ctx.loadByDay[suggestedDate] || 0;
    reasons.push(`${suggestedDate} har ${load} min inplanerat (${Math.max(0, WORKDAY_MINUTES - load)} min ledigt).`);
    steps.push(`Flytta till ${suggestedDate}${t.nextStep ? ` med nästa steg: ${t.nextStep}` : ""}.`);
  }
  if (t.estimatedMinutes === null) steps.push("Sätt en tidsuppskattning — utan den kan planen inte skydda dagen.");
  if (t.daysToDeadline === null && recommendation !== "gor_idag") steps.push("Sätt en deadline, annars glider den.");
  if (!t.nextStep) steps.push("Skriv ett konkret nästa steg (verb + objekt).");

  const riskIfMoved = t.customerWaiting ? "Kunden hör ingenting → dåligt rykte." : t.revenueSek ? `Intäkt ${t.revenueSek} kr skjuts framåt.` : t.daysToDeadline !== null && t.daysToDeadline <= 2 ? "Risk att deadline missas." : "Låg.";

  return { source: "regler", recommendation, recommendationLabel: RECOMMENDATIONS[recommendation], suggestedDate, reasons, steps, riskIfMoved, context: ctx };
};

const SCHEMA = {
  type: "object",
  properties: {
    recommendation: { type: "string", enum: Object.keys(RECOMMENDATIONS) },
    suggestedDate: { type: ["string", "null"], description: "YYYY-MM-DD eller null" },
    reasons: { type: "array", items: { type: "string" }, description: "Max 4 korta skäl" },
    steps: { type: "array", items: { type: "string" }, description: "Max 5 konkreta steg" },
    riskIfMoved: { type: "string" },
    messageToCustomer: { type: ["string", "null"], description: "Kort SMS-utkast om kund väntar, annars null" },
  },
  required: ["recommendation", "suggestedDate", "reasons", "steps", "riskIfMoved", "messageToCustomer"],
  additionalProperties: false,
};

const SYSTEM = `Du är Sebastians planeringsrådgivare i NEMOB OS (Nordic E-Mobility, elscooterverkstad i Örebro, en person som gör allt själv).
Du svarar på EN fråga: ska den här uppgiften bokas om, och i så fall hur? Svara kort, konkret, på svenska.
Principer: kund som väntar ska alltid få ett livstecken samma dag även om jobbet flyttas; deadline som passerat flyttas inte; stora block delas upp;
föreslå bara datum som är vardagar med ledig kapacitet (max 300 min/dag); respektera att uppgifter i områdena LVU-Myndighet och Ekonomi ofta har hårda externa datum.
Du får ett regelbaserat förslag — behåll det om det är rimligt, ändra bara med tydligt skäl. Hitta aldrig på fakta som inte finns i underlaget.`;

export const aiAdvice = async (rule, { env = process.env, createClient } = {}) => {
  const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return { status: "not_configured" };
  let client;
  try {
    if (createClient) client = createClient(apiKey);
    else {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic({ apiKey, timeout: 45000, maxRetries: 1 });
    }
  } catch {
    return { status: "not_configured" };
  }
  const { context, ...ruleOnly } = rule;
  let response;
  try {
    response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: `Underlag (JSON):\n${JSON.stringify(context)}\n\nRegelbaserat förslag:\n${JSON.stringify(ruleOnly)}` }],
    });
  } catch (error) {
    return { status: "down", code: error?.status ? `http_${error.status}` : "unreachable" };
  }
  if (response.stop_reason === "refusal") return { status: "down", code: "refusal" };
  const text = (response.content || []).filter((block) => block.type === "text").map((block) => block.text).join("");
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { status: "down", code: "invalid_json" }; }
  if (!RECOMMENDATIONS[parsed.recommendation]) return { status: "down", code: "invalid_payload" };
  return {
    status: "ok",
    advice: {
      source: "ai",
      recommendation: parsed.recommendation,
      recommendationLabel: RECOMMENDATIONS[parsed.recommendation],
      suggestedDate: datePart(parsed.suggestedDate) || null,
      reasons: (parsed.reasons || []).map((r) => clean(r, 300)).filter(Boolean).slice(0, 4),
      steps: (parsed.steps || []).map((s) => clean(s, 300)).filter(Boolean).slice(0, 5),
      riskIfMoved: clean(parsed.riskIfMoved, 300),
      messageToCustomer: clean(parsed.messageToCustomer, 400) || null,
    },
  };
};

// Orkestrering: regler först (alltid), AI ovanpå om nyckel finns.
export const adviseTask = async (task, tasks, { now = new Date(), env = process.env, createClient } = {}) => {
  const rule = ruleAdvice(task, tasks, now);
  const ai = await aiAdvice(rule, { env, createClient });
  const { context, ...ruleOnly } = rule;
  if (ai.status === "ok") return { status: "ok", advice: ai.advice, fallback: ruleOnly };
  return { status: "ok", advice: ruleOnly, aiStatus: ai.status, aiCode: ai.code || null };
};
