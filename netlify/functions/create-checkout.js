const catalog = require("../../data/products.json");

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const DEFAULT_SITE_ORIGIN = "https://www.nordicemobility.se";

const normalizeOrigin = (value) => {
  try {
    const url = new URL(value || DEFAULT_SITE_ORIGIN);
    if (!["https:", "http:"].includes(url.protocol)) return DEFAULT_SITE_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
};

const checkoutOrigin = () =>
  normalizeOrigin(env("SITE_URL") || env("URL") || env("DEPLOY_PRIME_URL") || DEFAULT_SITE_ORIGIN);

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
          brand: product.brand,
          id: product.id,
          status: product.status,
          delivery: product.delivery || "",
        },
      ])
  );

const TEVERUN_SHIPPING_SEK = 69900;

const createCheckoutSession = async ({ stripe, product, origin }) => {
  const metadata = {
    product_id: product.id || "",
    product_name: product.name || "",
    brand: product.brand || "",
  };
  const shippingOptions = (() => {
    if (product.brand === "KuKirin") {
      return [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 0, currency: "sek" },
            display_name: "Gratis hemleverans fr\u00e5n KuKirin",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 5 },
              maximum: { unit: "business_day", value: 5 },
            },
          },
        },
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 0, currency: "sek" },
            display_name: "Gratis leverans till Nordic E-Mobilitys verkstad",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 5 },
              maximum: { unit: "business_day", value: 5 },
            },
          },
        },
      ];
    }

    if (product.brand === "Teverun") {
      return [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: TEVERUN_SHIPPING_SEK, currency: "sek" },
            display_name: "Teverun-frakt 60 EUR",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 5 },
              maximum: { unit: "business_day", value: 7 },
            },
          },
        },
      ];
    }

    return undefined;
  })();

  const baseStableSession = {
    locale: "sv",
    line_items: [
      {
        price_data: {
          currency: "sek",
          product_data: {
            name: product.name,
            description: `Elscooter - Nordic E-Mobility, Orebro. ${product.delivery || ""}`.trim(),
          },
          unit_amount: product.price,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    metadata,
    payment_intent_data: { metadata },
    success_url: `${origin}/?purchase=success`,
    cancel_url: `${origin}/#produkter`,
    shipping_address_collection: {
      allowed_countries: ["SE"],
    },
    phone_number_collection: { enabled: true },
  };
  const stableSession = { ...baseStableSession };
  if (shippingOptions) stableSession.shipping_options = shippingOptions;

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
  const richNoShippingSession = { ...baseStableSession, ...policyFields };
  const attempts = [
    { ...richSession, payment_method_types: ["card", "klarna"], allow_promotion_codes: true },
    { ...richSession, payment_method_types: ["card", "klarna"] },
    { ...richSession, payment_method_types: ["card"], allow_promotion_codes: true },
    { ...richSession, payment_method_types: ["card"] },
    { ...stableSession, payment_method_types: ["card", "klarna"], allow_promotion_codes: true },
    { ...stableSession, payment_method_types: ["card", "klarna"] },
    { ...stableSession, payment_method_types: ["card"], allow_promotion_codes: true },
    { ...stableSession, payment_method_types: ["card"] },
    { ...richNoShippingSession, payment_method_types: ["card", "klarna"], allow_promotion_codes: true },
    { ...richNoShippingSession, payment_method_types: ["card", "klarna"] },
    { ...baseStableSession, payment_method_types: ["card"], allow_promotion_codes: true },
    { ...baseStableSession, payment_method_types: ["card"] },
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

    const origin = checkoutOrigin();
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

exports._internals = { loadProducts, createCheckoutSession, TEVERUN_SHIPPING_SEK, checkoutOrigin, normalizeOrigin };
