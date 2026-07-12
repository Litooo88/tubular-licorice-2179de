import test from "node:test";
import assert from "node:assert/strict";
import { mapBrief } from "../lib/brief.mjs";

test("saknade fält blir present:false — aldrig falskt noll", () => {
  const brief = mapBrief({ generated_at: "2026-07-12T06:00:00.000Z" });
  assert.equal(brief.valid, true);
  assert.equal(brief.todaysBookings.present, false);
  assert.equal(brief.openJobsCount.present, false);
  assert.equal(brief.oldestOpenJob.present, false);
  assert.equal(brief.overdueOffersCount.present, false);
  assert.equal(brief.unpaidInvoicesCount.present, false);
  assert.equal(brief.weekRevenueSek.present, false);
  assert.equal(brief.newBookingsSinceYesterday.present, false);
});

test("äkta nollor bevaras som 0", () => {
  const brief = mapBrief({
    todays_bookings: [],
    open_jobs: [],
    overdue_offers_count: 0,
    unpaid_invoices_count: 0,
    week_revenue_sek: 0,
    new_bookings_since_yesterday: 0,
  });
  assert.equal(brief.overdueOffersCount.present, true);
  assert.equal(brief.overdueOffersCount.value, 0);
  assert.equal(brief.weekRevenueSek.value, 0);
  assert.equal(brief.openJobsCount.value, 0);
  // Tom lista = "inga öppna jobb", inte "Data saknas".
  assert.equal(brief.oldestOpenJob.present, true);
  assert.equal(brief.oldestOpenJob.value, null);
});

test("fullt payload mappas korrekt inkl. äldsta öppna jobb", () => {
  const brief = mapBrief({
    generated_at: "2026-07-12T06:00:00.000Z",
    todays_bookings: [{ time: "10:00", first_name: "Anna", vehicle: "Xiaomi Pro 2", case_type: "Punktering", status: "booked" }],
    open_jobs: [
      { id: "a", vehicle: "Ninebot Max", status: "in_progress", days_open: 9 },
      { id: "b", vehicle: "Vässla", status: "new", days_open: 2 },
    ],
    overdue_offers_count: 3,
    unpaid_invoices_count: 1,
    week_revenue_sek: 12400,
    new_bookings_since_yesterday: 4,
  });
  assert.equal(brief.todaysBookings.value.length, 1);
  assert.equal(brief.openJobsCount.value, 2);
  assert.equal(brief.oldestOpenJob.value.vehicle, "Ninebot Max");
  assert.equal(brief.oldestOpenJob.value.days_open, 9);
  assert.equal(brief.weekRevenueSek.value, 12400);
});

test("ogiltig payload flaggas som invalid", () => {
  assert.equal(mapBrief(null).valid, false);
  assert.equal(mapBrief("text").valid, false);
});

test("fel typ på fält behandlas som saknat, inte som värde", () => {
  const brief = mapBrief({ week_revenue_sek: "mycket", overdue_offers_count: -2 });
  assert.equal(brief.weekRevenueSek.present, false);
  assert.equal(brief.overdueOffersCount.present, false);
});
