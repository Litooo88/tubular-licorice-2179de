// Schemalagd tömning av outbox-storen: kundutskick som köats under tysta
// timmar (nattstängda ärenden) skickas när sendAfter passerats och klockan är
// human. Körs var 15:e minut; skickar i praktiken kl 10:00 svensk tid.

import { getStore } from "@netlify/blobs";
import { isQuietHour } from "./_shared/quiet-hours.mjs";
import { sendThankYou, thankYouOutcome } from "./workshop-cases.mjs";

// Hur många gånger en köpost får försökas innan vi ger upp och slutar ockupera
// kön. Utan tak skulle ett permanent providerfel återkomma i all evighet.
const MAX_THANK_YOU_ATTEMPTS = 5;

export default async () => {
  if (isQuietHour()) return new Response("quiet");

  const outbox = getStore({ name: "outbox", consistency: "strong" });
  const caseStore = getStore({ name: "workshop-cases", consistency: "strong" });
  const { blobs } = await outbox.list().catch(() => ({ blobs: [] }));
  const now = Date.now();
  const results = [];

  for (const blob of blobs || []) {
    const entry = await outbox.get(blob.key, { type: "json" }).catch(() => null);
    if (!entry?.sendAfter || new Date(entry.sendAfter).getTime() > now) continue;

    if (entry.type === "thank_you" && entry.caseId) {
      const caseItem = await caseStore.get(entry.caseId, { type: "json" }).catch(() => null);
      // Skicka bara om ärendet fortfarande väntar — har status ändrats (t.ex.
      // skickat manuellt eller suppressed) släpps köposten utan utskick.
      if (caseItem?.notifications?.thankYou?.status === "queued") {
        try {
          const thankYou = await sendThankYou(caseItem, entry.thankYouVariant);
          // sendThankYou KASTAR inte vid providerfel — den returnerar
          // { email: { status: "failed" } }. Tidigare tolkades det som lyckat:
          // köposten raderades och timelinen fick raden "skickat" ändå.
          const outcome = thankYouOutcome(thankYou);
          const attempts = Number(entry.attempts || 0) + 1;
          const giveUp = outcome.retryable && attempts >= MAX_THANK_YOU_ATTEMPTS;
          const keepQueued = outcome.retryable && !giveUp;
          const sentAt = thankYou.sentAt || new Date().toISOString();
          const event = keepQueued
            ? `${outcome.event} (försök ${attempts} av ${MAX_THANK_YOU_ATTEMPTS})`
            : giveUp
              ? `Köat tackmail gavs upp efter ${attempts} försök (mejl: ${outcome.emailStatus}, SMS: ${outcome.smsStatus}). Hantera manuellt.`
              : outcome.delivered
                ? "Köat tackmail skickat (efter nattstängning)."
                : outcome.event;

          await caseStore.setJSON(entry.caseId, {
            ...caseItem,
            updatedAt: sentAt,
            coupon: thankYou.coupon,
            notifications: {
              ...(caseItem.notifications || {}),
              // Behåll "queued" så länge posten ligger kvar i kön, annars
              // skulle nästa körning avfärda ärendet som "skipped_not_queued"
              // och radera köposten utan att någonsin ha skickat något.
              thankYou: keepQueued
                ? { ...(caseItem.notifications?.thankYou || {}), status: "queued", attempts, lastError: outcome.event }
                : { status: thankYou.email.status, ...thankYou, delivered: outcome.delivered },
            },
            timeline: [
              ...(Array.isArray(caseItem.timeline) ? caseItem.timeline : []),
              { at: sentAt, event },
            ],
          });

          if (keepQueued) {
            await outbox.setJSON(blob.key, { ...entry, attempts, lastTriedAt: sentAt, lastError: outcome.event }).catch(() => {});
            results.push({ key: blob.key, status: "retry", attempt: attempts, email: outcome.emailStatus });
            continue;
          }
          results.push({ key: blob.key, status: giveUp ? "gave_up" : thankYou.email.status });
        } catch (error) {
          // Behåll köposten vid providerfel — nästa körning försöker igen.
          results.push({ key: blob.key, status: "retry", error: String(error?.message || error).slice(0, 120) });
          continue;
        }
      } else {
        results.push({ key: blob.key, status: "skipped_not_queued" });
      }
    } else {
      results.push({ key: blob.key, status: "unknown_type" });
    }

    await outbox.delete(blob.key).catch(() => {});
  }

  if (results.length) console.log("outbox-flush", JSON.stringify(results));
  return new Response(JSON.stringify({ ok: true, processed: results.length }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "*/15 * * * *",
};
