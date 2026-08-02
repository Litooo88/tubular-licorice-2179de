// Schemalagd synk av 46elks-webhookarna mot SITE_URL (krisläge 2026-07-29:
// .se-domänens DNS spärrades av Strato och webhookarna pekade på en död värd —
// hela samtalskedjan slutade fungera). Funktionen jämför voice_start/sms_url
// på vårt nummer med det SITE_URL säger att de ska vara och rättar vid diff.
// Idempotent och självläkande: när .se är återställd och SITE_URL pekar hem
// synkas webhookarna tillbaka automatiskt. Secrets loggas aldrig i klartext.

const env = (key) => process.env[key] || "";
const normalizePhone = (value) => String(value || "").replace(/[^+\d]/g, "");
const mask = (url) => String(url || "").replace(/secret=[^&]+/, "secret=***");

export default async () => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  if (!username || !password) return new Response("not_configured");

  const siteUrl = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
  const voiceSecret = env("VOICE_WEBHOOK_SECRET").trim();
  const smsSecret = env("SMS_INBOUND_SECRET").trim();
  const ourNumber = normalizePhone(env("ELKS_NUMBER") || "+46101385498");
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  const listResponse = await fetch("https://api.46elks.com/a1/numbers", {
    headers: { Authorization: authHeader },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!listResponse?.ok) {
    console.log(`elks-webhook-sync: kunde inte lista nummer (HTTP ${listResponse?.status || "nätfel"}).`);
    return new Response("list_failed", { status: 502 });
  }
  const listBody = await listResponse.json().catch(() => ({}));
  const numberEntry = (Array.isArray(listBody?.data) ? listBody.data : []).find(
    (item) => normalizePhone(item.number) === ourNumber && item.active !== "no",
  );
  if (!numberEntry) {
    console.log(`elks-webhook-sync: numret ${ourNumber} hittades inte på kontot.`);
    return new Response("number_missing", { status: 404 });
  }

  const desired = {};
  // voice_start rörs bara när VOICE_WEBHOOK_SECRET finns — utan secret skulle
  // vi skriva en URL som voice-simple avvisar och göra ont värre.
  if (voiceSecret) {
    desired.voice_start = `${siteUrl}/.netlify/functions/voice-simple?secret=${encodeURIComponent(voiceSecret)}`;
  }
  // sms_url bara om numret alls kan ta emot SMS — 010-numret är Fixed/Voice-
  // only och 46elks svarar 403 på sms_url-uppdateringar för det (2026-08-02).
  const capabilities = Array.isArray(numberEntry.capabilities) ? numberEntry.capabilities : [];
  if (capabilities.includes("sms") || capabilities.includes("mms")) {
    desired.sms_url = `${siteUrl}/api/sms-inbound${smsSecret ? `?secret=${encodeURIComponent(smsSecret)}` : ""}`;
  }

  const changes = {};
  for (const [field, wanted] of Object.entries(desired)) {
    if ((numberEntry[field] || "") !== wanted) changes[field] = wanted;
  }
  if (!Object.keys(changes).length) {
    return new Response(JSON.stringify({ ok: true, unchanged: true, host: new URL(siteUrl).host }));
  }

  const updateResponse = await fetch(`https://api.46elks.com/a1/numbers/${encodeURIComponent(numberEntry.id)}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(changes),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!updateResponse?.ok) {
    console.log(`elks-webhook-sync: uppdatering nekades (HTTP ${updateResponse?.status || "nätfel"}).`);
    return new Response("update_failed", { status: 502 });
  }

  console.log(
    `elks-webhook-sync: webhookar ompekade till ${new URL(siteUrl).host}: ` +
      Object.entries(changes).map(([field, value]) => `${field}=${mask(value)}`).join(", "),
  );
  return new Response(JSON.stringify({ ok: true, updated: Object.keys(changes), host: new URL(siteUrl).host }));
};

export const config = { schedule: "*/15 * * * *" };
