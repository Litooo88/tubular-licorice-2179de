const { json, parseBody, requireAdmin, clean } = require("./_shared/http");
const { connectBlobs, appendCaseEvent, get, list, put } = require("./_shared/storage");
const { assessRisk, deterministicQuote, tryOpenAiJson } = require("./_shared/operator");

const isDryRunRequest = (event, body) =>
  body.dryRun === true ||
  body.previewOnly === true ||
  event.queryStringParameters?.dryRun === "1";

const functionError = (error, dryRun) => {
  const code = clean(error?.code || error?.name || "AI_QUOTE_ERROR", 80) || "AI_QUOTE_ERROR";
  console.error("ai-quote failed", {
    code,
    dryRun,
    message: clean(error?.message || "", 240),
  });
  return json(500, { error: "Function error", code, dryRun });
};

exports.handler = async (event) => {
  connectBlobs(event);
  let writeDryRun = false;
  try {
    const body = parseBody(event);
    writeDryRun = isDryRunRequest(event, body);
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const caseItem = !writeDryRun && body.caseId ? await get("service_cases", body.caseId) : null;
    if (!writeDryRun && body.caseId && !caseItem) return json(404, { error: "Arendet hittades inte." });

    const priceRules = writeDryRun ? [] : await list("price_rules");
    const fallback = deterministicQuote({ ...body, caseItem }, priceRules);
    const generated = writeDryRun
      ? { value: fallback, mode: "deterministic_write_dry_run" }
      : await tryOpenAiJson({
          system: "Svara endast med JSON med falten label, from, min, max, summary och diagnosticRequired. Hall dig inom givna svenska prisregler och fatta inget kundbeslut.",
          input: { diagnosis: body.diagnosis, service: body.service, model: body.model, partCost: body.partCost, fallback },
          fallback,
        });
    // Merge the OpenAI result conservatively on top of the deterministic rule:
    // text fields freely, numbers only if finite and NOT below the rule's floor
    // (the AI must never undercut the price rules). Risk is re-assessed on the
    // merged values below. Without this merge the OpenAI call was dead spend.
    const aiValue = generated.mode === "openai" && generated.value && typeof generated.value === "object" ? generated.value : {};
    const mergedNumber = (candidate, fallbackNumber, floor) => {
      const value = Number(candidate);
      if (!Number.isFinite(value) || value <= 0) return fallbackNumber;
      return value < floor ? fallbackNumber : Math.round(value);
    };
    const proposed = {
      ...fallback,
      label: clean(aiValue.label, 160) || fallback.label,
      from: mergedNumber(aiValue.from, fallback.from, fallback.from),
      min: mergedNumber(aiValue.min, fallback.min, fallback.from),
      max: fallback.max ? mergedNumber(aiValue.max, fallback.max, fallback.from) : fallback.max,
      summary: clean(aiValue.summary, 600) || fallback.summary,
      diagnosticRequired: typeof aiValue.diagnosticRequired === "boolean" ? aiValue.diagnosticRequired : fallback.diagnosticRequired,
    };
    if (proposed.max && proposed.min > proposed.max) { proposed.min = fallback.min; proposed.max = fallback.max; }
    proposed.risk = assessRisk({ ...body, ...proposed, price: proposed.max, caseItem });
    proposed.approvalRequired = proposed.approvalRequired || proposed.risk.approvalRequired;

    let recommendation = null;
    if (!writeDryRun) {
      recommendation = await put("ai_recommendations", {
        caseId: body.caseId || "",
        kind: "quote",
        status: "proposed",
        risk: proposed.risk,
        payload: proposed,
        aiMode: generated.mode,
        createdBy: clean(body.operatorName || "AI operator", 120),
      });
    }
    if (body.caseId && recommendation) {
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
      dryRun: writeDryRun || generated.mode !== "openai",
      writesSkipped: writeDryRun ? ["ai_recommendations", ...(body.caseId ? ["case_events"] : [])] : [],
      readsSkipped: writeDryRun ? ["price_rules", ...(body.caseId ? ["service_cases"] : [])] : [],
      reference: { recommendationId: recommendation?.id || null },
    });
  } catch (error) {
    return functionError(error, writeDryRun);
  }
};
