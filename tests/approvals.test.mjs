// GET /api/approvals: de tre godkännandekällorna blir en lista med pekare på
// de befintliga rutterna. Lokal Blobs-server, inga nätanrop, inget skickas.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./_blobs-test-env.mjs";
import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import { pinTestEnv } from "./_test-env.mjs";


import { bookingRequestItem, draftItem, smsItem } from "../netlify/functions/approvals.mjs";

test("byggare: sms/draft/booking_request får rätt kind, mottagare och rutter", () => {
  const sms = smsItem({ id: "2026-11-12T08-00_706666666_ab12", to: "0706666666", message: "Hej!", at: "2026-11-12T08:00:00.000Z", source: "nova", claimedAt: new Date().toISOString() });
  assert.equal(sms.kind, "sms");
  assert.equal(sms.to, "+46706666666");
  assert.equal(sms.sourceLabel, "Nova (mötesbekräftelse)");
  assert.equal(sms.inFlight, true);
  assert.deepEqual(sms.approve, { method: "POST", url: "/api/kommunikation/approve", body: { id: sms.id } });

  const draft = draftItem({ caseId: "case_1", linkedCaseId: "case_1", message: "Utkast", category: "A", meta: { namn: "Anna", telefon: "0705555555", tjanst: "Batteri", alderDagar: 3 }, importedAt: "2026-11-10T10:00:00.000Z", priority: 7 });
  assert.equal(draft.kind, "draft");
  assert.equal(draft.name, "Anna");
  assert.equal(draft.approve.url, "/api/sms-drafts/case_1/approve");
  assert.equal(draft.reject.url, "/api/sms-drafts/case_1/skip");
  assert.equal(draft.inFlight, false);

  const booking = bookingRequestItem({ id: "case_2", serviceNumber: "NE-2", preferredDate: "2026-11-20T18:30", service: "Punktering", vehicle: { model: "Kukirin G2" }, customer: { name: "Erik Ek", phone: "0704444444" }, bookingRequest: { status: "pending", requestedAt: "2026-11-11T20:00:00.000Z" }, createdAt: "2026-11-11T19:00:00.000Z" });
  assert.equal(booking.kind, "booking_request");
  assert.equal(booking.text, "Önskar 2026-11-20 18:30 · Punktering · Kukirin G2");
  assert.equal(booking.at, "2026-11-11T20:00:00.000Z");
  assert.deepEqual(booking.approve, { method: "PATCH", url: "/api/cases/case_2", body: { action: "confirm_booking_request" } });
  assert.equal(booking.reject.body.action, "decline_booking_request");
  assert.equal(booking.reschedule.body.action, "reschedule_booking_request");
});

test("GET /api/approvals: slår ihop källorna, sorterar längst väntande först, filtrerar på kind", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-appr-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  const restoreEnv = pinTestEnv();
  t.after(async () => { restoreEnv(); await server.stop(); await rm(dir, { recursive: true, force: true }); });

  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  await cases.setJSON("case_req", { id: "case_req", serviceNumber: "NE-10", status: "new", bookingMode: "request", bookingRequest: { status: "pending", requestedAt: "2026-11-10T09:00:00.000Z" }, preferredDate: "2026-11-18T10:00", service: "Service", customer: { name: "Omar", phone: "0706666666" }, createdAt: "2026-11-10T09:00:00.000Z" });
  await cases.setJSON("case_conf", { id: "case_conf", status: "new", bookingMode: "request", bookingRequest: { status: "confirmed" }, preferredDate: "2026-11-18T11:00", customer: { name: "Lisa", phone: "0707777777" } });
  await cases.setJSON("case_direct", { id: "case_direct", status: "repairing", bookingMode: "direct", customer: { name: "Nour", phone: "0701234567" } });
  const drafts = getStore({ name: "sms-drafts", consistency: "strong" });
  await drafts.setJSON("case_direct", { caseId: "case_direct", category: "B", message: "Hej Nour, vi återkommer.", meta: { namn: "Nour", telefon: "0701234567" }, importedAt: "2026-11-11T12:00:00.000Z" });
  await drafts.setJSON("legacy-1", { id: "legacy-1", caseId: "case_conf", message: "Gammalt format", to: "0707777777", createdAt: "2026-11-09T12:00:00.000Z" });
  await drafts.setJSON("tomt", { caseId: "x", message: "   " }); // ogiltigt utkast, ska filtreras
  const { queuePendingSms } = await import("../netlify/functions/_shared/comm-log.mjs");
  const queued = await queuePendingSms({ source: "sms-inbound", to: "0706666666", message: "Tack! Vi ringer upp dig inom 24 timmar." });

  const { default: handler } = await import("../netlify/functions/approvals.mjs");
  assert.equal((await handler(new Request("https://x/api/approvals"))).status, 401);
  assert.equal((await handler(new Request("https://x/api/approvals", { method: "POST", headers: { "x-admin-token": "adm" } }))).status, 405);
  assert.equal((await handler(new Request("https://x/api/approvals?kind=fel", { headers: { "x-admin-token": "adm" } }))).status, 400);

  const res = await handler(new Request("https://x/api/approvals", { headers: { "x-admin-token": "adm" } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.counts, { total: 4, sms: 1, draft: 2, booking_request: 1 });
  assert.deepEqual(body.sources, { sms: "ok", drafts: "ok", bookings: "ok" });
  assert.equal(body.partial, false);
  assert.equal(body.smsApproval.enabled, true, "spärren är på som standard");
  assert.deepEqual(body.items.map((i) => i.kind), ["draft", "booking_request", "draft", "sms"], "längst väntande först");
  const booking = body.items.find((i) => i.kind === "booking_request");
  assert.equal(booking.id, "case_req");
  assert.equal(booking.serviceNumber, "NE-10");
  const legacy = body.items.find((i) => i.id === "legacy-1");
  assert.equal(legacy.caseId, "case_conf", "gammalt utkastformat: nyckel = id, ärendet i caseId");
  assert.equal(legacy.to, "+46707777777");
  const sms = body.items.find((i) => i.kind === "sms");
  assert.equal(sms.id, queued.pendingId);
  assert.equal(sms.sourceLabel, "Autosvar på inkommande SMS");
  assert.equal(sms.inFlight, false);

  const only = await (await handler(new Request("https://x/api/approvals?kind=booking_request,sms&limit=1", { headers: { "x-admin-token": "adm" } }))).json();
  assert.equal(only.items.length, 1);
  assert.equal(only.counts.draft, 0);
  assert.equal(only.sources.drafts, "skipped");
  assert.equal(only.counts.booking_request, 1);
  assert.equal(only.counts.sms, 1);

  // Ingenting har skrivits: köerna är oförändrade.
  assert.equal((await drafts.list()).blobs.length, 3);
  assert.equal((await getStore({ name: "sms-pending", consistency: "strong" }).list()).blobs.length, 1);
});
