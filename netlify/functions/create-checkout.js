const catalog = require("../../data/products.json");

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const adminDebugAllowed = (event) => {
  const expected = env("ADMIN_TOKEN");
  const provided = event.headers["x-admin-token"] || event.headers["X-Admin-Token"] || "";
  return Boolean(expected && provided && expected === provided);
};

const loadProducts = () =>
  Object.fromEntries(
    catalog.products
      .filter((product) => product.checkout && product.priceSek && !["slut", "upphord", "demo-bara"].includes(product.status))
      .map((product) => [
        product.id,
        {
          name: product.name,
          price: product.priceSek * 100,
          status: product.status,
          delivery: product.delivery || "",
        },
      ])
  );

const createCheckoutSession = async ({ stripe, product, origin }) => {
  const stableSession = {
    locale: "sv",
    line_items: [
      {
        price_data: {
          currency: "sek",
          product_data: {
            name: product.name,
            description: "Elscooter - Nordic E-Mobility, Orebro",
          },
          unit_amount: product.price,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${origin}/?purchase=success`,
    cancel_url: `${origin}/#produkter`,
    shipping_address_collection: {
      allowed_countries: ["SE"],
    },
    phone_number_collection: { enabled: true },
  };

  const policyFields = {
    consent_collection: {
      terms_of_service: "required",
    },
    custom_text: {
      terms_of_service_acceptance: {
        message:
          "Jag godkanner Nordic E-Mobilitys villkor, returpolicy och garantipolicy: https://www.nordicemobility.se/villkor/",
      },
      submit: {
        message:
          "Betala tryggt med kort, Klarna eller andra tillgangliga betalsatt. Villkor, returer och garanti finns pa https://www.nordicemobility.se/villkor/. Nordic E-Mobility kontaktar dig om leverans, showroom och efterservice.",
      },
    },
  };

  const richSession = { ...stableSession, ...policyFields };
  const attempts = [
    { ...richSession, payment_method_types: ["card", "klarna"], allow_promotion_codes: true },
    { ...richSession, payment_method_types: ["card", "klarna"] },
    { ...richSession, payment_method_types: ["card"], allow_promotion_codes: true },
    { ...richSession, payment_method_types: ["card"] },
    { ...stableSession, payment_method_types: ["card", "klarna"], allow_promotion_codes: true },
    { ...stableSession, payment_method_types: ["card", "klarna"] },
    { ...stableSession, payment_method_types: ["card"], allow_promotion_codes: true },
    { ...stableSession, payment_method_types: ["card"] },
  ];

  let lastError;
  for (const params of attempts) {
    try {
      return await stripe.checkout.sessions.create(params);
    } catch (error) {
      lastError = error;
      const retryable = error?.code === "parameter_unknown" || error?.type === "invalid_request_error";
      if (!retryable) throw error;
    }
  }
  throw lastError || new Error("Stripe Checkout kunde inte startas.");
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { productId } = JSON.parse(event.body || "{}");
    const product = loadProducts()[productId];
    const stripeSecretKey = env("STRIPE_SECRET_KEY");

    if (!product) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Ogiltig produkt" }),
      };
    }

    if (!stripeSecretKey) {
      return {
        statusCode: 503,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Stripe ar inte konfigurerat i Netlify. Saknar STRIPE_SECRET_KEY." }),
      };
    }

    const origin = event.headers.origin || "https://www.nordicemobility.se";
    const Stripe = require("stripe");
    const stripe = Stripe(stripeSecretKey);
    const session = await createCheckoutSession({ stripe, product, origin });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("Stripe error:", err);
    const debug = adminDebugAllowed(event)
      ? {
          message: err?.message || "Unknown Stripe error",
          type: err?.type || "",
          code: err?.code || "",
          param: err?.param || "",
        }
      : undefined;
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Kunde inte skapa betalningssession. Forsok igen.",
        detail: err?.code || err?.type || err?.message || "",
        debug,
      }),
    };
  }
};

exports._internals = { loadProducts, createCheckoutSession };
