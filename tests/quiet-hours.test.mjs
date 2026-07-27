import assert from "node:assert/strict";
import test from "node:test";

import { isQuietHour, nextOptimalSendAt } from "../netlify/functions/_shared/quiet-hours.mjs";

// Fasta tidpunkter i UTC — sommartid (CEST = UTC+2) i juli.
const at = (iso) => new Date(iso);

test("isQuietHour: natt och tidig morgon är tyst, dagtid inte", () => {
  assert.equal(isQuietHour(at("2026-07-24T01:00:00Z")), true); // 03:00 Sthlm
  assert.equal(isQuietHour(at("2026-07-24T05:30:00Z")), true); // 07:30 Sthlm
  assert.equal(isQuietHour(at("2026-07-24T06:00:00Z")), false); // 08:00 Sthlm
  assert.equal(isQuietHour(at("2026-07-24T12:00:00Z")), false); // 14:00 Sthlm
  assert.equal(isQuietHour(at("2026-07-24T19:00:00Z")), true); // 21:00 Sthlm
});

test("nextOptimalSendAt: nattstängning skickas kl 10 samma förmiddag", () => {
  // Ärende stängs 02:30 Sthlm → skicka 10:00 Sthlm samma dag (08:00 UTC).
  const sendAt = new Date(nextOptimalSendAt(at("2026-07-24T00:30:00Z")));
  assert.equal(sendAt.toISOString(), "2026-07-24T08:00:00.000Z");
});

test("nextOptimalSendAt: kvällsstängning skickas kl 10 nästa dag", () => {
  // Ärende stängs 22:15 Sthlm → skicka 10:00 Sthlm dagen därpå.
  const sendAt = new Date(nextOptimalSendAt(at("2026-07-24T20:15:00Z")));
  assert.equal(sendAt.toISOString(), "2026-07-25T08:00:00.000Z");
});

test("nextOptimalSendAt: träffar alltid klockan 10 svensk tid", () => {
  const hourInSthlm = (d) =>
    Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(d));
  for (const iso of ["2026-07-24T21:59:00Z", "2026-12-24T23:10:00Z", "2026-03-28T22:00:00Z"]) {
    assert.equal(hourInSthlm(new Date(nextOptimalSendAt(at(iso)))), 10, iso);
  }
});
