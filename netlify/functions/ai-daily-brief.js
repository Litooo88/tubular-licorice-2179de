const { json, parseBody, requireAdmin, env, clean, header } = require("./_shared/http");
const { list, put } = require("./_shared/storage");
const { assessRisk } = require("./_shared/operator");

const isDryRunRequest = (event, body) =>
  body.dryRun === true ||
  body.previewOnly === true ||
  event.queryStringParameters?.dryRun === "1";

const MISSING_BLOBS_RE = /MissingBlobsEnvironmentError|BlobsEnvironment|not been configured to use Netlify Blobs/i;

const isMissingBlobsEnvironment = (error) =>
  MISSING_BLOBS_RE.test(`${error?.code || ""} ${error?.name || ""} ${error?.message || ""}`);

const sourceError = (source, error) => ({
  source,
  error: clean(error?.code || error?.name || "SOURCE_UNAVAILABLE", 100),
  message: clean(error?.message || "Kallan kunde inte lasas.", 240),
  sourceUnavailable: isMissingBlobsEnvironment(error),
});

const originFor = (event) => {
  const host = header(event, "host");
  if (!host) return "";
  const forwardedProto = header(event, "x-forwarded-proto");
  const protocol = forwardedProto || (host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
};

const readCasesFromApi = async (event) => {
  const origin = originFor(event);
  if (!origin) throw Object.assign(new Error("Intern /api/cases URL saknas."), { code: "MISSING_ORIGIN" });
  const response = await fetch(`${origin}/api/cases`, {
    headers: { "x-admin-token": header(event, "x-admin-token") },
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data?.error || response.statusText || `HTTP ${response.status}`), {
      code: data?.code || `HTTP_${response.status}`,
    });
  }
  return Array.isArray(data.cases) ? data.cases : [];
};

const readListSource = async (entity, options = {}) => {
  const source = options.source || entity;
  try {
    const rows = await list(entity);
    return { source, rows, available: true, count: rows.length };
  } catch (error) {
    const failure = sourceError(source, error);
    console.error("ai-daily-brief source unavailable", failure);
    return { ...failure, rows: [], available: false, count: 0 };
  }
};

const readCases = async (event) => {
  const sources = [];
  try {
    const rows = await readCasesFromApi(event);
    sources.push({ source: "api_cases", path: "/api/cases", available: true, count: rows.length });
    return { rows, sources, warnings: [] };
  } catch (error) {
    const failure = sourceError("api_cases", error);
    sources.push({ ...failure, path: "/api/cases", available: false, count: 0 });
  }

  const storageSource = await readListSource("service_cases");
  sources.push(storageSource);
  return {
    rows: storageSource.rows,
    sources,
    warnings: [
      storageSource.available
        ? "AI-brief kunde inte lasa /api/cases och anvande service_cases fallback."
        : "AI-brief kunde inte lasa /api/cases eller service_cases.",
    ],
  };
};

const emptyDryRunBrief = (body = {}, method = "GET") => {
  const today = new Date().toISOString().slice(0, 10);
  const brief = {
    date: body.date || today,
    generatedAt: new Date().toISOString(),
    aiMode: "deterministic_write_dry_run",
    metrics: {
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
    summary: "0 aktiva arenden, 0 riskarenden och 0 klara for betalning.",
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
    readsSkipped: ["service_cases", "call_logs", "sms_drafts", "part_needs", "ai_recommendations"],
    brief,
  };
};

const functionError = (error, dryRun) => {
  const code = clean(error?.code || error?.name || "AI_DAILY_BRIEF_ERROR", 80) || "AI_DAILY_BRIEF_ERROR";
  console.error("ai-daily-brief failed", {
    code,
    dryRun,
    message: clean(error?.message || "", 240),
  });
  return json(500, {
    error: "AI daily brief failed",
    code,
    message: clean(error?.message || "AI-brief kunde inte hamtas.", 240),
    dryRun,
  });
};

const isActive = (item) => !["done", "archived", "closed"].includes(item.status);
const valueFor = (item) => Number(item.completion?.totalCost || item.total_cost || item.quote?.amount || item.estimatedValue || 0);
const customerName = (item) => item.customer?.name || "Okand kund";
const caseSummary = (item) => ({
  id: item.id,
  customer: customerName(item),
  model: item.vehicle?.model || "Modell saknas",
  status: item.status || "okand",
  value: valueFor(item),
});

exports.handler = async (event) => {
  let writeDryRun = false;
  try {
    const body = parseBody(event);
    writeDryRun = isDryRunRequest(event, body);
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" });
    if (writeDryRun) return json(200, emptyDryRunBrief(body, event.httpMethod));

    const caseRead = await readCases(event);
    const optionalReads = writeDryRun
      ? [
          { source: "call_logs", rows: [], available: true, count: 0, skipped: true },
          { source: "sms_drafts", rows: [], available: true, count: 0, skipped: true },
          { source: "part_needs", rows: [], available: true, count: 0, skipped: true },
        ]
      : await Promise.all([
          readListSource("call_logs"),
          readListSource("sms_drafts"),
          readListSource("part_needs"),
        ]);
    const [callRead, draftRead, partRead] = optionalReads;
    const cases = Array.isArray(caseRead.rows) ? caseRead.rows : [];
    const calls = Array.isArray(callRead.rows) ? callRead.rows : [];
    const drafts = Array.isArray(draftRead.rows) ? draftRead.rows : [];
    const parts = Array.isArray(partRead.rows) ? partRead.rows : [];
    const sourceWarnings = [
      ...(caseRead.warnings || []),
      ...optionalReads
        .filter((source) => !source.available)
        .map((source) => `${source.source}: ${source.error}${source.sourceUnavailable ? " (storage unavailable)" : ""}`),
    ];
    const active = cases.filter(isActive);
    const riskRows = active
      .map((item) => ({ item, risk: assessRisk({ caseItem: item, price: valueFor(item) }) }))
      .filter(({ item, risk }) => risk.reasons.length > 0 || item.priority === "urgent");
    const priority = [...active]
      .sort((a, b) => {
        const score = (item) =>
          (item.priority === "urgent" ? 100 : 0) +
          (item.status === "ready" ? 80 : 0) +
          (item.status === "waiting_customer" ? 60 : 0) +
          (item.status === "new" ? 50 : 0) +
          (Date.now() - new Date(item.updatedAt || item.createdAt || 0).getTime() > 48 * 60 * 60 * 1000 ? 20 : 0);
        return score(b) - score(a);
      })
      .slice(0, 8)
      .map(caseSummary);
    const missedCalls = calls.filter((item) => item.direction !== "outbound" && ["missed", "unanswered", "voicemail"].includes(item.status));
    const unansweredSms = drafts.filter((item) => ["received", "unanswered", "requires_reply"].includes(item.status));
    const openPartNeeds = parts.filter((item) => !["received", "installed", "cancelled"].includes(item.status));
    const waitingParts = active.filter((item) => item.status === "waiting_parts" || openPartNeeds.some((part) => part.caseId === item.id));
    const readyInvoice = active.filter((item) => item.status === "ready" || item.payment?.status === "invoice_ready");
    const salesOpportunities = active
      .filter((item) => ["new", "contacted", "diagnosing"].includes(item.status))
      .slice(0, 10)
      .map(caseSummary);
    const completedToday = cases.filter((item) => String(item.updatedAt || "").slice(0, 10) === new Date().toISOString().slice(0, 10) && ["ready", "done"].includes(item.status));
    const socialSubject = completedToday[0] || readyInvoice[0] || active[0];
    const socialPost = socialSubject
      ? `Dagens verkstadsogonblick: ${socialSubject.vehicle?.model || "en elscooter"} har fatt omsorg hos Nordic E-Mobility i Orebro. Boka service via nordicemobility.se.`
      : "Hall din elscooter redo for vardagen. Nordic E-Mobility i Orebro hjalper dig med service, bromsar och felsokning.";

    const brief = {
      date: body.date || new Date().toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
      aiMode: env("OPENAI_API_KEY") ? "deterministic_rules" : "deterministic_dry_run",
      metrics: {
        active: active.length,
        missedCalls: missedCalls.length,
        unansweredSms: unansweredSms.length,
        waitingCustomer: active.filter((item) => item.status === "waiting_customer").length,
        waitingParts: waitingParts.length,
        readyInvoice: readyInvoice.length,
        riskCases: riskRows.length,
        possibleRevenueToday: priority.reduce((sum, item) => sum + item.value, 0),
      },
      priority,
      missedCalls: missedCalls.slice(0, 10),
      unansweredSms: unansweredSms.slice(0, 10),
      waitingParts: waitingParts.slice(0, 10).map(caseSummary),
      openPartNeeds: openPartNeeds.slice(0, 10),
      readyInvoice: readyInvoice.slice(0, 10).map(caseSummary),
      riskCases: riskRows.slice(0, 10).map(({ item, risk }) => ({ ...caseSummary(item), risk })),
      suggestedSocialPost: socialPost,
    };
    const writeWarnings = [];
    if (event.httpMethod === "POST" && !writeDryRun) {
      try {
        const recommendation = await put("ai_recommendations", {
          kind: "daily_brief",
          status: "proposed",
          payload: { ...brief },
          createdBy: body.operatorName || "AI operator",
        });
        brief.recommendation = {
          id: recommendation.id,
          kind: recommendation.kind,
          status: recommendation.status,
          createdAt: recommendation.createdAt,
        };
      } catch (error) {
        const failure = sourceError("ai_recommendations", error);
        writeWarnings.push(`ai_recommendations: ${failure.error}`);
        brief.recommendationWrite = { skipped: true, ...failure };
      }
    }
    const sources = [...caseRead.sources, ...optionalReads].map((source) => ({
      source: source.source,
      path: source.path,
      available: source.available !== false,
      count: source.count || 0,
      error: source.error,
      sourceUnavailable: Boolean(source.sourceUnavailable),
      skipped: Boolean(source.skipped),
    }));
    const storageUnavailable = sources.filter((source) => source.sourceUnavailable);
    return json(200, {
      summary: `${active.length} aktiva ärenden, ${riskRows.length} riskärenden och ${readyInvoice.length} klara för betalning.`,
      topPriorities: priority,
      cashToday: readyInvoice.reduce((sum, item) => sum + valueFor(item), 0),
      riskCases: brief.riskCases,
      missedCallsToFollowUp: brief.missedCalls,
      partsToOrder: openPartNeeds.slice(0, 10),
      readyForPayment: brief.readyInvoice,
      salesOpportunities,
      socialMediaSuggestion: socialPost,
      dryRun: writeDryRun || !env("OPENAI_API_KEY"),
      writesSkipped: writeDryRun && event.httpMethod === "POST" ? ["ai_recommendations"] : [],
      readsSkipped: writeDryRun ? ["service_cases", "call_logs", "sms_drafts", "part_needs"] : [],
      dataSource: caseRead.sources?.find((source) => source.available !== false)?.source || "unavailable",
      sources,
      warnings: [...sourceWarnings, ...writeWarnings],
      storageHealth: {
        ok: storageUnavailable.length === 0,
        unavailableSources: storageUnavailable.map((source) => ({
          source: source.source,
          error: source.error,
        })),
      },
      brief,
    });
  } catch (error) {
    return functionError(error, writeDryRun);
  }
};
