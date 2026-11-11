// Schemalagd återhämtning för kommunikationsflödena (var 15:e minut, förskjuten
// mot outbox-flush). Gör två saker, båda idempotenta och utan nya kundutskick
// utanför de vanliga spärrarna:
//
//   1. Utskicksjournalen (_shared/send-journal.mjs): utskick som gick iväg men
//      vars ärendeskrivning föll får sin loggrad återapplicerad; reservationer
//      som aldrig fick ett resultat markeras "unknown" med en tidslinjerad.
//   2. Inkommande SMS (sms-inbound.mjs): leveranser vars behandling avbröts
//      (ärendekoppling, inkorg, notis) körs klart från det steg som saknas.
//      Autosvar som inte kunde ges i webhook-svaret skickas via SMS-API:t och
//      går då genom den vanliga godkännandespärren.
//
// Schemalagda funktioner kan inte anropas över HTTP i produktion (Netlify);
// därför ingen egen auth här, samma som outbox-flush.

import { reconcileSendJournal } from "./_shared/send-journal.mjs";
import { reprocessInbound } from "./sms-inbound.mjs";

export const runReconcile = async ({ now = Date.now() } = {}) => {
  const journal = await reconcileSendJournal({ now }).catch((error) => ({ error: String(error?.message || error).slice(0, 160) }));
  const inbound = await reprocessInbound({ now }).catch((error) => ({ error: String(error?.message || error).slice(0, 160) }));
  const summary = { at: new Date(now).toISOString(), journal, inbound };
  console.log("comm-reconcile", JSON.stringify(summary));
  return summary;
};

export default async () =>
  new Response(JSON.stringify({ ok: true, ...(await runReconcile()) }), { headers: { "Content-Type": "application/json; charset=utf-8" } });

export const config = {
  schedule: "7,22,37,52 * * * *",
};
