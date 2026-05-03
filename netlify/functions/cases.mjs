import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);
const htmlEscape = (value) =>
  clean(value, 5000).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const normalizePhone = (phone) => {
  const compact = clean(phone, 60).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const shortCaseId = (id) => clean(id, 120).replace(/^case_/, "").slice(0, 18).toUpperCase();
const firstName = (name) => clean(name, 120).split(/\s+/).filter(Boolean)[0] || "d\u00e4r";
const SITE_URL = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
const REVIEW_LINK = env("GOOGLE_REVIEW_LINK") || "https://www.google.com/search?q=Nordic+E-Mobility+Pistolv%C3%A4gen+6+%C3%96rebro+recension";
const LOGO_URL = `${SITE_URL}/nordic_logo_transparent.png`;

const authOk = (request) => {
  const token = env("ADMIN_TOKEN");
  if (!token) return false;
  return request.headers.get("x-admin-token") === token;
};

const smsConfig = () => ({
  username: env("ELKS_USERNAME") || env("SMS_API_USERNAME"),
  password: env("ELKS_PASSWORD") || env("SMS_API_PASSWORD"),
  from: (env("SMS_FROM") || "NordicEMob").slice(0, 11),
});

const postSms = async ({ to, message }) => {
  const normalizedTo = normalizePhone(to);
  const { username, password, from } = smsConfig();
  if (!normalizedTo) return { status: "invalid_phone", to: "" };
  if (!username || !password) return { status: "not_configured", to: normalizedTo };
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

const footerHtml = () => `
  <div style="border-top:1px solid #dfe5dc;margin-top:22px;padding-top:18px;color:#53605a;font-size:13px;line-height:1.55">
    <img src="${htmlEscape(LOGO_URL)}" alt="Nordic E-Mobility" style="display:block;max-width:150px;height:auto;margin:0 0 12px">
    <strong style="color:#111">Nordic E-Mobility AB</strong><br>
    Pistolv&auml;gen 6, 702 21 &Ouml;rebro<br>
    <a href="mailto:info@nordicemobility.se" style="color:#067a35">info@nordicemobility.se</a> &middot;
    <a href="tel:+46700243319" style="color:#067a35">070-024 33 19</a>
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

const pickupLinkFor = (caseItem) => `${SITE_URL}/book-online/?pickup=${encodeURIComponent(caseItem.id)}`;

const sendPickupReady = async (caseItem) => {
  const link = caseItem.pickup_link || pickupLinkFor(caseItem);
  const scooter = caseItem.vehicle?.model || "scooter";
  const cost = Number(caseItem.total_cost || 0);
  const summary = clean(caseItem.work_summary, 1600);
  const sms = await postSms({
    to: caseItem.customer?.phone,
    message: `Hej ${firstName(caseItem.customer?.name)}! Din ${scooter} ar klar. Total kostnad: ${cost} kr. Boka upphamtning: ${link}`,
  });
  const email = await resendEmail({
    to: caseItem.customer?.email ? [caseItem.customer.email] : [],
    subject: `Din ${scooter} ar klar att hamta`,
    html: shellHtml(
      "Din scooter &auml;r klar att h&auml;mta",
      `<p>Hej ${htmlEscape(firstName(caseItem.customer?.name))},</p>
       <p>Din ${htmlEscape(scooter)} &auml;r klar.</p>
       <div style="background:#f7faf6;border:1px solid #dfe8dc;border-radius:8px;padding:16px;margin:18px 0">
         <p style="margin:0 0 8px"><strong>Utf&ouml;rt arbete:</strong><br>${htmlEscape(summary).replace(/\n/g, "<br>")}</p>
         <p style="margin:0"><strong>Total kostnad:</strong> ${htmlEscape(cost)} kr</p>
       </div>
       <p><a href="${htmlEscape(link)}" style="display:inline-block;background:#00c853;color:#031006;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700">Boka upph&auml;mtning</a></p>`
    ),
    text: `Hej ${firstName(caseItem.customer?.name)}!\n\nDin ${scooter} ar klar.\n\nUtfort arbete:\n${summary}\n\nTotal kostnad: ${cost} kr\nBoka upphamtning: ${link}`,
    idempotencyKey: `${caseItem.id}-pickup-ready`,
  });
  return { sms, email, sentAt: new Date().toISOString() };
};

const couponCode = (caseItem) => `SCOOTER-${Buffer.from(caseItem.id).toString("base64url").slice(-6).toUpperCase()}`;

const sendThankYou = async (caseItem) => {
  const code = caseItem.coupon?.code || couponCode(caseItem);
  const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const summary = clean(caseItem.work_summary || caseItem.service, 1600);
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
       <p><strong>10 % p&aring; n&auml;sta inl&auml;mning:</strong><br>Kod: <strong>${htmlEscape(code)}</strong><br>Giltig till ${htmlEscape(validUntil)}.</p>`
    ),
    text: `Tack for fortroendet, ${firstName(caseItem.customer?.name)}!\n\nUtfort arbete:\n${summary}\n\nLamna recension: ${REVIEW_LINK}\n\n10 % pa nasta inlamning: ${code}. Giltig till ${validUntil}.`,
    idempotencyKey: `${caseItem.id}-thank-you`,
  });
  return { email, coupon: { code, percent: 10, validUntil, used: false, caseId: caseItem.id }, sentAt: new Date().toISOString() };
};

const listCases = async (store) => {
  const listed = await store.list();
  const keys = (listed.blobs || []).map((blob) => blob.key).filter(Boolean);
  const cases = await Promise.all(keys.map((key) => store.getJSON(key).catch(() => null)));
  return cases.filter(Boolean).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
};

const applyPatch = (caseItem, body) => {
  const now = new Date().toISOString();
  const fields = ["status", "priority", "service", "preferredDate", "contactMethod", "logistics", "discountCode", "estimatedValue", "intakeAt", "promisedAt", "message"];
  fields.forEach((field) => {
    if (field in body) caseItem[field] = clean(body[field], field === "message" ? 1200 : 160);
  });
  if (body.customerName || body.customerPhone || body.customerEmail) {
    caseItem.customer = {
      ...(caseItem.customer || {}),
      name: body.customerName ? clean(body.customerName, 160) : caseItem.customer?.name,
      phone: body.customerPhone ? clean(body.customerPhone, 80) : caseItem.customer?.phone,
      email: body.customerEmail ? clean(body.customerEmail, 240) : caseItem.customer?.email,
    };
  }
  if (body.vehicleModel) caseItem.vehicle = { ...(caseItem.vehicle || {}), model: clean(body.vehicleModel, 160) };
  if (body.assignedTo) {
    const sebastian = { key: "sebastian", name: "Sebastian", role: "Tung felsokning, batteri och elsystem", phone: "070-024 33 19" };
    const lennart = { key: "lennart", name: "Lennart", role: "Golv, mottagning och snabba jobb", phone: "072-260 77 53" };
    caseItem.assignedTo = body.assignedTo === "sebastian" ? sebastian : lennart;
  }
  if (body.note) {
    caseItem.notes = Array.isArray(caseItem.notes) ? caseItem.notes : [];
    caseItem.notes.push({ at: now, text: clean(body.note, 1000) });
  }
  caseItem.updatedAt = now;
};

export default async (request) => {
  if (!authOk(request)) return json({ error: "Unauthorized" }, 401);

  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.split("/").pop() || "");

  if (request.method === "GET") return json({ cases: await listCases(store) });

  if (request.method === "DELETE" && id && id !== "cases") {
    await store.delete(id);
    return json({ ok: true });
  }

  if (request.method !== "PATCH" || !id || id === "cases") return json({ error: "Method not allowed" }, 405);

  const body = await request.json().catch(() => ({}));
  const caseItem = await store.getJSON(id).catch(() => null);
  if (!caseItem) return json({ error: "Arendet hittades inte." }, 404);
  const now = new Date().toISOString();

  if (body.action === "ready_to_pickup") {
    if (caseItem.notifications?.pickupReady?.status === "sent") return json({ error: "Klar-att-hamta har redan skickats." }, 409);
    caseItem.total_cost = Number(body.total_cost || 0);
    caseItem.work_summary = clean(body.work_summary, 1600);
    if (!caseItem.total_cost || !caseItem.work_summary) return json({ error: "Total kostnad och utfort arbete kravs." }, 400);
    caseItem.pickup_link = pickupLinkFor(caseItem);
    caseItem.status = "ready";
    caseItem.timeline = Array.isArray(caseItem.timeline) ? caseItem.timeline : [];
    const notification = await sendPickupReady(caseItem);
    caseItem.notifications = { ...(caseItem.notifications || {}), pickupReady: { status: notification.sms.status === "sent" && notification.email.status === "sent" ? "sent" : "failed", ...notification } };
    caseItem.timeline.push({ at: now, event: "Markerad klar att hamta och kund meddelad via SMS/e-post." });
    caseItem.updatedAt = now;
    await store.setJSON(id, caseItem);
    return json({ ok: true, case: caseItem });
  }

  applyPatch(caseItem, body);

  if (["done", "paid"].includes(caseItem.status) && caseItem.notifications?.thankYou?.status !== "sent") {
    const thankYou = await sendThankYou(caseItem);
    caseItem.coupon = thankYou.coupon;
    caseItem.notifications = { ...(caseItem.notifications || {}), thankYou: { status: thankYou.email.status, ...thankYou } };
    caseItem.timeline = Array.isArray(caseItem.timeline) ? caseItem.timeline : [];
    caseItem.timeline.push({ at: now, event: "Tackmail med unik rabattkod skickat." });
  }

  await store.setJSON(id, caseItem);
  return json({ ok: true, case: caseItem });
};

export const config = {
  path: ["/api/cases", "/api/cases/:id"],
};
