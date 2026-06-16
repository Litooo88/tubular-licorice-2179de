const { clean, env } = require("./http");
const {
  APPROVAL_PATTERNS,
  APPROVAL_RULES,
  DEFAULT_PRICE_RULES,
  LOW_RISK_SMS_INTENTS,
  SMS_SIGNATURE,
} = require("./business-rules");

const LOW_RISK_INTENTS = new Set(LOW_RISK_SMS_INTENTS);

const combinedText = (input = {}) =>
  [input.intent, input.eventType, input.message, input.summary, input.diagnosis, input.issueDescription, input.service, input.brand, input.model, input.part, input.context, input.caseItem?.service, input.caseItem?.message, input.caseItem?.vehicle?.model]
    .filter(Boolean)
    .join(" ");

const assessRisk = (input = {}) => {
  const text = combinedText(input);
  const reasons = APPROVAL_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
  const price = Number(input.price ?? input.amount ?? input.max ?? input.estimatedValue ?? 0);
  const partCost = Number(input.partCost ?? input.part_cost ?? 0);
  if (price > APPROVAL_RULES.priceAbove) reasons.push("price_over_995");
  if (partCost > APPROVAL_RULES.partPurchaseAbove) reasons.push("part_purchase_over_500");
  const lowRiskIntent = LOW_RISK_INTENTS.has(clean(input.intent, 80));
  return {
    level: reasons.length ? "high" : lowRiskIntent ? "low" : "medium",
    reasons: [...new Set(reasons)],
    approvalRequired: reasons.length > 0 || !lowRiskIntent,
    autoSendAllowed: reasons.length === 0 && lowRiskIntent,
  };
};

const selectPriceRule = (input = {}, persistedRules = []) => {
  const text = combinedText(input).toLowerCase();
  if (/\be-?wheels e16\b|\be16\b/i.test(text)) {
    return DEFAULT_PRICE_RULES.find((rule) => rule.id === "ewheels-e16");
  }
  if (/\bbatteri|bms\b/i.test(text)) {
    return DEFAULT_PRICE_RULES.find((rule) => rule.id === "battery-diagnostic");
  }
  const usablePersistedRules = persistedRules
    .filter((rule) => Number.isFinite(Number(rule?.from)) && Number.isFinite(Number(rule?.min)))
    .map((rule) => ({
      ...rule,
      from: Number(rule.from),
      min: Number(rule.min),
      max: rule.max === null || rule.max === undefined ? null : Number(rule.max),
      keywords: Array.isArray(rule.keywords) && rule.keywords.length
        ? rule.keywords.map((keyword) => String(keyword).toLowerCase())
        : [rule.label, rule.name, rule.category].filter(Boolean).map((keyword) => String(keyword).toLowerCase()),
    }));
  const matches = [...DEFAULT_PRICE_RULES, ...usablePersistedRules].map((rule) => ({
    rule,
    score: rule.keywords.reduce((score, keyword) => score + (text.includes(keyword) ? keyword.length : 0), 0),
  })).sort((a, b) => b.score - a.score);
  return matches[0]?.score ? matches[0].rule : DEFAULT_PRICE_RULES.find((rule) => rule.id === "diagnostic-standard");
};

const firstName = (name) => clean(name, 100).split(/\s+/).filter(Boolean)[0] || "där";
const withSmsSignature = (message) => {
  const text = clean(message, 918);
  return clean(text.endsWith(SMS_SIGNATURE) ? text : `${text}\n${SMS_SIGNATURE}`, 918);
};

const deterministicSmsDraft = (input = {}) => {
  const customer = input.caseItem?.customer || input.customer || {};
  const name = firstName(customer.name);
  const model = clean(input.caseItem?.vehicle?.model || input.model || "elscooter", 100);
  const messages = {
    booking_confirmation: `Hej ${name}! Din bokning hos Nordic E-Mobility är registrerad. Vi återkommer om något behöver kompletteras.`,
    missed_call_reply: `Hej ${name}! Vi såg att du ringde Nordic E-Mobility. Svara gärna med modell och vad som är fel, så hjälper vi dig vidare.`,
    model_or_fault_question: `Hej ${name}! Vilken modell är det och hur visar sig felet? Skicka gärna en kort beskrivning eller bild.`,
    simple_status: `Hej ${name}! En kort status: vi arbetar vidare med din ${model} och återkommer när nästa steg är klart.`,
    review_link: `Hej ${name}! Tack för besöket hos Nordic E-Mobility. Lämna gärna en recension: ${env("GOOGLE_REVIEW_URL") || "https://www.google.com/search?q=Nordic+E-Mobility+Orebro"}`,
  };
  const message = input.message || messages[input.intent] || `Hej ${name}! Vi har tagit emot ditt ärende och återkommer med nästa steg.`;
  return withSmsSignature(message);
};

const intentFromInput = (input = {}) => {
  if (input.intent) return clean(input.intent, 80);
  const eventIntents = {
    missed_call_followup: "missed_call_reply",
    booking_confirmation: "booking_confirmation",
    model_or_fault_question: "model_or_fault_question",
    simple_status: "simple_status",
    review_link: "review_link",
  };
  return eventIntents[clean(input.eventType, 80)] || "custom";
};

const deterministicQuote = (input = {}, persistedRules = []) => {
  const rule = selectPriceRule(input, persistedRules);
  const risk = assessRisk({ ...input, price: rule.max, summary: rule.label });
  return {
    ruleId: rule.id,
    label: rule.label,
    from: rule.from,
    min: rule.min,
    max: rule.max,
    currency: "SEK",
    diagnosticRequired: Boolean(rule.diagnosticRequired),
    approvalRequired: Boolean(rule.approvalRequired) || risk.approvalRequired,
    risk,
    finalPrice: null,
    finalPriceNotice: "Slutpris bekräftas alltid innan arbete påbörjas.",
    summary: rule.max
      ? `${rule.label}: från ${rule.from} kr, normalt spann ${rule.min}-${rule.max} kr. Slutpris bekräftas innan arbete.`
      : `${rule.label}: från ${rule.from} kr. Slutpris bekräftas efter diagnos och innan arbete.`,
  };
};

const tryOpenAiJson = async ({ system, input, fallback }) => {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return { value: fallback, mode: "deterministic_dry_run" };
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env("OPENAI_MODEL") || "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || response.statusText);
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}");
    return { value: parsed, mode: "openai" };
  } catch (error) {
    return { value: fallback, mode: "deterministic_fallback", providerError: clean(error?.message, 240) };
  }
};

const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const sendSms = async ({ to, message }) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) return { status: "invalid_phone", sent: false };
  if (!username || !password) return { status: "dry_run_no_credentials", sent: false, to: normalizedTo };
  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from: (env("SMS_FROM") || "NordicEMob").slice(0, 11), to: normalizedTo, message, dontlog: "message" }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { status: "failed", sent: false, error: clean(body.error || response.statusText, 180), to: normalizedTo };
    return { status: "sent", sent: true, provider: "46elks", providerId: clean(body.id, 120), to: normalizedTo, sentAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", sent: false, error: clean(error?.message || "SMS failed", 180), to: normalizedTo };
  }
};

module.exports = {
  LOW_RISK_INTENTS,
  PRICE_RULES: DEFAULT_PRICE_RULES,
  assessRisk,
  deterministicQuote,
  deterministicSmsDraft,
  intentFromInput,
  sendSms,
  tryOpenAiJson,
  withSmsSignature,
};
