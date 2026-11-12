import assert from "node:assert/strict";
import test from "node:test";

import { attachInboundToCase, matchCaseByEmail, matchCaseByPhone } from "../netlify/functions/_shared/case-match.mjs";

const c = (id, status, phone, updatedAt, extra = {}) => ({ id, status, customer: { phone, email: extra.email || "" }, updatedAt, serviceNumber: `NE-${id}`, ...extra });

test("ett aktivt ärende på numret → matched", () => {
  const cases = [c("a", "repairing", "0704444444", "2026-11-01"), c("b", "done", "0704444444", "2026-10-01"), c("x", "repairing", "0705555555", "2026-11-05")];
  const m = matchCaseByPhone(cases, "+46704444444");
  assert.equal(m.status, "matched");
  assert.equal(m.caseId, "a");
  assert.equal(m.candidates[0].serviceNumber, "NE-a");
});

test("flera aktiva ärenden → ambiguous, inget kopplas", () => {
  const cases = [c("a", "repairing", "0704444444", "2026-11-01"), c("b", "new", "0704444444", "2026-11-10")];
  const m = matchCaseByPhone(cases, "0704444444");
  assert.equal(m.status, "ambiguous");
  assert.equal(m.caseId, "");
  assert.deepEqual(m.candidates.map((x) => x.id), ["b", "a"]);
});

test("bara avslutade ärenden → closed_only, inget kopplas", () => {
  const m = matchCaseByPhone([c("a", "done", "0704444444", "2026-11-01"), c("b", "archived", "0704444444", "2026-05-01")], "0704444444");
  assert.equal(m.status, "closed_only");
  assert.equal(m.caseId, "");
  assert.equal(m.candidates[0].id, "a");
});

test("okänt nummer eller tomt → none", () => {
  assert.equal(matchCaseByPhone([c("a", "new", "0704444444", "2026-11-01")], "0709999999").status, "none");
  assert.equal(matchCaseByPhone([c("a", "new", "0704444444", "2026-11-01")], "").status, "none");
});

test("e-post matchas skiftlägesokänsligt", () => {
  const cases = [c("a", "contacted", "", "2026-11-01", { email: "Erik@Example.se" })];
  assert.equal(matchCaseByEmail(cases, "erik@example.se").caseId, "a");
  assert.equal(matchCaseByEmail(cases, "inte-en-adress").status, "none");
});

test("attachInboundToCase: lägger till en gång, dubblett på providerId ger null", () => {
  const current = { id: "a", timeline: [{ at: "2026-11-01T00:00:00.000Z", event: "x" }] };
  const next = attachInboundToCase(current, { channel: "sms", from: "+46704444444", text: "Hej, är den klar?", at: "2026-11-11T10:00:00.000Z", providerId: "s123" });
  assert.equal(next.inboundMessages.length, 1);
  assert.equal(next.lastInboundAt, "2026-11-11T10:00:00.000Z");
  assert.match(next.timeline[1].event, /^SMS från kund mottaget: "Hej, är den klar\?"/);
  assert.equal(attachInboundToCase(next, { text: "igen", providerId: "s123" }), null);
  assert.equal(attachInboundToCase(next, { text: "igen", inboundKey: "k" }).inboundMessages.length, 2);
});
