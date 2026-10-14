// Novas uppringning, var tionde minut. Ringer upp nästa post i kön via 46elks;
// när kunden svarar kopplas samtalet till Nova (VOICE_AGENT_SIP) med kundens
// nummer som callerid, så att Nova ser vem det är och kan slå upp ärenden.
//
// Säkerhet: av tills Sebastian slagit på i /admin/ring-upp/ (config.enabled),
// bara vardagar 10–18, max två försök per nummer med minst 20 h mellan,
// optout/spärrlista kontrolleras när posten köas. Testsamtal (status test)
// går direkt och oavsett tid. Utan VOICE_AGENT_SIP eller 46elks-uppgifter
// händer ingenting.

import { getStore } from "@netlify/blobs";
import { isCallingWindow, pickNextOutbound } from "./_shared/nova.mjs";
import { normalizePhone } from "./_shared/sms.mjs";

const env = (n) => { try { return globalThis.Netlify?.env?.get?.(n) || process.env[n] || ""; } catch { return process.env[n] || ""; } };
const STORE = "nova-outbound";

export default async () => {
  const sip = env("VOICE_AGENT_SIP");
  const user = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const pass = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = normalizePhone(env("ELKS_SMS_NUMBER") || env("ELKS_NUMBER"));
  if (!sip || !user || !pass || !from) return new Response("not_configured");

  const store = getStore({ name: STORE, consistency: "strong" });
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  const items = (await Promise.all((blobs || []).map(async (b) => {
    const v = await store.get(b.key, { type: "json" }).catch(() => null);
    return v ? { key: b.key, ...v } : null;
  }))).filter(Boolean);
  const cfg = items.find((x) => x.key === "_config") || { enabled: false, maxPerRun: 1 };
  const queue = items.filter((x) => x.key !== "_config");

  // Ett samtal i taget: matchningen i ElevenLabs init-webhook är säkrast då.
  if (queue.some((x) => x.status === "calling" && Date.now() - new Date(x.lastAttemptAt || 0).getTime() < 5 * 60 * 1000)) {
    return new Response("busy");
  }
  // Fastnade "calling" (ingen hangup-callback) släpps tillbaka.
  for (const x of queue.filter((x) => x.status === "calling")) {
    await store.setJSON(x.key, { ...x, status: (x.attempts || 0) >= 2 ? "noanswer" : "queued", result: "ingen hangup-callback" });
  }

  const windowOpen = Boolean(cfg.enabled) && isCallingWindow();
  const next = pickNextOutbound(queue, { limit: 1, windowOpen });
  if (!next.length) return new Response(windowOpen ? "empty" : "closed");

  const base = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
  const secret = encodeURIComponent(env("VOICE_AGENT_SECRET"));
  const results = [];
  for (const entry of next) {
    const at = new Date().toISOString();
    await store.setJSON(entry.key, { ...entry, status: "calling", attempts: (entry.attempts || 0) + 1, lastAttemptAt: at, wasTest: entry.status === "test" });
    const voiceStart = JSON.stringify({ connect: sip, callerid: entry.phone, timeout: 25 });
    const res = await fetch("https://api.46elks.com/a1/calls", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ from, to: entry.phone, voice_start: voiceStart, whenhangup: `${base}/api/nova-outbound-hook?key=${encodeURIComponent(entry.key)}&s=${secret}` }),
      signal: AbortSignal.timeout(12000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e?.message || e) }));
    const text = (await res.text().catch(() => "")).slice(0, 200);
    if (!res.ok) {
      await store.setJSON(entry.key, {
        ...entry, status: "failed", attempts: (entry.attempts || 0) + 1, lastAttemptAt: at, wasTest: entry.status === "test", result: `46elks ${res.status} ${text}`,
        log: [...(entry.log || []), { at, result: "failed", state: `46elks ${res.status}`, durationSec: 0, costSek: 0 }].slice(-6),
      });
    }
    results.push({ key: entry.key, ok: res.ok, status: res.status });
  }
  console.log("nova-outbound-run", JSON.stringify(results));
  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
};

export const config = { schedule: "*/10 * * * *" };
