// Schemalagd tömning av outbox-storen: kundutskick som köats under tysta
// timmar (nattstängda ärenden) skickas när sendAfter passerats och klockan är
// human. Körs var 15:e minut; skickar i praktiken kl 10:00 svensk tid.

import { getStore } from "@netlify/blobs";
import { isQuietHour } from "./_shared/quiet-hours.mjs";
import { sendThankYou } from "./workshop-cases.mjs";

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
          const thankYou = await sendThankYou(caseItem);
          const sentAt = thankYou.sentAt || new Date().toISOString();
          await caseStore.setJSON(entry.caseId, {
            ...caseItem,
            updatedAt: sentAt,
            coupon: thankYou.coupon,
            notifications: {
              ...(caseItem.notifications || {}),
              thankYou: { status: thankYou.email.status, ...thankYou },
            },
            timeline: [
              ...(Array.isArray(caseItem.timeline) ? caseItem.timeline : []),
              { at: sentAt, event: "Köat tackmail skickat (efter nattstängning)." },
            ],
          });
          results.push({ key: blob.key, status: thankYou.email.status });
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
