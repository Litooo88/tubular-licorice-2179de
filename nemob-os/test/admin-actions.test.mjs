import test from "node:test";
import assert from "node:assert/strict";
import { runAdminAction } from "../lib/admin-actions.mjs";

const ENV = { NORDIC_ADMIN_TOKEN: "hemlig-token", NORDIC_SITE_URL: "https://admin.test" };
const ok = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

test("not_configured utan token — inget anrop görs", async () => {
  let called = false;
  const result = await runAdminAction("call", "case_1", {}, { env: {}, fetchImpl: async () => { called = true; } });
  assert.equal(result.status, "not_configured");
  assert.equal(called, false);
});

test("okänd åtgärd och ogiltigt id avvisas utan anrop", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  assert.equal((await runAdminAction("delete", "case_1", {}, { env: ENV, fetchImpl })).code, "unknown_action");
  assert.equal((await runAdminAction("call", "../admin", {}, { env: ENV, fetchImpl })).code, "invalid_case");
  assert.equal((await runAdminAction("sms", "case_1", { message: "  " }, { env: ENV, fetchImpl })).code, "missing_message");
  assert.equal(called, false);
});

test("ring: POST till exakt call-endpoint med token i header, aldrig i svaret", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return ok({ status: "calling", call: { id: "c1", to: "+46701234567" } })(); };
  const result = await runAdminAction("call", "case_2026-07-01_abc", {}, { env: ENV, fetchImpl });
  assert.equal(seen.url, "https://admin.test/api/cases/case_2026-07-01_abc/call");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["x-admin-token"], "hemlig-token");
  assert.deepEqual(JSON.parse(seen.init.body), { operator: "NEMOB OS" });
  assert.equal(result.status, "ok");
  assert.equal(result.result.call.id, "c1");
  assert.equal(JSON.stringify(result).includes("hemlig-token"), false);
});

test("sms: meddelandet skickas som generic med NEMOB OS som operatör", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return ok({ status: "sent", sms: { providerId: "s1" } })(); };
  const result = await runAdminAction("sms", "case_1", { message: "  Hej! Din scooter är klar.  " }, { env: ENV, fetchImpl });
  assert.equal(seen.url, "https://admin.test/api/cases/case_1/sms");
  assert.deepEqual(JSON.parse(seen.init.body), { message: "Hej! Din scooter är klar.", kind: "generic", operator: "NEMOB OS" });
  assert.equal(result.result.sms.providerId, "s1");
});

test("4xx från admin => rejected med adminens feltext (dubblettskydd)", async () => {
  const result = await runAdminAction("call", "case_1", {}, { env: ENV, fetchImpl: ok({ error: "Uppringning startades nyss (dubblettskydd)." }, 409) });
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "http_409");
  assert.match(result.error, /dubblettskydd/);
});

test("admin i safe-läge (not_configured i body) propageras", async () => {
  const result = await runAdminAction("call", "case_1", {}, { env: ENV, fetchImpl: ok({ status: "not_configured" }) });
  assert.equal(result.status, "not_configured");
});

test("timeout, 401 och 5xx => down med generisk kod", async () => {
  const timeout = async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; };
  assert.deepEqual(await runAdminAction("call", "case_1", {}, { env: ENV, fetchImpl: timeout }), { status: "down", code: "timeout" });
  assert.equal((await runAdminAction("call", "case_1", {}, { env: ENV, fetchImpl: ok({}, 401) })).code, "unauthorized");
  assert.equal((await runAdminAction("sms", "case_1", { message: "x" }, { env: ENV, fetchImpl: ok({}, 502) })).code, "http_502");
});
