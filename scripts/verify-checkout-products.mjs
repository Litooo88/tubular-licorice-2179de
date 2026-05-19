import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const checkoutFunction = require("../netlify/functions/create-checkout.js");
const { _internals } = checkoutFunction;
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "products.json"), "utf8"));

const checkoutProducts = catalog.products
  .filter((product) => product.checkout && product.priceSek && !["slut", "upphord", "demo-bara"].includes(product.status))
  .map((product) => product.id);
const backendProducts = Object.keys(_internals.loadProducts());
const backendSet = new Set(backendProducts);

const htmlFiles = ["index.html", "nya-elscootrar/index.html"];
const htmlProductIds = new Set();
const missingInBackend = [];
const mediaCheckoutLeaks = [];

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const productMatches = [...html.matchAll(/data-product="([^"]+)"/g)].map((match) => match[1]);
  productMatches.forEach((id) => htmlProductIds.add(id));
  productMatches
    .filter((id) => !backendSet.has(id))
    .forEach((id) => missingInBackend.push(`${file}: ${id}`));
  if (/product-media[^>]*data-product=/.test(html)) {
    mediaCheckoutLeaks.push(file);
  }
}

const missingFromHtml = checkoutProducts.filter((id) => !htmlProductIds.has(id));
const missingFromBackend = checkoutProducts.filter((id) => !backendSet.has(id));
const staleBackend = backendProducts.filter((id) => !checkoutProducts.includes(id));
const checkoutScript = fs.readFileSync(path.join(root, "assets/product-checkout.js"), "utf8");

const failures = [
  ...missingInBackend.map((item) => `HTML references product missing from backend: ${item}`),
  ...missingFromHtml.map((id) => `Checkout product missing from rendered HTML: ${id}`),
  ...missingFromBackend.map((id) => `Checkout product missing from backend loader: ${id}`),
  ...staleBackend.map((id) => `Backend exposes non-checkout/stale product: ${id}`),
  ...mediaCheckoutLeaks.map((file) => `Product media starts checkout in ${file}`),
];

if (/fallbackPaymentLinks/.test(checkoutScript)) {
  failures.push("assets/product-checkout.js still contains hardcoded fallbackPaymentLinks");
}

const previousStripeKey = process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY;
for (const id of checkoutProducts) {
  const response = await checkoutFunction.handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ productId: id }),
  });
  if (response.statusCode === 400) {
    failures.push(`Checkout handler rejects valid product id: ${id}`);
  }
  if (![503, 500, 200].includes(response.statusCode)) {
    failures.push(`Checkout handler returned unexpected status ${response.statusCode} for ${id}`);
  }
}
if (previousStripeKey) process.env.STRIPE_SECRET_KEY = previousStripeKey;

let stripeCalls = 0;
let firstStripeAttempt;
let secondStripeAttempt;
const fakeStripe = {
  checkout: {
    sessions: {
      create: async (params) => {
        stripeCalls += 1;
        if (stripeCalls === 1) {
          firstStripeAttempt = params;
          const error = new Error("Unknown parameter");
          error.code = "parameter_unknown";
          error.type = "invalid_request_error";
          throw error;
        }
        secondStripeAttempt = params;
        return { url: "https://checkout.stripe.test/session" };
      },
    },
  },
};

const fallbackSession = await _internals.createCheckoutSession({
  stripe: fakeStripe,
  product: { name: "Checkout test", price: 995000 },
  origin: "https://www.nordicemobility.se",
});

if (stripeCalls !== 2 || fallbackSession.url !== "https://checkout.stripe.test/session") {
  failures.push("Stripe checkout did not retry after a parameter_unknown response.");
}

if (firstStripeAttempt && "automatic_payment_methods" in firstStripeAttempt) {
  failures.push("Stripe checkout still sends automatic_payment_methods, which failed live with parameter_unknown.");
}

if (!Array.isArray(firstStripeAttempt?.payment_method_types) || !firstStripeAttempt.payment_method_types.includes("card")) {
  failures.push("Stripe checkout first attempt must explicitly include card as a payment method.");
}

if (!Array.isArray(secondStripeAttempt?.payment_method_types) || !secondStripeAttempt.payment_method_types.includes("card")) {
  failures.push("Stripe checkout retry must explicitly include card as a payment method.");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Verified ${checkoutProducts.length} checkout products across ${htmlFiles.join(", ")}.`);
