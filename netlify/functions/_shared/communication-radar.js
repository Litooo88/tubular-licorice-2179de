const { clean } = require("./http");
const { idFor } = require("./storage");

const BOOKING_URL = "https://www.nordicemobility.se/book-online/";

const SOURCES = new Set(["gmail", "sms", "call", "manual"]);
const DIRECTIONS = new Set(["inbound", "outbound"]);
const CLASSIFICATIONS = new Set([
  "customer",
  "supplier",
  "invoice",
  "complaint",
  "warranty",
  "battery_risk",
  "booking",
  "other",
]);
const EVENT_STATUSES = new Set(["new", "reviewed", "linked", "drafted", "dismissed"]);

const HIGH_RISK_PATTERNS = [
  { pattern: /reklamation|klag|missn[oö]jd|d[åa]ligt|arg/i, reason: "reklamation eller missnojd kund" },
  { pattern: /garanti|warranty|ers[aä]ttning|kompensation|pengarna tillbaka/i, reason: "garanti eller ersattning" },
  { pattern: /batteri|battery|bms|brand|brann|r[oö]k|luktar br[aä]nt|explod/i, reason: "batteri eller brandrisk" },
  { pattern: /olycka|skada|ramla|krock|personskada|juridik|advokat|ansvar/i, reason: "olycka, skada eller juridiskt ansvar" },
  { pattern: /([1-9][0-9]{3,})\s*(kr|sek)/i, reason: "pris over 995 kr" },
];

const SUPPLIERS = ["kugoo", "kukirin", "navee", "teverun", "dualtron", "monorim"];

const textFor = (event = {}) =>
  [event.from, event.to, event.subject, event.bodySummary, event.suggestedAction]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const riskForEvent = (event = {}) => {
  const haystack = textFor(event);
  const reasons = HIGH_RISK_PATTERNS.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.reason);
  return {
    level: reasons.length ? "high" : haystack.includes("pris") || haystack.includes("faktura") ? "medium" : "low",
    reasons,
  };
};

const classifyEvent = (event = {}) => {
  const haystack = textFor(event);
  if (/batteri|battery|bms|brand|brann|r[oö]k|luktar br[aä]nt/i.test(haystack)) return "battery_risk";
  if (/garanti|warranty/i.test(haystack)) return "warranty";
  if (/reklamation|missn[oö]jd|klag/i.test(haystack)) return "complaint";
  if (/faktura|invoice|betala|payment|swish|bankgiro/i.test(haystack)) return "invoice";
  if (SUPPLIERS.some((supplier) => haystack.includes(supplier))) return "supplier";
  if (/boka|bokning|l[aä]mna in|reparation|fels[oö]kning|service/i.test(haystack)) return "booking";
  if (/kund|elscooter|elcykel|punktering|broms|display|controller/i.test(haystack)) return "customer";
  return "other";
};

const suggestedActionFor = (event = {}, classification = classifyEvent(event), risk = riskForEvent(event)) => {
  if (risk.level === "high") return "Krav manuell granskning innan svar. Ge inga loften om garanti, ansvar, pris eller datum.";
  if (classification === "supplier") return "Prioritera leverantorssvar och koppla till arende/reservdelsbehov om det matchar.";
  if (classification === "booking") return `Skapa kort svar med bokningslank: ${BOOKING_URL}`;
  if (classification === "invoice") return "Kontrollera betalningsstatus och arende innan svar.";
  return "Skapa ett kort serviceutkast for manuell granskning.";
};

const displayStatusFor = (event = {}) => {
  if (event.caseId) return "linked_to_case";
  if (event.risk?.level === "high") return "needs_approval";
  if (event.draftId) return "draft";
  return "read_only";
};

const normalizeEvent = (input = {}) => {
  const source = SOURCES.has(input.source) ? input.source : "manual";
  const direction = DIRECTIONS.has(input.direction) ? input.direction : "inbound";
  const base = {
    id: clean(input.id || idFor("communication_event"), 180),
    source,
    direction,
    from: clean(input.from, 240),
    to: clean(input.to, 240),
    subject: clean(input.subject, 240),
    bodySummary: clean(input.bodySummary || input.summary || input.message, 1200),
    receivedAt: input.receivedAt || input.createdAt || new Date().toISOString(),
    caseId: clean(input.caseId, 180),
    customerId: clean(input.customerId, 180),
    draftId: clean(input.draftId, 180),
    status: EVENT_STATUSES.has(input.status) ? input.status : "new",
  };
  const classification = CLASSIFICATIONS.has(input.classification) ? input.classification : classifyEvent(base);
  const risk = input.risk && typeof input.risk === "object" && !Array.isArray(input.risk)
    ? {
        level: ["low", "medium", "high"].includes(input.risk.level) ? input.risk.level : riskForEvent(base).level,
        reasons: Array.isArray(input.risk.reasons) ? input.risk.reasons.map((item) => clean(item, 160)).filter(Boolean) : [],
      }
    : riskForEvent({ ...base, classification });
  const normalized = {
    ...base,
    risk,
    classification,
    suggestedAction: clean(input.suggestedAction || suggestedActionFor(base, classification, risk), 800),
  };
  normalized.displayStatus = clean(input.displayStatus || displayStatusFor(normalized), 40);
  return normalized;
};

const demoEvents = () => {
  const now = Date.parse("2026-06-26T09:30:00+02:00");
  return [
    normalizeEvent({
      id: "demo_gmail_supplier_kukirin",
      source: "gmail",
      from: "support@kukirin.example",
      to: "verkstad@nordicemobility.se",
      subject: "KuKirin G2 Pro reservdelar",
      bodySummary: "Leverantor behover bekraftelse pa bromsok och display innan order.",
      receivedAt: new Date(now - 35 * 60 * 1000).toISOString(),
      status: "new",
    }),
    normalizeEvent({
      id: "demo_sms_booking_puncture",
      source: "sms",
      from: "Kund: Sara",
      to: "Nordic E-Mobility",
      subject: "Punktering",
      bodySummary: "Hej, kan jag lamna in min E2S for punktering bak idag?",
      receivedAt: new Date(now - 75 * 60 * 1000).toISOString(),
      caseId: "demo_case_puncture",
      customerId: "demo_customer_sara",
      status: "linked",
    }),
    normalizeEvent({
      id: "demo_gmail_battery_risk",
      source: "gmail",
      from: "Kund: Johan",
      to: "verkstad@nordicemobility.se",
      subject: "Batteri luktar brant",
      bodySummary: "Kunden skriver att batteriet luktar brant efter laddning och undrar om garanti galler.",
      receivedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      status: "new",
    }),
    normalizeEvent({
      id: "demo_call_missed",
      source: "call",
      from: "Missat samtal",
      to: "Nordic E-Mobility",
      subject: "Missat samtal fran potentiell kund",
      bodySummary: "Samtal missades under verkstadstid. Ingen voicemail.",
      receivedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      status: "new",
    }),
    normalizeEvent({
      id: "demo_manual_invoice",
      source: "manual",
      from: "Admin",
      to: "Internt",
      subject: "Fakturafraga",
      bodySummary: "Kund fragar om betalningslank och upphamtning. Kontrollera case innan svar.",
      receivedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
      status: "reviewed",
    }),
  ];
};

const draftMessageFor = (event = {}) => {
  const normalized = normalizeEvent(event);
  const customerLine = normalized.from && !normalized.from.includes("@") ? ` ${normalized.from}` : "";
  if (normalized.risk.level === "high") {
    return "Hej! Tack for att du kontaktar Nordic E-Mobility. Vi vill granska detta manuellt innan vi ger besked, sa att du far korrekt information. Vi aterkommer sa snart arendet ar kontrollerat.\n\n/Nordic E-Mobility";
  }
  if (normalized.classification === "supplier") {
    return "Hej! Tack for uppdateringen. Vi kontrollerar arendet/reservdelsbehovet internt och aterkommer med bekraftelse innan nagon order laggs.\n\n/Nordic E-Mobility";
  }
  if (normalized.classification === "booking") {
    return `Hej${customerLine}! Tack for meddelandet. Boka garna in lamning via ${BOOKING_URL} och skriv modell samt felbeskrivning, sa tittar vi pa arendet i verkstaden. Slutpris bekraftas alltid innan arbete.\n\n/Nordic E-Mobility`;
  }
  return "Hej! Tack for ditt meddelande. Vi kontrollerar arendet och aterkommer med nasta steg. Inga arbeten eller kostnader startas utan bekraftelse.\n\n/Nordic E-Mobility";
};

const draftForEvent = (event = {}) => {
  const normalized = normalizeEvent(event);
  const requiresApproval = normalized.risk.level === "high";
  const deterministicDemo = normalized.id.startsWith("demo_");
  return {
    id: clean(event.draftId || (deterministicDemo ? `draft_${normalized.id}` : idFor("ai_response_draft")), 180),
    communicationEventId: normalized.id,
    caseId: normalized.caseId,
    customerId: normalized.customerId,
    source: normalized.source,
    channel: normalized.source === "gmail" ? "email" : normalized.source,
    message: draftMessageFor(normalized),
    risk: normalized.risk,
    riskLevel: normalized.risk.level,
    requiresApproval,
    approvalReasons: normalized.risk.reasons,
    status: requiresApproval ? "needs_approval" : "draft",
    createdBy: "AI communication radar",
    createdAt: event.draftCreatedAt || (deterministicDemo ? "2026-06-26T08:00:00.000Z" : new Date().toISOString()),
    dryRunSafe: true,
    sendsMessage: false,
  };
};

const caseEventPreviewFor = (event = {}, draft = null) => {
  const normalized = normalizeEvent(event);
  return {
    caseId: normalized.caseId,
    customerId: normalized.customerId,
    type: "ai_suggestion",
    direction: "internal",
    content: draft
      ? `Kommunikationsradar skapade svarsforslag (${draft.riskLevel} risk).`
      : `Kommunikationsradar klassade ${normalized.source}-handelse som ${normalized.classification}.`,
    metadata: {
      communicationEventId: normalized.id,
      draftId: draft?.id || normalized.draftId || "",
      source: normalized.source,
      classification: normalized.classification,
      riskLevel: normalized.risk.level,
      requiresApproval: draft?.requiresApproval || normalized.risk.level === "high",
      dryRunSafe: true,
    },
    createdBy: "AI communication radar",
  };
};

const summarizeRadar = (events = []) => {
  const rows = events.map(normalizeEvent);
  return {
    total: rows.length,
    newInbound: rows.filter((event) => event.status === "new" && event.direction === "inbound").length,
    needsReply: rows.filter((event) => ["new", "reviewed"].includes(event.status)).length,
    riskCases: rows.filter((event) => event.risk.level === "high").length,
    suppliers: rows.filter((event) => event.classification === "supplier").length,
    linkedToCase: rows.filter((event) => event.caseId).length,
  };
};

module.exports = {
  BOOKING_URL,
  CLASSIFICATIONS,
  DIRECTIONS,
  EVENT_STATUSES,
  SOURCES,
  caseEventPreviewFor,
  classifyEvent,
  demoEvents,
  displayStatusFor,
  draftForEvent,
  normalizeEvent,
  riskForEvent,
  summarizeRadar,
};
