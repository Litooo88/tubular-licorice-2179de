const { json, parseBody, requireAdmin, clean } = require("./_shared/http");
const { appendCaseEvent, get, list, put } = require("./_shared/storage");
const { assessRisk, deterministicQuote, tryOpenAiJson } = require("./_shared/operator");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return auth.response;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const body = parseBody(event);
  const caseItem = body.caseId ? await get("service_cases", body.caseId) : null;
  if (body.caseId && !caseItem) return json(404, { error: "Arendet hittades inte." });

  const priceRules = await list("price_rules");
  const fallback = deterministicQuote({ ...body, caseItem }, priceRules);
  const generated = await tryOpenAiJson({
    system: "Svara endast med JSON med falten label, from, min, max, summary och diagnosticRequired. Hall dig inom givna svenska prisregler och fatta inget kundbeslut.",
    input: { diagnosis: body.diagnosis, service: body.service, model: body.model, partCost: body.partCost, fallback },
    fallback,
  });
  const proposed = {
    ...fallback,
    from: fallback.from,
    min: fallback.min,
    max: fallback.max,
    summary: fallback.summary,
  };
  proposed.risk = assessRisk({ ...body, ...proposed, price: proposed.max, caseItem });
  proposed.approvalRequired = proposed.approvalRequired || proposed.risk.approvalRequired;

  const recommendation = await put("ai_recommendations", {
    caseId: body.caseId || "",
    kind: "quote",
    status: "proposed",
    risk: proposed.risk,
    payload: proposed,
    aiMode: generated.mode,
    createdBy: clean(body.operatorName || "AI operator", 120),
  });
  if (body.caseId) {
    const range = proposed.max ? `${proposed.min}-${proposed.max} kr` : `fran ${proposed.from} kr`;
    await appendCaseEvent({
      caseId: body.caseId,
      type: "quote",
      actor: body.operatorName || "AI operator",
      data: { summary: `${proposed.label}: ${range}`, recommendationId: recommendation.id, approvalRequired: proposed.approvalRequired },
    });
  }
  return json(201, {
    startPrice: proposed.from,
    likelyMin: proposed.min,
    likelyMax: proposed.max,
    requiresDiagnosis: proposed.diagnosticRequired,
    requiresApproval: proposed.approvalRequired,
    customerMessage: proposed.summary,
    internalNotes: `${proposed.label}. Risknivå: ${proposed.risk.level}. ${proposed.approvalRequired ? "Kräver godkännande." : "Kan granskas som låg risk."}`,
    quote: proposed,
    riskLevel: proposed.risk.level,
    finalPrice: null,
    finalPriceNotice: "Slutpris bekräftas alltid innan arbete påbörjas.",
    sources: priceRules.length ? ["price_rules", "business_rules"] : ["business_rules"],
    dryRun: generated.mode !== "openai",
    reference: { recommendationId: recommendation.id },
  });
};
