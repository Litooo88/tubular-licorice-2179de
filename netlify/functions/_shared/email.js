const { clean, env } = require("./http");

// Delad Resend-hjälpare för transaktionsmejl. Samma mönster som booking.mjs:
// saknas RESEND_API_KEY/EMAIL_FROM returneras { status: "not_configured" }
// i stället för att kasta — avsändarflödet får aldrig stoppa affärslogiken.

const looksLikeResendApiKey = (value) => clean(value, 220).startsWith("re_");

const resendEmail = async ({ to, subject, html, text, idempotencyKey, replyTo }) => {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  const reply = clean(replyTo || env("EMAIL_REPLY_TO") || env("WORKSHOP_EMAIL"), 240);

  const recipients = (Array.isArray(to) ? to : [to]).map((item) => clean(item, 240)).filter(Boolean);
  if (!recipients.length) return { status: "not_requested" };
  if (!apiKey || !from || !looksLikeResendApiKey(apiKey)) return { status: "not_configured" };

  const payload = { from, to: recipients, subject, html, text };
  if (reply) payload.reply_to = reply;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": clean(idempotencyKey, 180) } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "failed", provider: "resend", error: clean(body.message || body.error || response.statusText, 180) };
    }
    return { status: "sent", provider: "resend", id: clean(body.id, 120), sentAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", provider: "resend", error: clean(error.message, 180) };
  }
};

const FOOTER_HTML = `
  <div style="border-top:1px solid #dfe5dc;margin-top:22px;padding-top:18px;color:#53605a;font-size:13px;line-height:1.55">
    <strong style="color:#111">Nordic E-Mobility</strong> &middot; Org.nr 880809-6658 &middot; Innehar F-skatt<br>
    Pistolv&auml;gen 6, 702 21 &Ouml;rebro<br>
    <a href="mailto:info@nordicemobility.se" style="color:#067a35">info@nordicemobility.se</a> &middot;
    Verkstad: <a href="tel:+46101385498" style="color:#067a35">010-138 54 98</a>
  </div>
`;

const FOOTER_TEXT = [
  "",
  "Nordic E-Mobility · Org.nr 880809-6658 · Innehar F-skatt",
  "Pistolvägen 6, 702 21 Örebro",
  "info@nordicemobility.se · 010-138 54 98",
].join("\n");

module.exports = { resendEmail, FOOTER_HTML, FOOTER_TEXT };
