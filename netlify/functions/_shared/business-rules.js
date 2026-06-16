const CASE_STATUSES = Object.freeze([
  "NY FÖRFRÅGAN",
  "BOKAD",
  "INLÄMNAD",
  "VÄNTAR FELSÖKNING",
  "FELSÖKNING PÅGÅR",
  "PRISFÖRSLAG SKICKAT",
  "INVÄNTAR GODKÄNNANDE",
  "VÄNTAR RESERVDEL",
  "REPARATION PÅGÅR",
  "TEST / KVALITETSKONTROLL",
  "KLAR FÖR UPPHÄMTNING",
  "BETALNING SKICKAD",
  "BETALD",
  "AVSLUTAD",
  "REKLAMATION / ÅTERKOMST",
]);

const LEGACY_CASE_STATUSES = Object.freeze([
  "new",
  "contacted",
  "waiting_customer",
  "checked_in",
  "diagnosing",
  "repairing",
  "waiting_parts",
  "ready",
  "done",
  "archived",
]);

const TARGET_CASE_STATUSES = CASE_STATUSES;

const LOW_RISK_SMS_INTENTS = Object.freeze([
  "booking_confirmation",
  "missed_call_reply",
  "model_or_fault_question",
  "simple_status",
  "review_link",
]);

const APPROVAL_RULES = Object.freeze({
  priceAbove: 995,
  partPurchaseAbove: 500,
  alwaysRequireApproval: Object.freeze([
    "battery",
    "complaint",
    "unhappy_customer",
    "discount",
    "warranty",
    "legal_liability",
    "debt_or_promise",
  ]),
});

const APPROVAL_PATTERNS = Object.freeze([
  ["battery", /\bbatteri|bms\b/i],
  ["complaint", /reklamation|klagomal|klagomål/i],
  ["unhappy_customer", /missnojd|missnöjd|arg kund|besviken/i],
  ["discount", /rabatt|procent|%/i],
  ["warranty", /garanti/i],
  ["legal_liability", /jurid|ansvar|skadestand|skadestånd|skyldig/i],
  ["debt_or_promise", /lovar|garanterar|erkanner skuld|erkänner skuld|bindande löfte/i],
]);

const DEFAULT_PRICE_RULES = Object.freeze([
  { id: "puncture-standard", label: "Punktering vanligt hjul", from: 349, min: 349, max: 595, keywords: ["punktering", "slang", "vanligt hjul"] },
  { id: "puncture-motor", label: "Punktering motorhjul", from: 395, min: 395, max: 795, keywords: ["punktering motorhjul", "motorhjul", "motor wheel"] },
  { id: "diagnostic-standard", label: "Standard felsökning", from: 395, min: 395, max: 995, keywords: ["felsökning", "felsokning", "diagnos", "diagnostic"] },
  { id: "diagnostic-advanced", label: "Avancerad felsökning", from: 645, min: 645, max: 1495, keywords: ["avancerad felsökning", "avancerad felsokning", "avancerad", "elsystem", "kablage"] },
  { id: "brake-adjust", label: "Bromsjustering", from: 289, min: 289, max: 595, keywords: ["broms", "bromsjustering"] },
  { id: "ewheels-e16", label: "E-Wheels E16", from: 395, min: 595, max: 1995, diagnosticRequired: true, keywords: ["e-wheels e16", "ewheels e16", "e16"] },
  { id: "battery-diagnostic", label: "Batterifelsökning", from: 495, min: 495, max: null, approvalRequired: true, keywords: ["batterifelsökning", "batterifelsokning", "batteri", "bms"] },
  { id: "controller", label: "Controllerbyte", from: 995, min: 995, max: 1995, keywords: ["controller", "styrenhet"] },
  { id: "display-throttle", label: "Display/gasreglage", from: 595, min: 595, max: 1495, keywords: ["display", "gasreglage", "gashandtag", "tumgas"] },
]);

const SMS_SIGNATURE = "/ Nordic E-Mobility";

const PAYMENT_DETAILS = Object.freeze({
  swish: "123 240 6775",
  bankgiro: "5290-5494",
});

module.exports = {
  APPROVAL_PATTERNS,
  APPROVAL_RULES,
  CASE_STATUSES,
  DEFAULT_PRICE_RULES,
  LEGACY_CASE_STATUSES,
  LOW_RISK_SMS_INTENTS,
  PAYMENT_DETAILS,
  SMS_SIGNATURE,
  TARGET_CASE_STATUSES,
};
