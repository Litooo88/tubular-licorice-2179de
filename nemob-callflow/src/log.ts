import type { CallLogRow, Env } from "./types";

export async function logCall(env: Env, row: CallLogRow): Promise<void> {
  const payload = {
    timestamp: row.timestamp || new Date().toISOString(),
    callid: row.callid,
    caller_e164: row.caller_e164,
    duration_s: row.duration_s ?? null,
    answered_by: row.answered_by ?? null,
    status: row.status,
    ivr_choice: row.ivr_choice ?? null,
    recording_url: row.recording_url ?? null
  };

  await env.DB.prepare(
    `INSERT INTO call_log (timestamp, callid, caller_e164, duration_s, answered_by, status, ivr_choice, recording_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    payload.timestamp,
    payload.callid,
    payload.caller_e164,
    payload.duration_s,
    payload.answered_by,
    payload.status,
    payload.ivr_choice,
    payload.recording_url
  ).run();

  if (env.APPS_SCRIPT_WEBHOOK_URL) {
    fetch(env.APPS_SCRIPT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch((err) => console.warn("Apps Script backup log failed", err));
  }
}

export async function purgeOldLogs(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM call_log WHERE datetime(timestamp) < datetime('now', '-90 days')").run();
}
