const Stripe = require("stripe");
const { clean, env, header, json } = require("./_shared/http");
const { connectBlobs, put } = require("./_shared/storage");

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
    const payment = await put(
      "payments",
      checkoutPaymentRecord(session, stripeEvent),
      { id: `stripe_${clean(session.id, 170)}` }
    );

    return json(200, {
      ok: true,
      received: true,
      stored: true,
      paymentId: payment.id,
      type: stripeEvent.type,
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
