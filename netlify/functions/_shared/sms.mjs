// Delad SMS-hjälpare (46elks). Kanonisk implementation för NY kod.
// OBS: workshop-cases.mjs har en äldre lokal kopia som medvetet inte rörs i
// detta steg (riskminimering) — konsolidering dit är ett separat följearbete.

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

export const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

export const smsConfigured = () =>
  Boolean((env("ELKS_USERNAME") || env("SMS_API_USERNAME")) && (env("ELKS_PASSWORD") || env("SMS_API_PASSWORD")));

export const postSms = async ({ to, message }) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = (env("SMS_FROM") || "NordicEMob").slice(0, 11);
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) return { status: "invalid_phone", to: "" };
  if (!clean(message, 2000)) return { status: "missing_message", to: normalizedTo };
  if (!username || !password) return { status: "not_configured", to: normalizedTo };
  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from, to: normalizedTo, message, dontlog: "message" }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "failed", provider: "46elks", to: normalizedTo, error: clean(body.error || response.statusText, 180) };
    }
    return { status: "sent", provider: "46elks", to: normalizedTo, id: clean(body.id, 120), sentAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", provider: "46elks", to: normalizedTo, error: clean(error?.message || "sms failed", 180) };
  }
};
