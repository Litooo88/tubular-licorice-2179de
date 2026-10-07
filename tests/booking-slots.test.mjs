import test from "node:test";
import assert from "node:assert/strict";

import { buildDropoffDays, markFreeSlots } from "../netlify/functions/booking.mjs";

// Fast "nu": onsdag 2026-10-07 kl 12:00 svensk tid.
const NOW = { year: 2026, month: 10, day: 7, hour: 12, minute: 0 };

test("slots: bara tisdagar och torsdagar genereras", () => {
  const days = buildDropoffDays(NOW);
  assert.ok(days.length >= 9, `förväntade minst 9 dagar på 5 veckor, fick ${days.length}`);
  for (const day of days) {
    const [y, m, d] = day.date.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    assert.ok([2, 4].includes(weekday), `${day.date} är inte tis/tors`);
  }
});

test("slots: tider ligger 10:00-16:00 i halvtimmessteg", () => {
  const days = buildDropoffDays(NOW);
  for (const day of days) {
    for (const slot of day.slots) {
      const [hh, mm] = slot.time.split(":").map(Number);
      const minute = hh * 60 + mm;
      assert.ok(minute >= 600 && minute <= 960, `${day.date} ${slot.time} utanför fönstret`);
      assert.equal(mm % 30, 0);
      assert.ok(slot.endMs - slot.startMs === 30 * 60 * 1000);
    }
  }
});

test("slots: inga tider i dåtid (torsdag samma vecka börjar 10:00, onsdag 'idag' saknas)", () => {
  const days = buildDropoffDays(NOW);
  assert.ok(!days.some((day) => day.date === "2026-10-07"), "onsdagen ska inte finnas");
  const thursday = days.find((day) => day.date === "2026-10-08");
  assert.ok(thursday, "torsdag 8/10 ska finnas");
  assert.equal(thursday.slots[0].time, "10:00");
});

test("slots: samma dag filtrerar passerade tider", () => {
  const tuesdayNoon = { year: 2026, month: 10, day: 13, hour: 12, minute: 1 };
  const days = buildDropoffDays(tuesdayNoon);
  const today = days.find((day) => day.date === "2026-10-13");
  assert.ok(today, "tisdagen i dag ska finnas kvar med eftermiddagstider");
  assert.ok(today.slots.every((slot) => Number(slot.time.slice(0, 2)) * 60 + Number(slot.time.slice(3)) > 12 * 60));
});

test("markFreeSlots: upptaget intervall släcker överlappande slots, busy=null ger allt fritt", () => {
  const days = buildDropoffDays(NOW);
  const thursday = days.find((day) => day.date === "2026-10-08");
  const tenOClock = thursday.slots[0];
  // Upptaget 10:15-10:45 UTC-intervall relativt slotens egna ms — överlappar 10:00 och 10:30.
  const busy = [{ start: tenOClock.startMs + 15 * 60000, end: tenOClock.startMs + 45 * 60000 }];
  const marked = markFreeSlots(days, busy);
  const markedThursday = marked.find((day) => day.date === "2026-10-08");
  assert.equal(markedThursday.slots[0].free, false, "10:00 ska vara upptagen");
  assert.equal(markedThursday.slots[1].free, false, "10:30 ska vara upptagen");
  assert.equal(markedThursday.slots[2].free, true, "11:00 ska vara ledig");
  const unchecked = markFreeSlots(days, null);
  assert.ok(unchecked.every((day) => day.slots.every((slot) => slot.free)));
});
