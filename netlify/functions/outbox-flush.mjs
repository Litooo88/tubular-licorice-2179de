// Schemalagd tömning av outbox-storen: kundutskick som köats under tysta
// timmar (nattstängda ärenden) skickas när sendAfter passerats och klockan är
// human. Körs var 15:e minut; skickar i praktiken kl 10:00 svensk tid.

import { getStore } from "@netlify/blobs";
import { isQuietHour } from "./_shared/quiet-hours.mjs";
import { sendThankYou, thankYouOutcome } from "./workshop-cases.mjs";
import { postSms } from "./_shared/sms.mjs";
import { CAMPAIGN_BATCH_PER_RUN } from "./_shared/campaign.mjs";

// Hur många gånger en köpost får försökas innan vi ger upp och slutar ockupera
// kön. Utan tak skulle ett permanent providerfel återkomma i all evighet.
const MAX_THANK_YOU_ATTEMPTS = 5;

export default async () => {
  if (isQuietHour()) return new Response("quiet");

  const outbox = getStore({ name: "outbox", consistency: "strong" });
  const caseStore = getStore({ name: "workshop-cases", consistency: "strong" });
  const optoutStore = getStore({ name: "sms-optout", consistency: "strong" });
  const campaignStore = getStore({ name: "campaign-sent", consistency: "strong" });
  const { blobs } = await outbox.list().catch(() => ({ blobs: [] }));
  const now = Date.now();
  const results = [];
  // Kampanj-SMS skickas i portioner: max CAMPAIGN_BATCH_PER_RUN per körning
  // (var 15:e minut), så att en kö på hundra nummer tar en dryg timme i
  // stället för att en funktion står och skickar tills den dödas.
  let campaignSentThisRun = 0;

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
    } else if (entry.type === "draft_sms" && entry.caseId && entry.phone && entry.message) {
      // Kundsms som godkändes under tysta timmar (sms-draft-inbox). Samma
      // kontrakt som approve-rutten: skicka, logga på ärendet, new→contacted.
      const sms = await postSms({ to: entry.phone, message: entry.message }).catch(() => ({ status: "failed" }));
      const sentAt = new Date().toISOString();
      if (sms.status !== "sent") {
        const attempts = Number(entry.attempts || 0) + 1;
        if (attempts < MAX_THANK_YOU_ATTEMPTS) {
          await outbox.setJSON(blob.key, { ...entry, attempts, lastTriedAt: sentAt, lastError: sms.error || sms.status }).catch(() => {});
          results.push({ key: blob.key, status: "retry", attempt: attempts, sms: sms.status });
          continue;
        }
        results.push({ key: blob.key, status: "gave_up", sms: sms.status });
      } else {
        const caseItem = await caseStore.get(entry.caseId, { type: "json" }).catch(() => null);
        if (caseItem) {
          await caseStore.setJSON(entry.caseId, {
            ...caseItem,
            status: caseItem.status === "new" ? "contacted" : caseItem.status,
            smsLog: [
              ...(Array.isArray(caseItem.smsLog) ? caseItem.smsLog : []),
              { at: sentAt, kind: "draft-inbox", to: entry.phone, message: entry.message, status: "sent", providerId: sms.id || "", operator: entry.operator || "" },
            ].slice(-50),
            timeline: [
              ...(Array.isArray(caseItem.timeline) ? caseItem.timeline : []),
              { at: sentAt, event: `Köat AI-utkast (kategori ${entry.category || "C"}) skickat via SMS-API efter tysta timmar.` },
            ],
            updatedAt: sentAt,
          }).catch(() => {});
        }
        results.push({ key: blob.key, status: "sent" });
      }
    } else if (entry.type === "campaign_sms" && entry.phone && entry.message) {
      // Köat kampanj-SMS (call-dashboard action queue_campaign). Portionerat,
      // optout kontrolleras igen vid utskick (kan ha kommit efter köandet),
      // och campaign-sent uppdateras så att 30-dagarsspärren gäller.
      if (campaignSentThisRun >= CAMPAIGN_BATCH_PER_RUN) {
        results.push({ key: blob.key, status: "deferred" });
        continue;
      }
      const opted = await optoutStore.get(entry.phone, { type: "json" }).catch(() => null);
      if (opted) {
        results.push({ key: blob.key, status: "optout" });
      } else {
        campaignSentThisRun += 1;
        const sms = await postSms({ to: entry.phone, message: entry.message, from: entry.from || undefined }).catch(() => ({ status: "failed" }));
        const sentAt = new Date().toISOString();
        if (sms.status !== "sent") {
          const attempts = Number(entry.attempts || 0) + 1;
          if (attempts < MAX_THANK_YOU_ATTEMPTS) {
            await outbox.setJSON(blob.key, { ...entry, attempts, lastTriedAt: sentAt, lastError: sms.error || sms.status }).catch(() => {});
            results.push({ key: blob.key, status: "retry", attempt: attempts, sms: sms.status });
            continue;
          }
          results.push({ key: blob.key, status: "gave_up", sms: sms.status });
        } else {
          const prior = await campaignStore.get(entry.phone, { type: "json" }).catch(() => null);
          await campaignStore.setJSON(entry.phone, {
            phone: entry.phone,
            lastSentAt: sentAt,
            lastCode: entry.tag || "campaign",
            count: (Number(prior?.count) || 0) + 1,
            history: [...(Array.isArray(prior?.history) ? prior.history : []).slice(-19), { at: sentAt, code: entry.tag || "campaign", providerId: sms.id || "", operator: entry.operator || "" }],
          }).catch(() => {});
          results.push({ key: blob.key, status: "sent", tag: entry.tag });
        }
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
