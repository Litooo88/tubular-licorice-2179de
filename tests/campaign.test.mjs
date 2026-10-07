import assert from "node:assert/strict";
import test from "node:test";

import { campaignKey, filterRecipients, isGsm7, personalize, smsCost, smsParts } from "../netlify/functions/_shared/campaign.mjs";

test("svenska tecken är GSM-7, tankstreck och typografiska citattecken är det inte", () => {
  assert.equal(isGsm7("Hej! Vi såg att du sökt oss. Åäö ÅÄÖ é"), true);
  assert.equal(isGsm7("Tis–tors 10–16"), false);
  assert.equal(isGsm7("”hej”"), false);
});

test("deluppdelning: 160 GSM-7-tecken är en del, 161 är två; UCS-2 bryter vid 70", () => {
  assert.equal(smsParts("a".repeat(160)), 1);
  assert.equal(smsParts("a".repeat(161)), 2);
  assert.equal(smsParts("a".repeat(306)), 2);
  assert.equal(smsParts("a".repeat(307)), 3);
  assert.equal(smsParts("–" + "a".repeat(69)), 1);
  assert.equal(smsParts("–" + "a".repeat(70)), 2);
  assert.equal(smsParts("€".repeat(80) + "a"), 2); // utökade tecken räknas dubbelt
  assert.equal(smsParts(""), 0);
});

test("kostnaden följer uppmätt pris per del", () => {
  assert.equal(smsCost("a".repeat(100), 124), 64.48);
  assert.equal(smsCost("–" + "a".repeat(200), 1), 1.56); // 201 tecken UCS-2 = 3 delar
});

test("personalisering med namn och modell, med vettiga reserver när de saknas", () => {
  const mall = "Hej {namn}! Dags att vinterförvara din {modell}? Svara RING.";
  assert.equal(personalize(mall, { namn: "Maths Wersén", modell: "NAVEE GT3" }), "Hej Maths! Dags att vinterförvara din NAVEE GT3? Svara RING.");
  assert.equal(personalize(mall, { namn: "", modell: "" }), "Hej! Dags att vinterförvara ditt fordon? Svara RING.");
  assert.equal(personalize("Vi har {modell} inne.", {}), "Vi har fordonet inne.");
});

test("mottagarfiltret stoppar egna nummer, optout, spärrade, 30-dagarsspärr, dubbletter och icke-mobiler", () => {
  const now = new Date("2026-10-07T08:00:00Z").getTime();
  const dag = (n) => new Date(now - n * 86400000).toISOString();
  const r = filterRecipients({
    now,
    recipients: [
      { phone: "0760000001", namn: "A" },
      { phone: "+46760000001", namn: "A igen" },
      "+46760000002",
      { phone: "0760000003" },
      { phone: "0760000004" },
      { phone: "0760000005" },
      { phone: "0760000006" },
      { phone: "019123456" },
      { phone: "+442033189837" },
      { phone: "+46725751086" },
    ],
    ownNumbers: ["+46725751086"],
    optoutPhones: ["0760000003"],
    blockedPhones: ["+46760000004"],
    campaignSent: [
      { phone: "+46760000005", lastSentAt: dag(10) },
      { phone: "+46760000006", lastSentAt: dag(45) },
    ],
  });
  assert.deepEqual(r.ok.map((x) => x.phone), ["+46760000001", "+46760000002", "+46760000006"]);
  assert.equal(r.ok[0].namn, "A");
  assert.deepEqual(r.skipped, { dubblett: 1, optout: 1, sparrad: 1, kampanj_senaste_30d: 1, ej_svensk_mobil: 2, eget_nummer: 1 });
});

test("könyckeln är stabil per kampanj och nummer", () => {
  assert.equal(campaignKey("vinter-2026", "+46760000001"), "campaign-vinter-2026-46760000001");
  assert.equal(campaignKey("x y/z", "0760000001"), "campaign-xyz-0760000001");
});
