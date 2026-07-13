import assert from "node:assert/strict";
import test from "node:test";

import voiceSimple from "../netlify/functions/voice-simple.mjs";

const ENV_KEYS = ["VOICE_WEBHOOK_SECRET", "VOICE_PRIMARY_NUMBER", "VOICE_SEBASTIAN_PHONE"];

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
  await withEnv({ VOICE_PRIMARY_NUMBER: "+46700000001" }, async () => {
    const response = await voiceSimple(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      connect: "+46700000001",
      timeout: 25,
    });
  });
});

test("requires the configured shared secret", async () => {
  await withEnv(
    { VOICE_PRIMARY_NUMBER: "+46700000001", VOICE_WEBHOOK_SECRET: "test-secret" },
    async () => {
      const denied = await voiceSimple(request());
      assert.equal(denied.status, 401);

      const allowed = await voiceSimple(request("?secret=test-secret"));
      assert.equal(allowed.status, 200);
      const action = await allowed.json();
      assert.equal(action.connect, "+46700000001");
      assert.match(action.whenhangup, /voice-notify\?secret=test-secret$/);
    },
  );
});

test("rejects the call if no forwarding number is configured", async () => {
  await withEnv({}, async () => {
    const response = await voiceSimple(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hangup: "reject",
      reason: "voice_primary_not_configured",
    });
  });
});
