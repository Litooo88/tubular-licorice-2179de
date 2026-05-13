import type { Env } from "./types";

async function sendSms(env: Env, to: string, message: string): Promise<void> {
  const body = new URLSearchParams({
    from: env.ELKS_FROM_NUMBER,
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
 * Spam-skydd: bekräfta att numret ser ut som ett svenskt mobilnummer.
 * Förhindrar SMS-bombning av spam-uppringare, fasta nummer, internationella
 * nummer (som kan vara dyrare per SMS), och returkanaler som inte tar emot SMS.
 *
 * Svenska mobilnummer börjar alltid med +467X följt av 8 siffror (totalt 11 tecken).
 */
function isLikelySwedishMobile(e164: string): boolean {
  return /^\+467\d{8}$/.test(e164);
}

export function notifySebastian(env: Env, message: string, ctx: ExecutionContext): void {
  ctx.waitUntil(sendSms(env, env.SEBASTIAN_NUMBER, message));
}

export function notifyCaller(env: Env, to: string, ctx: ExecutionContext): void {
  // P0-skydd: skicka inte SMS till okända / icke-svenska / icke-mobila nummer.
  // Sparar SMS-credits och undviker rejections från 46elks.
  if (!isLikelySwedishMobile(to)) {
    console.log(`Skipping caller SMS to non-Swedish-mobile: ${to}`);
    return;
  }

  const message = [
    "Hej! Tack for ditt samtal till Nordic E-Mobility.",
    "Vi ar upptagna just nu men har sett att du ringt.",
    "Vi aterkommer under dagen.",
    "Akut arende? Skriv hit pa SMS. /Nordic E-Mobility"
  ].join("\n");
  ctx.waitUntil(sendSms(env, to, message));
}
