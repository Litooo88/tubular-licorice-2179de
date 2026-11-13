import test from "node:test";
import assert from "node:assert/strict";
import { resetCasesCache } from "../lib/admin-cases.mjs";
import { readRingContact, readRingList, reviewWorkshopReport, saveReportCase, updateRingContact } from "../lib/workspace-actions.mjs";

const id = "t_" + "a".repeat(20);
const phone = "+46700000000";
const item = {
  id: "case_test", status: "new", customer: { name: "Testkund", phone },
  serviceNumber: "V-1042", vehicle: { model: "G2 Pro" },
  bookingRequest: { status: "confirmed", decidedAt: "2026-11-13T08:15:00Z" },
  preferredDate: "2026-11-16T14:30",
};
const task = { id, kind: "callback", status: "proposed", customer: { phone }, caseId: item.id,
  sources: [{ source: "nova-call", sourceId: "conv_exact" }] };
const response = (body, etag = "", status = 200) => Response.json(body, { status, headers: etag ? { ETag: etag } : {} });
function mocked(handler) {
  return {
    env: { NORDIC_SITE_URL: "https://example.test", NORDIC_ADMIN_TOKEN: "test-only" },
    fetchImpl: async (url, req) => {
      assert.equal(req.headers["x-admin-token"], "test-only");
      assert.equal(req.redirect, "error");
      return handler(new URL(url).pathname, req);
    },
  };
}

test("ringlist keeps the booking creation time separate from the appointment and never preloads transcripts", async () => {
  resetCasesCache();
  const result = await readRingList(mocked((path) => {
    if (path === "/api/cases") return response({ cases: [item] });
    assert.equal(path, "/api/task-inbox/call-list");
    return response({ items: [{ taskId: id, phone, caseId: item.id, receivedAt: "2026-11-13T07:42:00Z", status: "selected" }],
      totalOpen: 1, sources: { ringList: "ok" } });
  }));
  assert.equal(result.status, "ok");
  assert.equal(result.rows[0].bookedAt, "2026-11-13T08:15:00Z");
  assert.equal(result.rows[0].confirmed, "2026-11-16T14:30");
  assert.equal(result.rows[0].receivedAt, "2026-11-13T07:42:00Z");
  assert.equal(result.rows[0].selected, true);
  resetCasesCache();
});

test("Nova transcript matches the task's number, prioritizes the exact call and excludes tests", async () => {
  const result = await readRingContact(id, mocked((path) => {
    if (path === "/api/task-inbox/" + id) return response(task);
    if (path === "/api/cases/" + item.id) return response(item);
    assert.equal(path, "/api/nova");
    return response({ calls: [
      { id: "other_customer", phone: "+46700000001", kind: "inbound", transcript: "Annan kund" },
      { id: "another", phone: "070-000 00 00", kind: "outbound", at: "2026-11-13T10:00:00Z", transcript: "Nova: Uppföljning" },
      { id: "conv_exact", phone, kind: "inbound", at: "2026-11-13T07:42:00Z", transcript: "Kund: Hej\nNova: Hej" },
      { id: "test", phone, kind: "test", transcript: "Test" },
    ] });
  }));
  assert.deepEqual(result.calls.map((call) => call.id), ["conv_exact", "another"]);
  assert.equal(result.calls[0].transcript, "Kund: Hej\nNova: Hej");
  assert.equal(result.case.id, item.id);
});

test("personal selection uses the task version and ring status uses the server-side phone", async () => {
  const options = mocked((path, req) => {
    if (req.method === "GET") return response(task, '"task-version"');
    if (path.endsWith("/select")) {
      assert.equal(req.headers["If-Match"], '"task-version"');
    } else {
      assert.equal(path, "/api/task-inbox/call-list/%2B46700000000/status");
      assert.equal(JSON.parse(req.body).taskId, id);
      assert.equal(JSON.parse(req.body).status, "handled_other");
    }
    return response({ ok: true });
  });
  assert.equal((await updateRingContact(id, { action: "select" }, options)).status, "ok");
  assert.equal((await updateRingContact(id, { action: "handled_other", phone: "do not trust" }, options)).status, "ok");
});

test("report review distinguishes similar models and leaves multiple customer matches for the operator", async () => {
  resetCasesCache();
  const models = [
    item,
    { ...item, id: "case_2", vehicle: { model: "E2S V2 Pro LR" } },
    { ...item, id: "case_3", vehicle: { model: "E2S V2 Pro LR" } },
    { ...item, id: "case_4", vehicle: { model: "E2S V2" } },
  ];
  const result = await reviewWorkshopReport("Tog emot en G2 Pro. Påbörjade motorbyte på en E2S V2 Pro LR.", mocked((path, req) => {
    assert.equal(req.method, "GET");
    assert.equal(path, "/api/cases");
    return response({ cases: models });
  }));
  assert.equal(result.proposals[0].status, "checked_in");
  assert.deepEqual(result.proposals[0].candidates.map((row) => row.id), [item.id]);
  assert.equal(result.proposals[1].status, "repairing");
  assert.deepEqual(result.proposals[1].candidates.map((row) => row.id), ["case_2", "case_3"]);
  resetCasesCache();
});

test("report save refuses stale versions, sends only status and internal note, and returns the confirmed case", async () => {
  let patches = 0;
  const options = mocked((path, req) => {
    assert.equal(path, "/api/cases/" + item.id);
    if (req.method === "GET") return response(item, '"case-v2"');
    patches++;
    assert.equal(req.method, "PATCH");
    assert.equal(req.headers["If-Match"], '"case-v2"');
    assert.deepEqual(JSON.parse(req.body), { operatorName: "NEMOB OS", note: "Motorbyte påbörjat", status: "repairing" });
    return response({ ok: true, case: { ...item, status: "repairing" } });
  });
  const input = { id: item.id, note: "Motorbyte påbörjat", status: "repairing", version: '"case-v2"', paymentStatus: "paid" };
  assert.equal((await saveReportCase({ ...input, version: '"case-v1"' }, options)).status, "conflict");
  assert.equal((await saveReportCase({ ...input, status: "done" }, options)).status, "invalid");
  assert.equal((await saveReportCase(input, options)).case.status, "repairing");
  assert.equal(patches, 1);
});
