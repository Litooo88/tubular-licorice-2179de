// eLks voice routing - simple direct connect with optional signed hangup callback.

import { tokenMatches } from "./_shared/admin-auth.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);
const EMERGENCY_PRIMARY_NUMBER = "+46700243319";

const authorizeVoiceWebhook = (request) => {
  const secret = clean(env("VOICE_WEBHOOK_SECRET"), 240);
  // Keep the production call route available while the optional shared secret
  // is being rolled out in both Netlify and the 46elks number configuration.
  if (!secret) return { ok: true, configured: false };
  const url = new URL(request.url);
  const provided = clean(
    request.headers.get("x-nordic-webhook-secret") ||
      url.searchParams.get("secret") ||
      url.searchParams.get("token"),
    240,
  );
  return { ok: tokenMatches(secret, provided), configured: true };
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const callbackUrl = (origin) => {
  const url = new URL("/.netlify/functions/voice-notify", origin);
  const secret = clean(env("VOICE_WEBHOOK_SECRET"), 240);
  if (secret) url.searchParams.set("secret", secret);
  return url.toString();
};

export default async (request) => {
  const auth = authorizeVoiceWebhook(request);
  if (!auth.ok) return json(auth.body || { error: "Unauthorized" }, auth.status || 401);

  const sebastian = clean(
    env("VOICE_PRIMARY_NUMBER") || env("VOICE_SEBASTIAN_PHONE") || EMERGENCY_PRIMARY_NUMBER,
    40,
  );
  const origin = new URL(request.url).origin;
  if (!sebastian) {
    return json({ hangup: "reject", reason: "voice_primary_not_configured" });
  }

  const action = {
    connect: sebastian,
    timeout: 25,
  };
  if (auth.configured) action.whenhangup = callbackUrl(origin);

  if (!auth.configured) {
    console.warn("voice_simple_secret_not_configured", { route: "public_fallback" });
  }

  return json(action);
};
