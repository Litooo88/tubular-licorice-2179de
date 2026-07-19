import assert from "node:assert/strict";
import test from "node:test";

import voiceSimple, { isOfficeHours } from "../netlify/functions/voice-simple.mjs";

const ENV_KEYS = [
  "VOICE_WEBHOOK_SECRET",
  "VOICE_PRIMARY_NUMBER",
  "VOICE_SEBASTIAN_PHONE",
  "VOICE_FALLBACK_NUMBER",
  "VOICE_TEST_NOW",
  "VOICE_CLOSED_MP3_URL",
];

// Måndag 2026-07-20 kl 10:00 svensk tid = öppet; lördag 23:00 = stängt.
const OPEN_NOW = "2026-07-20T10:00:00+02:00";
const CLOSED_NOW = "2026-07-18T23:00:00+02:00";

const withEnv = async (values, callback) => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);

  try {
    await callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

const request = (query = "") =>
  new Request(`https://www.example.test/.netlify/functions/voice-simple${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "direction=incoming&callid=test-call&from=%2B46700000000&to=%2B46100000000",
  });

test("routes calls when the shared secret has not been configured yet", async () => {
  await withEnv({ VOICE_PRIMARY_NUMBER: "+46700000001", VOICE_TEST_NOW: OPEN_NOW }, async () => {
    const response = await voiceSimple(request());
    assert.equal(response.status, 200);
    const action = await response.json();
    assert.equal(action.connect, "+46700000001");
    assert.equal(action.timeout, 25);
    assert.match(action.next, /voice-simple\?step=fallback$/);
  });
});

test("requires the configured shared secret", async () => {
  await withEnv(
    { VOICE_PRIMARY_NUMBER: "+46700000001", VOICE_WEBHOOK_SECRET: "test-secret", VOICE_TEST_NOW: OPEN_NOW },
    async () => {
      const denied = await voiceSimple(request());
      assert.equal(denied.status, 401);

      const allowed = await voiceSimple(request("?secret=test-secret"));
      assert.equal(allowed.status, 200);
      const action = await allowed.json();
      assert.equal(action.connect, "+46700000001");
      assert.match(action.whenhangup, /voice-notify\?secret=test-secret$/);
      assert.match(action.next, /voice-simple\?step=fallback&secret=test-secret$/);
    },
  );
});

test("uses the emergency forwarding number if Netlify has no number configured", async () => {
  await withEnv({ VOICE_TEST_NOW: OPEN_NOW }, async () => {
    const response = await voiceSimple(request());
    assert.equal(response.status, 200);
    const action = await response.json();
    assert.equal(action.connect, "+46700243319");
  });
});

test("plays the outside-hours prompt when the workshop phone is closed", async () => {
  await withEnv({ VOICE_PRIMARY_NUMBER: "+46700000001", VOICE_TEST_NOW: CLOSED_NOW }, async () => {
    const response = await voiceSimple(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      play: "https://www.nordicemobility.se/audio/outside-hours-prompt.mp3",
    });
  });
});

test("fallback step connects the fallback number when configured", async () => {
  await withEnv(
    { VOICE_PRIMARY_NUMBER: "+46700000001", VOICE_FALLBACK_NUMBER: "+46700000002", VOICE_TEST_NOW: OPEN_NOW },
    async () => {
      const response = await voiceSimple(request("?step=fallback"));
      assert.equal(response.status, 200);
      const action = await response.json();
      assert.equal(action.connect, "+46700000002");
    },
  );
});

test("fallback step ends the call quietly when no fallback number is configured", async () => {
  await withEnv({ VOICE_PRIMARY_NUMBER: "+46700000001", VOICE_TEST_NOW: OPEN_NOW }, async () => {
    const response = await voiceSimple(request("?step=fallback"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
  });
});

test("isOfficeHours: helgdagar och helger är stängda, vardagar 9-18 öppna", () => {
  assert.equal(isOfficeHours(new Date("2026-07-20T10:00:00+02:00")), true); // måndag förmiddag
  assert.equal(isOfficeHours(new Date("2026-07-20T08:59:00+02:00")), false); // före öppning
  assert.equal(isOfficeHours(new Date("2026-07-20T18:00:00+02:00")), false); // efter stängning
  assert.equal(isOfficeHours(new Date("2026-07-18T12:00:00+02:00")), false); // lördag
  assert.equal(isOfficeHours(new Date("2026-12-24T12:00:00+01:00")), false); // julafton
});
