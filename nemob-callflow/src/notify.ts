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

export function notifySebastian(env: Env, message: string, ctx: ExecutionContext): void {
  ctx.waitUntil(sendSms(env, env.SEBASTIAN_NUMBER, message));
}

export function notifyCaller(env: Env, to: string, ctx: ExecutionContext): void {
  const message = [
    "Hej! Tack for ditt samtal till Nordic E-Mobility.",
    "Vi ar upptagna just nu men har sett att du ringt.",
    "Vi aterkommer under dagen.",
    "Akut arende? Skriv hit pa SMS. /Nordic E-Mobility"
  ].join("\n");
  ctx.waitUntil(sendSms(env, to, message));
}
