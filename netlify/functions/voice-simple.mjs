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

const authorizeVoiceWebhook = (request) => {
  const secret = clean(env("VOICE_WEBHOOK_SECRET"), 240);
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
  if (!auth.ok) return json({ error: "Unauthorized" }, 401);

  const sebastian = clean(env("VOICE_PRIMARY_NUMBER") || env("VOICE_SEBASTIAN_PHONE"), 40);
  const origin = new URL(request.url).origin;
  if (!sebastian) {
    return json({ hangup: "reject", reason: "voice_primary_not_configured" });
  }

  return json({
    connect: sebastian,
    timeout: 25,
    whenhangup: callbackUrl(origin),
  });
};
