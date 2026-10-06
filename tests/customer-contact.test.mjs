import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACT_TEMPLATES,
  buildContactDigest,
  buildMessage,
  parseApprovalReply,
  requiresApproval,
} from "../netlify/functions/_shared/customer-contact.mjs";

const kund = { namn: "Anna Gidmo", modell: "Kukirin M4 Max" };

test("nivå 1-mallar får skickas utan godkännande", () => {
  for (const id of ["mottagen", "status", "klar", "bokad", "aterkoppling"]) {
    const dom = requiresApproval(id, { ...kund, status: "vi väntar på ett däck" });
    assert.equal(dom.approval, false, `${id} skulle vara autoskick, blev: ${dom.reason}`);
  }
});

test("nivå 2-mallar kräver alltid godkännande", () => {
  for (const id of ["pris", "batteri", "fritext"]) {
    assert.equal(requiresApproval(id, { ...kund, pris: 300, text: "hej" }).approval, true, id);
  }
});

// Säkerhetsreglerna: pris över 995 kr, rabatt, garanti, batteri och
// reklamation kräver godkännande. Kontrollen ska träffa även när mallen i sig
// är ofarlig — en "statusuppdatering" som nämner garanti är ingen rutinnotis.
test("riskord i texten tvingar fram godkännande även i en nivå 1-mall", () => {
  const garanti = requiresApproval("status", { ...kund, status: "det här täcks av garantin" });
  assert.equal(garanti.approval, true);
  assert.match(garanti.reason, /garanti/i);

  const batteri = requiresApproval("status", { ...kund, status: "batteriet är utbytt" });
  assert.equal(batteri.approval, true);

  const gratis = requiresApproval("status", { ...kund, status: "vi gör det kostnadsfritt" });
  assert.equal(gratis.approval, true);
});

test("pris över 995 kr kräver godkännande oavsett mall", () => {
  assert.equal(requiresApproval("klar", { ...kund, pris: 996 }).approval, true);
  assert.equal(requiresApproval("klar", { ...kund, pris: 995 }).approval, false);
});

test("okänd mall faller till godkännande, inte till autoskick", () => {
  assert.equal(requiresApproval("hittepa", kund).approval, true);
});

test("meddelandet namnger kunden, fordonet och företaget", () => {
  const text = buildMessage("klar", kund);
  assert.match(text, /Hej Anna/);
  assert.match(text, /Kukirin M4 Max/);
  assert.match(text, /Nordic E-Mobility/);
  assert.ok(text.length <= 900);
});

// Utan modell ska det stå "ditt fordon", inte "din" med ett tomrum efter.
// Kunderna lämnar in både scootrar och cyklar, så frasen måste passa båda.
test("saknat namn och modell ger fortfarande en läsbar mening", () => {
  const text = buildMessage("mottagen", {});
  assert.equal(text, "Hej! Vi har tagit emot ditt fordon i verkstaden. Vi hör av oss så snart vi vet vad som behövs. /Nordic E-Mobility");
  assert.doesNotMatch(text, /undefined|null|din /);
});

test("klar-mallen får stor bokstav på frasen när den inleder meningen", () => {
  assert.match(buildMessage("klar", { modell: "Navee GT3" }), /! Din Navee GT3 är klar/);
  assert.match(buildMessage("klar", {}), /! Ditt fordon är klar/);
});

test("inlämningsmallen tar med grannen bara när ett namn finns", () => {
  assert.match(buildMessage("inlamning", { ...kund, grannnamn: "Mohamed" }), /granne Mohamed/);
  assert.doesNotMatch(buildMessage("inlamning", kund), /granne/);
});

test("alla mallar producerar text utan att krascha på tom kontext", () => {
  for (const id of Object.keys(CONTACT_TEMPLATES)) {
    const text = buildMessage(id, {});
    assert.equal(typeof text, "string");
  }
});

// Svarstolkningen är det som gör att ett ja kan ges utan att öppna admin.
test("godkännanden via sms tolkas rätt", () => {
  assert.deepEqual(parseApprovalReply("1 ok"), { kind: "ok", index: 1 });
  assert.deepEqual(parseApprovalReply("1ok"), { kind: "ok", index: 1 });
  assert.deepEqual(parseApprovalReply("2 JA"), { kind: "ok", index: 2 });
  assert.deepEqual(parseApprovalReply("3 skicka"), { kind: "ok", index: 3 });
  assert.deepEqual(parseApprovalReply("alla ok"), { kind: "ok", all: true });
  assert.deepEqual(parseApprovalReply("ok alla"), { kind: "ok", all: true });
  assert.deepEqual(parseApprovalReply("2 nej"), { kind: "nej", index: 2 });
  assert.deepEqual(parseApprovalReply("4 skippa"), { kind: "nej", index: 4 });
  assert.deepEqual(parseApprovalReply("1 ändra: ring mig först"), { kind: "andra", index: 1, text: "ring mig först" });
  assert.deepEqual(parseApprovalReply("1 andra ring mig först"), { kind: "andra", index: 1, text: "ring mig först" });
});

// Kritiskt: ett kundsvar får ALDRIG tolkas som ett godkännande. "1" betyder
// RING i kundflödet, och fri text är bara fri text.
test("kundsvar och skräp tolkas inte som godkännande", () => {
  for (const text of ["1", "RING", "STOPP", "ok", "ja", "nej", "", "   ", "hej vad kostar ett bakdäck?", "1 ändra:", "ändra 1"]) {
    assert.equal(parseApprovalReply(text), null, `"${text}" tolkades som kommando`);
  }
});

test("digesten håller sig kort och numrerar raderna", () => {
  const drafts = Array.from({ length: 7 }, (_, i) => ({
    message: "x".repeat(300),
    rubrik: "Statusuppdatering",
    meta: { namn: `Kund ${i + 1}`, telefon: "+46700000000" },
  }));
  const text = buildContactDigest({ drafts, now: new Date("2026-10-06T08:20:00Z") });
  assert.match(text, /7 sms-utkast väntar/);
  assert.match(text, /\(\+2 fler i mejlet\)/);
  assert.match(text, /1\. Kund 1 - Statusuppdatering/);
  assert.match(text, /5\. Kund 5/);
  assert.doesNotMatch(text, /6\. Kund 6/, "bara fem rader ska med i SMS:et");
  assert.ok(text.length < 460, `digesten blev ${text.length} tecken - för dyr som SMS`);
});

test("tom kö ger inget digest-sms", () => {
  assert.equal(buildContactDigest({ drafts: [] }), null);
  assert.equal(buildContactDigest({}), null);
});
