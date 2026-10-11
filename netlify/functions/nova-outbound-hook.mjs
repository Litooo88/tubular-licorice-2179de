// 46elks whenhangup för Novas uppringningar: sparar utfallet på köposten.
// Inte besvarat -> tillbaka i kön tills max två försök, sedan "noanswer".

import { getStore } from "@netlify/blobs";
import { OUTBOUND_MAX_ATTEMPTS } from "./_shared/nova.mjs";

const env = (n) => { try { return globalThis.Netlify?.env?.get?.(n) || process.env[n] || ""; } catch { return process.env[n] || ""; } };

export default async (request) => {
  const url = new URL(request.url);
  if (!env("VOICE_AGENT_SECRET") || url.searchParams.get("s") !== env("VOICE_AGENT_SECRET")) return new Response("unauthorized", { status: 401 });
  const key = url.searchParams.get("key") || "";
  const form = await request.formData().catch(() => null);
  const state = String(form?.get("state") || form?.get("result") || "");
  const duration = Number(form?.get("duration") || 0);
  const store = getStore({ name: "nova-outbound", consistency: "strong" });
  const entry = await store.get(key, { type: "json" }).catch(() => null);
  if (!entry) return new Response("ok");
  // Ett besvarat samtal som kopplats till Nova räcker; Novas sammanfattning
  // kommer via post-call-webhooken.
  const answered = duration >= 8 && !/fail|busy|noanswer/i.test(state);
  const status = answered ? "done" : (entry.wasTest ? "failed" : (entry.attempts || 0) >= OUTBOUND_MAX_ATTEMPTS ? "noanswer" : "queued");
  await store.setJSON(key, { ...entry, status, result: `${state || "okänt"} ${duration}s`, durationSec: duration, endedAt: new Date().toISOString() });
  return new Response("ok");
};

export const config = { path: "/api/nova-outbound-hook" };
