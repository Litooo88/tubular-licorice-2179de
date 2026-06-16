const { clean, json, parseBody, requireAdmin } = require("./_shared/http");
const { appendCaseEvent, get, list, put } = require("./_shared/storage");

const STATUSES = new Set(["draft", "approved", "rejected", "sent", "dry_run"]);
const STATUS_ACTIONS = Object.freeze({
  approve: "approved",
  reject: "rejected",
  sent: "sent",
  dry_run: "dry_run",
});

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return auth.response;
  const params = event.queryStringParameters || {};

  if (event.httpMethod === "GET") {
    return json(200, { ok: true, drafts: await list("sms_drafts", { caseId: params.caseId, status: params.status, limit: params.limit }) });
  }
  if (!["POST", "PATCH"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" });

  const body = parseBody(event);
  if (event.httpMethod === "POST") {
    const caseItem = body.caseId ? await get("service_cases", body.caseId) : null;
    if (body.caseId && !caseItem) return json(404, { error: "Arendet hittades inte." });
    const message = clean(body.message || body.smsDraft, 918);
    if (!message) return json(400, { error: "message kravs." });
    const draft = await put("sms_drafts", {
      caseId: clean(body.caseId, 180),
      customerId: clean(body.customerId || caseItem?.customerId || caseItem?.customer?.id, 180),
      eventType: clean(body.eventType || body.intent || "custom", 80),
      intent: clean(body.intent || body.eventType || "custom", 80),
      to: clean(body.to || caseItem?.customer?.phone, 80),
      message,
      riskLevel: clean(body.riskLevel || body.risk?.level || "low", 30),
      requiresApproval: body.requiresApproval === true || body.risk?.approvalRequired === true,
      status: "draft",
      createdBy: clean(body.createdBy || body.operatorName || "admin", 120),
    });
    if (draft.caseId) {
      await appendCaseEvent({
        caseId: draft.caseId,
        customerId: draft.customerId,
        type: "sms",
        direction: "internal",
        content: "SMS-utkast sparat.",
        metadata: { draftId: draft.id, status: draft.status },
        createdBy: draft.createdBy,
      });
    }
    return json(201, { ok: true, draft, sent: false, dryRun: false });
  }

  const existing = body.id ? await get("sms_drafts", body.id) : null;
  if (!existing) return json(404, { error: "SMS-utkastet hittades inte." });
  const status = STATUS_ACTIONS[body.action] || body.status;
  if (!STATUSES.has(status)) return json(400, { error: "Giltig draft-status kravs." });
  const requiresApproval = existing.requiresApproval === true || existing.risk?.approvalRequired === true;
  if (status === "sent" && requiresApproval && existing.status !== "approved") {
    return json(409, { error: "Utkastet kravs godkannande innan det kan markeras som skickat." });
  }
  const changedAt = new Date().toISOString();
  const draft = await put("sms_drafts", {
    ...existing,
    status,
    reviewedBy: clean(body.createdBy || body.operatorName || "admin", 120),
    reviewedAt: changedAt,
    delivery: status === "sent" || status === "dry_run" ? { status, sent: false, markedAt: changedAt } : existing.delivery || null,
  }, { id: existing.id });
  if (draft.caseId && status !== existing.status) {
    await appendCaseEvent({
      caseId: draft.caseId,
      customerId: draft.customerId,
      type: "sms",
      direction: "internal",
      content: `SMS-utkast markerat som ${status}.`,
      metadata: { draftId: draft.id, previousStatus: existing.status, status },
      createdBy: draft.reviewedBy,
    });
  }
  return json(200, { ok: true, draft, sent: false, dryRun: status === "dry_run" });
};
