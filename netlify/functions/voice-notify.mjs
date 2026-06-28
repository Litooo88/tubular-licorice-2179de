// 46elks whenhangup callback - sends an internal missed/answered call SMS when configured.

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

const parsePayload = async (request) => {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return request.json().catch(() => ({}));
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      return Object.fromEntries([...form.entries()].map(([key, value]) => [key, clean(value, 2000)]));
    }
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch (error) {
    console.error("voice-notify parse error", { message: clean(error.message, 240) });
    return {};
  }
};

const smsConfig = () => ({
  username: env("ELKS_USERNAME") || env("SMS_API_USERNAME"),
  password: env("ELKS_PASSWORD") || env("SMS_API_PASSWORD"),
  from: clean(env("SMS_FROM") || "NordicEM", 11),
  to: clean(env("VOICE_NOTIFY_TO") || env("VOICE_MISSED_SMS_TO"), 40),
});

const sendInternalSms = async (message) => {
  const { username, password, from, to } = smsConfig();
  if (!username || !password || !to) return { status: "not_configured" };
  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from, to, message, dontlog: "message" }),
      signal: AbortSignal.timeout(7000),
    });
    return { status: response.ok ? "sent" : "failed", httpStatus: response.status };
  } catch (error) {
    console.error("voice-notify SMS error", { message: clean(error.message, 240) });
    return { status: "failed", error: clean(error.message, 240) };
  }
};

export default async (request) => {
  const auth = authorizeVoiceWebhook(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const payload = await parsePayload(request);
  const callerNo = clean(payload.from, 80) || "okant nummer";
  const state = clean(payload.state || payload.result, 80);
  const duration = Number(payload.duration || 0) || 0;
  const actions = typeof payload.actions === "string" ? payload.actions : JSON.stringify(payload.actions || "");
  const answered = (state === "success" && duration > 5) || actions.includes("connect");
  const time = new Date().toLocaleTimeString("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  });
  const message = answered
    ? `[Nordic] ${time} Besvarat samtal fran ${callerNo} (${duration}s)`
    : `[Nordic] ${time} MISSAT samtal fran ${callerNo}. Ring upp eller skicka SMS.`;
  const sms = await sendInternalSms(message);

  return new Response(JSON.stringify({ ok: true, sms, webhookSecretConfigured: auth.configured }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
