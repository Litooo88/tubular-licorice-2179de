// Regressionstester för kontraktsfynden i docs/FULL_SYSTEM_AUDIT_2026_09_07.md.
// Alla providerkall är stubbar — testerna skickar aldrig SMS, mejl eller
// betalningar och rör ingen Netlify-storage.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";

import { publicBookingCase } from "../netlify/functions/_shared/public-booking.mjs";
import { thankYouOutcome } from "../netlify/functions/workshop-cases.mjs";
import { normalizeDraft } from "../netlify/functions/sms-draft-inbox.mjs";

const require = createRequire(import.meta.url);
const { _internals } = require("../netlify/functions/create-checkout.js");

// --- F01: publik bokningsrespons ------------------------------------------

const internalCase = {
  id: "case_2026-09-07T10-00-00-000Z_hemlig",
  serviceNumber: 4711,
  status: "new",
  service: "Service",
  preferredDate: "2026-09-10T09:00",
  customer: { name: "Test Testsson", phone: "+46700000000", email: "test@example.com" },
  payment: { status: "unpaid", amount: 2495, swish: "1234" },
  internalNote: "INTERN: kunden var otrevlig i telefon",
  notes: [{ at: "2026-09-07", text: "INTERN anteckning" }],
  timeline: [{ at: "2026-09-07", event: "INTERN handelse" }],
  notifications: {
    sms: { status: "sent" },
    customerEmail: { status: "sent" },
    staffSms: { status: "sent" },
    calendar: { status: "created" },
  },
};

test("F01: publikt bokningssvar lacker inga interna falt", () => {
  const publicCase = publicBookingCase(internalCase);
  const serialized = JSON.stringify(publicCase);
  for (const secret of ["INTERN", "swish", "2495", internalCase.id, "4711", "+46700000000", "test@example.com"]) {
    assert.equal(serialized.includes(secret), false, `publikt svar lackte "${secret}"`);
  }
  assert.deepEqual(Object.keys(publicCase).sort(), ["customerDelivery", "notifications", "preferredDate", "service", "status"]);
});

test("F01: kundens kvittens finns kvar och ar arlig", () => {
  assert.deepEqual(publicBookingCase(internalCase).customerDelivery, { status: "sent" });

  const smsOnly = {
    notifications: { sms: { status: "sent" }, customerEmail: { status: "not_requested" }, staffSms: { status: "sent" } },
  };
  // Ingen mejladress angavs: SMS ensamt ar full leverans, inte "partial".
  assert.deepEqual(publicBookingCase(smsOnly).customerDelivery, { status: "sent" });

  const halfway = { notifications: { sms: { status: "sent" }, customerEmail: { status: "failed" } } };
  assert.equal(publicBookingCase(halfway).customerDelivery.status, "partial");

  const nothing = { notifications: { sms: { status: "failed" }, customerEmail: { status: "failed" } } };
  assert.equal(publicBookingCase(nothing).customerDelivery.status, "missing");
});

// --- F05: checkout-fallback far aldrig tappa frakten ----------------------

const teverun = { id: "teverun-test", name: "Teverun Test", brand: "Teverun", price: 2999900, delivery: "" };

const stripeStub = ({ failFirst = 0 }) => {
  const seen = [];
  let calls = 0;
  return {
    seen,
    checkout: {
      sessions: {
        create: async (params) => {
          seen.push(params);
          calls += 1;
          if (calls <= failFirst) {
            const error = new Error("simulerat providerfel");
            error.type = "invalid_request_error";
            throw error;
          }
          return { id: `cs_test_${calls}`, url: "https://stripe.test/session" };
        },
      },
    },
  };
};

test("F05: varje tillatet forsok behaller frakten", async () => {
  // Alla utom sista forsoket faller — tidigare hamnade vi da i en variant helt
  // utan shipping_options och salde 699 kr frakt gratis.
  const stripe = stripeStub({ failFirst: 7 });
  const session = await _internals.createCheckoutSession({ stripe, product: teverun, origin: "https://example.test" });
  assert.ok(session.id);
  assert.equal(stripe.seen.length, 8);
  for (const [index, params] of stripe.seen.entries()) {
    assert.ok(params.shipping_options, `forsok ${index + 1} saknade shipping_options`);
    assert.equal(
      params.shipping_options[0].shipping_rate_data.fixed_amount.amount,
      _internals.TEVERUN_SHIPPING_SEK,
      `forsok ${index + 1} hade fel fraktbelopp`,
    );
  }
});

test("F05: felar kontrollerat i stallet for att salja utan frakt", async () => {
  const stripe = stripeStub({ failFirst: 99 });
  await assert.rejects(() => _internals.createCheckoutSession({ stripe, product: teverun, origin: "https://example.test" }));
  assert.ok(stripe.seen.every((params) => params.shipping_options));
});

// --- F06: tackmail far inte kvitteras som skickat nar det inte gick ivag ---

test("F06: providerfel ger inget falskt leveranskvitto", () => {
  const failed = thankYouOutcome({ email: { status: "failed" }, reviewSms: { status: "failed" } });
  assert.equal(failed.delivered, false);
  assert.equal(failed.retryable, true);
  assert.equal(/skickat/i.test(failed.event), false);

  const noAddress = thankYouOutcome({ email: { status: "not_requested" }, reviewSms: { status: "skipped" } });
  assert.equal(noAddress.delivered, false);
  // Ingen mejladress blir inte battre av ett omforsok — den far inte ockupera kon.
  assert.equal(noAddress.retryable, false);
  assert.equal(/skickades inte/i.test(noAddress.event), true);

  const partial = thankYouOutcome({ email: { status: "not_requested" }, reviewSms: { status: "sent" } });
  assert.equal(partial.delivered, true);
  assert.equal(partial.event.includes("SMS"), true);

  const ok = thankYouOutcome({ email: { status: "sent" }, reviewSms: { status: "sent" } });
  assert.equal(ok.delivered, true);
  assert.equal(ok.retryable, false);
});

// --- F04: blandade utkastformat i samma store ------------------------------

test("F04: legacy-utkast utan meta kraschar inte inkorgen", () => {
  const legacy = normalizeDraft(
    { id: "draft_abc", caseId: "case_123", message: "Hej!", to: "+46700000000", intent: "followup", status: "draft", createdAt: "2026-09-01T00:00:00.000Z" },
    "draft_abc",
  );
  assert.equal(typeof legacy.meta.namn, "string");
  assert.equal(legacy.meta.telefon, "+46700000000");
  assert.equal(legacy.category, "C");
  assert.equal(legacy.format, "legacy");
  // caseId maste vara blob-nyckeln (den som approve/skip anropas med),
  // arendet finns kvar i linkedCaseId.
  assert.equal(legacy.caseId, "draft_abc");
  assert.equal(legacy.linkedCaseId, "case_123");

  const modern = normalizeDraft(
    { caseId: "case_456", message: "Hej igen", category: "A", meta: { namn: "Anna", telefon: "+46700000001", alderDagar: 3 } },
    "case_456",
  );
  assert.equal(modern.meta.namn, "Anna");
  assert.equal(modern.category, "A");
  assert.equal(modern.format, "inbox");
  assert.equal(modern.caseId, "case_456");

  assert.equal(normalizeDraft(null, "x"), null);
  assert.equal(normalizeDraft({ message: "   " }, "x"), null);
});

// --- F17: kunskapsindexet ska inte bara PÅSTÅ att det saknar PII -----------

test("F17: fritext i repair-index redigeras", async () => {
  const { redactPii, buildIndexRow } = await import("../netlify/functions/_shared/repair-index.mjs");

  assert.equal(redactPii("Kund ringde 070-123 45 67"), "Kund ringde [telefon]");
  assert.equal(redactPii("Ringde +46 70 123 45 67"), "Ringde [telefon]");
  assert.equal(redactPii("Mejl: anna@example.com"), "Mejl: [mejl]");
  assert.equal(redactPii("Personnr 19900101-1234"), "Personnr [personnummer]");
  // Teknisk text far inte forstoras.
  assert.equal(redactPii("Bytte BMS, kostnad 1995 kr, E16 2026-09-07"), "Bytte BMS, kostnad 1995 kr, E16 2026-09-07");

  const row = buildIndexRow({
    id: "case_1",
    status: "done",
    vehicle: { brand: "E-Wheels", model: "E16" },
    service: "Batteri",
    workshop: { partsUsed: "BMS. Kund nas pa 070-123 45 67" },
    completion: { symptom: "Laddar inte, mejl anna@example.com", rootCauseNote: "Ringde 070-123 45 67", workSummary: "Bytte BMS" },
  });
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes("070"), false);
  assert.equal(serialized.includes("@example.com"), false);
  assert.equal(row.workSummary, "Bytte BMS");
});
