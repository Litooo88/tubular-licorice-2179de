const { clean, json, parseBody, requireAdmin } = require("./_shared/http");
const { connectBlobs, appendCaseEvent, get, put } = require("./_shared/storage");
const {
  caseEventPreviewFor,
  draftForEvent,
  normalizeEvent,
} = require("./_shared/communication-radar");

const isDryRunRequest = (event, body = {}) =>
  body.dryRun === true ||
  body.previewOnly === true ||
  event.queryStringParameters?.dryRun === "1";

const approvedForWrite = (body = {}) =>
  body.approved === true ||
  body.approval === true ||
  String(body.approvalStatus || "").toLowerCase() === "approved";

const eventFromBody = async (body = {}, dryRun = false) => {
  if (body.event && typeof body.event === "object") return normalizeEvent(body.event);
  if (body.communicationEvent && typeof body.communicationEvent === "object") return normalizeEvent(body.communicationEvent);
  if (body.eventId && !dryRun) {
    const stored = await get("communication_events", body.eventId);
    if (stored) return normalizeEvent(stored);
  }
  return normalizeEvent(body);
};

exports.handler = async (event) => {
  connectBlobs(event);
  let dryRun = false;
  try {
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = parseBody(event);
    dryRun = isDryRunRequest(event, body);
    const communicationEvent = await eventFromBody(body, dryRun);
    const draft = {
      ...draftForEvent(communicationEvent),
      createdBy: clean(body.createdBy || body.operatorName || "AI communication radar", 120),
    };
    const timelinePreview = communicationEvent.caseId ? caseEventPreviewFor(communicationEvent, draft) : null;

    if (dryRun) {
      return json(200, {
        ok: true,
        dryRun: true,
        draft,
        communicationEvent,
        timelinePreview,
        writesSkipped: ["ai_response_drafts", "communication_events", "case_events"],
        sendsMessage: false,
      });
    }

    if (!approvedForWrite(body)) {
      return json(428, {
        error: "approval required before persisting AI response draft",
        dryRun: false,
        draft,
        communicationEvent,
        timelinePreview,
        sendsMessage: false,
      });
    }

    const savedDraft = await put("ai_response_drafts", draft);
    const savedEvent = await put("communication_events", {
      ...communicationEvent,
      draftId: savedDraft.id,
      status: "drafted",
    });
    let caseEvent = null;
    if (body.linkToTimeline === true && savedEvent.caseId) {
      caseEvent = await appendCaseEvent(caseEventPreviewFor(savedEvent, savedDraft));
    }
    return json(201, {
      ok: true,
      dryRun: false,
      draft: savedDraft,
      communicationEvent: savedEvent,
      caseEvent,
      sendsMessage: false,
    });
  } catch (error) {
    console.error("ai-communication-draft failed", {
      code: clean(error?.code || error?.name || "AI_COMMUNICATION_DRAFT_ERROR", 80),
      dryRun,
      message: clean(error?.message || "", 240),
    });
    return json(500, {
      error: "Function error",
      code: clean(error?.code || error?.name || "AI_COMMUNICATION_DRAFT_ERROR", 80),
      dryRun,
    });
  }
};
