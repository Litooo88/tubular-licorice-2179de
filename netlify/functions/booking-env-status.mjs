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

const clean = (value, max = 5000) => String(value || "").trim().slice(0, max);
const googleCalendarDiagnostics = () => {
  const calendarId = clean(env("GOOGLE_CALENDAR_ID"), 500);
  const serviceEmail = clean(env("GOOGLE_SERVICE_ACCOUNT_EMAIL"), 240);
  const privateKey = clean(env("GOOGLE_PRIVATE_KEY"), 5000).replace(/\\n/g, "\n");

  return {
    calendarIdPresent: Boolean(calendarId),
    calendarIdLooksLikeId: Boolean(calendarId) && !/^https?:\/\//i.test(calendarId),
    serviceEmailPresent: Boolean(serviceEmail),
    serviceEmailLooksLikeServiceAccount: serviceEmail.endsWith(".iam.gserviceaccount.com"),
    privateKeyPresent: Boolean(privateKey),
    privateKeyLooksLikePem: privateKey.includes("BEGIN PRIVATE KEY") && privateKey.includes("END PRIVATE KEY"),
    privateKeyStartsWithBegin: privateKey.startsWith("-----BEGIN PRIVATE KEY-----"),
  };
};

const expected = [
  "ELKS_USERNAME",
  "ELKS_PASSWORD",
  "SMS_FROM",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "WORKSHOP_EMAIL",
  "WORKSHOP_SMS_TO",
  "GOOGLE_CALENDAR_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_CALENDAR_TIMEZONE",
  "GOOGLE_CALENDAR_DURATION_MINUTES",
];

export default async () => {
  const status = Object.fromEntries(expected.map((key) => [key, Boolean(env(key))]));
  return json({ ok: true, status, googleCalendar: googleCalendarDiagnostics() });
};

export const config = {
  path: "/api/booking-env-status",
};
