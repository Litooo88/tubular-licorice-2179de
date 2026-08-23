import test from "node:test";
import assert from "node:assert/strict";
import { adviseTask, aiAdvice, loadByDay, ruleAdvice, suggestDate } from "../lib/advice.mjs";

const NOW = new Date("2026-08-24T09:00:00+02:00"); // måndag
const base = (extra = {}) => ({
  id: "t1", title: "Svara Marin och Fritid", area: "ovrigt", status: "ny", deadline: "", estimatedMinutes: 30,
  riskLevel: "ingen", riskNote: "", impact: "", revenueSek: null, customerWaiting: false, customerWaitingSince: "",
  blocksOthers: false, nextStep: "", pinned: false, movedToDate: "", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  ...extra,
});

test("belastning per dag räknar planerade minuter och hoppar över helg vid datumförslag", () => {
  const tasks = [
    base({ id: "a", status: "flyttad", movedToDate: "2026-08-25", estimatedMinutes: 280 }),
    base({ id: "b", deadline: "2026-08-26", estimatedMinutes: 60 }),
  ];
  const load = loadByDay(tasks, "2026-08-24");
  assert.equal(load["2026-08-25"], 280);
  assert.equal(load["2026-08-26"], 60);
  // tisdag full (280+45 > 300) → onsdag
  assert.equal(suggestDate(base({ estimatedMinutes: 45 }), tasks, "2026-08-24"), "2026-08-26");
  // fredag → nästa vardag är måndag, aldrig lördag/söndag
  assert.equal(suggestDate(base(), [], "2026-08-28"), "2026-08-31");
});

test("deadline passerad eller idag => gör idag, inget datum", () => {
  const advice = ruleAdvice(base({ deadline: "2026-08-23" }), [], NOW);
  assert.equal(advice.recommendation, "gor_idag");
  assert.equal(advice.suggestedDate, null);
  assert.match(advice.reasons[0], /passerad/);
});

test("kund väntar => kontakta först, jobbet får ett datum", () => {
  const advice = ruleAdvice(base({ customerWaiting: true, customerWaitingSince: "2026-08-20" }), [], NOW);
  assert.equal(advice.recommendation, "kontakta_forst");
  assert.match(advice.steps[0], /SMS|mejl/);
  assert.equal(advice.suggestedDate, "2026-08-25");
  assert.match(advice.riskIfMoved, /rykte/);
});

test("stort block => dela upp; datum senast dagen före deadline", () => {
  const advice = ruleAdvice(base({ estimatedMinutes: 180, deadline: "2026-08-27" }), [], NOW);
  assert.equal(advice.recommendation, "dela_upp");
  assert.ok(advice.suggestedDate <= "2026-08-26");
});

test("vanlig uppgift => flytta till första lediga vardag + saknade fält påpekas", () => {
  const advice = ruleAdvice(base({ estimatedMinutes: null }), [], NOW);
  assert.equal(advice.recommendation, "flytta");
  assert.equal(advice.suggestedDate, "2026-08-25");
  assert.ok(advice.steps.some((s) => /tidsuppskattning/.test(s)));
  assert.ok(advice.steps.some((s) => /deadline/i.test(s)));
  assert.ok(advice.steps.some((s) => /nästa steg/.test(s)));
});

test("aiAdvice utan nyckel => not_configured utan att skapa klient", async () => {
  let created = false;
  const result = await aiAdvice(ruleAdvice(base(), [], NOW), { env: {}, createClient: () => { created = true; } });
  assert.equal(result.status, "not_configured");
  assert.equal(created, false);
});

test("aiAdvice med nyckel: skickar json_schema, parsar svaret, nyckeln läcker inte", async () => {
  let seen;
  const createClient = (apiKey) => ({ messages: { create: async (params) => { seen = { apiKey, params }; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ recommendation: "flytta", suggestedDate: "2026-08-26", reasons: ["Tisdag är full."], steps: ["Flytta till onsdag."], riskIfMoved: "Låg.", messageToCustomer: null }) }] }; } } });
  const result = await aiAdvice(ruleAdvice(base(), [], NOW), { env: { ANTHROPIC_API_KEY: "sk-test" }, createClient });
  assert.equal(seen.apiKey, "sk-test");
  assert.equal(seen.params.model, "claude-opus-5");
  assert.equal(seen.params.output_config.format.type, "json_schema");
  assert.equal(result.status, "ok");
  assert.equal(result.advice.source, "ai");
  assert.equal(result.advice.suggestedDate, "2026-08-26");
  assert.equal(JSON.stringify(result).includes("sk-test"), false);
});

test("ogiltigt AI-svar eller API-fel => regelrådet används", async () => {
  const bad = () => ({ messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "inte json" }] }) } });
  const r1 = await adviseTask(base(), [], { now: NOW, env: { ANTHROPIC_API_KEY: "x" }, createClient: bad });
  assert.equal(r1.advice.source, "regler");
  assert.equal(r1.aiCode, "invalid_json");
  const boom = () => ({ messages: { create: async () => { const e = new Error("429"); e.status = 429; throw e; } } });
  const r2 = await adviseTask(base(), [], { now: NOW, env: { ANTHROPIC_API_KEY: "x" }, createClient: boom });
  assert.equal(r2.aiCode, "http_429");
  assert.equal(r2.advice.recommendation, "flytta");
});
