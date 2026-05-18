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

const loadProducts = () => {
  return Object.fromEntries(
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
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { productId } = JSON.parse(event.body);
    const product = loadProducts()[productId];
    const stripeSecretKey = env("STRIPE_SECRET_KEY");

    if (!product) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Ogiltig produkt" }),
      };
    }

    if (!stripeSecretKey) {
      return {
        statusCode: 503,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Stripe är inte konfigurerat i Netlify. Saknar STRIPE_SECRET_KEY." }),
      };
    }

    const origin = event.headers.origin || "https://www.nordicemobility.se";
    const Stripe = require("stripe");
    const stripe = Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.create({
      locale: "sv",
      automatic_payment_methods: { enabled: true },
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: "sek",
            product_data: {
              name: product.name,
              description: "Elscooter - Nordic E-Mobility, Örebro",
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
      consent_collection: {
        terms_of_service: "required",
      },
      custom_text: {
        terms_of_service_acceptance: {
          message:
            "Jag godkänner Nordic E-Mobilitys villkor, returpolicy och garantipolicy: https://www.nordicemobility.se/villkor/",
        },
        submit: {
          message:
            "Betala tryggt med kort, Klarna eller andra tillgängliga betalsätt. Villkor, returer och garanti finns på https://www.nordicemobility.se/villkor/. Nordic E-Mobility kontaktar dig om leverans, showroom och efterservice.",
        },
      },
    });

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

exports._internals = { loadProducts };
