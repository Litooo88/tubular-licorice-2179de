import test from "node:test";
import assert from "node:assert/strict";
import { anonymizeForTest, extractRepairKnowledge } from "../scripts/lib/chatgpt-repair-extractor.mjs";

const message = (role, text, create_time) => ({
  message: { author: { role }, create_time, content: { parts: [text] } },
});

const conversations = [{
  id: "conv-battery-1",
  title: "Batteriproblem E-Wheels E2S V2",
  mapping: {
    a: message("user", "E-Wheels E2S V2 visar 17 V och laddar inte. Jag mätte B+ till B- 41.3 V och B- till P- 1.4 V.", 1),
    b: message("assistant", "Mät varje cellgrupp och kontrollera BMS samt nickelremsor. Testa även P- mot B-.", 2),
    c: message("user", "Jag hittade felet, det var en bruten nickelremsa. Jag svetsade dit en ny och nu fungerar batteriet.", 3),
  },
}];

test("extraherar bekräftat repair-case med stabila tekniska fält", () => {
  const records = extractRepairKnowledge(conversations);
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.brand, "e_wheels");
  assert.match(record.model, /E2S/i);
  assert.equal(record.status, "confirmed_fix");
  assert.equal(record.confidence, "high");
  assert.equal(record.likelyRootCause, "battery_cell");
  assert.equal(record.confirmedRootCause, "battery_cell");
  assert.ok(record.symptoms.some((item) => /laddar inte/i.test(item)));
  assert.ok(record.testsPerformed.some((item) => /mät/i.test(item)));
  assert.match(record.resolution, /bruten nickelremsa/i);
  assert.ok(record.voltages.includes("41.3 v"));
});

test("ignorerar vanliga konversationer utan tillräcklig verkstadsrelevans", () => {
  const records = extractRepairKnowledge([{
    id: "conv-food",
    title: "Middag",
    mapping: { a: message("user", "Vad ska vi äta ikväll?", 1), b: message("assistant", "Pasta.", 2) },
  }]);
  assert.deepEqual(records, []);
});

test("automatisk redaktion tar e-post, telefon och personnummer", () => {
  const result = anonymizeForTest("Kund: test@example.com 070-123 45 67 850101-1234");
  assert.equal(result.text, "Kund: [email] [phone] [personnummer]");
});
