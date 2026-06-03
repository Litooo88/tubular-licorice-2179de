import type { Env } from "./types";

/**
 * SMS-avsandare. ELKS_FROM_NUMBER (+46101385498) ar ett voice-only nummer som
 * INTE kan skicka SMS. Vi anvander darfor SMS_SENDER (alfanumerisk, t.ex.
 * "NordicEMob") for utgaende SMS. ELKS_FROM_NUMBER anvands fortfarande som
 * callerid pa utgaende SAMTAL (dar kravs ett giltigt nummer).
 *
 * OBS: alfanumerisk avsandare kan INTE ta emot svar. Darfor lovar vi inte
 * "svara pa detta SMS" i meddelanden till uppringare.
 */
function smsSender(env: Env): string {
  return env.SMS_SENDER || env.ELKS_FROM_NUMBER;
}

async function sendSms(env: Env, to: string, message: string): Promise<void> {
  const body = new URLSearchParams({
    from: smsSender(env),
    to,
    message
  });

  const credentials = btoa(`${env.ELKS_USERNAME}:${env.ELKS_PASSWORD}`);
  const response = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`46elks SMS failed: ${response.status} ${await response.text()}`);
  }
}

/**
 * Spam-skydd: bekrafta att numret ser ut som ett svenskt mobilnummer.
 * Forhindrar SMS-bombning av spam-uppringare, fasta nummer, internationella
 * nummer, och returkanaler som inte tar emot SMS.
 */
function isLikelySwedishMobile(e164: string): boolean {
  return /^\+467\d{8}$/.test(e164);
}

export function notifySebastian(env: Env, message: string, ctx: ExecutionContext): void {
  ctx.waitUntil(sendSms(env, env.SEBASTIAN_NUMBER, message));
}

export function notifyCaller(env: Env, to: string, ctx: ExecutionContext): void {
  // Skicka bara till svenska mobilnummer (spam-/kostnadsskydd).
  if (!isLikelySwedishMobile(to)) {
    console.log(`Skipping caller SMS to non-Swedish-mobile: ${to}`);
    return;
  }

  // OBS: avsandaren ar alfanumerisk och kan inte ta emot svar, sa vi lovar
  // INTE att de kan svara pa SMS:et. Bara en bekraftelse + att vi aterkommer.
  const message = [
    "Hej! Tack for ditt samtal till Nordic E-Mobility i Orebro.",
    "Vi sag att du ringt och aterkommer sa snart vi kan.",
    "/Nordic E-Mobility"
  ].join("\n");
  ctx.waitUntil(sendSms(env, to, message));
}
