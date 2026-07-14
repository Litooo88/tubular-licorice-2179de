import test from "node:test";
import assert from "node:assert/strict";
import {
  SessionStore,
  parseCookies,
  pinMatches,
  resolveAuthConfig,
  sessionCookie,
} from "../lib/auth.mjs";

test("loopback kräver ingen PIN (som förut)", () => {
  for (const host of ["127.0.0.1", "::1", "localhost", ""]) {
    const cfg = resolveAuthConfig({ NEMOB_OS_HOST: host });
    assert.equal(cfg.required, false, host);
    assert.equal(cfg.error, null);
  }
});

test("icke-loopback utan PIN vägrar starta (fail-safe)", () => {
  const cfg = resolveAuthConfig({ NEMOB_OS_HOST: "0.0.0.0" });
  assert.equal(cfg.required, true);
  assert.match(cfg.error, /NEMOB_OS_PIN/);
  const shortPin = resolveAuthConfig({ NEMOB_OS_HOST: "0.0.0.0", NEMOB_OS_PIN: "123" });
  assert.ok(shortPin.error, "för kort PIN ska också stoppas");
});

test("icke-loopback med giltig PIN aktiverar skyddet", () => {
  const cfg = resolveAuthConfig({ NEMOB_OS_HOST: "0.0.0.0", NEMOB_OS_PIN: "839217" });
  assert.equal(cfg.required, true);
  assert.equal(cfg.error, null);
  assert.equal(cfg.pin, "839217");
});

test("pinMatches: rätt/fel/tom/kort", () => {
  assert.equal(pinMatches("839217", "839217"), true);
  assert.equal(pinMatches("839218", "839217"), false);
  assert.equal(pinMatches("", "839217"), false);
  assert.equal(pinMatches("123", "123"), false, "PIN under minlängd får aldrig godkännas");
});

test("sessioner: skapas, valideras, går ut", () => {
  let now = 1_000_000;
  const sessions = new SessionStore(() => now);
  const token = sessions.create();
  assert.equal(sessions.isValid(token), true);
  assert.equal(sessions.isValid("påhittad"), false);
  now += 31 * 24 * 60 * 60 * 1000; // 31 dagar senare
  assert.equal(sessions.isValid(token), false, "utgången session ska nekas");
});

test("cookien är HttpOnly och innehåller aldrig PIN-värdet", () => {
  const cookie = sessionCookie("tok_abc");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(!cookie.includes("839217"));
  assert.deepEqual(parseCookies("a=1; nemob_session=tok_abc"), { a: "1", nemob_session: "tok_abc" });
});
