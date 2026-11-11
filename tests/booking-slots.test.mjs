import test from "node:test";
import assert from "node:assert/strict";

import { buildDropoffDays, classifyCalendarEvents, isBaselineSlot, markFreeSlots, OPEN_EVENT_RE } from "../netlify/functions/booking.mjs";

// Fast "nu": onsdag 2026-10-07 kl 12:00 svensk tid.
const NOW = { year: 2026, month: 10, day: 7, hour: 12, minute: 0 };
const weekdayOf = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const minuteOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

test("slots: alla veckodagar genereras, 12:00-20:00 i halvtimmessteg", () => {
  const days = buildDropoffDays(NOW);
  assert.equal(days.length, 35, "35 dagar framåt, inklusive i dag (eftermiddagstider kvar)");
  const weekdays = new Set(days.map((d) => weekdayOf(d.date)));
  assert.equal(weekdays.size, 7);
  for (const day of days) {
    for (const slot of day.slots) {
      const minute = minuteOf(slot.time);
      assert.ok(minute >= 720 && minute <= 1200, `${day.date} ${slot.time} utanför fönstret`);
      assert.equal(minute % 30, 0);
      assert.equal(slot.endMs - slot.startMs, 30 * 60 * 1000);
    }
  }
  const thursday = days.find((d) => d.date === "2026-10-08");
  assert.equal(thursday.slots.length, 17);
});

test("slots: grundtider tis/tors 15-20 är markerade baseline, inget annat", () => {
  const days = buildDropoffDays(NOW);
  for (const day of days) {
    const wd = weekdayOf(day.date);
    for (const slot of day.slots) {
      const expected = [2, 4].includes(wd) && minuteOf(slot.time) >= 900;
      assert.equal(slot.baseline, expected, `${day.date} ${slot.time}`);
    }
  }
  assert.equal(isBaselineSlot(2, 15 * 60), true);
  assert.equal(isBaselineSlot(2, 14 * 60 + 30), false);
  assert.equal(isBaselineSlot(3, 15 * 60), false);
  assert.equal(isBaselineSlot(4, 20 * 60), true);
});

test("slots: inga tider i dåtid, samma dag bara framtida tider", () => {
  const days = buildDropoffDays(NOW);
  const today = days.find((d) => d.date === "2026-10-07");
  assert.ok(today, "onsdagen i dag ska finnas med eftermiddagstider");
  assert.equal(today.slots[0].time, "12:30");
  const late = buildDropoffDays({ year: 2026, month: 10, day: 7, hour: 20, minute: 5 });
  assert.ok(!late.some((d) => d.date === "2026-10-07"), "efter 20:00 finns inga tider kvar i dag");
});

test("markFreeSlots: utan kalender är grundtiderna direktbokning och allt annat förfrågan", () => {
  const marked = markFreeSlots(buildDropoffDays(NOW), null);
  for (const day of marked) {
    const wd = weekdayOf(day.date);
    for (const slot of day.slots) {
      const baseline = [2, 4].includes(wd) && minuteOf(slot.time) >= 900;
      assert.equal(slot.free, true, `${day.date} ${slot.time} ska vara ledig (inget upptaget känt)`);
      assert.equal(slot.mode, baseline ? "direct" : "request", `${day.date} ${slot.time}`);
    }
  }
});

test("markFreeSlots: 'Öppet' öppnar andra tider, upptaget stänger även grundtider", () => {
  const days = buildDropoffDays(NOW);
  const friday = days.find((d) => d.date === "2026-10-09");
  const thursday = days.find((d) => d.date === "2026-10-08");
  const at = (day, time) => day.slots.find((s) => s.time === time);
  // Öppet fredag 13:00-16:00, upptagen torsdag 15:15-15:45.
  const windows = {
    open: [{ start: at(friday, "13:00").startMs, end: at(friday, "16:00").startMs }],
    busy: [{ start: at(thursday, "15:00").startMs + 15 * 60000, end: at(thursday, "15:00").startMs + 45 * 60000 }],
  };
  const marked = markFreeSlots(days, windows);
  const fri = marked.find((d) => d.date === "2026-10-09");
  const get = (day, time) => day.slots.find((s) => s.time === time);
  // Fredag utanför Öppet: ledig men bara som förfrågan.
  assert.deepEqual([get(fri, "12:30").free, get(fri, "12:30").mode], [true, "request"]);
  assert.deepEqual([get(fri, "13:00").free, get(fri, "13:00").mode], [true, "direct"]);
  assert.deepEqual([get(fri, "15:30").free, get(fri, "15:30").mode], [true, "direct"]);
  assert.equal(get(fri, "16:00").mode, "request", "slutet på Öppet-fönstret är exklusivt");
  const thu = marked.find((d) => d.date === "2026-10-08");
  assert.equal(get(thu, "15:00").free, false, "upptagen");
  assert.equal(get(thu, "15:30").free, false, "upptagen");
  assert.deepEqual([get(thu, "16:00").free, get(thu, "16:00").mode], [true, "direct"]);
  assert.deepEqual([get(thu, "14:30").free, get(thu, "14:30").mode], [true, "request"], "utanför grundtiderna och inget Öppet: förfrågan");
});

test("classifyCalendarEvents: Öppet-titlar, upptagna, lediga (transparent), heldag, avbokade", () => {
  const { open, busy } = classifyCalendarEvents([
    { summary: "Öppet verkstad", start: { dateTime: "2026-10-09T13:00:00+02:00" }, end: { dateTime: "2026-10-09T16:00:00+02:00" } },
    { summary: "open", start: { dateTime: "2026-10-10T12:00:00+02:00" }, end: { dateTime: "2026-10-10T14:00:00+02:00" } },
    { summary: "Ny verkstadsforfragan: Kund", start: { dateTime: "2026-10-08T15:00:00+02:00" }, end: { dateTime: "2026-10-08T15:30:00+02:00" } },
    { summary: "Check-in", transparency: "transparent", start: { dateTime: "2026-10-08T15:30:00+02:00" }, end: { dateTime: "2026-10-08T15:45:00+02:00" } },
    { summary: "Semester", start: { date: "2026-10-12" }, end: { date: "2026-10-13" } },
    { summary: "Avbokad", status: "cancelled", start: { dateTime: "2026-10-08T16:00:00+02:00" }, end: { dateTime: "2026-10-08T17:00:00+02:00" } },
    { summary: "Möte om öppettider", start: { dateTime: "2026-10-08T17:00:00+02:00" }, end: { dateTime: "2026-10-08T18:00:00+02:00" } },
  ], "Europe/Stockholm");
  assert.equal(open.length, 2);
  assert.equal(busy.length, 3, "kundbokning, heldag semester, mötet (transparent check-in och avbokad räknas inte)");
  const semester = busy.find((b) => b.end - b.start === 24 * 3600e3);
  assert.ok(semester, "heldag = hela dygnet");
  assert.equal(new Date(semester.start).toISOString(), "2026-10-11T22:00:00.000Z");
  assert.equal(OPEN_EVENT_RE.test("Oppet 12-20"), true);
  assert.equal(OPEN_EVENT_RE.test("Upptagen"), false);
});
