import assert from "node:assert/strict";
import test from "node:test";

import { archivedCopy, isAutoArchiveCandidate, keepReason } from "../netlify/functions/_shared/auto-archive.mjs";

const NOW = new Date("2026-10-07T06:00:00Z").getTime();
const dagar = (n) => new Date(NOW - n * 86400000).toISOString();
const dod = (extra = {}) => ({
  id: "case_x",
  status: "new",
  createdAt: dagar(20),
  notes: [],
  smsLog: [],
  timeline: [
    { at: dagar(20), event: "Bokning skapad via hemsidan. Startansvar: Verkstaden" },
    { at: dagar(20), event: "SMS-bekraftelse skickad till kund." },
    { at: dagar(20), event: "Kalenderhandelse skapad for verkstaden." },
  ],
  preferredDate: dagar(18).slice(0, 16),
  ...extra,
});

test("en webbförfrågan som legat 20 dagar utan kontakt arkiveras", () => {
  assert.equal(keepReason(dod(), NOW), null);
  assert.equal(isAutoArchiveCandidate(dod(), NOW), true);
});

test("automatiska bekräftelser och svep-rensningens 'Oklart ursprung' räknas inte som kontakt", () => {
  const item = dod({
    notes: [{ at: dagar(10), text: "Oklart ursprung" }],
    timeline: [...dod().timeline, { at: dagar(10), event: "Uppdaterad av Sebastian: Oklart ursprung" }, { at: dagar(10), event: "Workshop flaggade: Needs Sebastian review" }],
  });
  assert.equal(keepReason(item, NOW), null);
});

test("yngre än 14 dagar lämnas kvar", () => {
  assert.equal(keepReason(dod({ createdAt: dagar(13) }), NOW), "för ungt");
  assert.equal(keepReason(dod({ createdAt: dagar(14) }), NOW), null);
});

test("varje form av verklig kontakt stoppar arkiveringen", () => {
  assert.equal(keepReason(dod({ smsLog: [{ at: dagar(5), kind: "draft-inbox" }] }), NOW), "sms");
  assert.equal(keepReason(dod({ customerUpdates: [{ at: dagar(5), text: "Vi har tittat" }] }), NOW), "kunduppdatering");
  assert.equal(keepReason(dod({ notes: [{ at: dagar(5), text: "Ringde, inget svar" }] }), NOW), "anteckning");
  assert.equal(keepReason(dod({ timeline: [...dod().timeline, { at: dagar(5), event: "Uppdaterad av Sebastian: väntar på kunden" }] }), NOW), "handling i tidslinjen");
  assert.equal(keepReason(dod({ statusUpdateRequestedAt: dagar(3) }), NOW), "kunden frågade nyss");
  assert.equal(keepReason(dod({ preferredDate: dagar(-3).slice(0, 16) }), NOW), "önskad dag i framtiden");
  assert.equal(keepReason(dod({ payment: { status: "paid" } }), NOW), "betalning");
});

test("bara status new berörs", () => {
  for (const status of ["contacted", "checked_in", "ready", "done", "archived"]) {
    assert.equal(keepReason(dod({ status }), NOW), "status");
  }
});

test("en gammal statusförfrågan från kunden skyddar inte för evigt", () => {
  assert.equal(keepReason(dod({ statusUpdateRequestedAt: dagar(30) }), NOW), null);
});

test("arkivkopian är spårbar och återställbar", () => {
  const kopia = archivedCopy(dod(), NOW);
  assert.equal(kopia.status, "archived");
  assert.equal(kopia.previousStatus, "new");
  assert.equal(kopia.autoArchived.days, 20);
  assert.match(kopia.notes.at(-1).text, /Auto-arkiverad: ny i 20 dagar/);
  assert.equal(kopia.timeline.length, dod().timeline.length + 1);
  assert.equal(kopia.id, "case_x");
});
