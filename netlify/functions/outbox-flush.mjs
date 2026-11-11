// Schemalagd tömning av outbox-storen: kundutskick som köats under tysta
// timmar (nattstängda ärenden) skickas när sendAfter passerats och klockan är
// human. Körs var 15:e minut; skickar i praktiken kl 10:00 svensk tid.

import { getStore } from "@netlify/blobs";
import { isQuietHour } from "./_shared/quiet-hours.mjs";
import { sendThankYou, thankYouOutcome } from "./workshop-cases.mjs";
import { postSms } from "./_shared/sms.mjs";
import { loggedSms } from "./_shared/comm-log.mjs";
import { CAMPAIGN_BATCH_PER_RUN } from "./_shared/campaign.mjs";
import { claimJson, commitCase } from "./_shared/case-store.mjs";
import { hasJournalEntry, markCommitted, sendJournaled } from "./_shared/send-journal.mjs";

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

  const runId = `flush-${new Date(now).toISOString()}`;
  for (const blob of blobs || []) {
    const peek = await outbox.get(blob.key, { type: "json" }).catch(() => null);
    if (!peek?.sendAfter || new Date(peek.sendAfter).getTime() > now) continue;
    // Reservera köposten villkorat: två överlappande körningar (eller en
    // körning som drog över 15 minuter) får inte båda skicka. Förloraren
    // hoppar över; en reservation äldre än 10 min räknas som övergiven.
    const claim = await claimJson(outbox, blob.key, { by: runId, now });
    if (!claim.ok) { results.push({ key: blob.key, status: claim.reason === "in_flight" ? "in_flight" : `claim_${claim.reason}` }); continue; }
    const entry = claim.item;

    if (entry.type === "thank_you" && entry.caseId) {
      const caseItem = await caseStore.get(entry.caseId, { type: "json" }).catch(() => null);
      // Skicka bara om ärendet fortfarande väntar — har status ändrats (t.ex.
      // skickat manuellt eller suppressed) släpps köposten utan utskick.
      if (caseItem?.notifications?.thankYou?.status === "queued") {
        try {
          // Gick utskicket i en tidigare körning men ärendeskrivningen föll
          // sparades resultatet på köposten: skicka INTE om, skriv bara ärendet.
          const thankYou = entry.thankYouDone && entry.thankYouResult ? entry.thankYouResult : await sendThankYou(caseItem, entry.thankYouVariant);
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

          // Versionerad skrivning: utskicket är gjort, resultatet läggs på
          // ärendets FÄRSKA version (en samtidig admin-PATCH skrivs inte över).
          const savedThankYou = await commitCase(caseStore, entry.caseId, (fresh) => ({
            ...fresh,
            updatedAt: sentAt,
            coupon: thankYou.coupon,
            notifications: {
              ...(fresh.notifications || {}),
              // Behåll "queued" så länge posten ligger kvar i kön, annars
              // skulle nästa körning avfärda ärendet som "skipped_not_queued"
              // och radera köposten utan att någonsin ha skickat något.
              thankYou: keepQueued
                ? { ...(fresh.notifications?.thankYou || {}), status: "queued", attempts, lastError: outcome.event }
                : { status: thankYou.email.status, ...thankYou, delivered: outcome.delivered },
            },
            timeline: [
              ...(Array.isArray(fresh.timeline) ? fresh.timeline : []),
              { at: sentAt, event },
            ],
          }));

          if (!savedThankYou.ok) {
            // Utskicket är gjort men ärendet kunde inte skrivas: behåll köposten
            // med resultatet så att nästa körning bara gör om skrivningen.
            await outbox.setJSON(blob.key, { ...entry, claimedAt: "", claimedBy: "", thankYouDone: true, thankYouResult: thankYou, lastTriedAt: sentAt, lastError: `ärendeskrivning: ${savedThankYou.reason}` }).catch(() => {});
            results.push({ key: blob.key, status: "case_write_retry", reason: savedThankYou.reason });
            continue;
          }
          if (keepQueued) {
            await outbox.setJSON(blob.key, { ...entry, claimedAt: "", claimedBy: "", attempts, lastTriedAt: sentAt, lastError: outcome.event }).catch(() => {});
            results.push({ key: blob.key, status: "retry", attempt: attempts, email: outcome.emailStatus });
            continue;
          }
          results.push({ key: blob.key, status: giveUp ? "gave_up" : thankYou.email.status });
        } catch (error) {
          // Behåll köposten vid providerfel — nästa körning försöker igen (släpp reservationen).
          await outbox.setJSON(blob.key, { ...entry, claimedAt: "", claimedBy: "" }).catch(() => {});
          results.push({ key: blob.key, status: "retry", error: String(error?.message || error).slice(0, 120) });
          continue;
        }
      } else {
        results.push({ key: blob.key, status: "skipped_not_queued" });
      }
    } else if (entry.type === "draft_sms" && entry.caseId && entry.phone && entry.message) {
      // Kundsms som godkändes under tysta timmar (sms-draft-inbox). Samma
      // kontrakt som approve-rutten: skicka, logga på ärendet, new→contacted.
      const journaled = await sendJournaled({
        caseId: entry.caseId, channel: "sms", to: entry.phone, message: entry.message, source: "outbox-draft", operator: entry.operator || "", action: "outbox_draft_sms",
        apply: { log: "smsLog", kind: "draft-inbox", statusFrom: ["new"], statusTo: "contacted", event: `Köat AI-utkast (kategori ${entry.category || "C"}) skickat via SMS-API efter tysta timmar.` },
        idempotencyKey: `outbox-${blob.key}-${Number(entry.attempts || 0) + 1}`,
        send: () => loggedSms("outbox-draft", postSms)({ to: entry.phone, message: entry.message, approved: true }),
      });
      const sms = journaled.result || { status: journaled.status };
      const sentAt = new Date().toISOString();
      if (sms.status !== "sent") {
        const attempts = Number(entry.attempts || 0) + 1;
        if (attempts < MAX_THANK_YOU_ATTEMPTS) {
          await outbox.setJSON(blob.key, { ...entry, claimedAt: "", claimedBy: "", attempts, lastTriedAt: sentAt, lastError: sms.error || sms.status }).catch(() => {});
          results.push({ key: blob.key, status: "retry", attempt: attempts, sms: sms.status });
          continue;
        }
        results.push({ key: blob.key, status: "gave_up", sms: sms.status });
      } else {
        const savedCase = await commitCase(caseStore, entry.caseId, (fresh) => hasJournalEntry(fresh, journaled.journalKey) ? null : ({
          ...fresh,
          status: fresh.status === "new" ? "contacted" : fresh.status,
          smsLog: [
            ...(Array.isArray(fresh.smsLog) ? fresh.smsLog : []),
            { at: sentAt, kind: "draft-inbox", to: entry.phone, message: entry.message, status: "sent", providerId: sms.id || "", operator: entry.operator || "", journalKey: journaled.journalKey },
          ].slice(-50),
          timeline: [
            ...(Array.isArray(fresh.timeline) ? fresh.timeline : []),
            { at: sentAt, event: `Köat AI-utkast (kategori ${entry.category || "C"}) skickat via SMS-API efter tysta timmar.` },
          ],
          updatedAt: sentAt,
        })).catch(() => ({ ok: false, reason: "threw" }));
        if ((savedCase.ok || savedCase.reason === "aborted") && journaled.journalKey) await markCommitted(journaled.journalKey, { caseEtag: savedCase.etag || "" }).catch(() => {});
        results.push({ key: blob.key, status: "sent", caseLogged: Boolean(savedCase.ok || savedCase.reason === "aborted") });
      }
    } else if (entry.type === "campaign_sms" && entry.phone && entry.message) {
      // Köat kampanj-SMS (call-dashboard action queue_campaign). Portionerat,
      // optout kontrolleras igen vid utskick (kan ha kommit efter köandet),
      // och campaign-sent uppdateras så att 30-dagarsspärren gäller.
      if (campaignSentThisRun >= CAMPAIGN_BATCH_PER_RUN) {
        await outbox.setJSON(blob.key, { ...entry, claimedAt: "", claimedBy: "" }).catch(() => {});
        results.push({ key: blob.key, status: "deferred" });
        continue;
      }
      const opted = await optoutStore.get(entry.phone, { type: "json" }).catch(() => null);
      if (opted) {
        results.push({ key: blob.key, status: "optout" });
      } else {
        campaignSentThisRun += 1;
        const sms = await loggedSms(`campaign:${entry.tag || "kampanj"}`, postSms)({ to: entry.phone, message: entry.message, from: entry.from || undefined }).catch(() => ({ status: "failed" }));
        const sentAt = new Date().toISOString();
        if (sms.status !== "sent" && sms.status !== "pending_approval") {
          const attempts = Number(entry.attempts || 0) + 1;
          if (attempts < MAX_THANK_YOU_ATTEMPTS) {
            await outbox.setJSON(blob.key, { ...entry, claimedAt: "", claimedBy: "", attempts, lastTriedAt: sentAt, lastError: sms.error || sms.status }).catch(() => {});
            results.push({ key: blob.key, status: "retry", attempt: attempts, sms: sms.status });
            continue;
          }
          results.push({ key: blob.key, status: "gave_up", sms: sms.status });
        } else if (sms.status === "pending_approval") {
          // Ligger nu i godkännandekön på /admin/kommunikation/; 30-dagarsspärren
          // sätts först när Sebastian godkänt och SMS:et faktiskt gått.
          results.push({ key: blob.key, status: "pending_approval", tag: entry.tag });
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
