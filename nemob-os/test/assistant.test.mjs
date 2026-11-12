import assert from "node:assert/strict";
import test from "node:test";
import { readAssistant } from "../lib/assistant.mjs";

test("assistant uses the documented gateway tool and projects customer results", async () => {
  const result = await readAssistant("customers", "Test", {
    env: { NEMOB_GATEWAY_TOKEN: "fixture-token" },
    fetchImpl: async (url, request) => {
      assert.equal(url.pathname, "/api/ai/tools/search_customer");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.Authorization, "Bearer fixture-token");
      assert.equal(request.redirect, "error");
      assert.deepEqual(JSON.parse(request.body), { query: "Test", limit: 25 });
      return Response.json({ status: "ok", truncated: true, cases: [
        { serviceNumber: "NE-1", customer: { name: "Test", email: "hidden" } },
      ] });
    },
  });
  assert.deepEqual(result, { status: "ok", partial: true, rows: [["NE-1", "Test"]] });
});

test("assistant rejects writes and distinguishes missing credentials from refused access", async () => {
  const never = () => assert.fail("Unexpected Gateway call");
  assert.deepEqual(await readAssistant("set_presence", "", { fetchImpl: never }), { status: "invalid" });
  assert.deepEqual(await readAssistant("presence", "", { env: {}, fetchImpl: never }), { status: "not_configured" });
  assert.deepEqual(await readAssistant("presence", "", {
    env: { NEMOB_GATEWAY_TOKEN: "fixture-token" },
    fetchImpl: async () => new Response(null, { status: 403 }),
  }), { status: "forbidden" });
});
