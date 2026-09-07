// Schemalagd saldovakt för 46elks. Tomt saldo var grundorsaken till
// telefonhaveriet 13-17 juli och får aldrig hända tyst igen — men vakten låg
// tidigare inbakad i GET /api/call-dashboard, alltså i en läsvy som admin
// hämtar vid varje sidladdning. Den kunde därför skicka SMS och skriva blobs
// från ett anrop vars eget svar sa readOnly:true, och den slutade fungera helt
// om ingen råkade öppna admin. Nu körs den på schema, oberoende av UI.

import { getStore } from "@netlify/blobs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const WARN_THROTTLE_MS = 24 * 60 * 60 * 1000;

export default async () => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const warnTo = env("VOICE_NOTIFY_TO") || env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO");
  if (!username || !password || !warnTo) return new Response("not_configured");

  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const meResponse = await fetch("https://api.46elks.com/a1/me", {
    headers: { Authorization: authHeader },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!meResponse?.ok) return new Response("balance_unavailable", { status: 502 });

  const me = await meResponse.json().catch(() => ({}));
  if (!Number.isFinite(Number(me.balance))) return new Response("balance_unavailable", { status: 502 });

  // 46elks anger saldot i tiotusendels kronor.
  const balanceSek = Math.round(Number(me.balance) / 10000);
  const warnBelowSek = Number(env("ELKS_BALANCE_WARN_SEK")) || 100;
  if (balanceSek >= warnBelowSek) return new Response(JSON.stringify({ ok: true, balanceSek, warned: false }), {
    headers: { "Content-Type": "application/json" },
  });

  const warnStore = getStore({ name: "ops-warnings", consistency: "strong" });
  const lastWarn = await warnStore.get("elks-balance", { type: "json" }).catch(() => null);
  const throttled = Boolean(lastWarn?.at) && Date.now() - new Date(lastWarn.at).getTime() <= WARN_THROTTLE_MS;
  if (throttled) return new Response(JSON.stringify({ ok: true, balanceSek, warned: false, throttled: true }), {
    headers: { "Content-Type": "application/json" },
  });

  const response = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      from: env("SMS_FROM") || "NordicEM",
      to: warnTo,
      message: `[Nordic] VARNING: 46elks-saldot är nere på ${balanceSek} kr (gräns ${warnBelowSek} kr). Fyll på nu - vid 0 kr slutar telefon och SMS att fungera, som 13-17 juli.`,
    }).toString(),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  const status = response?.ok ? "sent" : "failed";
  await warnStore.setJSON("elks-balance", { at: new Date().toISOString(), balanceSek, result: status }).catch(() => {});
  console.log("elks-balance-guard", JSON.stringify({ balanceSek, warnBelowSek, status }));
  return new Response(JSON.stringify({ ok: true, balanceSek, warned: true, status }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  // Var fjärde timme räcker: throttlen släpper ändå bara igenom ett larm per
  // dygn, och saldot sjunker inte snabbare än så vid normal drift.
  schedule: "0 */4 * * *",
};
