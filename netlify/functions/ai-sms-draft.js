const { json, parseBody, requireAdmin, clean } = require("./_shared/http");
const { appendCaseEvent, get, put } = require("./_shared/storage");
const { assessRisk, deterministicSmsDraft, intentFromInput, tryOpenAiJson, withSmsSignature } = require("./_shared/operator");

const isDryRunRequest = (event, body) => {
  const query = event?.queryStringParameters || {};
  return body.dryRun === true
    || body.previewOnly === true
    || query.dryRun === "1"
    || query.previewOnly === "1";
};

exports.handler = async (event) => {
  let dryRun = false;
  try {
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = parseBody(event);
    dryRun = isDryRunRequest(event, body);
    const intent = intentFromInput(body);
    const providedCaseItem = body.case || body.caseItem || null;
    const caseItem = dryRun
      ? providedCaseItem
      : body.caseId
        ? await get("service_cases", body.caseId)
        : null;
    if (!dryRun && body.caseId && !caseItem) return json(404, { error: "Arendet hittades inte." });

  const fallbackMessage = deterministicSmsDraft({ ...body, intent, caseItem });
  const aiCaseContext = caseItem
    ? {
        service: caseItem.service || "",
        problemDescription: caseItem.message || "",
        vehicleModel: caseItem.vehicle?.model || "",
        status: caseItem.status || "",
      }
    : null;
  const generated = dryRun
    ? { value: { message: fallbackMessage }, mode: "deterministic_dry_run" }
    : await tryOpenAiJson({
        system: "Svara endast med JSON: {\"message\":\"...\"}. Skriv ett kort svenskt SMS-utkast for Nordic E-Mobility. Lova inget och fatta inga beslut.",
        input: { intent, eventType: body.eventType, context: body.context, caseContext: aiCaseContext },
        fallback: { message: fallbackMessage },
      });
  const message = withSmsSignature(generated.value?.message || fallbackMessage);
  const risk = assessRisk({
    ...body,
    intent,
    message,
    caseItem,
    price: body.suggestedPriceRange?.max ?? body.price ?? caseItem?.quote?.amount,
  });
    const customerId = clean(body.customerId || body.customer?.id || caseItem?.customerId || caseItem?.customer?.id, 180);
    let draft = null;
    let recommendation = null;
    const writesSkipped = dryRun
      ? ["sms_drafts", "ai_recommendations", ...(body.caseId ? ["case_events"] : [])]
      : [];
    if (!dryRun) {
      draft = await put("sms_drafts", {
        caseId: body.caseId || "",
        customerId,
        eventType: clean(body.eventType || intent, 80),
        intent,
        to: clean(body.to || caseItem?.customer?.phone, 80),
        message,
        status: "draft",
        riskLevel: risk.level,
        requiresApproval: risk.approvalRequired,
        risk,
        aiMode: generated.mode,
        providerError: generated.providerError || "",
        createdBy: clean(body.operatorName || "AI operator", 120),
      });
      recommendation = await put("ai_recommendations", {
        caseId: body.caseId || "",
        kind: "sms_draft",
        status: "proposed",
        risk,
        payload: { draftId: draft.id, message, intent },
        aiMode: generated.mode,
      });
    }
    if (!dryRun && body.caseId) {
      await appendCaseEvent({
        caseId: body.caseId,
      customerId,
      type: "ai_suggestion",
      direction: "internal",
      content: `AI skapade SMS-utkast (${risk.level} risk).`,
      metadata: {
        draftId: draft.id,
        riskLevel: risk.level,
        requiresApproval: risk.approvalRequired,
        eventType: body.eventType || intent,
        recommendationId: recommendation.id,
      },
      createdBy: body.operatorName || "AI operator",
    });
  }
  const existingAmount = Number(caseItem?.quote?.amount || 0);
  const inputRange = body.suggestedPriceRange;
  const suggestedPriceRange = inputRange && typeof inputRange === "object"
    ? {
        from: Number(inputRange.from || inputRange.min || 0),
        min: Number(inputRange.min || inputRange.from || 0),
        max: inputRange.max === null ? null : Number(inputRange.max || inputRange.min || inputRange.from || 0),
        currency: "SEK",
      }
    : existingAmount > 0
      ? { from: existingAmount, min: existingAmount, max: existingAmount, currency: "SEK" }
      : null;
  const lowRiskNextStatuses = {
    booking_confirmation: "BOKAD",
    missed_call_reply: "NY FÖRFRÅGAN",
    model_or_fault_question: "VÄNTAR FELSÖKNING",
    simple_status: null,
    review_link: "AVSLUTAD",
  };
  const suggestedNextStatus = risk.approvalRequired
    ? "INVÄNTAR GODKÄNNANDE"
    : lowRiskNextStatuses[intent] ?? null;
  const internalSummary = clean(
    `SMS-utkast skapat för ${caseItem?.service || intent || "ärendet"}. Risk: ${risk.level}. ${risk.reasons.length ? `Godkännande krävs: ${risk.reasons.join(", ")}.` : "Lågriskutkast."}`,
    800
  );
  return json(dryRun ? 200 : 201, {
    smsDraft: message,
    riskLevel: risk.level,
    requiresApproval: risk.approvalRequired,
    suggestedNextStatus,
    suggestedPriceRange,
    internalSummary,
    dryRun: dryRun || generated.mode !== "openai",
    writesSkipped,
    references: {
      draftId: draft?.id || null,
      recommendationId: recommendation?.id || null,
    },
  });
  } catch (error) {
    console.error("ai-sms-draft failed", {
      name: error?.name,
      message: error?.message,
      dryRun,
    });
    return json(500, {
      error: "Function error",
      code: error?.name || "AI_SMS_DRAFT_ERROR",
      dryRun,
    });
  }
};
