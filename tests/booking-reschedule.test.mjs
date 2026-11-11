// "Bekräfta annan tid": Sebastian flyttar en förfrågan i admin. Kunden ska få
// SMS + mejl med den NYA tiden, kalenderhändelsen flyttas och ärendet minns
// vilken tid kunden ursprungligen bad om. Lokal Blobs-server, 46elks och
// Resend mockade; inget lämnar maskinen.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getStore, setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";

import { calendarWindowFor, requestConfirmedEmail, requestRescheduledSms, stockholmNowLocal, validateNewTime } from "../netlify/functions/_shared/booking-request.mjs";

test("hjälpfunktioner: tidsvalidering, kalenderfönster, texter", () => {
  const now = new Date("2026-10-30T03:30:00Z"); // 04:30 svensk tid
  assert.equal(stockholmNowLocal(now), "2026-10-30T04:30");
  assert.deepEqual(validateNewTime("2026-10-30T15:00", now), { ok: true, value: "2026-10-30T15:00" });
  assert.equal(validateNewTime("2026-10-30T04:00", now).ok, false, "passerad");
  assert.equal(validateNewTime("2026-02-30T15:00", now).ok, false, "ogiltigt datum");
  assert.equal(validateNewTime("2027-03-01T15:00", now).ok, false, "mer än 90 dagar");
  assert.equal(validateNewTime("15:00", now).ok, false);
  assert.deepEqual(calendarWindowFor("2026-10-30T15:00", 30), {
    start: { dateTime: "2026-10-30T15:00:00", timeZone: "Europe/Stockholm" },
    end: { dateTime: "2026-10-30T15:30:00", timeZone: "Europe/Stockholm" },
  });
  assert.equal(calendarWindowFor("2026-10-30T23:45", 30).end.dateTime, "2026-10-31T00:15:00");
  const sms = requestRescheduledSms({ name: "Omar Ali", preferredDate: "2026-10-30T15:00", serviceNumber: "NE-1", statusLink: "https://x" });
  assert.match(sms, /^Hej Omar! Vi har bokat in dig på en ny tid hos Nordic E-Mobility: fre 30 okt 15:00\./);
  const mail = requestConfirmedEmail({ name: "Omar", preferredDate: "2026-10-30T15:00", previousDate: "2026-10-29T12:00", serviceNumber: "NE-1", statusLink: "https://x", address: "A", mapsLink: "https://m", changed: true });
  assert.match(mail.subject, /^Ny tid bokad: fre 30 okt 15:00/);
  assert.match(mail.html, /i stället för tors 29 okt 12:00/);
  assert.match(mail.text, /Tid: fre 30 okt 15:00/);
});

test("admin: bekräfta annan tid skickar SMS + mejl med nya tiden och flyttar kalendern", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-"));
  const server = new BlobsServer({ directory: dir, token: "mock", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site", token: "mock", edgeURL: url, uncachedEdgeURL: url });
  const realFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  Object.assign(process.env, { ADMIN_TOKEN: "adm", ELKS_USERNAME: "u", ELKS_PASSWORD: "p", RESEND_API_KEY: "re_test", EMAIL_FROM: "Nordic <info@x.se>" });
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  t.after(async () => { globalThis.fetch = realFetch; process.env = oldEnv; await server.stop(); await rm(dir, { recursive: true, force: true }); });

  const sms = [];
  const mails = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.includes("api.46elks.com")) { sms.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return ok({ id: "s1" }); }
    if (u.includes("api.resend.com")) { mails.push(JSON.parse(init.body)); return ok({ id: "m1" }); }
    return realFetch(input, init);
  };

  const day = stockholmNowLocal(new Date(Date.now() + 2 * 864e5)).slice(0, 10);
  await getStore({ name: "workshop-cases", consistency: "strong" }).setJSON("case_1", {
    id: "case_1", serviceNumber: "NE-4242", status: "contacted", preferredDate: `${day}T12:00`,
    bookingMode: "request", bookingRequest: { status: "pending", requestedAt: "x" },
    customer: { name: "Omar Ali", phone: "0701234567", email: "omar@example.com" },
    notifications: { calendar: { status: "created", id: "evt1", summary: "Ny verkstadsforfragan: Omar Ali" } }, timeline: [],
  });

  const { default: handler } = await import("../netlify/functions/workshop-cases.mjs");
  const patch = (body) => handler(new Request("https://x/api/cases/case_1", { method: "PATCH", headers: { "x-admin-token": "adm", "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: { id: "case_1" } });

  assert.equal((await patch({ action: "reschedule_booking_request", preferredDate: "2020-01-01T15:00" })).status, 400, "passerad tid avvisas");
  assert.equal(sms.length, 0);

  const res = await patch({ action: "reschedule_booking_request", preferredDate: `${day}T15:00`, operatorName: "Sebastian" });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.equal(out.case.preferredDate, `${day}T15:00`);
  assert.equal(out.case.bookingRequest.status, "confirmed");
  assert.equal(out.case.bookingRequest.requestedDate, `${day}T12:00`, "kundens önskade tid sparas");
  assert.ok(out.case.bookingRequest.rescheduledAt);
  assert.equal(sms.length, 1);
  assert.equal(sms[0].to, "+46701234567");
  assert.match(sms[0].message, /ny tid .*15:00/);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ["omar@example.com"]);
  assert.match(mails[0].subject, /^Ny tid bokad: .*15:00/);
  assert.equal(out.calendar.status, "not_configured");
  assert.ok(out.case.timeline.some((e) => /NY TID satt av Sebastian/.test(e.event)));
  assert.ok(out.case.timeline.some((e) => /Bekräftelsemejl skickat/.test(e.event)));

  // Redan bekräftad: kan flyttas igen, men inte "bekräftas" en gång till.
  assert.equal((await patch({ action: "confirm_booking_request" })).status, 409);
  const again = await (await patch({ action: "reschedule_booking_request", preferredDate: `${day}T16:30` })).json();
  assert.equal(again.case.preferredDate, `${day}T16:30`);
  assert.equal(again.case.bookingRequest.requestedDate, `${day}T12:00`, "ursprunglig önskan behålls vid andra flytten");
  assert.equal(sms.length, 2);
});
