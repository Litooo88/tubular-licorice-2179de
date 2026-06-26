const { clean, json, parseBody, requireAdmin } = require("./_shared/http");
const { appendCaseEvent, list, put } = require("./_shared/storage");
const {
  caseEventPreviewFor,
  demoEvents,
  normalizeEvent,
  summarizeRadar,
} = require("./_shared/communication-radar");

const isDryRunRequest = (event, body = {}) =>
  body.dryRun === true ||
  body.previewOnly === true ||
  event.queryStringParameters?.dryRun === "1";

const approvedForWrite = (body = {}) =>
  body.approved === true ||
  body.approval === true ||
  String(body.approvalStatus || "").toLowerCase() === "approved";

exports.handler = async (event) => {
  try {
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    const params = event.queryStringParameters || {};

    if (event.httpMethod === "GET") {
      if (params.dryRun === "1" || params.demo === "1") {
        const events = demoEvents();
        return json(200, {
          ok: true,
          dryRun: true,
          mode: "deterministic_mock",
          events,
          summary: summarizeRadar(events),
          writesSkipped: ["communication_events"],
        });
      }
      const events = await list("communication_events", {
        caseId: params.caseId,
        status: params.status,
        limit: params.limit,
      });
      return json(200, { ok: true, dryRun: false, events, summary: summarizeRadar(events) });
    }

    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = parseBody(event);
    const dryRun = isDryRunRequest(event, body);
    const communicationEvent = normalizeEvent(body.event || body);
    const timelinePreview = communicationEvent.caseId ? caseEventPreviewFor(communicationEvent) : null;

    if (dryRun) {
      return json(200, {
        ok: true,
        dryRun: true,
        event: communicationEvent,
        timelinePreview,
        writesSkipped: ["communication_events", "case_events"],
      });
    }

    if (!approvedForWrite(body)) {
      return json(428, {
        error: "approval required before persisting communication event",
        dryRun: false,
        event: communicationEvent,
        timelinePreview,
      });
    }

    const saved = await put("communication_events", {
      ...communicationEvent,
      createdBy: clean(body.createdBy || body.operatorName || "admin", 120),
    });
    let caseEvent = null;
    if (body.linkToTimeline === true && saved.caseId) {
      caseEvent = await appendCaseEvent(caseEventPreviewFor(saved));
    }
    return json(201, {
      ok: true,
      dryRun: false,
      event: saved,
      caseEvent,
      sendsMessage: false,
    });
  } catch (error) {
    console.error("communication-events failed", {
      code: clean(error?.code || error?.name || "COMMUNICATION_EVENTS_ERROR", 80),
      message: clean(error?.message || "", 240),
    });
    return json(500, { error: "Function error", code: clean(error?.code || error?.name || "COMMUNICATION_EVENTS_ERROR", 80) });
  }
};
