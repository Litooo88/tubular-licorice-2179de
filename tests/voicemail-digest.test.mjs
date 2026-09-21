import test from "node:test";
import assert from "node:assert/strict";

import { buildDigestMessage } from "../netlify/functions/voicemail-digest.mjs";
import { normalizeBlockPhone } from "../netlify/functions/_shared/call-blocklist.mjs";

const item = (priority, caller, summary, extra = {}) => ({
  caller,
  summary,
  createdAt: "2026-09-21T05:00:00.000Z",
  classification: { priority },
  ...extra,
});

test("digest: null när det varken finns nya eller ohanterade", () => {
  assert.equal(buildDigestMessage({ fresh: [], unhandledCount: 0 }), null);
});

test("digest: VIKTIGT sorteras före ÅTGÄRD och LÅG", () => {
  const message = buildDigestMessage({
    fresh: [item("low", "+46700000001", "lågt"), item("urgent", "+46700000002", "bråttom"), item("action", "+46700000003", "boka")],
    unhandledCount: 3,
  });
  const urgentIndex = message.indexOf("VIKTIGT");
  const actionIndex = message.indexOf("ÅTGÄRD");
  const lowIndex = message.indexOf("LÅG");
  assert.ok(urgentIndex > -1 && actionIndex > -1 && lowIndex > -1);
  assert.ok(urgentIndex < actionIndex && actionIndex < lowIndex);
});

test("digest: kundnamn följer med och nummer kortas till fyra sista", () => {
  const message = buildDigestMessage({
    fresh: [item("urgent", "+46706866777", "batteriet laddar inte", { customerMatch: { matched: true, customerName: "Anna Svensson" } })],
    unhandledCount: 1,
  });
  assert.match(message, /\.\.\.6777 \(Anna Svensson\)/);
  assert.match(message, /batteriet laddar inte/);
});

test("digest: fler än fem poster klipps med hänvisning till admin", () => {
  const fresh = Array.from({ length: 8 }, (_, i) => item("action", `+467000000${i}`, `ärende ${i}`));
  const message = buildDigestMessage({ fresh, unhandledCount: 8 });
  assert.match(message, /och 3 till i admin/);
  assert.ok(message.length <= 450);
});

test("digest: bara ohanterad kö utan nya ger ändå påminnelse", () => {
  const message = buildDigestMessage({ fresh: [], unhandledCount: 12 });
  assert.match(message, /Ohanterade totalt: 12/);
});

test("blocklist: normalisering hanterar 07-, 46- och +46-format", () => {
  assert.equal(normalizeBlockPhone("0707984552"), "+46707984552");
  assert.equal(normalizeBlockPhone("46707984552"), "+46707984552");
  assert.equal(normalizeBlockPhone("+46707984552"), "+46707984552");
  assert.equal(normalizeBlockPhone("070-798 45 52"), "+46707984552");
  assert.equal(normalizeBlockPhone(""), "");
});
