const { clean, json, parseBody, requireAdmin } = require("./_shared/http");
const { appendCaseEvent, get, list } = require("./_shared/storage");

const TYPES = new Set(["sms", "call", "status_change", "quote", "payment", "part", "note", "ai_suggestion", "booking"]);
const DIRECTIONS = new Set(["inbound", "outbound", "internal"]);
const sourceWarning = (error) => ({
  sourceUnavailable: true,
  storageAvailable: false,
  warnings: [{
    source: "case_events",
    errorType: error?.name || "StorageUnavailable",
    errorMessage: clean(error?.message || "Timeline storage unavailable.", 240),
  }],
});

exports.handler = async (event) => {
  try {
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    const params = event.queryStringParameters || {};

    if (event.httpMethod === "GET") {
      if (!params.caseId) return json(400, { error: "caseId kravs." });
      try {
        const events = await list("case_events", { caseId: params.caseId, limit: params.limit });
        return json(200, { ok: true, events, sourceUnavailable: false, storageAvailable: true, warnings: [] });
      } catch (error) {
        return json(200, { ok: true, events: [], ...sourceWarning(error) });
      }
    }
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = parseBody(event);
    const type = body.action === "note" ? "note" : body.type;
    const direction = body.action === "note" ? "internal" : body.direction || "internal";
    if (!body.caseId || !TYPES.has(type)) return json(400, { error: "caseId och giltig type kravs." });
    if (!DIRECTIONS.has(direction)) return json(400, { error: "Giltig direction kravs." });
    const caseItem = await get("service_cases", body.caseId);
    if (!caseItem) return json(404, { error: "Arendet hittades inte." });
    const content = clean(body.content || body.summary || body.message, 2000);
    if (!content) return json(400, { error: "content kravs." });
    const caseEvent = await appendCaseEvent({
      caseId: body.caseId,
      customerId: body.customerId || caseItem.customerId || caseItem.customer?.id || "",
      type,
      direction,
      content,
      metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {},
      createdBy: clean(body.createdBy || body.operatorName || body.actor || "admin", 120),
      createdAt: body.createdAt || body.at,
    });
    return json(201, { ok: true, event: caseEvent });
  } catch (error) {
    console.error("case-events failed", {
      name: error?.name,
      message: error?.message,
      method: event?.httpMethod,
    });
    return json(500, {
      error: "Timeline storage unavailable",
      code: error?.name || "CASE_EVENTS_ERROR",
      ...sourceWarning(error),
    });
  }
};
