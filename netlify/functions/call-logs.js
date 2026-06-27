const { clean, json, parseBody, requireAdmin } = require("./_shared/http");
const { appendCaseEvent, list, put } = require("./_shared/storage");

const isReadOnlyRequest = (event, body = {}) =>
  body.dryRun === true ||
  body.readOnly === true ||
  body.previewOnly === true ||
  event.queryStringParameters?.dryRun === "1" ||
  event.queryStringParameters?.readOnly === "1" ||
  event.queryStringParameters?.previewOnly === "1";

const storageWarning = (error, source = "call_logs") => ({
  source,
  code: clean(error?.code || error?.name || "STORAGE_UNAVAILABLE", 80),
  message: clean(error?.message || "Storage kunde inte lasas.", 240),
});

exports.handler = async (event) => {
  let readOnly = false;
  try {
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    const params = event.queryStringParameters || {};

    if (event.httpMethod === "GET") {
      try {
        const calls = await list("call_logs", { caseId: params.caseId, status: params.status, limit: params.limit });
        return json(200, {
          ok: true,
          calls,
          storageAvailable: true,
          sourceUnavailable: false,
          sourceLabel: "46elks/call-log",
          warnings: [],
        });
      } catch (error) {
        console.error("call-logs read failed", storageWarning(error));
        return json(200, {
          ok: true,
          calls: [],
          storageAvailable: false,
          sourceUnavailable: true,
          sourceLabel: "Samtalsimport ej kopplad",
          warnings: [storageWarning(error)],
        });
      }
    }
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = parseBody(event);
    readOnly = isReadOnlyRequest(event, body);
    const callPayload = {
      caseId: clean(body.caseId, 180),
      phone: clean(body.phone, 80),
      direction: clean(body.direction || "inbound", 40),
      status: clean(body.status || "logged", 60),
      duration: Number(body.duration || 0),
      providerId: clean(body.providerId, 180),
      note: clean(body.note, 1000),
      occurredAt: body.occurredAt || new Date().toISOString(),
      createdBy: clean(body.operatorName || "admin", 120),
    };
    if (readOnly) {
      return json(200, {
        ok: true,
        dryRun: true,
        readOnly: true,
        call: { ...callPayload, id: clean(body.id || "dry_run_call_log", 180) },
        writesSkipped: ["call_logs", "case_events"],
      });
    }
    const call = await put("call_logs", callPayload, { id: body.id });
    if (call.caseId) {
      await appendCaseEvent({
        caseId: call.caseId,
        type: "call",
        actor: call.createdBy,
        data: { summary: `${call.direction} samtal: ${call.status}${call.note ? ` - ${call.note}` : ""}`, callId: call.id },
        at: call.occurredAt,
      });
    }
    return json(201, { ok: true, call });
  } catch (error) {
    console.error("call-logs failed", {
      code: clean(error?.code || error?.name || "CALL_LOGS_ERROR", 80),
      readOnly,
      message: clean(error?.message || "", 240),
    });
    return json(500, {
      error: "Function error",
      code: clean(error?.code || error?.name || "CALL_LOGS_ERROR", 80),
      readOnly,
    });
  }
};
