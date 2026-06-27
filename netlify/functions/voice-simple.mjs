// eLks voice routing - simple direct connect with optional signed hangup callback.

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);

const callbackUrl = (origin) => {
  const url = new URL("/.netlify/functions/voice-notify", origin);
  const secret = clean(env("VOICE_WEBHOOK_SECRET"), 240);
  if (secret) url.searchParams.set("secret", secret);
  return url.toString();
};

export default async (request) => {
  const sebastian = clean(env("VOICE_PRIMARY_NUMBER") || "+46700243319", 40);
  const origin = new URL(request.url).origin;

  return new Response(JSON.stringify({
    connect: sebastian,
    timeout: 25,
    whenhangup: callbackUrl(origin),
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
