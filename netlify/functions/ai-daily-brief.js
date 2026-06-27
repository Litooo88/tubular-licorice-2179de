const { clean, env, header, json, parseBody, requireAdmin } = require("./_shared/http");
const { list, put } = require("./_shared/storage");
const { assessRisk } = require("./_shared/operator");

const MISSING_BLOBS_RE = /MissingBlobsEnvironmentError|BlobsEnvironment|not been configured to use Netlify Blobs/i;
const CLOSED_STATUSES = new Set(["done", "archived", "closed"]);
const PAID_OR_INVOICED = new Set(["paid", "invoiced"]);

const isDryRunRequest = (event, body) =>
  body.dryRun === true ||
  body.previewOnly === true ||
  event.queryStringParameters?.dryRun === "1";

const isMissingBlobsEnvironment = (error) =>
  MISSING_BLOBS_RE.test(`${error?.code || ""} ${error?.name || ""} ${error?.message || ""}`);

const originFor = (event) => {
  const host = header(event, "host");
  if (!host) return "";
  const forwardedProto = header(event, "x-forwarded-proto");
  const protocol = forwardedProto || (host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
};

const valueFor = (item) =>
  Number(item?.payment?.amount || item?.completion?.totalCost || item?.total_cost || item?.quote?.amount || item?.estimatedValue || 0);

const isActive = (item) => !CLOSED_STATUSES.has(String(item?.status || ""));
const customerName = (item) => item?.customer?.name || item?.customerName || "Okand kund";
const modelName = (item) => item?.vehicle?.model || item?.model || "Modell saknas";
const missingModel = (item) => !clean(modelName(item), 120) || /^okand|^okänd|^test$/i.test(clean(modelName(item), 120));
const isStale = (item) => {
  const time = new Date(item?.updatedAt || item?.createdAt || 0).getTime();
  return Number.isFinite(time) && time > 0 && Date.now() - time > 48 * 60 * 60 * 1000;
};
const customerDeliveryStatus = (item) => {
  const notifications = item?.notifications || {};
  const delivery = item?.customerDelivery || notifications.customerDelivery || {};
  if (delivery.status) return delivery.status;
  const smsSent = notifications.sms?.status === "sent";
  const emailSent = notifications.customerEmail?.status === "sent";
  if (smsSent && emailSent) return "sent";
  if (smsSent || emailSent) return "partial";
  return "missing";
};
const paymentStatus = (item) => clean(item?.payment?.status || "unpaid", 80) || "unpaid";
const hasPaymentAmount = (item) => {
  const paymentAmount = item?.payment?.amount;
  const completionAmount = item?.completion?.totalCost;
  return paymentAmount !== undefined && paymentAmount !== null && paymentAmount !== "" ||
    completionAmount !== undefined && completionAmount !== null && completionAmount !== "";
};
const completionNotified = (item) => Boolean(item?.completion?.customerNotifiedAt);
const isRiskText = (item) => /batteri|bms|reklamation|missnojd|missnöjd|garanti|jurid|brand|kortslut/i.test([
  item?.priority,
  item?.service,
  item?.message,
  item?.status,
].filter(Boolean).join(" "));

const caseSummary = (item, reason = "") => ({
  id: item.id,
  customer: customerName(item),
  model: modelName(item),
  status: item.status || "okand",
  reason,
  value: valueFor(item),
});

const reasonsFor = (item, matchedMissedCallIds = new Set()) => {
  if (!isActive(item)) return [];
  const reasons = [];
  if (item.status === "new" && customerDeliveryStatus(item) === "missing") reasons.push("Ny utan bekraftelse");
  if (item.status === "ready" && !completionNotified(item)) reasons.push("Klar - kund ej notifierad");
  if ((item.status === "ready" || paymentStatus(item) === "invoice_ready" || hasPaymentAmount(item)) && !PAID_OR_INVOICED.has(paymentStatus(item))) {
    reasons.push("Klar att fakturera/betala");
  }
  if (item.status === "waiting_customer") reasons.push("Vantar kund");
  if (item.status === "waiting_parts") reasons.push("Vantar del");
  if (item.priority === "urgent" || isRiskText(item)) reasons.push("Risk");
  if (isStale(item)) reasons.push("Statt stilla");
  if (missingModel(item)) reasons.push("Saknar modell");
  if (matchedMissedCallIds.has(String(item.id))) reasons.push("Missat samtal matchat");
  return reasons;
};

const priorityScore = (reasons) => reasons.reduce((sum, reason) => sum + ({
  "Missat samtal matchat": 100,
  Risk: 90,
  "Statt stilla": 80,
  "Ny utan bekraftelse": 75,
  "Klar - kund ej notifierad": 70,
  "Klar att fakturera/betala": 65,
  "Vantar kund": 55,
  "Vantar del": 50,
  "Saknar modell": 40,
}[reason] || 10), 0);

const emptyBrief = (body = {}, method = "GET") => {
  const today = new Date().toISOString().slice(0, 10);
  const brief = {
    date: body.date || today,
    generatedAt: new Date().toISOString(),
    aiMode: "deterministic_dry_run",
    metrics: {
      doNow: 0,
      active: 0,
      missedCalls: 0,
      unansweredSms: 0,
      waitingCustomer: 0,
      waitingParts: 0,
      readyInvoice: 0,
      riskCases: 0,
      possibleRevenueToday: 0,
    },
    priority: [],
    missedCalls: [],
    unansweredSms: [],
    waitingParts: [],
    openPartNeeds: [],
    readyInvoice: [],
    riskCases: [],
    suggestedSocialPost: "Hall din elscooter redo for vardagen. Nordic E-Mobility i Orebro hjalper dig med service, bromsar och felsokning.",
  };
  return {
    ok: true,
    summary: "0 arenden kraver atgard nu. Inga Blob-kallor lastes i dry-run.",
    topPriorities: [],
    cashToday: 0,
    riskCases: [],
    missedCallsToFollowUp: [],
    partsToOrder: [],
    readyForPayment: [],
    salesOpportunities: [],
    socialMediaSuggestion: brief.suggestedSocialPost,
    dryRun: true,
    writesSkipped: method === "POST" ? ["ai_recommendations"] : [],
    readsSkipped: ["api_cases", "service_cases", "call_logs", "sms_drafts", "part_needs", "ai_recommendations"],
    sourceStatus: {
      primary: "dry_run",
      casesAvailable: false,
      storesChecked: [],
      warnings: ["dryRun aktivt: inga Blob-lasningar eller writes gjordes."],
    },
    brief,
  };
};

const readAdminCases = async (event, warnings) => {
  const origin = originFor(event);
  if (!origin) {
    warnings.push("api_cases: kunde inte bygga intern URL.");
    return { rows: [], source: { source: "api_cases", count: 0, error: "MISSING_ORIGIN" } };
  }
  try {
    const response = await fetch(`${origin}/api/cases`, {
      headers: { "x-admin-token": header(event, "x-admin-token") },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = clean(data?.error || response.statusText || `HTTP_${response.status}`, 120);
      warnings.push(`api_cases: kunde inte lasas (${code}).`);
      return { rows: [], source: { source: "api_cases", count: 0, error: code } };
    }
    const rows = Array.isArray(data.cases) ? data.cases : [];
    if (!rows.length) warnings.push("api_cases: tom eller saknar poster.");
    return { rows, source: { source: "api_cases", count: rows.length } };
  } catch (error) {
    const code = clean(error?.code || error?.name || "API_CASES_UNAVAILABLE", 80);
    const message = clean(error?.message || "api_cases kunde inte lasas.", 240);
    console.error("ai-daily-brief api_cases failed", { code, message });
    warnings.push(`api_cases: kunde inte lasas (${code}).`);
    return { rows: [], source: { source: "api_cases", count: 0, error: code } };
  }
};

const readOptionalList = async (entity, warnings) => {
  try {
    const rows = await list(entity);
    return { rows, source: { source: entity, count: rows.length, sourceUnavailable: false } };
  } catch (error) {
    const code = clean(error?.code || error?.name || "STORAGE_UNAVAILABLE", 80);
    const message = clean(error?.message || "Kallan kunde inte lasas.", 240);
    console.error("ai-daily-brief optional source failed", { source: entity, code, message });
    const sourceUnavailable = isMissingBlobsEnvironment(error);
    warnings.push(sourceUnavailable
      ? `${entity}: storage ej konfigurerad (${code}).`
      : `${entity}: kunde inte lasas (${code}).`);
    return { rows: [], source: { source: entity, count: 0, error: code, sourceUnavailable } };
  }
};

const functionError = (error, dryRun) => {
  const code = clean(error?.code || error?.name || "AI_DAILY_BRIEF_ERROR", 80) || "AI_DAILY_BRIEF_ERROR";
  console.error("ai-daily-brief failed", {
    code,
    dryRun,
    message: clean(error?.message || "", 240),
  });
  return json(500, { error: "Function error", code, dryRun });
};

const buildBrief = ({ body, cases, calls, drafts, parts, warnings, sources }) => {
  const active = cases.filter(isActive);
  const missedCalls = calls.filter((item) => item.direction !== "outbound" && ["missed", "unanswered", "voicemail"].includes(item.status));
  const matchedMissedCallIds = new Set(missedCalls.map((item) => item.caseId || item.case?.id).filter(Boolean).map(String));
  const riskRows = active
    .map((item) => {
      const risk = assessRisk({ caseItem: item, price: valueFor(item) });
      const reasons = [...new Set([...reasonsFor(item, matchedMissedCallIds), ...(risk.reasons || [])])];
      return { item, reasons, risk: { ...risk, reasons } };
    })
    .filter(({ item, reasons }) => reasons.some((reason) => /Risk|Statt|Saknar modell/i.test(reason)) || item.priority === "urgent");
  const priority = active
    .map((item) => ({ item, reasons: reasonsFor(item, matchedMissedCallIds) }))
    .filter(({ reasons }) => reasons.length)
    .sort((a, b) => priorityScore(b.reasons) - priorityScore(a.reasons) || String(b.item.updatedAt || b.item.createdAt).localeCompare(String(a.item.updatedAt || a.item.createdAt)))
    .slice(0, 10)
    .map(({ item, reasons }) => caseSummary(item, reasons.join(", ")));
  const unansweredSms = drafts.filter((item) => ["received", "unanswered", "requires_reply"].includes(item.status));
  const openPartNeeds = parts.filter((item) => !["received", "installed", "cancelled"].includes(item.status));
  const waitingParts = active.filter((item) => item.status === "waiting_parts" || openPartNeeds.some((part) => part.caseId === item.id));
  const waitingCustomer = active.filter((item) => item.status === "waiting_customer");
  const readyInvoice = active.filter((item) =>
    (item.status === "ready" || paymentStatus(item) === "invoice_ready" || hasPaymentAmount(item)) && !PAID_OR_INVOICED.has(paymentStatus(item)));
  const salesOpportunities = active
    .filter((item) => ["new", "contacted", "diagnosing"].includes(item.status))
    .slice(0, 10)
    .map((item) => caseSummary(item, "Salj/uppfoljning"));
  const socialSubject = readyInvoice[0] || priority[0] || active[0];
  const socialPost = socialSubject
    ? `Dagens verkstadsfokus: ${socialSubject.model || "elscooter"} far omsorg hos Nordic E-Mobility i Orebro. Boka service via nordicemobility.se.`
    : "Hall din elscooter redo for vardagen. Nordic E-Mobility i Orebro hjalper dig med service, bromsar och felsokning.";
  const brief = {
    date: body.date || new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    aiMode: env("OPENAI_API_KEY") ? "deterministic_rules" : "deterministic_dry_run",
    metrics: {
      doNow: priority.length,
      active: active.length,
      missedCalls: missedCalls.length,
      unansweredSms: unansweredSms.length,
      waitingCustomer: waitingCustomer.length,
      waitingParts: waitingParts.length,
      readyInvoice: readyInvoice.length,
      riskCases: riskRows.length,
      possibleRevenueToday: priority.reduce((sum, item) => sum + item.value, 0),
    },
    priority,
    missedCalls: missedCalls.slice(0, 10),
    unansweredSms: unansweredSms.slice(0, 10),
    waitingParts: waitingParts.slice(0, 10).map((item) => caseSummary(item, "Vantar del")),
    openPartNeeds: openPartNeeds.slice(0, 10),
    readyInvoice: readyInvoice.slice(0, 10).map((item) => caseSummary(item, "Klar att fakturera/betala")),
    riskCases: riskRows.slice(0, 10).map(({ item, risk }) => ({ ...caseSummary(item, risk.reasons.join(", ")), risk })),
    suggestedSocialPost: socialPost,
  };
  return {
    ok: true,
    summary: `${priority.length} arenden kraver atgard nu. ${waitingCustomer.length} vantar kund, ${waitingParts.length} vantar del och ${readyInvoice.length} ar klara for betalning/faktura.`,
    topPriorities: priority,
    cashToday: readyInvoice.reduce((sum, item) => sum + valueFor(item), 0),
    riskCases: brief.riskCases,
    missedCallsToFollowUp: brief.missedCalls,
    partsToOrder: openPartNeeds.slice(0, 10),
    readyForPayment: brief.readyInvoice,
    salesOpportunities,
    socialMediaSuggestion: socialPost,
    dryRun: !env("OPENAI_API_KEY"),
    writesSkipped: [],
    readsSkipped: [],
    warnings,
    sourceStatus: {
      primary: "api_cases",
      casesAvailable: cases.length > 0,
      caseCount: cases.length,
      storesChecked: sources,
      warnings,
    },
    brief,
  };
};

exports.handler = async (event) => {
  let writeDryRun = false;
  try {
    const body = parseBody(event);
    writeDryRun = isDryRunRequest(event, body);
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" });
    if (writeDryRun) return json(200, emptyBrief(body, event.httpMethod));

    const warnings = [];
    const sources = [];
    const adminCases = await readAdminCases(event, warnings);
    sources.push(adminCases.source);
    let cases = adminCases.rows;

    if (!cases.length) {
      const fallbackCases = await readOptionalList("service_cases", warnings);
      sources.push(fallbackCases.source);
      cases = fallbackCases.rows;
    } else {
      sources.push({ source: "service_cases", count: 0, skipped: true, reason: "api_cases_used" });
    }

    const [callSource, draftSource, partSource] = await Promise.all([
      readOptionalList("call_logs", warnings),
      readOptionalList("sms_drafts", warnings),
      readOptionalList("part_needs", warnings),
    ]);
    sources.push(callSource.source, draftSource.source, partSource.source);

    const response = buildBrief({
      body,
      cases,
      calls: callSource.rows,
      drafts: draftSource.rows,
      parts: partSource.rows,
      warnings,
      sources,
    });

    if (event.httpMethod === "POST") {
      try {
        const recommendation = await put("ai_recommendations", {
          kind: "daily_brief",
          status: "proposed",
          payload: { ...response.brief },
          createdBy: body.operatorName || "AI operator",
        });
        response.brief.recommendation = {
          id: recommendation.id,
          kind: recommendation.kind,
          status: recommendation.status,
          createdAt: recommendation.createdAt,
        };
      } catch (error) {
        const code = clean(error?.code || error?.name || "AI_RECOMMENDATION_WRITE_FAILED", 80);
        console.error("ai-daily-brief recommendation write failed", { code, message: clean(error?.message || "", 240) });
        response.warnings.push(`ai_recommendations: write hoppades over (${code}).`);
        response.writesSkipped.push("ai_recommendations");
      }
    }

    return json(200, response);
  } catch (error) {
    return functionError(error, writeDryRun);
  }
};
