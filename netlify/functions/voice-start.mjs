import { tokenMatches } from "./_shared/admin-auth.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

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
  if (!secret) {
    return {
      ok: false,
      configured: false,
      status: 503,
      body: { error: "VOICE_WEBHOOK_SECRET saknas i Netlify.", code: "VOICE_WEBHOOK_SECRET_MISSING" },
    };
  }
  const url = new URL(request.url);
  const provided = clean(
    request.headers.get("x-nordic-webhook-secret") ||
      url.searchParams.get("secret") ||
      url.searchParams.get("token"),
    240,
  );
  return { ok: tokenMatches(secret, provided), configured: true };
};

const normalizePhone = (value) => {
  const compact = clean(value, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const voiceConfig = () => ({
  sebastian: normalizePhone(env("VOICE_SEBASTIAN_PHONE")),
  workshop: normalizePhone(env("VOICE_WORKSHOP_PHONE")),
  workshopNumber: normalizePhone(env("VOICE_CALLER_ID")) || "+46101385498",
  timeout: Math.max(8, Math.min(30, Number(env("VOICE_TIMEOUT_SECONDS") || 18))),
});

const parseBody = async (request) => {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json().catch(() => ({}));
  }
  const form = await request.formData().catch(() => null);
  if (!form) return {};
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, clean(value, 2000)]));
};

const connectAction = ({ to, callerid, timeout, nextUrl }) => ({
  connect: to,
  callerid,
  timeout: String(timeout),
  next: nextUrl,
});

const hangupAction = () => ({ hangup: "reject" });

const smsConfig = () => ({
  username: env("ELKS_USERNAME") || env("SMS_API_USERNAME"),
  password: env("ELKS_PASSWORD") || env("SMS_API_PASSWORD"),
  from: clean(env("SMS_FROM") || "NordicEMob", 11),
});

const smsRecipients = () => {
  const configured = (env("VOICE_MISSED_SMS_TO") || env("WORKSHOP_SMS_TO"))
    .split(",")
    .map((item) => normalizePhone(item))
    .filter(Boolean);
  return [...new Set(configured)];
};

const sendMissedCallSms = async ({ customerNumber, result, callid }) => {
  const { username, password, from } = smsConfig();
  const recipients = smsRecipients();
  if (!username || !password || !recipients.length) return { status: "not_configured" };

  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
  const message = [
    "Missat verkstadssamtal.",
    `Kund: ${customerNumber || "okant nummer"}`,
    `Tid: ${time}`,
    `Status: ${result || "ej svar"}`,
    callid ? `Call ID: ${callid}` : "",
  ].filter(Boolean).join("\n");

  const payloadFor = (to) => new URLSearchParams({
    from,
    to,
    message,
    dontlog: "message",
  });

  const results = await Promise.all(recipients.map(async (to) => {
    try {
      const response = await fetch("https://api.46elks.com/a1/sms", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: payloadFor(to),
        signal: AbortSignal.timeout(7000),
      });
      return { to, ok: response.ok, status: response.status };
    } catch (error) {
      return { to, ok: false, error: clean(error.message, 200) };
    }
  }));

  return {
    status: results.some((item) => item.ok) ? "sent" : "failed",
    results,
  };
};

export default async (request) => {
  const webhookAuth = authorizeVoiceWebhook(request);
  if (!webhookAuth.ok) return json(webhookAuth.body || { error: "Unauthorized" }, webhookAuth.status || 401);
  const url = new URL(request.url);
  const stage = clean(url.searchParams.get("stage"), 40);
  const body = request.method === "POST" ? await parseBody(request) : {};
  const callConfig = voiceConfig();
  const baseUrl = `${url.origin}${url.pathname}`;

  if (!stage) {
    if (!callConfig.sebastian) {
      console.log("voice_start_missing_operator", { callid: body.callid || body.id, operator: "sebastian" });
      return json(hangupAction());
    }
    const action = connectAction({
      to: callConfig.sebastian,
      callerid: callConfig.workshopNumber,
      timeout: callConfig.timeout,
      nextUrl: `${baseUrl}?stage=sebastian${webhookAuth.configured ? `&secret=${encodeURIComponent(env("VOICE_WEBHOOK_SECRET"))}` : ""}`,
    });
    console.log("voice_start", { callid: body.callid || body.id, from: body.from, to: body.to, action: "sebastian" });
    return json(action);
  }

  if (stage === "sebastian") {
    const result = clean(body.result || body.state, 40);
    console.log("voice_step_sebastian", { callid: body.callid || body.id, from: body.from, result, why: body.why });
    if (result === "success") return json(hangupAction());
    if (!callConfig.workshop) {
      const sms = await sendMissedCallSms({
        customerNumber: normalizePhone(body.from),
        result: result || "workshop_not_configured",
        callid: clean(body.callid || body.id, 120),
      });
      console.log("voice_missing_workshop_sms", sms);
      return json(hangupAction());
    }
    return json(connectAction({
      to: callConfig.workshop,
      callerid: callConfig.workshopNumber,
      timeout: callConfig.timeout,
      nextUrl: `${baseUrl}?stage=workshop${webhookAuth.configured ? `&secret=${encodeURIComponent(env("VOICE_WEBHOOK_SECRET"))}` : ""}`,
    }));
  }

  if (stage === "workshop") {
    const result = clean(body.result || body.state, 40);
    console.log("voice_step_workshop", { callid: body.callid || body.id, from: body.from, result, why: body.why });
    if (result !== "success") {
      const sms = await sendMissedCallSms({
        customerNumber: normalizePhone(body.from),
        result,
        callid: clean(body.callid || body.id, 120),
      });
      console.log("voice_missed_sms", sms);
    }
    return json(hangupAction());
  }

  return json(hangupAction());
};

export const config = {
  path: "/api/voice-start",
};
