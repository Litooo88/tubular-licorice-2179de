// Pinnad testmiljö (hotfix 2026-11-12).
//
// Netlifys byggmiljö kör `npm run build` MED produktionens miljövariabler
// (ELKS_SMS_NUMBER, WORKSHOP_SMS_TO, SMS_FROM, SITE_URL, VOICE_* …). Tester
// som förlitade sig på att en variabel var osatt (t.ex. att inkommande SMS
// till "+46101385498" matchar fallback-numret) passerade lokalt men föll i
// Netlify: sms-inbound svarade tomt eftersom ELKS_SMS_NUMBER pekade på det
// riktiga numret. Byggen för PR #170/#171 stannade därför på exit code 2.
//
// Varje test som kör funktionskod mot lagring/leverantörsmockar anropar
// `pinTestEnv({...})` i sin setup: alla variabler som påverkar beteendet tas
// bort först, sedan sätts testets egna värden. Ingen funktionskod ändras och
// inga tester hoppas över – testerna blir bara oberoende av var de körs.

export const VOLATILE_ENV_KEYS = [
  // SMS/telefoni
  "ELKS_USERNAME", "ELKS_PASSWORD", "SMS_API_USERNAME", "SMS_API_PASSWORD", "SMS_FROM",
  "ELKS_SMS_NUMBER", "ELKS_NUMBER", "PRIVATE_LINE_NUMBER", "SMS_INBOUND_SECRET",
  "SEBASTIAN_SMS_TO", "WORKSHOP_SMS_TO", "WORKSHOP_CHAT_SMS_TO",
  "VOICE_NOTIFY_TO", "VOICE_MISSED_SMS_TO", "VOICE_PRIMARY_NUMBER", "VOICE_SEBASTIAN_PHONE",
  "VOICE_WORKSHOP_PHONE", "VOICE_FALLBACK_NUMBER", "VOICE_AGENT_SECRET", "VOICE_WEBHOOK_SECRET",
  // E-post / kalender
  "RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO", "WORKSHOP_EMAIL",
  "GOOGLE_CALENDAR_ID", "GOOGLE_CALENDAR_TIMEZONE", "GOOGLE_CALENDAR_DURATION_MINUTES",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_REVIEW_LINK", "GOOGLE_REVIEW_URL",
  // Admin / lagring
  "ADMIN_TOKEN", "SITE_URL", "CASE_STORE_ALLOW_UNVERSIONED",
];

// Standardvärden som de flesta tester vill ha; testet skickar egna ovanpå.
export const TEST_ENV_DEFAULTS = {
  ADMIN_TOKEN: "adm",
  ELKS_USERNAME: "u",
  ELKS_PASSWORD: "p",
  SMS_FROM: "NordicEMob",
  // Samma nummer som testerna skickar inkommande SMS "till".
  ELKS_SMS_NUMBER: "+46101385498",
  ELKS_NUMBER: "+46101385498",
  SEBASTIAN_SMS_TO: "+46700243319",
  SITE_URL: "https://www.nordicemobility.se",
};

// Returnerar en återställningsfunktion för t.after().
export const pinTestEnv = (overrides = {}) => {
  const before = { ...process.env };
  for (const key of VOLATILE_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, TEST_ENV_DEFAULTS, overrides);
  for (const [key, value] of Object.entries(overrides)) if (value === undefined || value === null) delete process.env[key];
  return () => { process.env = before; };
};
