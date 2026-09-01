import { getStore } from "@netlify/blobs";

const clean = (value, max = 2000) => String(value || "").trim().slice(0, max);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

export const normalizeVoicemailPhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

export const safeElksRecordingUrl = (value) => {
  try {
    const url = new URL(clean(value, 500));
    if (url.protocol !== "https:" || url.hostname !== "api.46elks.com") return "";
    if (!/^\/a1\/recordings\/[a-z0-9_-]+\.wav$/i.test(url.pathname)) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
};

const URGENT_RULES = [
  ["batteri/säkerhet", /\b(brand|brinner|brann|r[oö]k|ryker|explod|svull|v[aä]ldigt varm|kortslut|gnistor?|farlig|farligt)\b/i],
  ["olycka/personskada", /\b(olycka|krock|personskad|skadade mig|ambulans|sjukhus)\b/i],
  ["reklamation/missnöje", /\b(reklamation|garanti|konsumentverket|polisanm[aä]l|advokat|missn[oö]jd|arg|ers[aä]ttning)\b/i],
  ["uttalat brådskande", /\b(akut|br[aå]ttom|omedelbart|nu direkt|ring mig snarast|måste ha (den|det) idag)\b/i],
];

const ACTION_RULES = [
  ["bokning/tid", /\b(boka|bokning|inl[aä]mning|h[aä]mta|upph[aä]mtning|tid|öppettid)\b/i],
  ["verkstadsärende", /\b(repar|service|elscooter|scooter|d[aä]ck|broms|motor|batteri|ladd|felkod|startar inte)\b/i],
  ["pris/order", /\b(pris|kostar|offert|best[aä]ll|k[oö]pa|reservdel|leverans)\b/i],
  ["kontaktbegäran", /\b(ring upp|ring mig|återkom|kontakta|svara|telefon)\b/i],
];

const LOW_VALUE_PATTERN = /^(hej|hall[åo]|tjena|test|ingenting|fel nummer|ringde fel|tack)[.!?\s]*$/i;

export const summarizeVoicemail = (transcript, max = 240) => {
  const normalized = clean(transcript, 4000).replace(/\s+/g, " ");
  if (!normalized) return "Ingen tydlig talad information kunde transkriberas.";
  const sentence = normalized.match(/^.{1,320}?(?:[.!?](?:\s|$)|$)/)?.[0] || normalized;
  return sentence.length <= max ? sentence : `${sentence.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

export const classifyVoicemail = ({ transcript, customerMatch = null } = {}) => {
  const text = clean(transcript, 6000).replace(/\s+/g, " ");
  const urgentReasons = URGENT_RULES.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
  const actionReasons = ACTION_RULES.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
  const meaningfulWords = text.split(/\s+/).filter((word) => word.replace(/[^a-zåäö0-9]/gi, "").length >= 3);

  if (urgentReasons.length) {
    const safety = urgentReasons.includes("batteri/säkerhet") || urgentReasons.includes("olycka/personskada");
    return {
      priority: "urgent",
      label: "VIKTIGT",
      reasons: urgentReasons,
      requiresHumanReview: true,
      suggestedAction: safety ? "Läs och ring upp omgående. Gör ingen automatisk teknisk bedömning." : "Läs och följ upp samma dag.",
    };
  }

  if (customerMatch?.matched || actionReasons.length || meaningfulWords.length >= 6) {
    return {
      priority: "action",
      label: customerMatch?.matched ? "KUND – ÅTGÄRD" : "ÅTGÄRD",
      reasons: [...new Set([...(customerMatch?.matched ? ["befintlig kund"] : []), ...actionReasons])],
      requiresHumanReview: true,
      suggestedAction: customerMatch?.matched ? "Öppna kundkortet och följ upp." : "Bedöm och återkoppla när du kan.",
    };
  }

  return {
    priority: "low",
    label: "LÅG PRIORITET",
    reasons: LOW_VALUE_PATTERN.test(text) || meaningfulWords.length < 2 ? ["för lite information"] : ["ingen tydlig åtgärd"],
    requiresHumanReview: false,
    suggestedAction: "Ingen direkt åtgärd föreslås. Finns kvar i admin för kontroll.",
  };
};

export const buildVoicemailNotification = ({ caller, summary, classification, customerMatch, lineLabel = "Nordic" }) => {
  const customer = customerMatch?.matched
    ? `${clean(customerMatch.customerName, 80) || "Befintlig kund"}${customerMatch.model ? `, ${clean(customerMatch.model, 80)}` : ""}`
    : "Okänt nummer / inget kundkort";
  return clean([
    `[${clean(lineLabel, 40)} AI • ${classification.label}] Telesvar från ${clean(caller, 40) || "okänt nummer"}.`,
    customer,
    clean(summary, 260),
    classification.suggestedAction,
  ].join("\n"), 918);
};

const configuredTestCallers = () => new Set(
  clean(env("VOICEMAIL_AI_TEST_CALLER"), 400)
    .split(/[,;\s]+/)
    .map(normalizeVoicemailPhone)
    .filter(Boolean),
);

export const voicemailAiEnabledForCaller = (caller) => {
  if (clean(env("VOICEMAIL_AI_ENABLED"), 20).toLowerCase() !== "true") return false;
  const allowlist = configuredTestCallers();
  return !allowlist.size || allowlist.has(normalizeVoicemailPhone(caller));
};

export const voicemailInternalSmsEnabled = () =>
  clean(env("VOICEMAIL_INTERNAL_SMS_ENABLED"), 20).toLowerCase() === "true";

const allStoreKeys = async (store) => {
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined);
    keys.push(...(page.blobs || []).map((item) => item.key).filter(Boolean));
    cursor = page.cursor;
  } while (cursor);
  return keys;
};

const readStoreItems = async (store, keys, concurrency = 25) => {
  const items = [];
  for (let index = 0; index < keys.length; index += concurrency) {
    const chunk = keys.slice(index, index + concurrency);
    const values = await Promise.all(chunk.map((key) => store.get(key, { type: "json" }).catch(() => null)));
    items.push(...values.filter(Boolean));
  }
  return items;
};

const findCustomerMatch = async (callerRaw) => {
  const caller = normalizeVoicemailPhone(callerRaw);
  if (!caller) return { matched: false };
  try {
    const store = getStore({ name: "workshop-cases", consistency: "strong" });
    const items = await readStoreItems(store, await allStoreKeys(store));
    const matches = items
      .filter((item) => normalizeVoicemailPhone(item?.customer?.phone) === caller)
      .sort((left, right) => {
        const leftActive = ["done", "archived"].includes(left?.status) ? 0 : 1;
        const rightActive = ["done", "archived"].includes(right?.status) ? 0 : 1;
        if (leftActive !== rightActive) return rightActive - leftActive;
        return String(right?.updatedAt || right?.createdAt || "").localeCompare(String(left?.updatedAt || left?.createdAt || ""));
      });
    const item = matches[0];
    if (!item) return { matched: false };
    return {
      matched: true,
      caseId: clean(item.id, 180),
      customerName: clean(item.customer?.name, 120),
      service: clean(item.service, 160),
      model: clean(item.vehicle?.model, 160),
      caseStatus: clean(item.status, 60),
    };
  } catch (error) {
    console.warn("voicemail_customer_match_failed", { message: clean(error?.message, 180) });
    return { matched: false, sourceUnavailable: true };
  }
};

const downloadElksRecording = async (recordingUrl) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  if (!username || !password) throw new Error("elks_credentials_missing");
  const response = await fetch(recordingUrl, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`recording_download_http_${response.status}`);
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (declaredBytes > 12 * 1024 * 1024) throw new Error("recording_too_large");
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error("recording_empty");
  if (buffer.byteLength > 12 * 1024 * 1024) throw new Error("recording_too_large");
  return buffer;
};

// Transkriberingsmodellen får en domänprompt för att stava verkstadsorden rätt.
// Priset: på tyst ljud hittar modellen inget tal och ekar i stället tillbaka
// prompten eller vår egen hälsningsfras — det blev "sammanfattningar" som
// beskrev vårt eget telesvar i stället för kundens ärende (3 av 8 i augusti).
// Ekot filtreras bort här och behandlas som "inget tal", vilket är sanningen.
const TRANSCRIPTION_PROMPT =
  "Svenskt telesvar till en elscooterverkstad. Vanliga ord: Nordic E-Mobility, elscooter, batteri, BMS, däck, broms, laddare, bokning och Örebro.";

const OUR_OWN_VOICE_PATTERNS = [
  /du har kommit till nordic/i,
  /elscooterverkstad(en)? i örebro/i,
  /lämna ett meddelande efter pipet/i,
  /du hör en automatisk röst/i,
  /utanför våra öppettider/i,
  /tryck fyrkant när du är klar/i,
];

const compare = (value) => clean(value, 8000).toLowerCase().replace(/[^a-zåäö0-9]+/g, " ").trim();

export const isTranscriptEcho = (text) => {
  const normalized = compare(text);
  if (!normalized) return false;
  const prompt = compare(TRANSCRIPTION_PROMPT);
  if (normalized === prompt || prompt.startsWith(normalized) || normalized.startsWith(prompt)) return true;
  return OUR_OWN_VOICE_PATTERNS.some((pattern) => pattern.test(clean(text, 8000)));
};

const transcribeVoicemail = async (audioBuffer) => {
  const apiKey = clean(env("OPENAI_API_KEY"), 300);
  if (!apiKey) return { status: "not_configured", text: "", model: "" };
  const model = clean(env("OPENAI_TRANSCRIPTION_MODEL"), 100) || "gpt-4o-mini-transcribe";
  const form = new FormData();
  form.set("file", new Blob([audioBuffer], { type: "audio/wav" }), "voicemail.wav");
  form.set("model", model);
  form.set("language", "sv");
  form.set("response_format", "json");
  form.set("prompt", TRANSCRIPTION_PROMPT);
  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`transcription_http_${response.status}`);
    const text = clean(body.text, 8000);
    if (isTranscriptEcho(text)) return { status: "no_speech", text: "", model, echo: true };
    return { status: text ? "complete" : "no_speech", text, model };
  } catch (error) {
    return { status: "failed", text: "", model, error: clean(error?.message, 180) };
  }
};

const retentionDays = () => Math.min(Math.max(Number(env("VOICEMAIL_TRANSCRIPT_RETENTION_DAYS")) || 30, 7), 90);

const purgeOldVoicemailAnalyses = async (store) => {
  try {
    const cutoff = Date.now() - retentionDays() * 24 * 60 * 60 * 1000;
    const items = await readStoreItems(store, await allStoreKeys(store));
    const expiredIds = items
      .filter((item) => new Date(item?.createdAt || 0).getTime() < cutoff)
      .map((item) => clean(item.id || item.callId, 180))
      .filter(Boolean);
    await Promise.all(expiredIds.map((id) => store.delete(id).catch(() => {})));
  } catch (error) {
    console.warn("voicemail_retention_cleanup_failed", { message: clean(error?.message, 180) });
  }
};

export const processVoicemailAnalysis = async ({ payload = {}, source = "workshop-line", lineLabel = "Nordic", notify = null } = {}) => {
  const callId = clean(payload.callid || payload.id, 180);
  const recordingUrl = safeElksRecordingUrl(payload.wav);
  const caller = normalizeVoicemailPhone(payload.from) || clean(payload.from, 40) || "okänt nummer";
  if (!callId || !recordingUrl) return { status: "invalid_callback", callId, caller };

  const store = getStore({ name: "voicemail-analysis", consistency: "strong" });
  const existing = await store.get(callId, { type: "json" }).catch(() => null);
  if (["complete", "no_speech"].includes(existing?.status)) return { status: "already_processed", item: existing };
  if (existing?.status === "processing" && Date.now() - new Date(existing.updatedAt || 0).getTime() < 10 * 60 * 1000) {
    return { status: "already_processing", item: existing };
  }

  const now = new Date().toISOString();
  const createdAt = Number.isFinite(new Date(payload.created).getTime()) ? new Date(payload.created).toISOString() : now;
  const base = {
    id: callId,
    callId,
    caller,
    createdAt,
    updatedAt: now,
    durationSeconds: Math.max(0, Number(payload.duration) || 0),
    recordingUrl,
    status: "processing",
    source: clean(source, 60) || "workshop-line",
    lineLabel: clean(lineLabel, 60) || "Nordic",
    rawAudioStored: false,
    handled: false,
    expiresAt: new Date(new Date(createdAt).getTime() + retentionDays() * 24 * 60 * 60 * 1000).toISOString(),
  };
  await store.setJSON(callId, base);

  const customerMatch = await findCustomerMatch(caller);
  let transcription;
  // Under 2 sekunder finns inget meddelande att transkribera — kunden la på i
  // hälsningen. Att fråga modellen ändå kostar pengar och ger bara hallucination.
  if (base.durationSeconds > 0 && base.durationSeconds < 2) {
    transcription = { status: "no_speech", text: "", model: "", tooShort: true };
  } else {
    try {
      transcription = await transcribeVoicemail(await downloadElksRecording(recordingUrl));
    } catch (error) {
      transcription = { status: "failed", text: "", model: "", error: clean(error?.message, 180) };
    }
  }

  if (["not_configured", "failed"].includes(transcription.status)) {
    const failed = {
      ...base,
      updatedAt: new Date().toISOString(),
      status: transcription.status,
      transcript: "",
      summary: "Automatisk transkribering kunde inte köras. Lyssna på originalinspelningen.",
      customerMatch,
      transcription: { status: transcription.status, model: transcription.model || "", error: transcription.error || "" },
      notification: { status: "fallback_required" },
    };
    await store.setJSON(callId, failed);
    await purgeOldVoicemailAnalyses(store);
    return { status: transcription.status, item: failed };
  }

  const summary = transcription.status === "no_speech"
    ? "Inget meddelande lämnades — bara tystnad spelades in. Numret finns: ring upp."
    : summarizeVoicemail(transcription.text);
  const classification = classifyVoicemail({ transcript: transcription.text, customerMatch });
  // Sebastians krav (spec punkt 7): BARA VIKTIGT ger internt SMS. ÅTGÄRD och
  // LÅG landar enbart i admininkorgen.
  let notification = {
    status: "skipped",
    reason:
      classification.priority === "urgent"
        ? "internal_sms_disabled"
        : classification.priority === "action"
          ? "action_admin_only"
          : "low_priority",
  };
  if (classification.priority === "urgent" && typeof notify === "function") {
    notification = await notify(buildVoicemailNotification({ caller, summary, classification, customerMatch, lineLabel }));
  }
  const complete = {
    ...base,
    updatedAt: new Date().toISOString(),
    status: transcription.status,
    transcript: transcription.text,
    summary,
    classification,
    customerMatch,
    transcription: { status: transcription.status, model: transcription.model },
    notification,
  };
  await store.setJSON(callId, complete);
  await purgeOldVoicemailAnalyses(store);
  return { status: transcription.status, item: complete };
};
