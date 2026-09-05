import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVoicemailNotification,
  isTranscriptEcho,
  classifyVoicemail,
  normalizeVoicemailPhone,
  safeElksRecordingUrl,
  summarizeVoicemail,
  voicemailAiEnabledForCaller,
  voicemailInternalSmsEnabled,
} from "../netlify/functions/_shared/voicemail-analysis.mjs";

test("godkänner bara autentiserbara 46elks-inspelningsadresser", () => {
  assert.equal(
    safeElksRecordingUrl("https://api.46elks.com/a1/recordings/c361e5927d2c4d7dcf71a142dc0ec6d9b-r0.wav"),
    "https://api.46elks.com/a1/recordings/c361e5927d2c4d7dcf71a142dc0ec6d9b-r0.wav",
  );
  assert.equal(safeElksRecordingUrl("https://example.test/a1/recordings/fake.wav"), "");
  assert.equal(safeElksRecordingUrl("http://api.46elks.com/a1/recordings/fake.wav"), "");
  assert.equal(safeElksRecordingUrl("https://api.46elks.com/a1/me"), "");
});

test("normaliserar svenskt kundnummer", () => {
  assert.equal(normalizeVoicemailPhone("070-123 45 67"), "+46701234567");
  assert.equal(normalizeVoicemailPhone("0046 70 123 45 67"), "+46701234567");
});

test("säkerhets- och reklamationsord kräver mänsklig kontroll", () => {
  const result = classifyVoicemail({ transcript: "Batteriet ryker och är väldigt varmt, ring mig nu direkt." });
  assert.equal(result.priority, "urgent");
  assert.equal(result.requiresHumanReview, true);
  assert.ok(result.reasons.includes("batteri/säkerhet"));
});

test("befintlig verkstadskund prioriteras som åtgärd", () => {
  const result = classifyVoicemail({
    transcript: "Hej, jag undrar hur det går.",
    customerMatch: { matched: true, customerName: "Testkund" },
  });
  assert.equal(result.priority, "action");
  assert.ok(result.reasons.includes("befintlig kund"));
});

test("tomt testmeddelande filtreras som låg prioritet", () => {
  const result = classifyVoicemail({ transcript: "Test." });
  assert.equal(result.priority, "low");
  assert.equal(result.requiresHumanReview, false);
});

test("sammanfattning och internnotis är korta och handlingsbara", () => {
  const summary = summarizeVoicemail("Jag vill boka service för min elscooter. Ring gärna upp mig efter klockan tre.");
  const classification = classifyVoicemail({ transcript: summary });
  const message = buildVoicemailNotification({
    caller: "+46701234567",
    summary,
    classification,
    customerMatch: { matched: false },
    lineLabel: "Privatlinjen",
  });
  assert.match(message, /ÅTGÄRD/);
  assert.match(message, /Privatlinjen/);
  assert.ok(message.length <= 918);
});

test("testnummer begränsar AI utan att aktivera intern-SMS", () => {
  const previous = {
    enabled: process.env.VOICEMAIL_AI_ENABLED,
    caller: process.env.VOICEMAIL_AI_TEST_CALLER,
    sms: process.env.VOICEMAIL_INTERNAL_SMS_ENABLED,
  };
  process.env.VOICEMAIL_AI_ENABLED = "true";
  process.env.VOICEMAIL_AI_TEST_CALLER = "+46701234567";
  delete process.env.VOICEMAIL_INTERNAL_SMS_ENABLED;
  try {
    assert.equal(voicemailAiEnabledForCaller("070-123 45 67"), true);
    assert.equal(voicemailAiEnabledForCaller("070-999 99 99"), false);
    assert.equal(voicemailInternalSmsEnabled(), false);
  } finally {
    if (previous.enabled === undefined) delete process.env.VOICEMAIL_AI_ENABLED;
    else process.env.VOICEMAIL_AI_ENABLED = previous.enabled;
    if (previous.caller === undefined) delete process.env.VOICEMAIL_AI_TEST_CALLER;
    else process.env.VOICEMAIL_AI_TEST_CALLER = previous.caller;
    if (previous.sms === undefined) delete process.env.VOICEMAIL_INTERNAL_SMS_ENABLED;
    else process.env.VOICEMAIL_INTERNAL_SMS_ENABLED = previous.sms;
  }
});

// Rotorsak till de tre oanvandbara sammanfattningarna i augusti: pa tyst ljud
// ekade transkriberingsmodellen tillbaka domanprompten eller vart eget telesvar.
test("ekad domanprompt och egen halsningsfras raknas inte som kundens meddelande", () => {
  assert.equal(isTranscriptEcho("Svenskt telesvar till en elscooterverkstad."), true);
  assert.equal(isTranscriptEcho("Svenskt telesvar till en elscooterverkstad. Vanliga ord: Nordic E-Mobility, elscooter."), true);
  assert.equal(isTranscriptEcho("Hej, du har kommit till Nordic E-Mobilitys elscooterverkstad i Örebro."), true);
  assert.equal(isTranscriptEcho("Du hör en automatisk röst från Nordic E-Mobility."), true);
});

test("riktiga kundmeddelanden slipper igenom eko-vakten", () => {
  assert.equal(isTranscriptEcho("Hej, jag heter Anna och min elscooter startar inte. Ring gärna upp."), false);
  assert.equal(isTranscriptEcho("Batteriet är väldigt varmt och ryker."), false);
  assert.equal(isTranscriptEcho("Jag vill boka service för min elscooter i Örebro."), false);
  assert.equal(isTranscriptEcho(""), false);
});

// Produktionsfynd 2/9 och 3/9: modellen ekade bara ordlistan ur prompten, inte
// hela meningen — den varianten slank igenom forsta versionen av vakten.
test("eko av enbart ordlistan ur prompten fangas ocksa", () => {
  assert.equal(isTranscriptEcho("Nordic E-Mobility, elscooter, batteri, BMS, däck, broms, laddare, bokning och Örebro."), true);
  assert.equal(isTranscriptEcho("elscooter, batteri, BMS, däck"), true);
  assert.equal(isTranscriptEcho("Jag har en elscooter med trasigt batteri och vill boka tid i Örebro."), false);
});

// "Hej, Sabina." var hela sammanfattningen 4/9 — sjalva arendet (bakdack pa en
// Kugerin G2 Pro) och aterunppringningsnumret lag i mening tva och tre.
test("sammanfattningen tar med hela arendet, inte bara forsta meningen", () => {
  const transcript = "Hej, Sabina. Ring mig på 0735-140494. Jag undrar om ni kan byta ett bakdäck på en Kugerin G2 Pro. Tack.";
  const summary = summarizeVoicemail(transcript);
  assert.match(summary, /0735-140494/);
  assert.match(summary, /bakdäck/);
  assert.ok(summary.length <= 240, "far inte spranga 240 tecken");
});

test("lang transkribering kapas utan att spranga gransen", () => {
  const long = "Hej det är Anders. ".repeat(40);
  const summary = summarizeVoicemail(long);
  assert.ok(summary.length <= 240, `for lang: ${summary.length}`);
  assert.ok(summary.startsWith("Hej det är Anders."));
});
