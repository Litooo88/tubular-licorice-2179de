// /api/task-inbox — gemensam uppgiftsinkorg för NEMOB OS 2.0 (admin-token).
//
//   GET  /api/task-inbox?status=open|all|<status>&kind=a,b&limit=N&sync=0
//        Synkar förslag från källorna (om inte sync=0), väcker snoozade,
//        returnerar { items[], counts, sources, partial, sync, generatedAt }.
//   POST /api/task-inbox                       manuell uppgift { title, description?, phone?, name?, caseId?,
//                                         dueAt?, estimatedMinutes?, priority?, assignee?, idempotencyKey } → 201/200
//   POST /api/task-inbox/sync                  bara synk → { ok, sync, sources }
//   GET  /api/task-inbox/:id                   uppgiften (ETag)
//   POST /api/task-inbox/:id/select|start|done|reject|snooze|reopen|assign|note
//        { by?, note?, until?, assignee? }, valfri If-Match → { ok, task, unchanged } (ETag)
//   GET  /api/task-inbox/call-list?max=15      personlig ringlista med arbetsstatus
//   POST /api/task-inbox/call-list/build       { max?, by? } väljer topp-N ring-uppgifter (idempotent)
//   POST /api/task-inbox/call-list/:phone/status
//        { status: waiting|called_answered|called_no_answer|sms_sent|handled_other|callback_later,
//          note?, callbackAt?, by?, taskId? } → beständig status i ringlistan + uppgiftsövergång
//
// Inget här skickar SMS, ringer eller bekräftar bokningar: bokningsbeslut och
// utskick görs via de befintliga rutterna som `action` pekar på.
// Källfel fäller inte anropet: `sources.<namn>` bär feltexten (partial: true).
// E-post är en registrerad källa med status not_configured tills integrationen finns.

import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { CASE_STORE, etagHeaders } from "./_shared/case-store.mjs";
import { fetchElksHistory } from "./_shared/elks-history.mjs";
import { listBlockedNumbers } from "./_shared/call-blocklist.mjs";
import { ownNovaNumbers } from "./_shared/nova.mjs";
import { normalizePhone } from "./_shared/sms.mjs";
import {
  ACTIONS, buildCallList, CALL_STATUS_TASK_ACTION, CALL_WORK_STATUSES, createManualTask, deriveFromCases, deriveFromInboundSms, deriveFromMissedCalls, deriveFromNova,
  deriveFromRingList, getTask, KINDS, listTasks, OPEN_STATUSES, setCallWorkStatus, sortTasks, STATUSES, syncProposals, TASK_STORE, transitionTask, wakeSnoozed,
} from "./_shared/task-inbox.mjs";

const env = (n) => { try { return globalThis.Netlify?.env?.get?.(n) || process.env[n] || ""; } catch { return process.env[n] || ""; } };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
const clean = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const HOUR = 3600000;
const taskStore = () => getStore({ name: TASK_STORE, consistency: "strong" });
const ringStore = () => getStore({ name: "ring-list", consistency: "strong" });

const readAll = async (name) => {
  const store = getStore({ name, consistency: "strong" });
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined);
    keys.push(...(page.blobs || []).map((b) => { try { return decodeURIComponent(b.key); } catch { return b.key; } }));
    cursor = page.cursor;
  } while (cursor);
  const items = [];
  for (let i = 0; i < keys.length; i += 40) {
    const part = await Promise.all(keys.slice(i, i + 40).map(async (key) => { const v = await store.get(key, { type: "json" }).catch(() => null); return v ? { key, ...v } : null; }));
    items.push(...part.filter(Boolean));
  }
  return items;
};
const attempt = async (fn) => { try { return { items: await fn(), error: "" }; } catch (e) { return { items: [], error: clean(e?.message, 160) || "fel" }; } };

// Läser alla källor (tolerant) och härleder förslag. Exporterad för tester.
export const collectProposals = async ({ now = Date.now(), fetchImpl = fetch } = {}) => {
  const [cases, ring, inbound, meetings, messages, calls, blocked] = await Promise.all([
    attempt(async () => (await readAll(CASE_STORE)).map(({ key, ...v }) => v)),
    attempt(() => readAll("ring-list")),
    attempt(() => readAll("sms-inbound")),
    attempt(() => readAll("voice-agent-meetings")),
    attempt(() => readAll("voice-agent-messages")),
    attempt(() => readAll("voice-agent-calls")),
    attempt(async () => (await listBlockedNumbers()).map((b) => normalizePhone(b?.phone || b)).filter(Boolean)),
  ]);
  const elks = await fetchElksHistory("calls", now - 48 * HOUR, { maxPages: 3, fetchImpl });
  const sources = {
    cases: cases.error || "ok", ringList: ring.error || "ok", smsInbound: inbound.error || "ok", novaMeetings: meetings.error || "ok", novaMessages: messages.error || "ok",
    novaCalls: calls.error || "ok", elksCalls: elks.error || "ok", email: "not_configured",
  };
  const ctx = { cases: cases.items, now };
  const proposals = [
    ...deriveFromCases(cases.items, ctx),
    ...deriveFromRingList(ring.items, ctx),
    ...deriveFromInboundSms(inbound.items, ctx),
    ...deriveFromNova({ meetings: meetings.items, messages: messages.items, calls: calls.items }, ctx),
    ...deriveFromMissedCalls(elks.rows, { ...ctx, ownNumbers: ownNovaNumbers(env), blocked: new Set(blocked.items) }),
  ];
  return { proposals, sources, partial: Object.values(sources).some((s) => s !== "ok" && s !== "not_configured"), ringEntries: ring.items };
};

const counts = (tasks) => {
  const c = { total: tasks.length, open: 0, byStatus: {}, byKind: {}, byPriority: { high: 0, medium: 0, low: 0 }, needsReview: 0, minutesOpen: 0 };
  for (const t of tasks) {
    c.byStatus[t.status] = (c.byStatus[t.status] || 0) + 1;
    if (!OPEN_STATUSES.has(t.status)) continue;
    c.open += 1; c.byKind[t.kind] = (c.byKind[t.kind] || 0) + 1; c.byPriority[t.priority?.level || "low"] += 1;
    if (t.needsReview) c.needsReview += 1;
    c.minutesOpen += Number(t.estimatedMinutes) || 0;
  }
  return c;
};

export default async (request, context) => {
  const auth = requireAdminToken(request, json, "ADMIN_TOKEN saknas i Netlify.");
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean).slice(2); // efter api/tasks
  const now = Date.now();
  const store = taskStore();
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const by = clean(body.by || request.headers.get("x-operator") || "admin", 60);

  // ---- Ringlistan -------------------------------------------------------
  if (parts[0] === "call-list") {
    if (parts.length === 1 && request.method === "GET") {
      const [tasks, ring] = await Promise.all([listTasks(store), attempt(() => readAll("ring-list"))]);
      await wakeSnoozed(store, tasks, now);
      const list = buildCallList(tasks, ring.items, { now, max: Math.min(Math.max(Number(url.searchParams.get("max")) || 15, 1), 100) });
      return json({ ...list, statuses: CALL_WORK_STATUSES, sources: { ringList: ring.error || "ok" }, generatedAt: new Date(now).toISOString() });
    }
    if (parts[1] === "build" && request.method === "POST") {
      const max = Math.min(Math.max(Number(body.max) || 10, 1), 50);
      const [tasks, ring] = await Promise.all([listTasks(store), attempt(() => readAll("ring-list"))]);
      await wakeSnoozed(store, tasks, now);
      const list = buildCallList(tasks, ring.items, { now, max });
      let selected = 0;
      for (const row of list.items) {
        if (row.status === "proposed") { const r = await transitionTask(store, row.taskId, { action: "select", by, note: "Vald till dagens ringlista", now }); if (r.ok && !r.unchanged) { selected += 1; row.status = "selected"; } }
      }
      return json({ ok: true, selected, ...list, generatedAt: new Date(now).toISOString() });
    }
    if (parts.length === 3 && parts[2] === "status" && request.method === "POST") {
      const phone = normalizePhone(decodeURIComponent(parts[1]));
      const result = await setCallWorkStatus(ringStore(), phone, { status: clean(body.status, 30), note: body.note, callbackAt: body.callbackAt, by, now });
      if (!result.ok) return json({ error: result.error, description: result.description || "" }, result.status);
      // Spegla på uppgiften (den angivna eller den öppna ring-uppgiften för numret).
      const action = CALL_STATUS_TASK_ACTION[clean(body.status, 30)];
      let task = null;
      if (action) {
        let id = clean(body.taskId, 60);
        if (!id) {
          const open = sortTasks((await listTasks(store)).filter((t) => OPEN_STATUSES.has(t.status) && t.customer?.phone === phone && [KINDS.callback, KINDS.meeting_call].includes(t.kind)));
          id = open[0]?.id || "";
        }
        if (id) {
          const r = await transitionTask(store, id, { action, by, note: clean(body.note, 300) || CALL_WORK_STATUSES[body.status], until: result.entry.work?.callbackAt, now });
          task = r.ok ? r.task : { id, error: r.error };
        }
      }
      return json({ ok: true, entry: { phone: result.entry.phone, status: result.entry.status, work: result.entry.work }, task });
    }
    return json({ error: "not_found" }, 404);
  }

  // ---- Synk -------------------------------------------------------------
  if (parts[0] === "sync" && request.method === "POST") {
    const { proposals, sources, partial } = await collectProposals({ now });
    const sync = await syncProposals(store, proposals, { now, by: "sync" });
    return json({ ok: true, sync, proposals: proposals.length, sources, partial });
  }

  // ---- Enskild uppgift ---------------------------------------------------
  if (parts.length >= 1 && parts[0] !== "sync") {
    const id = clean(parts[0], 60);
    if (parts.length === 1 && request.method === "GET") {
      const read = await getTask(store, id);
      if (!read.item) return json({ error: "not_found" }, 404);
      return json(read.item, 200, etagHeaders(read.etag));
    }
    if (parts.length === 2 && request.method === "POST") {
      const action = clean(parts[1], 20);
      if (!ACTIONS[action]) return json({ error: "unknown_action", actions: Object.keys(ACTIONS) }, 404);
      const r = await transitionTask(store, id, { action, by, note: body.note, until: body.until || body.callbackAt, assignee: body.assignee, etag: request.headers.get("if-match") || "", now });
      if (!r.ok) return json({ error: r.error, description: r.description || "", ...(r.task ? { task: r.task } : {}) }, r.status, etagHeaders(r.etag));
      return json({ ok: true, task: r.task, unchanged: Boolean(r.unchanged) }, 200, etagHeaders(r.etag));
    }
    return json({ error: "not_found" }, 404);
  }

  // ---- Lista / skapa -----------------------------------------------------
  if (request.method === "POST") {
    const r = await createManualTask(store, body, { now, by });
    if (!r.ok) return json({ error: r.error, description: r.description }, 400);
    return json({ ok: true, created: r.created, task: r.task }, r.created ? 201 : 200, etagHeaders(r.etag));
  }
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const doSync = url.searchParams.get("sync") !== "0";
  let sync = null, sources = null, partial = false;
  if (doSync) {
    const collected = await collectProposals({ now });
    sources = collected.sources; partial = collected.partial;
    sync = await syncProposals(store, collected.proposals, { now, by: "sync" });
  }
  const tasks = await listTasks(store);
  await wakeSnoozed(store, tasks, now);
  const status = clean(url.searchParams.get("status"), 20) || "open";
  const kinds = clean(url.searchParams.get("kind"), 200).split(",").map((s) => s.trim()).filter(Boolean);
  if (kinds.some((k) => !KINDS[k])) return json({ error: "invalid_kind", kinds: Object.keys(KINDS) }, 400);
  if (status !== "open" && status !== "all" && !STATUSES.includes(status)) return json({ error: "invalid_status", statuses: ["open", "all", ...STATUSES] }, 400);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 1000);
  const filtered = sortTasks(tasks.filter((t) => (status === "all" || (status === "open" ? OPEN_STATUSES.has(t.status) : t.status === status)) && (!kinds.length || kinds.includes(t.kind))));
  return json({
    items: filtered.slice(0, limit).map(({ history, ...t }) => ({ ...t, historyCount: (history || []).length })),
    counts: counts(tasks), sources, partial, sync, generatedAt: new Date(now).toISOString(),
  });
};

export const config = { path: ["/api/task-inbox", "/api/task-inbox/*"] };
