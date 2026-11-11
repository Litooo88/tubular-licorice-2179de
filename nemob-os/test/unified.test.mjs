import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCases, fetchCommunication, readUnifiedPlanning } from "../lib/unified.mjs";

test("case overview filters closed cases and does not return raw customer/payment details", () => {
  const result = summarizeCases({ status: "ok", cases: [
    { id: "a", status: "ready", payment: { status: "unpaid", secret: "hidden" }, customer: { phone: "hidden" } },
    { id: "b", source: "website-booking", preferredDate: "2026-11-11T12:00", bookingRequest: { status: "pending" } },
    { id: "c", status: "archived", workshop: { needsSebastianReview: true } },
    { id: "e", source: "website-booking", preferredDate: "2026-11-09T12:00", bookingRequest: { status: "pending" } },
    { id: "f", source: "website-booking", preferredDate: "2026-11-11T14:00", bookingRequest: { status: "confirmed" } },
    { id: "d", source: "website-booking", preferredDate: "2026-11-10T12:00" },
  ] }, new Date("2026-11-10T23:30:00Z"));
  assert.equal(result.open, 5);
  assert.equal(result.readyUnpaid, 1);
  assert.equal(result.upcoming, 1);
  assert.equal(result.pending, 2);
  assert.equal(result.decisions[0].id, "b");
  assert.deepEqual(result.bookingQueue.map((row) => row.id), ["e", "b"]);
  assert.deepEqual(result.bookings.map((row) => [row.id, row.confirmed]), [["f", true]]);
  assert.doesNotMatch(JSON.stringify(result), /hidden/);
  assert.deepEqual(summarizeCases({ status: "down", cases: [{}] }), { status: "down" });
});

test("communication uses authenticated GET and returns only the selected queue metadata", async () => {
  const data = await fetchCommunication({
    env: { NORDIC_ADMIN_TOKEN: "synthetic-token" },
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname + url.search, "/api/kommunikation?days=7");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["x-admin-token"], "synthetic-token");
      return Response.json({
        contacts: [{ name: "Testkund", waiting: true, waitingHours: 8.5, phone: "hidden" }],
        counts: { waiting: 1 }, pending: [{ body: "hidden" }],
        today: { nova: { smsOut: 0, callsIn: 0, chats: 0 } },
        sources: { elksCalls: "unreachable", elksSms: "ok" },
      });
    },
  });
  assert.deepEqual(data, {
    status: "ok", partial: true, waiting: 1, pending: 1, contacts: [{ name: "Testkund", hours: 8 }],
    nova: { smsOut: 0, callsIn: 0, chats: 0 },
  });
  const shouldNotCall = () => assert.fail("Unexpected fetch");
  assert.deepEqual(await fetchCommunication({ env: {}, fetchImpl: shouldNotCall }), { status: "not_configured" });
  assert.deepEqual(await fetchCommunication({ env: { NORDIC_ADMIN_TOKEN: "test", NORDIC_SITE_URL: "http://example.invalid" },
    fetchImpl: shouldNotCall }), { status: "down" });
});

test("private planning shows at most three priorities and keeps the full task list", () => {
  const result = readUnifiedPlanning([
    { title: "Done", status: "klar" },
    ...Array.from({ length: 4 }, (_, i) => ({ title: String(i), status: "ny", pinned: i === 3 })),
  ]);
  assert.equal(result.tasks.length, 5);
  assert.equal(result.priorities.length, 3);
  assert.equal(result.priorities[0].title, "3");
});
