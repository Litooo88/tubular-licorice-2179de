import { validateRequest } from "./auth";
import { dial, holdThenDial, introIvr, outsideHoursVoicemail, recordVoicemail, voicemailPrompt, callId, caller, ivrChoice } from "./flow";
import { logCall, purgeOldLogs } from "./log";
import { notifyCaller, notifySebastian } from "./notify";
import { isOfficeHours, stockholmTime, stockholmParts } from "./officeHours";
import { sendDailyReport } from "./report";
import type { ElksPayload, Env, Operator } from "./types";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function parsePayload(req: Request): Promise<{ body: string; payload: ElksPayload }> {
  const body = await req.text();
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return { body, payload: JSON.parse(body || "{}") };
  const params = new URLSearchParams(body);
  return { body, payload: Object.fromEntries(params.entries()) as ElksPayload };
}

async function guarded(req: Request, env: Env, path: URL, handler: (payload: ElksPayload, body: string) => Promise<Response>): Promise<Response> {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const { body, payload } = await parsePayload(req);
  if (!(await validateRequest(req, env, body))) {
    await logCall(env, {
      callid: payload.callid || payload.id || "rejected",
      caller_e164: payload.from || "unknown",
      status: "rejected"
    });
    return new Response("Forbidden", { status: 403 });
  }
  return handler(payload, body);
}

async function handleVoice(req: Request, env: Env, url: URL): Promise<Response> {
  return guarded(req, env, url, async (payload) => {
    const open = isOfficeHours(new Date());
    await logCall(env, {
      callid: callId(payload, url),
      caller_e164: caller(payload, url),
      status: "started",
      ivr_choice: open ? null : "outside_hours"
    });
    return json(open ? introIvr(env, url, payload) : outsideHoursVoicemail(env, url, payload));
  });
}

async function handleRoute(req: Request, env: Env, url: URL, route: string): Promise<Response> {
  return guarded(req, env, url, async (payload) => {
    let operator: Operator = route === "sebastian" ? "sebastian" : "lennart";
    const choice = ivrChoice(payload, url);
    if (route === "from-ivr" && choice === "2") operator = "sebastian";
    await logCall(env, {
      callid: callId(payload, url),
      caller_e164: caller(payload, url),
      status: "route",
      ivr_choice: choice || (operator === "sebastian" ? "2" : "default")
    });
    return json(holdThenDial(env, url, operator, payload));
  });
}

async function handleDial(req: Request, env: Env, url: URL, operator: Operator): Promise<Response> {
  return guarded(req, env, url, async (payload) => json(dial(env, url, operator, payload)));
}

async function handleVoicemail(req: Request, env: Env, url: URL): Promise<Response> {
  return guarded(req, env, url, async (payload) => json(voicemailPrompt(env, url, payload)));
}

async function handleRecord(req: Request, env: Env, url: URL): Promise<Response> {
  return guarded(req, env, url, async (payload) => json(recordVoicemail(url, payload)));
}

async function handleVoicemailSaved(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  return guarded(req, env, url, async (payload) => {
    const recordingUrl = payload.wav || url.searchParams.get("recording_url") || null;
    const from = caller(payload, url);
    await logCall(env, {
      callid: callId(payload, url),
      caller_e164: from,
      duration_s: payload.duration ? Number(payload.duration) : null,
      answered_by: "voicemail",
      status: "voicemail",
      ivr_choice: ivrChoice(payload, url),
      recording_url: recordingUrl
    });
    notifySebastian(env, `Missat samtal fran ${from} kl ${stockholmTime()}.\nVoicemail: ${recordingUrl || "saknas"}`, ctx);
    if (from !== "unknown") notifyCaller(env, from, ctx);
    return json({ ok: true });
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs === 0 ? `${mins}m` : `${mins}m${secs}s`;
}

async function handleHangup(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  return guarded(req, env, url, async (payload) => {
    const attempt = url.searchParams.get("attempt");
    const state = payload.state || "failed";
    const duration = payload.duration ? Number(payload.duration) : 0;
    const answered = state === "success" && duration > 0;
    const answeredBy = answered ? (attempt === "lennart" ? "lennart" : "sebastian") : "missed";
    const from = caller(payload, url);
    await logCall(env, {
      callid: callId(payload, url),
      caller_e164: from,
      duration_s: duration,
      answered_by: answeredBy,
      status: answered ? "answered" : "missed",
      ivr_choice: ivrChoice(payload, url)
    });

    // Notifiera Sebastian vid varje besvarat samtal (oavsett vem som svarade).
    // Voicemail hanteras separat i handleVoicemailSaved - ingen risk for dubblett.
    if (answered) {
      const who = answeredBy === "lennart" ? "Lennart" : "Du";
      const durationFmt = formatDuration(duration);
      notifySebastian(
        env,
        `${who} tog samtal fran ${from} kl ${stockholmTime()}, varaktighet ${durationFmt}.`,
        ctx
      );
    }

    return json({ ok: true });
  });
}

async function handleStats(req: Request, env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return new Response("Forbidden", { status: 403 });
  const row = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN date(timestamp) = date('now') THEN 1 ELSE 0 END) AS calls_today,
      SUM(CASE WHEN date(timestamp) = date('now') AND status IN ('missed','voicemail') THEN 1 ELSE 0 END) AS missed_today,
      AVG(CASE WHEN date(timestamp) = date('now') AND duration_s IS NOT NULL THEN duration_s ELSE NULL END) AS avg_duration_s,
      SUM(CASE WHEN date(timestamp) = date('now') AND answered_by = 'sebastian' AND ivr_choice = '1' THEN 1 ELSE 0 END) AS fallback_calls,
      SUM(CASE WHEN date(timestamp) = date('now') AND ivr_choice = 'outside_hours' THEN 1 ELSE 0 END) AS outside_hours_calls,
      SUM(CASE WHEN date(timestamp) = date('now') AND ivr_choice != 'outside_hours' THEN 1 ELSE 0 END) AS office_hours_calls
    FROM call_log
  `).first<Record<string, number | null>>();
  const callsToday = Number(row?.calls_today || 0);
  return json({
    calls_today: callsToday,
    missed_today: Number(row?.missed_today || 0),
    avg_duration_s: Math.round(Number(row?.avg_duration_s || 0)),
    fallback_rate: callsToday ? Number(row?.fallback_calls || 0) / callsToday : 0,
    office_hours_calls: Number(row?.office_hours_calls || 0),
    outside_hours_calls: Number(row?.outside_hours_calls || 0)
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/voice") return handleVoice(req, env, url);
    if (url.pathname === "/route/from-ivr") return handleRoute(req, env, url, "from-ivr");
    if (url.pathname === "/route/sebastian") return handleRoute(req, env, url, "sebastian");
    if (url.pathname === "/route/lennart") return handleRoute(req, env, url, "lennart");
    if (url.pathname === "/dial/sebastian") return handleDial(req, env, url, "sebastian");
    if (url.pathname === "/dial/sebastian-fallback") return handleDial(req, env, url, "sebastian-fallback");
    if (url.pathname === "/dial/lennart") return handleDial(req, env, url, "lennart");
    if (url.pathname === "/voicemail") return handleVoicemail(req, env, url);
    if (url.pathname === "/record") return handleRecord(req, env, url);
    if (url.pathname === "/event/voicemail-saved") return handleVoicemailSaved(req, env, ctx, url);
    if (url.pathname === "/event/hangup") return handleHangup(req, env, ctx, url);
    if (url.pathname === "/stats") return handleStats(req, env, url);
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Nattlig purge av gamla loggar (03:00 UTC).
    if (event.cron === "0 3 * * *") {
      await purgeOldLogs(env);
      return;
    }
    // Dagsrapport-cron firar vid bade sommar- och vinter-UTC (11/12 och 16/17).
    // Vi kontrollerar faktisk Stockholm-timme sa exakt EN rapport skickas per
    // tidpunkt oavsett sommar-/vintertid (DST-saker).
    const { hour } = stockholmParts(new Date());
    if (hour === 13) {
      await sendDailyReport(env, "middagsrapport", ctx);
    } else if (hour === 18) {
      await sendDailyReport(env, "kvallsrapport", ctx);
    }
  }
};
