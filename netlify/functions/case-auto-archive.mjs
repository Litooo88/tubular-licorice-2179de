// Schemalagd auto-arkivering av döda webbförfrågningar. Regeln och vad som
// räknas som kontakt ligger i _shared/auto-archive.mjs (testad).
//
// Körs 05:50 varje dag, före morgondigesten, så att dagens siffror är rena.
// Skickar inga SMS eller mejl: arkivering triggar inte tackflödet, och
// ärendena är per definition sådana där ingen kontakt tagits.

import { getStore } from "@netlify/blobs";
import { AUTO_ARCHIVE_DAYS, archivedCopy, keepReason } from "./_shared/auto-archive.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const MAX_PER_RUN = 150;

const sammanfattning = (item) => ({
  id: item.id,
  createdAt: item.createdAt,
  name: item.customer?.name || item.customerName || "",
  source: item.source || "",
  service: item.service || "",
});

export const runAutoArchive = async ({ apply, now = Date.now() }) => {
  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  const archived = [];
  const kept = {};
  let scanned = 0;
  for (const blob of blobs || []) {
    const item = await store.get(blob.key, { type: "json" }).catch(() => null);
    if (!item || item.status !== "new") continue;
    scanned += 1;
    const reason = keepReason(item, now);
    if (reason !== null) {
      kept[reason] = (kept[reason] || 0) + 1;
      continue;
    }
    if (archived.length >= MAX_PER_RUN) break;
    if (apply) await store.setJSON(blob.key, archivedCopy(item, now));
    archived.push(sammanfattning(item));
  }
  return { ok: true, apply: Boolean(apply), days: AUTO_ARCHIVE_DAYS, scannedNew: scanned, archived: archived.length, kept, items: archived };
};

// Enbart schemalagd. Netlify tillåter ingen egen `path` på schemalagda
// funktioner (bygget stoppar), och de går inte att anropa över HTTP.
// Torrkörning görs lokalt mot GET /api/cases med samma keepReason
// (se scratchpad-skriptet i sync-loggen 2026-10-07).
export default async () => {
  const result = await runAutoArchive({ apply: true });
  console.log("case-auto-archive", JSON.stringify({ ...result, items: result.items.map((i) => i.id) }));
  return json(result);
};

export const config = {
  schedule: "50 5 * * *",
};
