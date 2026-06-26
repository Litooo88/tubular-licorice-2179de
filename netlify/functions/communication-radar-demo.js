const { json, requireAdmin } = require("./_shared/http");
const { demoEvents, draftForEvent, summarizeRadar } = require("./_shared/communication-radar");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return auth.response;
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" });

  const events = demoEvents();
  const drafts = events.map((item) => draftForEvent(item));
  return json(200, {
    ok: true,
    mode: "deterministic_mock",
    dryRun: true,
    writesSkipped: ["communication_events", "ai_response_drafts", "case_events"],
    externalCallsSkipped: ["gmail", "sms", "46elks"],
    summary: summarizeRadar(events),
    events,
    drafts,
  });
};
