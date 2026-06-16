const { clean, json, parseBody, requireAdmin } = require("./_shared/http");
const { appendCaseEvent, list, put } = require("./_shared/storage");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return auth.response;
  const params = event.queryStringParameters || {};

  if (event.httpMethod === "GET") {
    return json(200, { ok: true, calls: await list("call_logs", { caseId: params.caseId, status: params.status, limit: params.limit }) });
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const body = parseBody(event);
  const call = await put("call_logs", {
    caseId: clean(body.caseId, 180),
    phone: clean(body.phone, 80),
    direction: clean(body.direction || "inbound", 40),
    status: clean(body.status || "logged", 60),
    duration: Number(body.duration || 0),
    providerId: clean(body.providerId, 180),
    note: clean(body.note, 1000),
    occurredAt: body.occurredAt || new Date().toISOString(),
    createdBy: clean(body.operatorName || "admin", 120),
  }, { id: body.id });
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
};
