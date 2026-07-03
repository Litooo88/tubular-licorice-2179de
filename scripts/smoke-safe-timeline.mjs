// Smoke: safe timeline writes.
// Verifierar att appendCaseEvent ALDRIG skriver över huvudcase-blobben:
// en statusändring som sker mellan händelser får inte försvinna, och
// timeline-eventet ska hamna i den separata case-events-storen.
// Körs helt lokalt (NORDIC_LOCAL_STORAGE_FALLBACK=1) — inga Blobs-anrop,
// inga SMS, inga mail, inga production-writes.
//
//   NORDIC_LOCAL_STORAGE_FALLBACK=1 node scripts/smoke-safe-timeline.mjs

process.env.NORDIC_LOCAL_STORAGE_FALLBACK = "1";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const storage = require("../netlify/functions/_shared/storage.js");
const { appendCaseEvent, get, list, remove, storeFor } = storage;

const CASE_ID = "smoke_case_safe_timeline";
let failures = 0;
const assert = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

// 1. Skapa ett case i "workshop-cases"-storen (som workshop-cases.mjs gör).
const original = {
  id: CASE_ID,
  status: "waiting_customer",
  customer: { name: "Smoke Testsson", phone: "+46700000000" },
  payment: { status: "unpaid" },
  timeline: [{ at: new Date().toISOString(), event: "Bokning skapad." }],
};
await storeFor("service_cases").setJSON(CASE_ID, original);

// 2. Simulera en samtidig PATCH: status + betalning ändras (t.ex. av admin).
const patched = {
  ...original,
  status: "done",
  payment: { status: "paid", amount: 1495 },
};
await storeFor("service_cases").setJSON(CASE_ID, patched);

// 3. Append:a ett timeline-event EFTER patchen (gamla koden hade här kunnat
//    skriva tillbaka en inaktuell version av caset).
const event = await appendCaseEvent({
  caseId: CASE_ID,
  type: "ai_suggestion",
  content: "AI skapade SMS-utkast (smoke).",
  createdBy: "smoke-test",
});

// 4. Verifiera: statusen och betalningen finns kvar — caset är HELT orört.
const after = await get("service_cases", CASE_ID);
assert(after?.status === "done", "status 'done' kvar efter timeline-event");
assert(after?.payment?.status === "paid" && after?.payment?.amount === 1495, "payment paid/1495 kvar");
assert(JSON.stringify(after) === JSON.stringify(patched), "case-blobben är byte-identisk (inga writes från appendCaseEvent)");

// 5. Verifiera: eventet finns i den separata case-events-storen.
const events = await list("case_events", { caseId: CASE_ID });
assert(events.some((e) => e.id === event.id && e.content.includes("smoke")), "timeline-eventet finns i case-events-storen");
assert(Boolean(event.caseId === CASE_ID && event.createdBy === "smoke-test"), "eventet har korrekt caseId/createdBy");

// 6. Städa upp lokal testdata.
await remove("service_cases", CASE_ID);
await remove("case_events", event.id);

if (failures) {
  console.error(`\n${failures} FAIL`);
  process.exit(1);
}
console.log("\nAlla smoke-kontroller godkända. Inga SMS/mail/production-writes.");
