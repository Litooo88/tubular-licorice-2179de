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

const expected = [
  "ELKS_USERNAME",
  "ELKS_PASSWORD",
  "SMS_FROM",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "WORKSHOP_EMAIL",
  "GOOGLE_CALENDAR_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_CALENDAR_TIMEZONE",
  "GOOGLE_CALENDAR_DURATION_MINUTES",
];

export default async () => {
  const status = Object.fromEntries(expected.map((key) => [key, Boolean(env(key))]));
  return json({ ok: true, status });
};

export const config = {
  path: "/api/booking-env-status",
};
