const Stripe = require("stripe");
const { clean, env, header, json } = require("./_shared/http");
const { connectBlobs, get, put } = require("./_shared/storage");
const { resendEmail, FOOTER_HTML, FOOTER_TEXT } = require("./_shared/email");

const stripe = () => Stripe(env("STRIPE_SECRET_KEY") || "sk_test_placeholder");

const rawBody = (event) => {
  const body = event?.body || "";
  return event?.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
};

const checkoutPaymentRecord = (session, stripeEvent) => {
  const metadata = session.metadata || {};
  const customerDetails = session.customer_details || {};
  return {
    provider: "stripe",
    providerEventId: clean(stripeEvent.id, 160),
    providerSessionId: clean(session.id, 180),
    providerPaymentIntentId: clean(session.payment_intent, 180),
    type: "checkout_session",
    status: clean(session.payment_status || session.status || "unknown", 80),
    currency: clean(session.currency || "sek", 20).toLowerCase(),
    amountTotal: Number(session.amount_total || 0),
    amountSubtotal: Number(session.amount_subtotal || 0),
    productId: clean(metadata.product_id || metadata.productId, 180),
    productName: clean(metadata.product_name || metadata.productName, 240),
    productBrand: clean(metadata.brand, 120),
    customerEmail: clean(customerDetails.email || session.customer_email, 240),
    customerName: clean(customerDetails.name, 240),
    customerPhone: clean(customerDetails.phone, 80),
    rawCreated: session.created || null,
    paidAt: session.payment_status === "paid" ? new Date().toISOString() : "",
    eventType: clean(stripeEvent.type, 120),
  };
};

const formatSek = (amountOre) =>
  `${new Intl.NumberFormat("sv-SE").format(Math.round(Number(amountOre || 0) / 100))} kr`;

const orderReference = (session) => clean(session.id, 180).slice(-12).toUpperCase();

const htmlEscape = (value) =>
  clean(value, 2000).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

// Distansavtalslagen kräver bekräftelse på varaktigt medium med bl.a.
// ångerinformation efter köpet — Stripes standardkvitto räcker inte.
const orderConfirmationEmail = (record, session) => {
  const firstName = clean(record.customerName, 120).split(/\s+/)[0] || "där";
  const reference = orderReference(session);
  const rows = [
    ["Orderreferens", reference],
    ["Produkt", record.productName || "Se kvitto"],
    ["Belopp", `${formatSek(record.amountTotal)} inkl. moms`],
  ];
  const html = `
  <div style="margin:0;background:#f4f6f2;padding:24px;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #dfe5dc;border-radius:8px;overflow:hidden">
      <div style="background:#061007;color:#fff;padding:22px 24px">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8ff5ae;font-weight:700">Nordic E-Mobility</div>
        <h1 style="font-size:24px;line-height:1.2;margin:8px 0 0">Tack f&ouml;r din best&auml;llning!</h1>
      </div>
      <div style="padding:24px;line-height:1.6">
        <p>Hej ${htmlEscape(firstName)},</p>
        <p>Vi har tagit emot din betalning och bekr&auml;ftar h&auml;rmed ditt k&ouml;p. Vi kontaktar dig om leverans och n&auml;sta steg &mdash; normalt inom en arbetsdag.</p>
        <div style="background:#f7faf6;border:1px solid #dfe8dc;border-radius:8px;padding:16px;margin:18px 0">
          ${rows.map(([label, value]) => `<p style="margin:0 0 8px"><strong>${label}:</strong> ${htmlEscape(value)}</p>`).join("")}
          <p style="margin:0"><strong>Avtalspart:</strong> Nordic E-Mobility, Org.nr 880809-6658, Pistolv&auml;gen 6, 702 21 &Ouml;rebro</p>
        </div>
        <p><strong>Din &aring;ngerr&auml;tt (14 dagar):</strong> Du har r&auml;tt att &aring;ngra k&ouml;pet inom 14 dagar fr&aring;n att du tagit emot varan, utan att ange n&aring;got sk&auml;l. Enklast &aring;ngrar du dig via v&aring;rt digitala formul&auml;r p&aring; <a href="https://www.nordicemobility.se/angra-kop/" style="color:#067a35">nordicemobility.se/angra-kop</a> &mdash; du kan ocks&aring; anv&auml;nda <a href="https://publikationer.konsumentverket.se/kontrakt-och-mallar/angerblankett" style="color:#067a35">Konsumentverkets standardblankett</a> eller mejla oss. Vid retur st&aring;r du f&ouml;r returfrakten, och avdrag g&ouml;rs endast f&ouml;r varans faktiska v&auml;rdeminskning.</p>
        <p><strong>Reklamation och garanti:</strong> Som konsument har du 3 &aring;rs reklamationsr&auml;tt enligt konsumentk&ouml;plagen. Fullst&auml;ndiga villkor: <a href="https://www.nordicemobility.se/villkor/" style="color:#067a35">villkor</a> &middot; <a href="https://www.nordicemobility.se/garanti/" style="color:#067a35">garanti</a>.</p>
        <p>Fr&aring;gor? Svara p&aring; det h&auml;r mejlet eller ring 010-138 54 98.</p>
        ${FOOTER_HTML}
      </div>
    </div>
  </div>`;
  const text = [
    `Hej ${firstName},`,
    "",
    "Tack för din beställning hos Nordic E-Mobility! Vi har tagit emot din betalning.",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "Avtalspart: Nordic E-Mobility, Org.nr 880809-6658, Pistolvägen 6, 702 21 Örebro",
    "",
    "ÅNGERRÄTT (14 dagar): Du kan ångra köpet inom 14 dagar från att du tagit emot varan,",
    "utan att ange skäl. Ångra digitalt: https://www.nordicemobility.se/angra-kop/",
    "Konsumentverkets standardblankett: https://publikationer.konsumentverket.se/kontrakt-och-mallar/angerblankett",
    "Vid retur står du för returfrakten; avdrag görs endast för faktisk värdeminskning.",
    "",
    "Reklamation: 3 års reklamationsrätt enligt konsumentköplagen.",
    "Villkor: https://www.nordicemobility.se/villkor/  Garanti: https://www.nordicemobility.se/garanti/",
    "",
    "Vi kontaktar dig om leverans och nästa steg — normalt inom en arbetsdag.",
    FOOTER_TEXT,
  ].join("\n");
  return {
    subject: `Orderbekräftelse ${reference} – Nordic E-Mobility`,
    html,
    text,
  };
};

const workshopOrderEmail = (record, session) => ({
  subject: `NY PRODUKTORDER: ${record.productName || "okänd produkt"} – ${formatSek(record.amountTotal)}`,
  text: [
    "Ny betald produktorder via Stripe checkout.",
    `Orderreferens: ${orderReference(session)}`,
    `Produkt: ${record.productName || "-"} (${record.productBrand || "-"})`,
    `Belopp: ${formatSek(record.amountTotal)}`,
    `Kund: ${record.customerName || "-"}`,
    `E-post: ${record.customerEmail || "-"}`,
    `Telefon: ${record.customerPhone || "-"}`,
    "",
    "Nästa steg: bekräfta leverans mot leverantören och kontakta kunden.",
  ].join("\n"),
  html: "",
});

const sendOrderNotifications = async (record, session) => {
  const results = {};
  if (record.customerEmail) {
    const email = orderConfirmationEmail(record, session);
    results.orderConfirmation = await resendEmail({
      to: [record.customerEmail],
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `${clean(session.id, 160)}-order-confirmation`,
    });
  } else {
    results.orderConfirmation = { status: "not_requested", reason: "no_customer_email" };
  }

  const workshopRecipients = (env("WORKSHOP_EMAIL") || env("NOTIFY_EMAIL") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (workshopRecipients.length) {
    const notice = workshopOrderEmail(record, session);
    results.workshopNotice = await resendEmail({
      to: workshopRecipients,
      subject: notice.subject,
      text: notice.text,
      html: `<pre style="font-family:monospace;white-space:pre-wrap">${htmlEscape(notice.text)}</pre>`,
      idempotencyKey: `${clean(session.id, 160)}-workshop-order`,
    });
  } else {
    results.workshopNotice = { status: "not_configured" };
  }
  return results;
};

exports.handler = async (event) => {
  connectBlobs(event);
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return json(503, { error: "Stripe webhook ar inte konfigurerad.", configured: false });
  }

  const signature = header(event, "stripe-signature");
  if (!signature) return json(400, { error: "Stripe signature saknas." });

  let stripeEvent;
  try {
    stripeEvent = stripe().webhooks.constructEvent(rawBody(event), signature, webhookSecret);
  } catch (error) {
    return json(400, { error: "Ogiltig Stripe signature.", code: clean(error?.type || error?.name, 120) });
  }

  try {
    if (stripeEvent.type !== "checkout.session.completed") {
      return json(200, { ok: true, received: true, ignored: true, type: stripeEvent.type });
    }

    const session = stripeEvent.data?.object || {};
    const paymentId = `stripe_${clean(session.id, 170)}`;

    // Stripe kan skicka om samma event — skicka aldrig om mejl som redan gått.
    const existing = await get("payments", paymentId);
    const alreadyConfirmed = existing?.notifications?.orderConfirmation?.status === "sent";

    const record = checkoutPaymentRecord(session, stripeEvent);
    if (existing?.notifications) record.notifications = existing.notifications;
    let payment = await put("payments", record, { id: paymentId });

    if (session.payment_status === "paid" && !alreadyConfirmed) {
      const notifications = await sendOrderNotifications(record, session);
      payment = await put(
        "payments",
        { ...payment, notifications: { ...(payment.notifications || {}), ...notifications } },
        { id: paymentId }
      );
      console.log("stripe_order_notifications", {
        paymentId,
        orderConfirmation: notifications.orderConfirmation?.status,
        workshopNotice: notifications.workshopNotice?.status,
      });
    }

    return json(200, {
      ok: true,
      received: true,
      stored: true,
      paymentId: payment.id,
      type: stripeEvent.type,
      orderConfirmation: payment.notifications?.orderConfirmation?.status || "skipped",
    });
  } catch (error) {
    console.error("stripe-webhook failed", {
      name: error?.name,
      message: error?.message,
      type: stripeEvent?.type,
    });
    return json(500, {
      error: "Stripe webhook kunde inte spara betalningen.",
      code: error?.name || "STRIPE_WEBHOOK_STORAGE_ERROR",
    });
  }
};
