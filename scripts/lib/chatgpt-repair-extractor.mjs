import { createHash } from "node:crypto";

export const ROOT_CAUSES = [
  "battery_cell", "bms", "controller", "wiring", "hall_sensor", "motor",
  "puncture", "brake", "wear", "water_damage", "user_error", "unknown",
];

const TECHNICAL_TERMS = [
  "elscooter", "scooter", "sparkcykel", "felkod", "controller", "kontroller", "display",
  "motor", "hall", "hallsensor", "bms", "batteri", "laddare", "punktering", "däck",
  "broms", "mosfet", "faskabel", "balanskabel", "cellgrupp", "nickelremsa", "navmotor",
  "navee", "kukirin", "kugoo", "ninebot", "xiaomi", "vsett", "teverun", "halo knight",
  "dualtron", "e-wheels", "eway", "e-way", "ooktek", "vässla", "vassla", "isinwheel",
];

const SHORT_CODE_TERMS = ["e2", "e7", "e14", "e16", "e003"];

const BRAND_PATTERNS = [
  ["halo_knight", /\bhalo\s*knight\b/i],
  ["dualtron", /\bdualtron\b/i],
  ["teverun", /\bteverun\b/i],
  ["kukirin", /\b(kukirin|kugoo)\b/i],
  ["ninebot", /\b(ninebot|segway)\b/i],
  ["xiaomi", /\b(xiaomi|m365|mi\s*(pro|essential|electric))\b/i],
  ["navee", /\bnavee\b/i],
  ["vsett", /\bvsett\b/i],
  ["e_wheels", /\b(e-wheels|ewheels|e2s)\b/i],
  ["ooktek", /\b(ook\s*tek|ooktek)\b/i],
  ["vassla", /\b(vässla|vassla)\b/i],
  ["isinwheel", /\bisinwheel\b/i],
  ["zero", /\bzero\b/i],
];

const MODEL_PATTERNS = [
  /\b(NAVEE\s+(?:GT3\s*Max|ST3\s*Pro|V\d+[A-Za-z]*|S\d+[A-Za-z]*))\b/i,
  /\b(KuKirin\s+(?:G\d+(?:\s*Master|\s*Pro)?|M\d+))\b/i,
  /\b(Ninebot\s+(?:G\d+(?:\s*Max)?|F\d+[A-Za-z]*|E\d+[A-Za-z]*))\b/i,
  /\b(Xiaomi\s+(?:Pro\s*2|M365|Essential|[A-Za-z0-9 -]{2,20}))\b/i,
  /\b(VSETT\s+\d+\+?(?:\s*Apex)?)\b/i,
  /\b(Dualtron\s+(?:Storm(?:\s*Limited)?|Thunder|Eagle\s*Pro|[A-Za-z0-9 -]{2,20}))\b/i,
  /\b(Teverun\s+(?:Blade\s*Mini\s*Ultra|Fighter\s*Supreme\s*7260R|[A-Za-z0-9 -]{2,25}))\b/i,
  /\b(Halo\s*Knight\s+[A-Za-z0-9 -]{1,20})\b/i,
  /\b(E2S\s*V2(?:\s*Pro(?:\s*LR)?)?)\b/i,
  /\b(E-?way\s+E-?\d{3,5})\b/i,
  /\b(OOK-?TEK\s+[A-Za-z0-9 -]{1,20})\b/i,
];

const ROOT_CAUSE_HINTS = [
  ["battery_cell", /\b(cellgrupp|cell(er)?|nickelremsa|deep\s*sleep|obalans|låg cellspänning)\b/gi],
  ["bms", /\b(bms|p-|b-|skyddsläge|protection|charge mosfet|discharge mosfet)\b/gi],
  ["controller", /\b(controller|kontroller|styrenhet|fasfel|controllerfel)\b/gi],
  ["wiring", /\b(kabelbrott|bruten kabel|kontaktfel|glapp|kortslutning|oxid|ärgat|kablage)\b/gi],
  ["hall_sensor", /\b(hallsensor|hallkort|hall sensor)\b/gi],
  ["motor", /\b(navmotor|hubmotor|motorlindning|magnet|lager i motorn|motorfel)\b/gi],
  ["puncture", /\b(punktering|punkteringsfri|slangbrott|däckskada)\b/gi],
  ["brake", /\b(bromssensor|motorbroms|bromsok|bromsskiva|bromsfel)\b/gi],
  ["wear", /\b(slitage|sliten|lager|glapp i vikmekanism)\b/gi],
  ["water_damage", /\b(vattenskada|fuktskada|korrosion|vatteninträngning)\b/gi],
  ["user_error", /\b(police\s*mode|fel inställning|hastighetsbegränsning|speed\s*limit)\b/gi],
];

const PART_PATTERNS = [
  "bms", "controller", "kontroller", "display", "gasreglage", "bromssensor", "hallsensor",
  "hallkort", "motor", "navmotor", "batteri", "laddare", "däck", "slang", "bromsok",
  "bromsskiva", "nickelremsa", "balanskabel", "mosfet", "framgaffel", "vikmekanism",
];

const ERROR_CODE_REGEX = /\b(?:E\s*-?\s?\d{1,4}|P\d{1,3}|H\d{1,3})\b/gi;
const VOLTAGE_REGEX = /\b\d{1,3}(?:[,.]\d+)?\s*v\b/gi;
const TIME_REGEX = /\b\d{1,3}\s*(?:min(?:uter)?|tim(?:mar)?|h)\b/gi;
const PRICE_REGEX = /\b\d{2,6}\s*(?:kr|sek|:-)\b/gi;

const CONFIRM_PATTERNS = /\b(hittade felet|felet var|det var|bekräftat löst|är löst|löste problemet|fungerar nu|nu fungerar|fixat|åtgärdat)\b/i;
const DISPROVEN_PATTERNS = /\b(inte felet|var inte|hjälpte inte|löste inte|utesluten|motbevisad)\b/i;
const LIKELY_PATTERNS = /\b(trolig|sannolik|verkar vara|kan vara|misstänker|stark kandidat)\b/i;
const TEST_PATTERNS = /\b(mät|mätte|testa|testade|kontrollera|kontrollerade|koppla|kopplade|bytte|prova|provade|felsök|resistans|kontinuitet|spänning mellan)\b/i;
const SYMPTOM_PATTERNS = /\b(startar inte|vill inte starta|snurrar inte|driver inte|surrar|skrapar|vibrerar|stänger av|slår ifrån|laddar inte|felkod|ingen motorbroms|tappar spänning|hoppar ner|dör|går bara|begränsad hastighet|blir varm|luktar|punktering|glapp)\b/i;

const clean = (value) => String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
const unique = (items) => [...new Set(items.filter(Boolean))];

export function collectMessageText(message) {
  const parts = message?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof part.text === "string") return part.text;
      return "";
    }).filter(Boolean).join("\n");
  }
  if (typeof message?.content?.text === "string") return message.content.text;
  if (typeof message?.text === "string") return message.text;
  return "";
}

export function flattenConversation(conversation) {
  return Object.entries(conversation?.mapping || {})
    .map(([id, node]) => ({ id, node }))
    .filter(({ node }) => node?.message)
    .sort((a, b) => (a.node.message.create_time || 0) - (b.node.message.create_time || 0))
    .map(({ id, node }) => ({
      id,
      role: node.message.author?.role || "unknown",
      createdAt: node.message.create_time ? new Date(node.message.create_time * 1000).toISOString() : null,
      text: clean(collectMessageText(node.message)),
    }))
    .filter((message) => message.text && !["system", "tool"].includes(message.role));
}

function termHits(text) {
  const lower = clean(text).toLowerCase();
  const hits = TECHNICAL_TERMS.filter((term) => lower.includes(term));
  for (const term of SHORT_CODE_TERMS) {
    if (new RegExp(`\\b${term}\\b`, "i").test(lower)) hits.push(term);
  }
  return unique(hits);
}

function relevanceScore(text) {
  const hits = termHits(text);
  const hasError = ERROR_CODE_REGEX.test(text);
  ERROR_CODE_REGEX.lastIndex = 0;
  const score = hits.reduce((sum, term) => sum + (term.length >= 5 ? 2 : 1), 0) + (hasError ? 3 : 0);
  return { score, hits };
}

function splitSentences(text) {
  return clean(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(clean)
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 700);
}

function detectBrand(text) {
  for (const [brand, pattern] of BRAND_PATTERNS) if (pattern.test(text)) return brand;
  return "unknown";
}

function detectModel(text) {
  for (const pattern of MODEL_PATTERNS) {
    const match = text.match(pattern);
    if (match) return clean(match[1]);
  }
  return "unknown";
}

function detectRootCause(text) {
  const scored = ROOT_CAUSE_HINTS.map(([cause, pattern]) => {
    const matches = text.match(pattern) || [];
    pattern.lastIndex = 0;
    return { cause, score: matches.length };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  return scored[0]?.cause || "unknown";
}

function extractList(regex, text, normalizer = (value) => value) {
  const matches = text.match(regex) || [];
  regex.lastIndex = 0;
  return unique(matches.map((match) => normalizer(clean(match))));
}

function detectStatus(messages) {
  const userText = messages.filter((m) => m.role === "user").map((m) => m.text).join(" ");
  const allText = messages.map((m) => m.text).join(" ");
  if (CONFIRM_PATTERNS.test(userText)) return "confirmed_fix";
  if (DISPROVEN_PATTERNS.test(userText)) return "disproven";
  if (LIKELY_PATTERNS.test(allText)) return "likely_cause";
  if (TEST_PATTERNS.test(allText)) return "diagnostic_step";
  return "unknown";
}

function extractEvidence(messages, pattern, { roles = null, limit = 8 } = {}) {
  const output = [];
  for (const message of messages) {
    if (roles && !roles.includes(message.role)) continue;
    for (const sentence of splitSentences(message.text)) {
      if (pattern.test(sentence)) output.push(sentence);
    }
  }
  return unique(output).slice(0, limit);
}

function extractResolution(messages) {
  const userSentences = extractEvidence(messages, CONFIRM_PATTERNS, { roles: ["user"], limit: 3 });
  return userSentences.length ? userSentences.join(" ").slice(0, 1500) : null;
}

function extractParts(text) {
  const lower = text.toLowerCase();
  return PART_PATTERNS.filter((part) => new RegExp(`\\b${part.replace("-", "[- ]?")}\\b`, "i").test(lower));
}

function buildLesson({ status, rootCause, symptoms, testsPerformed, resolution }) {
  if (status === "confirmed_fix" && rootCause !== "unknown") {
    const symptom = symptoms[0] || "det dokumenterade symptomet";
    return `Vid ${symptom}: verifiera ${rootCause} med dokumenterade tester innan delbyte.${resolution ? ` Bekräftelse: ${resolution}` : ""}`.slice(0, 1500);
  }
  if (status === "disproven" && testsPerformed.length) {
    return `Hypotesen gav inte förväntat resultat. Bevara testordningen: ${testsPerformed.slice(0, 3).join(" → ")}.`.slice(0, 1500);
  }
  return null;
}

function privacyRedact(text) {
  const warnings = [];
  let value = clean(text)
    .replace(/[A-ZÅÄÖ0-9._%+-]+@[A-ZÅÄÖ0-9.-]+\.[A-ZÅÄÖ]{2,}/gi, "[email]")
    .replace(/(?:\+46|0)\s?7[02369](?:[\s-]?\d){7}/g, "[phone]")
    .replace(/\b(?:19|20)?\d{6}[-+]?\d{4}\b/g, "[personnummer]");
  if (/\b(?:gata|gatan|väg|vägen|gränd|allé)\s+\d+/i.test(value)) warnings.push("possible_address");
  if (/\bkund(?:en)?\s+(?:heter|är)\s+[A-ZÅÄÖ][a-zåäö]+/i.test(value)) warnings.push("possible_customer_name");
  value = value.slice(0, 5000);
  return { text: value, warnings };
}

function stableId(conversation, messages) {
  const source = [conversation.id || conversation.conversation_id || conversation.title || "unknown", ...messages.map((m) => m.id)].join("|");
  return `chatgpt_${createHash("sha256").update(source).digest("hex").slice(0, 20)}`;
}

function segmentConversation(messages) {
  const segments = [];
  const consumedUserIds = new Set();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "user" || consumedUserIds.has(message.id)) continue;
    const relevance = relevanceScore(message.text);
    if (relevance.score < 2) continue;

    const segment = [message];
    consumedUserIds.add(message.id);
    for (let cursor = index + 1; cursor < messages.length && segment.length < 6; cursor += 1) {
      const next = messages[cursor];
      if (next.role === "user" && relevanceScore(next.text).score >= 2 && segment.some((m) => m.role === "assistant")) {
        if (CONFIRM_PATTERNS.test(next.text) || DISPROVEN_PATTERNS.test(next.text)) {
          segment.push(next);
          consumedUserIds.add(next.id);
        }
        break;
      }
      segment.push(next);
      if (next.role === "user") consumedUserIds.add(next.id);
    }
    segments.push(segment);
  }
  return segments;
}

function candidateFromSegment(conversation, messages) {
  const fullText = messages.map((m) => m.text).join("\n");
  const title = clean(conversation.title || conversation.name || "untitled");
  const combined = `${title}\n${fullText}`;
  const relevance = relevanceScore(combined);
  const status = detectStatus(messages);
  const symptoms = extractEvidence(messages, SYMPTOM_PATTERNS, { roles: ["user"], limit: 8 });
  const testsPerformed = extractEvidence(messages, TEST_PATTERNS, { limit: 10 });
  const resolution = extractResolution(messages);
  const rootCauseSource = resolution || combined;
  const rootCause = detectRootCause(rootCauseSource);
  const excerptRaw = messages.map((m) => `${m.role}: ${m.text}`).join("\n");
  const redacted = privacyRedact(excerptRaw);
  const brand = detectBrand(combined);
  const model = detectModel(combined);
  const errorCodes = extractList(ERROR_CODE_REGEX, combined, (value) => value.replace(/[\s-]+/g, "").toUpperCase());
  const confidence = status === "confirmed_fix" && (brand !== "unknown" || model !== "unknown")
    ? "high"
    : relevance.score >= 10 || errorCodes.length
      ? "medium"
      : "low";

  return {
    id: stableId(conversation, messages),
    source: "chatgpt_history",
    sourceConversationId: clean(conversation.id || conversation.conversation_id || "") || null,
    sourceMessageIds: messages.map((message) => message.id),
    sourceTitle: title,
    createTime: messages[0]?.createdAt || (conversation.create_time ? new Date(conversation.create_time * 1000).toISOString() : null),
    updateTime: messages.at(-1)?.createdAt || (conversation.update_time ? new Date(conversation.update_time * 1000).toISOString() : null),
    brand,
    model,
    errorCodes,
    symptoms,
    testsPerformed,
    likelyRootCause: rootCause,
    confirmedRootCause: status === "confirmed_fix" && rootCause !== "unknown" ? rootCause : null,
    resolution,
    partsMentioned: extractParts(combined),
    diagnosticLesson: buildLesson({ status, rootCause, symptoms, testsPerformed, resolution }),
    confidence,
    status,
    reviewStatus: "needs_review",
    keywordHits: relevance.hits,
    voltages: extractList(VOLTAGE_REGEX, combined, (value) => value.replace(",", ".").toLowerCase()),
    prices: extractList(PRICE_REGEX, combined),
    timeMentions: extractList(TIME_REGEX, combined),
    privacyCleaned: true,
    redactionWarnings: redacted.warnings,
    excerpt: redacted.text,
  };
}

export function extractRepairKnowledge(conversations) {
  if (!Array.isArray(conversations)) throw new Error("Expected conversations.json to contain an array.");
  const candidates = [];
  for (const conversation of conversations) {
    const messages = flattenConversation(conversation);
    for (const segment of segmentConversation(messages)) {
      candidates.push(candidateFromSegment(conversation, segment));
    }
  }
  const deduped = new Map();
  for (const candidate of candidates) deduped.set(candidate.id, candidate);
  return [...deduped.values()].sort((a, b) => String(b.updateTime || "").localeCompare(String(a.updateTime || "")));
}

export function anonymizeForTest(text) {
  return privacyRedact(text);
}
