import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVoicemailNotification,
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
