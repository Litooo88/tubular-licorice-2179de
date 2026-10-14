// Admin-API för Nova: Ring upp-listan, samtalshistoriken och uppringningskön.
//
//   GET  /api/nova                     -> allt som sidan /admin/ring-upp/ visar
//   POST /api/nova/done                {kind: meeting|message|ring|call, id}
//   POST /api/nova/outbound-queue      {entries:[{phone,name,reason,lastCallAt,priority,label}]}
//   POST /api/nova/outbound-config     {enabled, maxPerRun}
//   POST /api/nova/outbound-test       {phone}  -> ett testsamtal direkt (oavsett tid)
//   POST /api/nova/outbound-clear      {status?} -> tar bort köposter (t.ex. queued)
//
// Kräver admin-token. Inget här skickar SMS till kunder.

import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { normalizePhone } from "./_shared/sms.mjs";
import { listBlockedNumbers } from "./_shared/call-blocklist.mjs";
import { buildNovaStats, callOutcome, classifyNovaCall, ownNovaNumbers } from "./_shared/nova.mjs";

const env = (n) => { try { return globalThis.Netlify?.env?.get?.(n) || process.env[n] || ""; } catch { return process.env[n] || ""; } };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const clean = (v, max = 400) => String(v || "").trim().slice(0, max);
const DAY = 86400000;

const readAll = async (name) => {
  const store = getStore({ name, consistency: "strong" });
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined).catch(() => ({ blobs: [] }));
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  const items = await Promise.all(keys.map(async (key) => {
    const v = await store.get(key, { type: "json" }).catch(() => null);
    return v ? { key, ...v } : null;
  }));
  return { store, items: items.filter(Boolean) };
};

export const OUTBOUND_STORE = "nova-outbound";
export const OUTBOUND_CONFIG_KEY = "_config";

export default async (request) => {
  const auth = requireAdminToken(request, json);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const action = clean(url.pathname.split("/").filter(Boolean).pop(), 40);
  const now = Date.now();

  if (request.method === "GET") {
    const days = Math.min(Number(url.searchParams.get("days")) || 14, 60);
    const since = now - days * DAY;
    const [calls, meetings, messages, inbound, outbound] = await Promise.all([
      readAll("voice-agent-calls"), readAll("voice-agent-meetings"), readAll("voice-agent-messages"), readAll("sms-inbound"), readAll(OUTBOUND_STORE),
    ]);
    const recent = (x) => new Date(x.at || 0).getTime() >= since;
    const cfg = outbound.items.find((x) => x.key === OUTBOUND_CONFIG_KEY) || { enabled: false, maxPerRun: 1 };
    const queue = outbound.items.filter((x) => x.key !== OUTBOUND_CONFIG_KEY);
    const count = (s) => queue.filter((x) => x.status === s).length;
    const ownNumbers = ownNovaNumbers(env);
    return json({
      generatedAt: new Date(now).toISOString(),
      days,
      stats: buildNovaStats({ calls: calls.items, entries: queue, now, ownNumbers }),
      callbacks: {
        meetings: meetings.items.filter((m) => !m.done).sort((a, b) => String(a.at).localeCompare(String(b.at))),
        messages: messages.items.filter((m) => !m.done).sort((a, b) => String(a.at).localeCompare(String(b.at))),
        ring: inbound.items.filter((r) => r.type === "ring" && !r.handled).sort((a, b) => String(a.at).localeCompare(String(b.at))),
        doneRecent: [...meetings.items, ...messages.items].filter((m) => m.done && recent({ at: m.doneAt })).length,
      },
      calls: calls.items.filter(recent).sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .map((c) => {
          const cls = classifyNovaCall(c, queue, { ownNumbers });
          return {
            id: c.id, at: c.startedAt || c.at, phone: cls.phone || c.phone, durationSec: c.durationSec, outcome: c.outcome, summary: c.summary, transcript: c.transcript,
            meetingBooked: c.meetingBooked, customer: c.customer, done: Boolean(c.done),
            kind: cls.kind, outboundKey: cls.outboundKey, result: callOutcome(c), endReason: c.endReason || "", tools: c.tools || [],
          };
        }),
      outbound: {
        config: { enabled: Boolean(cfg.enabled), maxPerRun: Number(cfg.maxPerRun) || 1, updatedAt: cfg.updatedAt || null },
        counts: { queued: count("queued"), calling: count("calling"), done: count("done"), noanswer: count("noanswer"), failed: count("failed"), test: count("test") },
        recent: queue.filter((x) => x.status !== "queued").sort((a, b) => String(b.lastAttemptAt || "").localeCompare(String(a.lastAttemptAt || ""))).slice(0, 40),
        next: queue.filter((x) => x.status === "queued").sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).slice(0, 15),
      },
    });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({}));

  if (action === "done") {
    const kind = clean(body.kind, 20);
    const id = clean(body.id, 200);
    const storeName = { meeting: "voice-agent-meetings", message: "voice-agent-messages", ring: "sms-inbound", call: "voice-agent-calls" }[kind];
    if (!storeName || !id) return json({ error: "kind och id krävs" }, 400);
    const store = getStore({ name: storeName, consistency: "strong" });
    const item = await store.get(id, { type: "json" }).catch(() => null);
    if (!item) return json({ error: "Posten finns inte" }, 404);
    const at = new Date(now).toISOString();
    const next = kind === "ring" ? { ...item, handled: true, handledAt: at, handledBy: "Ring upp-sidan" } : { ...item, done: true, doneAt: at, note: clean(body.note, 300) || item.note || "" };
    await store.setJSON(id, next);
    return json({ ok: true });
  }

  const store = getStore({ name: OUTBOUND_STORE, consistency: "strong" });

  if (action === "outbound-config") {
    const cur = (await store.get(OUTBOUND_CONFIG_KEY, { type: "json" }).catch(() => null)) || {};
    const cfg = { ...cur, enabled: Boolean(body.enabled), maxPerRun: Math.min(Math.max(Number(body.maxPerRun) || cur.maxPerRun || 1, 1), 3), updatedAt: new Date(now).toISOString() };
    await store.setJSON(OUTBOUND_CONFIG_KEY, cfg);
    return json({ ok: true, config: cfg });
  }

  if (action === "outbound-test") {
    const phone = normalizePhone(body.phone);
    if (!/^\+46\d{8,10}$/.test(phone)) return json({ error: "Ogiltigt nummer" }, 400);
    const key = `test-${phone.replace(/\D/g, "")}`;
    await store.setJSON(key, { phone, name: clean(body.name, 60) || "Sebastian", reason: "test", status: "test", priority: -1, attempts: 0, queuedAt: new Date(now).toISOString() });
    return json({ ok: true, key, note: "Ringer inom 10 minuter (nästa körning)." });
  }

  if (action === "outbound-queue") {
    const incoming = Array.isArray(body.entries) ? body.entries.slice(0, 500) : [];
    const [{ items: optout }, blocked] = await Promise.all([readAll("sms-optout"), listBlockedNumbers()]);
    const stop = new Set([...optout.map((o) => normalizePhone(o.phone || o.key)), ...blocked.map((b) => normalizePhone(b?.phone || b))]);
    let queued = 0, skipped = 0;
    for (const e of incoming) {
      const phone = normalizePhone(e.phone);
      if (!/^\+467\d{8}$/.test(phone) || stop.has(phone)) { skipped++; continue; }
      const key = `out-${phone.replace(/\D/g, "")}`;
      const existing = await store.get(key, { type: "json" }).catch(() => null);
      if (existing && existing.status !== "queued") { skipped++; continue; }
      await store.setJSON(key, {
        phone, name: clean(e.name, 60), reason: clean(e.reason, 200), label: clean(e.label, 40), lastCallAt: clean(e.lastCallAt, 30),
        priority: Number(e.priority) || 0, status: "queued", attempts: 0, queuedAt: new Date(now).toISOString(),
      });
      queued++;
    }
    return json({ ok: true, queued, skipped });
  }

  if (action === "outbound-clear") {
    const status = clean(body.status, 20) || "queued";
    const { items } = await readAll(OUTBOUND_STORE);
    let removed = 0;
    for (const x of items) if (x.key !== OUTBOUND_CONFIG_KEY && x.status === status) { await store.delete(x.key).catch(() => {}); removed++; }
    return json({ ok: true, removed });
  }

  return json({ error: "unknown_action" }, 404);
};

export const config = { path: ["/api/nova", "/api/nova/:action"] };
