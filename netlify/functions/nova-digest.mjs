// Ett samlat SMS om dagen till Sebastian: vad Nova gjorde i går (samtal,
// utfall, uppringningar) och alla som vill bli uppringda (Novas telefonmöten,
// RING-svar, meddelanden), med länk till /admin/ring-upp/.
// Ersätter ett SMS per samtal (Sebastian 2026-10-11: han ringer inte direkt
// ändå, en fast tid kring lunch fungerar bättre). Skickar inget när listan är tom.
//
// 10:00 UTC = 12:00 sommartid, 11:00 vintertid.

import { getStore } from "@netlify/blobs";
import { postSms } from "./_shared/sms.mjs";
import { buildCallbackDigest, buildNovaStats, novaDayLine, ownNovaNumbers } from "./_shared/nova.mjs";

const env = (n) => { try { return globalThis.Netlify?.env?.get?.(n) || process.env[n] || ""; } catch { return process.env[n] || ""; } };
const readAll = async (name) => {
  const store = getStore({ name, consistency: "strong" });
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  return (await Promise.all((blobs || []).map(async (b) => {
    const v = await store.get(b.key, { type: "json" }).catch(() => null);
    return v ? { key: b.key, ...v } : null;
  }))).filter(Boolean);
};

export default async () => {
  const to = env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO");
  if (!to) return new Response("not_configured");
  const [meetings, messages, inbound, calls, outbound] = await Promise.all([
    readAll("voice-agent-meetings"), readAll("voice-agent-messages"), readAll("sms-inbound"), readAll("voice-agent-calls"), readAll("nova-outbound"),
  ]);
  const stats = buildNovaStats({ calls, entries: outbound, ownNumbers: ownNovaNumbers(env) });
  const base = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
  const text = buildCallbackDigest({
    meetings: meetings.filter((m) => !m.done),
    messages: messages.filter((m) => !m.done),
    ring: inbound.filter((r) => r.type === "ring" && !r.handled),
    url: `${base}/admin/ring-upp/`,
    summary: novaDayLine(stats.yesterday),
  });
  if (!text) return new Response("empty");
  const sms = await postSms({ to, message: text });
  console.log("nova-digest", sms.status, text.length);
  return new Response(sms.status);
};

export const config = { schedule: "0 10 * * *" };
