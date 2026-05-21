import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);
const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const htmlEscape = (value) =>
  clean(value, 5000).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};
const firstName = (name) => clean(name, 140).split(/\s+/).filter(Boolean)[0] || "d\u00e4r";
const shortCaseId = (id) => clean(id, 120).replace(/^case_/, "").slice(0, 18).toUpperCase();
const SITE_URL = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
const REVIEW_LINK = env("GOOGLE_REVIEW_URL") || env("GOOGLE_REVIEW_LINK") || "https://www.google.com/search?q=Nordic+E-Mobility+Orebro";
const LOGO_URL = `${SITE_URL}/nordic_logo_transparent.png`;
const smsConfig = () => ({
  username: env("ELKS_USERNAME") || env("SMS_API_USERNAME"),
  password: env("ELKS_PASSWORD") || env("SMS_API_PASSWORD"),
  from: (env("SMS_FROM") || "NordicEMob").slice(0, 11),
});
const postSms = async ({ to, message }) => {
  const normalizedTo = normalizePhone(to);
  const { username, password, from } = smsConfig();
  if (!normalizedTo) return { status: "invalid_phone", to: "" };
  if (!message) return { status: "missing_message", to: normalizedTo };
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
    if (!response.ok) return { status: "failed", provider: "46elks", to: normalizedTo, error: clean(body.error || response.statusText, 180) };
    return { status: "sent", provider: "46elks", to: normalizedTo, id: clean(body.id, 120), sentAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", provider: "46elks", to: normalizedTo, error: clean(error?.message || "sms failed", 180) };
  }
};
const resendEmail = async ({ to, subject, html, text, idempotencyKey }) => {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  const replyTo = env("EMAIL_REPLY_TO") || env("WORKSHOP_EMAIL") || "";
  if (!to || !to.length) return { status: "not_requested" };
  if (!apiKey || !from || !clean(apiKey, 220).startsWith("re_")) return { status: "not_configured" };
  const payload = { from, to, subject, html, text };
  if (replyTo) payload.reply_to = replyTo;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { status: "failed", provider: "resend", error: clean(body.message || body.error || response.statusText, 180) };
  return { status: "sent", provider: "resend", id: clean(body.id, 120), sentAt: new Date().toISOString() };
};
const numberOrNull = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const normalized = Number(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(normalized) ? normalized : null;
};

const STAFF = {
  lennart: { key: "lennart", name: "Lennart", role: "Golv, mottagning och snabba jobb", phone: "010-138 54 98" },
  sebastian: { key: "sebastian", name: "Sebastian", role: "Tung felsokning, batteri och elsystem", phone: "010-138 54 98" },
};

const PAYMENT_STATUSES = new Set(["unpaid", "invoice_ready", "invoiced", "paid"]);
const PAYMENT_METHODS = new Set(["swish", "card", "cash", "invoice", "bank", "other"]);
const PAYMENT_SWISH_NUMBER = "123 240 6775";
const PAYMENT_BANKGIRO = "5290-5494";
const CONTENT_STATUSES = new Set(["draft", "review", "ready", "published"]);
const JOB_TYPES = new Set(["puncture", "tire", "brake", "throttle", "electrical", "battery", "service"]);
const SERVICE_ACTIONS = new Set([
  "wheel_remove",
  "tube_replace",
  "tire_replace",
  "solid_tire_install",
  "tubeless_sealant",
  "brake_adjust",
  "brake_part_replace",
  "throttle_replace",
  "display_replace",
  "wiring_check",
  "battery_diagnostics",
  "bms_check",
  "test_run",
  "safety_check",
]);
const POSITIONS = new Set(["front", "rear", "motor_wheel", "not_applicable"]);
const boolValue = (value) => value === true || value === "true" || value === "on" || value === 1 || value === "1";

const footerHtml = () => `
  <div style="border-top:1px solid #dfe5dc;margin-top:22px;padding-top:18px;color:#53605a;font-size:13px;line-height:1.55">
    <img src="${htmlEscape(LOGO_URL)}" alt="Nordic E-Mobility" style="display:block;max-width:150px;height:auto;margin:0 0 12px">
    <strong style="color:#111">Nordic E-Mobility</strong><br>
    Pistolv&auml;gen 6, 702 21 &Ouml;rebro<br>
    <a href="mailto:info@nordicemobility.se" style="color:#067a35">info@nordicemobility.se</a> &middot;
    <a href="tel:+46101385498" style="color:#067a35">010-138 54 98</a>
  </div>
`;

const shellHtml = (title, body) => `
  <div style="margin:0;background:#f4f6f2;padding:24px;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #dfe5dc;border-radius:8px;overflow:hidden">
      <div style="background:#061007;color:#fff;padding:22px 24px">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8ff5ae;font-weight:700">Nordic E-Mobility</div>
        <h1 style="font-size:24px;line-height:1.2;margin:8px 0 0">${title}</h1>
      </div>
      <div style="padding:24px;line-height:1.6">${body}${footerHtml()}</div>
    </div>
  </div>
`;

const couponCode = (caseItem) => `SCOOTER-${Buffer.from(caseItem.id).toString("base64url").slice(-6).toUpperCase()}`;

const sendThankYou = async (caseItem) => {
  const code = caseItem.coupon?.code || couponCode(caseItem);
  const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const summary = clean(caseItem.completion?.workSummary || caseItem.workshop?.workDone || caseItem.service, 1600);
  const email = await resendEmail({
    to: caseItem.customer?.email ? [caseItem.customer.email] : [],
    subject: `Tack for fortroendet, ${firstName(caseItem.customer?.name)}`,
    html: shellHtml(
      `Tack f&ouml;r f&ouml;rtroendet, ${htmlEscape(firstName(caseItem.customer?.name))}`,
      `<p>Vi hoppas att allt k&auml;nns bra efter bes&ouml;ket.</p>
       <div style="background:#f7faf6;border:1px solid #dfe8dc;border-radius:8px;padding:16px;margin:18px 0">
         <p style="margin:0 0 8px"><strong>Utf&ouml;rt arbete:</strong><br>${htmlEscape(summary).replace(/\n/g, "<br>")}</p>
         <p style="margin:0"><strong>Datum:</strong> ${new Date().toLocaleDateString("sv-SE")}</p>
       </div>
       <p><a href="${htmlEscape(REVIEW_LINK)}" style="display:inline-block;background:#00c853;color:#031006;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700">L&auml;mna en recension</a></p>
       <p style="margin:18px 0 0">F&ouml;lj oss g&auml;rna f&ouml;r tips, servicebilder och erbjudanden:<br>
         <a href="https://www.facebook.com/nordicemobility" style="color:#067a35">Facebook</a> &middot;
         <a href="https://www.instagram.com/nordicemobility" style="color:#067a35">Instagram</a>
       </p>
       <p><strong>10 % p&aring; n&auml;sta inl&auml;mning:</strong><br>Kod: <strong>${htmlEscape(code)}</strong><br>Giltig till ${htmlEscape(validUntil)}.</p>`,
    ),
    text: `Tack for fortroendet, ${firstName(caseItem.customer?.name)}!\n\nUtfort arbete:\n${summary}\n\nLamna recension: ${REVIEW_LINK}\nFacebook: https://www.facebook.com/nordicemobility\nInstagram: https://www.instagram.com/nordicemobility\n\n10 % pa nasta inlamning: ${code}. Giltig till ${validUntil}.`,
    idempotencyKey: `${caseItem.id}-thank-you`,
  });
  return { email, coupon: { code, percent: 10, validUntil, used: false, caseId: caseItem.id }, sentAt: new Date().toISOString() };
};

const paymentSmsText = ({ caseItem, amount }) => {
  const rounded = Math.round(Number(amount || 0));
  const reference = shortCaseId(caseItem.id);
  return [
    `Hej ${firstName(caseItem.customer?.name)}!`,
    `Att betala: ${rounded} kr.`,
    `Swish f\u00f6retag: ${PAYMENT_SWISH_NUMBER} (mottagare: Nordic E-Mobility).`,
    `Bankgiro: ${PAYMENT_BANKGIRO}.`,
    `Meddelande/OCR: ${reference}.`,
    `Tack! / Nordic E-Mobility`,
  ].join("\n");
};

const workshopReviewSmsText = (caseItem) => {
  const workshop = caseItem.workshop || {};
  const lines = [
    `Workshoplogg ${shortCaseId(caseItem.id)}`,
    `Kund: ${clean(caseItem.customer?.name, 80) || "Okand"} - ${clean(caseItem.customer?.phone, 40) || "telefon saknas"}`,
    `Modell: ${clean(caseItem.vehicle?.model, 80) || "Okand"}`,
    workshop.workDone ? `Gjort: ${clean(workshop.workDone, 260)}` : "",
    workshop.partsUsed ? `Delar: ${clean(workshop.partsUsed, 180)}` : "",
    workshop.issuesFound ? `Avvikelse: ${clean(workshop.issuesFound, 180)}` : "",
    workshop.nextAction ? `Nasta: ${clean(workshop.nextAction, 160)}` : "",
  ].filter(Boolean);
  return clean(lines.join("\n"), 900);
};

const requireAdmin = (request) => {
  const expected = process.env.ADMIN_TOKEN || globalThis.Netlify?.env?.get?.("ADMIN_TOKEN");
  const provided = request.headers.get("x-admin-token") || "";

  if (!expected) {
    return { ok: false, response: json({ error: "ADMIN_TOKEN saknas i Netlify miljo variabler." }, 503) };
  }

  if (provided !== expected) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  return { ok: true };
};

const loadCase = async (store, id) => store.get(id, { type: "json" });

const normalizePriceRows = (rows = []) =>
  Array.isArray(rows)
    ? rows.map((row) => ({
        sku: clean(row.sku, 80),
        name: clean(row.name, 180),
        category: clean(row.category, 120),
        qty: Math.max(1, Number(row.qty || 1)),
        price: Math.max(0, numberOrNull(row.price) ?? 0),
        unit: clean(row.unit, 40) || "st",
        fortnoxArticleNumber: clean(row.fortnoxArticleNumber, 80),
      })).filter((row) => row.sku && row.name)
    : [];

const priceRowsTotal = (rows = []) =>
  rows.reduce((sum, row) => sum + Number(row.price || 0) * Number(row.qty || 1), 0);

const quoteSmsText = ({ caseItem, amount, summary, contactOwner }) => {
  const owner = contactOwner === "sebastian" ? STAFF.sebastian : STAFF.lennart;
  const model = clean(caseItem.vehicle?.model, 160) || "scooter";
  const rounded = Math.round(Number(amount || 0));
  return [
    `Hej ${firstName(caseItem.customer?.name)}! Vi har fels\u00f6kt din ${model}.`,
    `Prisf\u00f6rslag: ${rounded} kr inkl. moms.`,
    `\u00c5tg\u00e4rd: ${clean(summary, 320)}`,
    `Svara JA om du godk\u00e4nner, eller ring ${owner.name} p\u00e5 ${owner.phone}.`,
    "/ Nordic E-Mobility",
  ].join("\n");
};

const normalizeWorkshopState = (current = {}, value = {}) => {
  if (!value || typeof value !== "object") return current;
  return {
    ...current,
    workDone: value.workDone === undefined ? current.workDone || "" : clean(value.workDone, 3000),
    partsUsed: value.partsUsed === undefined ? current.partsUsed || "" : clean(value.partsUsed, 2000),
    issuesFound: value.issuesFound === undefined ? current.issuesFound || "" : clean(value.issuesFound, 3000),
    serviceActions:
      value.serviceActions === undefined
        ? Array.isArray(current.serviceActions) ? current.serviceActions : []
        : Array.isArray(value.serviceActions)
          ? value.serviceActions.map((item) => clean(item, 40)).filter((item) => SERVICE_ACTIONS.has(item))
          : [],
    nextAction: value.nextAction === undefined ? current.nextAction || "" : clean(value.nextAction, 1200),
    needsSebastianReview:
      value.needsSebastianReview === undefined
        ? Boolean(current.needsSebastianReview)
        : boolValue(value.needsSebastianReview),
    reviewRequestedAt:
      value.reviewRequestedAt === undefined ? current.reviewRequestedAt || null : clean(value.reviewRequestedAt, 80) || null,
    updatedAt: new Date().toISOString(),
  };
};

export default async (request, context) => {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const id = context.params?.id;

  if (request.method === "GET") {
    if (id) {
      const item = await loadCase(store, id);
      return item ? json(item) : json({ error: "Not found" }, 404);
    }

    const { blobs } = await store.list();
    const cases = [];

    for (const blob of blobs) {
      const item = await loadCase(store, blob.key);
      if (item) cases.push(item);
    }

    cases.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));

    return json({
      cases,
      totals: {
        active: cases.filter((item) => !["done", "archived"].includes(item.status)).length,
        value: cases.reduce((sum, item) => sum + Number(item.estimatedValue || 0), 0),
      },
    });
  }

  if (request.method === "POST") {
    if (id) return json({ error: "Use POST /api/cases without id." }, 400);

    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const caseId = `case_${now.replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
    const priceRows = normalizePriceRows(body.priceRows);
    const totalCost = body.totalCost === undefined ? priceRowsTotal(priceRows) : numberOrNull(body.totalCost) ?? priceRowsTotal(priceRows);
    const customerName = clean(body.customerName || body.name, 140) || "Drop-in kund";
    const customerPhone = clean(body.customerPhone || body.phone, 80);
    const vehicleModel = clean(body.vehicleModel || body.vehicle || body.scooter, 180);
    const operatorName = clean(body.operatorName, 80) || "admin";
    const workSummary = clean(body.workSummary, 3000) || priceRows.map((row) => `${row.qty} x ${row.name}`).join(", ");
    const invoiceText = clean(body.invoiceText, 5000) || priceRows.map((row) => `${row.fortnoxArticleNumber ? `${row.fortnoxArticleNumber} ` : ""}${row.qty} x ${row.name}`).join("\n");

    const next = {
      id: caseId,
      createdAt: now,
      updatedAt: now,
      createdBy: { name: operatorName, source: "admin" },
      updatedBy: { name: operatorName, source: "admin", at: now },
      status: "contacted",
      source: clean(body.source, 80) || "admin",
      channel: "internal",
      priority: clean(body.priority, 40) || "normal",
      preferredContactTime: null,
      preferredDate: null,
      discountCode: null,
      contactMethod: customerPhone ? "sms" : "phone",
      logistics: "dropoff",
      assignedTo: STAFF.lennart,
      customer: {
        name: customerName,
        phone: customerPhone,
        email: clean(body.customerEmail || body.email, 180),
      },
      vehicle: {
        model: vehicleModel,
      },
      service: priceRows.length ? "Snabbpris / drop-in" : "Drop-in",
      addons: [],
      estimatedValue: totalCost,
      message: clean(body.message, 3000),
      intakeAt: null,
      promisedAt: null,
      notes: body.note ? [{ at: now, text: clean(body.note, 1200) }] : [],
      notifications: {},
      confirmation_sent: false,
      confirmation_missing: false,
      completion: {
        totalCost,
        workSummary,
        invoiceText,
        priceRows,
        readyForFortnox: false,
        updatedAt: now,
      },
      payment: {
        status: "unpaid",
        amount: totalCost,
        method: "",
        reference: "",
        updatedAt: now,
      },
      timeline: [
        { at: now, event: `Internt ärende skapat av ${operatorName} från ${clean(body.source, 80) || "admin"}.` },
        ...(priceRows.length ? [{ at: now, event: `Prisförslag: ${totalCost} kr inkl. moms (${priceRows.length} rader).` }] : []),
      ],
    };

    await store.setJSON(caseId, next);
    return json({ ok: true, case: next }, 201);
  }

  if (request.method === "PATCH") {
    if (!id) return json({ error: "Missing case id" }, 400);

    const current = await loadCase(store, id);
    if (!current) return json({ error: "Not found" }, 404);

    const body = await request.json();
    const now = new Date().toISOString();
    const operatorName = clean(body.operatorName, 80);
    const currentPayment = current.payment || {};
    const currentContent = current.content || {};

    if (body.action === "send_sms") {
      const message = clean(body.message, 918);
      if (!message) return json({ error: "SMS-text saknas." }, 400);
      const result = await postSms({ to: current.customer?.phone, message });
      const entry = {
        at: result.sentAt || now,
        type: "manual_sms",
        to: normalizePhone(current.customer?.phone),
        status: result.status,
        provider: result.provider || "46elks",
        message,
        caseId: current.id,
      };
      const next = {
        ...current,
        updatedAt: now,
        updatedBy: operatorName ? { name: operatorName, source: "admin", at: now } : current.updatedBy,
        status: ["new", "contacted"].includes(current.status) ? "waiting_customer" : current.status,
        outboundMessages: [...(Array.isArray(current.outboundMessages) ? current.outboundMessages : []), entry],
        notifications: {
          ...(current.notifications || {}),
          manualSms: {
            status: result.status,
            lastSentAt: result.sentAt || now,
            to: entry.to,
            provider: entry.provider,
            error: result.error || "",
          },
        },
        timeline: [
          ...(Array.isArray(current.timeline) ? current.timeline : []),
          { at: result.sentAt || now, event: `Manuellt SMS ${result.status === "sent" ? "skickat" : "misslyckades"} till kund.` },
          ...(result.status === "sent" && ["new", "contacted"].includes(current.status) ? [{ at: result.sentAt || now, event: "Status ändrad till väntar kund efter SMS-svar." }] : []),
        ],
      };
      await store.setJSON(id, next);
      return json({ ok: result.status === "sent", result, case: next });
    }

    if (body.action === "send_quote_sms") {
      const amount = numberOrNull(body.amount);
      const summary = clean(body.summary, 500);
      const contactOwner = clean(body.contactOwner, 40) === "sebastian" ? "sebastian" : "lennart";
      if (!amount || amount <= 0) return json({ error: "Prisf\u00f6rslag m\u00e5ste ha belopp." }, 400);
      if (!summary) return json({ error: "\u00c5tg\u00e4rd/sammanfattning saknas." }, 400);
      const message = quoteSmsText({ caseItem: current, amount, summary, contactOwner });
      const result = await postSms({ to: current.customer?.phone, message });
      const quote = {
        ...(current.quote || {}),
        status: result.status === "sent" ? "sent" : "failed",
        amount,
        summary,
        contactOwner,
        message,
        sentAt: result.sentAt || now,
        sms: result,
      };
      const entry = {
        at: result.sentAt || now,
        type: "quote_sms",
        to: normalizePhone(current.customer?.phone),
        status: result.status,
        provider: result.provider || "46elks",
        message,
        caseId: current.id,
        quote: { amount, summary, contactOwner },
      };
      const next = {
        ...current,
        updatedAt: now,
        updatedBy: operatorName ? { name: operatorName, source: "admin", at: now } : current.updatedBy,
        status: current.status === "new" ? "waiting_customer" : current.status,
        quote,
        outboundMessages: [...(Array.isArray(current.outboundMessages) ? current.outboundMessages : []), entry],
        timeline: [
          ...(Array.isArray(current.timeline) ? current.timeline : []),
          { at: result.sentAt || now, event: `Prisf\u00f6rslag ${result.status === "sent" ? "skickat" : "misslyckades"} via SMS: ${Math.round(amount)} kr.` },
        ],
      };
      await store.setJSON(id, next);
      return json({ ok: result.status === "sent", result, case: next });
    }

    if (body.action === "send_payment_instruction") {
      const amount = numberOrNull(body.amount ?? body.paymentAmount ?? current.completion?.totalCost ?? current.payment?.amount);
      if (!amount || amount <= 0) return json({ error: "Belopp saknas for betalningsinstruktion." }, 400);
      const priceRows = normalizePriceRows(body.priceRows);
      const message = clean(body.message, 918) || paymentSmsText({ caseItem: current, amount });
      const result = await postSms({ to: current.customer?.phone, message });
      const nextCompletion = {
        ...(current.completion || {}),
        totalCost: amount,
        workSummary: body.workSummary === undefined ? current.completion?.workSummary || "" : clean(body.workSummary, 3000),
        invoiceText: body.invoiceText === undefined ? current.completion?.invoiceText || "" : clean(body.invoiceText, 5000),
        priceRows: priceRows.length ? priceRows : Array.isArray(current.completion?.priceRows) ? current.completion.priceRows : [],
        updatedAt: now,
      };
      const nextPayment = {
        ...(current.payment || {}),
        status: "invoice_ready",
        method: PAYMENT_METHODS.has(clean(body.paymentMethod, 40)) ? clean(body.paymentMethod, 40) : "swish",
        amount,
        reference: clean(body.paymentReference, 160),
        instructionSentAt: result.sentAt || now,
        instructionMessage: message,
        updatedAt: now,
      };
      const entry = {
        at: result.sentAt || now,
        type: "payment_instruction_sms",
        to: normalizePhone(current.customer?.phone),
        status: result.status,
        provider: result.provider || "46elks",
        message,
        caseId: current.id,
      };
      const next = {
        ...current,
        updatedAt: now,
        updatedBy: operatorName ? { name: operatorName, source: "admin", at: now } : current.updatedBy,
        status: current.status === "done" ? current.status : "ready",
        completion: nextCompletion,
        payment: nextPayment,
        outboundMessages: [...(Array.isArray(current.outboundMessages) ? current.outboundMessages : []), entry],
        timeline: [
          ...(Array.isArray(current.timeline) ? current.timeline : []),
          { at: result.sentAt || now, event: `Betalningsinstruktion ${result.status === "sent" ? "skickad" : "misslyckades"} via SMS: ${Math.round(amount)} kr.` },
        ],
      };
      await store.setJSON(id, next);
      return json({ ok: result.status === "sent", result, case: next });
    }

    if (body.action === "submit_workshop_log") {
      const workshop = normalizeWorkshopState(current.workshop || {}, body.workshop || {});
      const next = {
        ...current,
        updatedAt: now,
        workshop: {
          ...workshop,
          submittedToSebastianAt: now,
          needsSebastianReview: true,
          reviewRequestedAt: workshop.reviewRequestedAt || now,
        },
      };
      const result = await postSms({ to: env("SEBASTIAN_SMS_TO") || STAFF.sebastian.phone, message: workshopReviewSmsText(next) });
      next.notifications = {
        ...(current.notifications || {}),
        workshopLogSms: {
          status: result.status,
          to: result.to,
          provider: result.provider || "46elks",
          sentAt: result.sentAt || now,
          error: result.error || "",
        },
      };
      next.timeline = [
        ...(Array.isArray(current.timeline) ? current.timeline : []),
        { at: result.sentAt || now, event: `Workshoplogg ${result.status === "sent" ? "skickad" : "kunde inte skickas"} till Sebastian via SMS.` },
      ];
      await store.setJSON(id, next);
      return json({ ok: result.status === "sent", result, case: next });
    }

    const nextCompletion = {
      ...(current.completion || {}),
      totalCost:
        body.totalCost === undefined ? current.completion?.totalCost ?? null : numberOrNull(body.totalCost),
      workSummary:
        body.workSummary === undefined ? current.completion?.workSummary || "" : clean(body.workSummary, 3000),
      invoiceText:
        body.invoiceText === undefined ? current.completion?.invoiceText || "" : clean(body.invoiceText, 5000),
      pickupSummary:
        body.pickupSummary === undefined ? current.completion?.pickupSummary || "" : clean(body.pickupSummary, 1600),
      jobType:
        body.jobType === undefined
          ? current.completion?.jobType || "service"
          : JOB_TYPES.has(clean(body.jobType, 40)) ? clean(body.jobType, 40) : current.completion?.jobType || "service",
      serviceActions:
        body.serviceActions === undefined
          ? Array.isArray(current.completion?.serviceActions) ? current.completion.serviceActions : []
          : Array.isArray(body.serviceActions)
            ? body.serviceActions.map((value) => clean(value, 40)).filter((value) => SERVICE_ACTIONS.has(value))
            : [],
      position:
        body.position === undefined
          ? current.completion?.position || "not_applicable"
          : POSITIONS.has(clean(body.position, 40)) ? clean(body.position, 40) : current.completion?.position || "not_applicable",
      testRunDone:
        body.testRunDone === undefined ? Boolean(current.completion?.testRunDone) : boolValue(body.testRunDone),
      safetyCheckDone:
        body.safetyCheckDone === undefined ? Boolean(current.completion?.safetyCheckDone) : boolValue(body.safetyCheckDone),
      extraNoCost:
        body.extraNoCost === undefined ? Boolean(current.completion?.extraNoCost) : boolValue(body.extraNoCost),
      customerInformed:
        body.customerInformed === undefined ? Boolean(current.completion?.customerInformed) : boolValue(body.customerInformed),
      readyForFortnox:
        body.readyForFortnox === undefined ? Boolean(current.completion?.readyForFortnox) : boolValue(body.readyForFortnox),
      internalComment:
        body.internalComment === undefined ? current.completion?.internalComment || "" : clean(body.internalComment, 2000),
      priceRows:
        body.priceRows === undefined
          ? Array.isArray(current.completion?.priceRows) ? current.completion.priceRows : []
          : normalizePriceRows(body.priceRows),
      readyAt:
        body.readyAt === undefined ? current.completion?.readyAt || null : clean(body.readyAt, 80) || null,
      customerNotifiedAt:
        body.customerNotifiedAt === undefined
          ? current.completion?.customerNotifiedAt || null
          : clean(body.customerNotifiedAt, 80) || null,
      customerNotifiedVia:
        body.customerNotifiedVia === undefined
          ? current.completion?.customerNotifiedVia || ""
          : clean(body.customerNotifiedVia, 80),
      updatedAt: now,
    };

    const requestedPaymentStatus =
      body.paymentStatus === undefined ? currentPayment.status || "unpaid" : clean(body.paymentStatus, 40) || "unpaid";
    const requestedPaymentMethod =
      body.paymentMethod === undefined ? currentPayment.method || "" : clean(body.paymentMethod, 40) || "";

    const nextPayment = {
      ...currentPayment,
      status: PAYMENT_STATUSES.has(requestedPaymentStatus) ? requestedPaymentStatus : currentPayment.status || "unpaid",
      method:
        PAYMENT_METHODS.has(requestedPaymentMethod)
          ? requestedPaymentMethod
          : requestedPaymentMethod
            ? currentPayment.method || ""
            : "",
      amount:
        body.paymentAmount === undefined
          ? currentPayment.amount ?? current.completion?.totalCost ?? null
          : numberOrNull(body.paymentAmount),
      reference:
        body.paymentReference === undefined ? currentPayment.reference || "" : clean(body.paymentReference, 160),
      paidAt: body.paidAt === undefined ? currentPayment.paidAt || null : clean(body.paidAt, 80) || null,
      fortnoxCustomerNumber:
        body.fortnoxCustomerNumber === undefined
          ? currentPayment.fortnoxCustomerNumber || ""
          : clean(body.fortnoxCustomerNumber, 80),
      fortnoxInvoiceNumber:
        body.fortnoxInvoiceNumber === undefined
          ? currentPayment.fortnoxInvoiceNumber || ""
          : clean(body.fortnoxInvoiceNumber, 80),
      updatedAt: now,
    };
    const requestedContentStatus =
      body.contentStatus === undefined ? currentContent.status || "draft" : clean(body.contentStatus, 40) || "draft";
    const nextContent = {
      ...currentContent,
      social:
        body.contentSocial === undefined ? currentContent.social || "" : clean(body.contentSocial, 4000),
      google:
        body.contentGoogle === undefined ? currentContent.google || "" : clean(body.contentGoogle, 3000),
      web:
        body.contentWeb === undefined ? currentContent.web || "" : clean(body.contentWeb, 5000),
      status: CONTENT_STATUSES.has(requestedContentStatus) ? requestedContentStatus : currentContent.status || "draft",
      targets:
        body.contentTargets === undefined ? currentContent.targets || "" : clean(body.contentTargets, 160),
      notes:
        body.contentNotes === undefined ? currentContent.notes || "" : clean(body.contentNotes, 1600),
      reviewedAt:
        body.contentReviewedAt === undefined ? currentContent.reviewedAt || null : clean(body.contentReviewedAt, 80) || null,
      publishedAt:
        body.contentPublishedAt === undefined ? currentContent.publishedAt || null : clean(body.contentPublishedAt, 80) || null,
      updatedAt: now,
    };

    if (nextPayment.status === "paid" && !nextPayment.paidAt) {
      nextPayment.paidAt = now;
    }

    const next = {
      ...current,
      updatedAt: now,
      updatedBy: operatorName ? { name: operatorName, source: "admin", at: now } : current.updatedBy,
      status: clean(body.status, 40) || current.status,
      preferredDate: body.preferredDate === undefined ? current.preferredDate : clean(body.preferredDate, 120) || null,
      discountCode: body.discountCode === undefined ? current.discountCode : clean(body.discountCode, 40) || null,
      preferredContactTime:
        body.preferredContactTime === undefined ? current.preferredContactTime : clean(body.preferredContactTime, 80) || null,
      contactMethod: body.contactMethod === undefined ? current.contactMethod : clean(body.contactMethod, 40) || "phone",
      logistics: body.logistics === undefined ? current.logistics : clean(body.logistics, 80) || "dropoff",
      intakeAt: body.intakeAt === undefined ? current.intakeAt : clean(body.intakeAt, 80) || null,
      promisedAt: body.promisedAt === undefined ? current.promisedAt : clean(body.promisedAt, 80) || null,
      estimatedValue: body.estimatedValue === undefined ? current.estimatedValue : Number(body.estimatedValue || 0),
      priority: body.priority === undefined ? current.priority : clean(body.priority, 40) || "normal",
      service: body.service === undefined ? current.service : clean(body.service, 160) || current.service,
      message: body.message === undefined ? current.message : clean(body.message, 3000),
      customer: {
        ...(current.customer || {}),
        name: body.customerName === undefined ? current.customer?.name : clean(body.customerName, 140),
        phone: body.customerPhone === undefined ? current.customer?.phone : clean(body.customerPhone, 80),
        email: body.customerEmail === undefined ? current.customer?.email : clean(body.customerEmail, 180),
      },
      vehicle: {
        ...(current.vehicle || {}),
        model: body.vehicleModel === undefined ? current.vehicle?.model : clean(body.vehicleModel, 180),
      },
      completion: nextCompletion,
      payment: nextPayment,
      content: nextContent,
      workshop: body.workshop === undefined ? current.workshop || {} : normalizeWorkshopState(current.workshop || {}, body.workshop),
    };

    if (body.assignedTo) {
      const assignee = clean(body.assignedTo, 40);
      next.assignedTo = assignee === "sebastian" ? STAFF.sebastian : STAFF.lennart;
    }

    if (body.status === "ready" && !next.completion.readyAt) {
      next.completion.readyAt = now;
    }

    if (body.note) {
      next.notes = [...(current.notes || []), { at: now, text: clean(body.note) }];
    }

    const timeline = [...(current.timeline || [])];
    if (body.note) {
      timeline.push({ at: now, event: `Uppdaterad${operatorName ? ` av ${operatorName}` : ""}: ${clean(body.note, 160)}` });
    } else if (body.status !== undefined) {
      timeline.push({ at: now, event: `Status andrad till ${next.status}${operatorName ? ` av ${operatorName}` : ""}` });
    }

    const paymentTouched =
      body.paymentStatus !== undefined ||
      body.paymentMethod !== undefined ||
      body.paymentAmount !== undefined ||
      body.paymentReference !== undefined ||
      body.paidAt !== undefined ||
      body.fortnoxCustomerNumber !== undefined ||
      body.fortnoxInvoiceNumber !== undefined;
    const contentTouched =
      body.contentSocial !== undefined ||
      body.contentGoogle !== undefined ||
      body.contentWeb !== undefined ||
      body.contentStatus !== undefined ||
      body.contentTargets !== undefined ||
      body.contentNotes !== undefined ||
      body.contentReviewedAt !== undefined ||
      body.contentPublishedAt !== undefined;
    const readyNotificationTouched = body.customerNotifiedAt !== undefined || body.customerNotifiedVia !== undefined;

    if (paymentTouched) {
      timeline.push({
        at: now,
        event: `Betalning: ${nextPayment.status}${nextPayment.amount !== null && nextPayment.amount !== undefined ? ` ${nextPayment.amount} kr` : ""}${nextPayment.method ? ` via ${nextPayment.method}` : ""}`,
      });
    }

    if (readyNotificationTouched && nextCompletion.customerNotifiedAt) {
      timeline.push({
        at: nextCompletion.customerNotifiedAt,
        event: `Klartext skickad till kund${nextCompletion.customerNotifiedVia ? ` via ${nextCompletion.customerNotifiedVia}` : ""}.`,
      });
    }

    if (contentTouched) {
      const targetInfo = nextContent.targets ? ` mot ${nextContent.targets}` : "";
      timeline.push({
        at: now,
        event: `Content uppdaterat: ${nextContent.status}${targetInfo}.`,
      });
    }

    if (body.workshop !== undefined) {
      timeline.push({
        at: now,
        event: next.workshop?.needsSebastianReview
          ? "Workshop flaggade: Needs Sebastian review."
          : "Workshoplogg/status uppdaterad.",
      });
    }

    next.timeline = timeline;

    if ((next.status === "done" || next.payment?.status === "paid") && next.notifications?.thankYou?.status !== "sent") {
      const thankYou = await sendThankYou(next);
      next.coupon = thankYou.coupon;
      next.notifications = {
        ...(next.notifications || {}),
        thankYou: { status: thankYou.email.status, ...thankYou },
      };
      next.timeline.push({ at: thankYou.sentAt || now, event: "Tackmail med rabattkod skickat efter avslutat/betalt arende." });
    }

    await store.setJSON(id, next);
    return json({ ok: true, case: next });
  }

  if (request.method === "DELETE") {
    if (!id) return json({ error: "Missing case id" }, 400);

    const current = await loadCase(store, id);
    if (!current) return json({ error: "Not found" }, 404);

    await store.delete(id);
    return json({ ok: true, deleted: id });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: ["/api/cases", "/api/cases/:id"],
};
