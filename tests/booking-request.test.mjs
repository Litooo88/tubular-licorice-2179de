import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_MODES, formatRequestedTime, isPendingRequest, requestConfirmedSms, requestDeclinedSms, requestReceivedSms } from "../netlify/functions/_shared/booking-request.mjs";
import { isRetiredStaffNumber, readEnv, SEBASTIAN_MOBILE } from "../netlify/functions/_shared/env.mjs";

test("förfrågan: texterna säger aldrig 'bokad' förrän Sebastian bekräftat", () => {
  const args = { name: "Anna Andersson", preferredDate: "2026-10-28T13:00", serviceNumber: "NE-2001", statusLink: "https://x/status/?service=NE-2001" };
  const received = requestReceivedSms(args);
  assert.match(received, /^Hej Anna!/);
  assert.match(received, /INTE bokad/);
  assert.match(received, /ons 28 okt 13:00/);
  assert.match(received, /Kom inte förrän/);
  assert.doesNotMatch(received, /är bokad/);
  const confirmed = requestConfirmedSms(args);
  assert.match(confirmed, /nu bekräftad: ons 28 okt 13:00/);
  assert.match(confirmed, /NE-2001/);
  const declined = requestDeclinedSms({ ...args, bookingUrl: "https://x/book-online/" });
  assert.match(declined, /kan vi inte ta emot dig ons 28 okt 13:00/);
  assert.match(declined, /tisdag och torsdag 15–20/);
  assert.equal(formatRequestedTime("trasigt"), "tid saknas");
  assert.equal(isPendingRequest({ bookingMode: BOOKING_MODES.request, bookingRequest: { status: "pending" } }), true);
  assert.equal(isPendingRequest({ bookingMode: BOOKING_MODES.request, bookingRequest: { status: "confirmed" } }), false);
  assert.equal(isPendingRequest({ bookingMode: BOOKING_MODES.direct }), false);
});

test("env: pensionerade personalnummer filtreras bort, övriga nycklar rörs inte", () => {
  const old = { ...process.env };
  try {
    process.env.VOICE_PRIMARY_NUMBER = "+46725751086";
    process.env.WORKSHOP_SMS_TO = "0725751086, +46700243319";
    process.env.VOICE_NOTIFY_TO = "+46701112233";
    process.env.ELKS_USERNAME = "+46725751086";
    delete process.env.SEBASTIAN_SMS_TO;
    assert.equal(isRetiredStaffNumber("072-575 10 86"), true);
    assert.equal(readEnv("VOICE_PRIMARY_NUMBER"), SEBASTIAN_MOBILE, "bara pensionerat => Sebastians mobil");
    assert.equal(readEnv("WORKSHOP_SMS_TO"), "+46700243319");
    assert.equal(readEnv("VOICE_NOTIFY_TO"), "+46701112233");
    assert.equal(readEnv("SEBASTIAN_SMS_TO"), "", "osatt förblir osatt");
    assert.equal(readEnv("ELKS_USERNAME"), "+46725751086", "inte en personalnyckel");
  } finally {
    process.env = old;
  }
});
