import { stockholmTime } from "./officeHours";
import { notifySebastian } from "./notify";
import type { Env } from "./types";

/**
 * Skickar en daglig SMS-rapport till Sebastian med dagens samtalsstatistik.
 * Anropas av scheduled-handlern kl 13:00 och 18:00 Stockholm.
 *
 * Använder COUNT(DISTINCT callid) för att undvika dubbelräkning — ett samtal
 * loggar flera rader (started, route, answered/missed, voicemail).
 */
export async function sendDailyReport(env: Env, label: string, ctx: ExecutionContext): Promise<void> {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN status = 'started' THEN callid END) AS calls,
      COUNT(DISTINCT CASE WHEN status = 'answered' THEN callid END) AS answered,
      COUNT(DISTINCT CASE WHEN status IN ('missed','voicemail') THEN callid END) AS missed,
      COUNT(DISTINCT CASE WHEN status = 'voicemail' THEN callid END) AS voicemails
    FROM call_log
    WHERE date(timestamp) = date('now')
  `).first<Record<string, number | null>>();

  const calls = Number(row?.calls || 0);
  const answered = Number(row?.answered || 0);
  const missed = Number(row?.missed || 0);
  const voicemails = Number(row?.voicemails || 0);

  const lines = [
    `Nordic E-Mobility ${label} kl ${stockholmTime()}:`,
    `${calls} samtal idag, ${answered} besvarade, ${missed} missade.`
  ];
  if (voicemails > 0) {
    lines.push(`${voicemails} rostmeddelande vantar pa atgard.`);
  }
  if (calls === 0) {
    lines.push("Inga samtal annu idag.");
  }

  notifySebastian(env, lines.join("\n"), ctx);
}
