import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { banner, beslutsstod, loadBatteriref, searchRows } from "../lib/batteriref.mjs";

const DATA = {
  version: "2026-08-03",
  status: "INTERNT REFERENSMATERIAL - inte automatisk offert. Publiceras aldrig.",
  prisfaktor: 0.9,
  regler: ["Referensen är inte ett löfte."],
  prisrader: [
    { kategori: "Elcykel", modell: "ECORIDE 2016-2023", variant: "P11", tjanst: "13.5Ah = 20% extra kapacitet = 4100 kr", bdMin: 4100, bdMax: 4100, nordicMin: 3690, nordicMax: 3690, status: "Referens - ej offert", risk: "Normal referens" },
    { kategori: "Elcykel", modell: "PROTANIUM", variant: "", tjanst: "10Ah = 15% extra kapacitet = 3600 kr", bdMin: 3600, bdMax: 3600, nordicMin: 3240, nordicMax: 3240, status: "Referens - ej offert", risk: "Smart/BMS – kalkyl" },
    { kategori: "Elmoped", modell: "NIU 4803", variant: "", tjanst: "Full cellrenovering", bdMin: 11900, bdMax: 11900, nordicMin: 10710, nordicMax: 10710, status: "Referens - ej offert", risk: "Smart/BMS – kalkyl" },
  ],
  niu4803: { prisstege: [{ steg: 1, atgard: "Diagnos", nordicPris: 695 }], kundformulering: "text", publikaFall: [], identifiering: {} },
  balanseringsregel: [{ kontroll: "Gruppspänning", gront: "ok", gult: "obalans", rott: "2 V avvikelse", atgard: "övervakat", varfor: "..." }],
};

test("utan sökväg => not_configured, trasig fil => unreadable", () => {
  assert.equal(loadBatteriref("").status, "not_configured");
  assert.equal(loadBatteriref(undefined).status, "not_configured");
  const dir = mkdtempSync(join(tmpdir(), "batteriref-"));
  try {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "inte json");
    assert.equal(loadBatteriref(bad).status, "unreadable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sökning: alla ord måste träffa, modellträff rankas först", () => {
  const hits = searchRows(DATA, "ecoride 13.5");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].nordicMin, 3690);
  const niu = searchRows(DATA, "niu");
  assert.equal(niu.length, 1);
  assert.equal(niu[0].modell, "NIU 4803");
  assert.deepEqual(searchRows(DATA, ""), []);
  assert.deepEqual(searchRows(DATA, "xiaomi"), []);
});

test("komma i sökningen matchar punkt i datan (13,5 = 13.5)", () => {
  assert.equal(searchRows(DATA, "13,5").length, 1);
});

test("bannern följer alltid med och beslutsstödet exponerar reglerna", () => {
  assert.match(banner(DATA), /INTERNT REFERENSMATERIAL/);
  const b = beslutsstod(DATA);
  assert.equal(b.balanseringsregel.length, 1);
  assert.equal(b.niu4803.prisstege[0].nordicPris, 695);
  assert.equal(b.prisfaktor, 0.9);
});
