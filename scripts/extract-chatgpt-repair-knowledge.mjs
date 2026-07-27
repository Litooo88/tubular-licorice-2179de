#!/usr/bin/env node

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_OUTPUT_DIR = 'repair-knowledge-export';

const KEYWORDS = [
  'elscooter',
  'scooter',
  'sparkcykel',
  'felkod',
  'controller',
  'display',
  'motor',
  'hall',
  'hallsensor',
  'bms',
  'batteri',
  'laddare',
  'punktering',
  'däck',
  'broms',
  'mosfet',
  'fas',
  'balanskabel',
  'navee',
  'kukirin',
  'kugoo',
  'ninebot',
  'xiaomi',
  'vsett',
  'teverun',
  'halo knight',
  'dualtron',
  'e-wheels',
  'eway',
  'e-way',
  'ooktek',
  'vässla',
  'vassla',
  'isinwheel',
  'e2s',
  'e7',
  'e16',
  'e14',
  'e003'
];

const BRAND_PATTERNS = [
  ['halo_knight', /\bhalo\s*knight\b/i],
  ['dualtron', /\bdualtron\b/i],
  ['teverun', /\bteverun\b/i],
  ['kukirin', /\b(kukirin|kugoo)\b/i],
  ['ninebot', /\b(ninebot|segway|g30|g2\s*max)\b/i],
  ['xiaomi', /\b(xiaomi|m365|mi\s*(pro|essential|electric))\b/i],
  ['navee', /\bnavee\b/i],
  ['vsett', /\bvsett\b/i],
  ['e_wheels', /\b(e-wheels|ewheels|e2s|e7|e4)\b/i],
  ['ooktek', /\book\s*tek|ooktek\b/i],
  ['vassla', /\b(vässla|vassla)\b/i],
  ['isinwheel', /\bisinwheel\b/i],
  ['zero', /\bzero\b/i]
];

const ROOT_CAUSE_HINTS = [
  ['battery_cell', /\b(cellgrupp|cell(er)?|nickelremsa|0\s*v|deep\s*sleep|balans)\b/i],
  ['bms', /\b(bms|p-|b-|mosfet|skyddsläge|protect)\b/i],
  ['controller', /\b(controller|kontroller|styrenhet|mosfet|fasfel)\b/i],
  ['wiring', /\b(kabel|kontakt|glapp|kortslut|oxid|ärgat|bruten kabel)\b/i],
  ['hall_sensor', /\b(hall|hallsensor|hallkort)\b/i],
  ['motor', /\b(motor|navmotor|hubmotor|lindning|magnet|skrap|surrar)\b/i],
  ['puncture', /\b(punktering|punkteringsfri|slang|däckbyte)\b/i],
  ['brake', /\b(broms|bromssensor|motorbroms|bromslampa)\b/i],
  ['water_damage', /\b(vatten|fukt|vattenskada|regn|korrosion)\b/i],
  ['user_error', /\b(police\s*mode|inställning|p-?setting|begränsad|speed\s*limit)\b/i]
];

const ERROR_CODE_REGEX = /\b(E\s*-?\s?\d{1,4}|E\d{1,4}|P\d{1,3}|H\d{1,3})\b/gi;
const VOLTAGE_REGEX = /\b\d{1,3}(?:[,.]\d+)?\s*v\b/gi;
const TIME_REGEX = /\b\d{1,3}\s*(?:min|tim|h)\b/gi;
const PRICE_REGEX = /\b\d{2,6}\s*(?:kr|sek|:-)\b/gi;

function usage() {
  console.log(`Usage:
  node scripts/extract-chatgpt-repair-knowledge.mjs <conversations.json> [output-dir]

Example:
  node scripts/extract-chatgpt-repair-knowledge.mjs ~/Downloads/chatgpt-export/conversations.json repair-knowledge-export

Outputs:
  repair_knowledge_seed.jsonl
  repair_cases_candidates.csv
  error_code_index.csv
  extraction_summary.json

Notes:
  - This is a deterministic first-pass extractor.
  - It does not call AI APIs.
  - It is meant to create a review queue, not final approved workshop truth.
`);
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lower(value) {
  return normalizeText(value).toLowerCase();
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows, columns) {
  const lines = [columns.join(';')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(';'));
  return `${lines.join('\n')}\n`;
}

function collectMessageText(message) {
  const parts = message?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') return JSON.stringify(part);
        return '';
      })
      .join('\n');
  }

  if (typeof message?.content?.text === 'string') return message.content.text;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

function flattenConversation(conversation) {
  const nodes = Object.values(conversation.mapping ?? {})
    .filter((node) => node?.message)
    .sort((a, b) => (a.message.create_time ?? 0) - (b.message.create_time ?? 0));

  return nodes.map((node) => ({
    role: node.message.author?.role ?? 'unknown',
    createdAt: node.message.create_time ? new Date(node.message.create_time * 1000).toISOString() : null,
    text: normalizeText(collectMessageText(node.message))
  })).filter((message) => message.text);
}

function keywordScore(text) {
  const haystack = lower(text);
  let score = 0;
  const hits = [];

  for (const keyword of KEYWORDS) {
    if (haystack.includes(keyword.toLowerCase())) {
      score += keyword.length > 4 ? 2 : 1;
      hits.push(keyword);
    }
  }

  return { score, hits: [...new Set(hits)] };
}

function detectBrand(text) {
  for (const [brand, pattern] of BRAND_PATTERNS) {
    if (pattern.test(text)) return brand;
  }
  return 'unknown';
}

function detectRootCause(text) {
  const matches = [];
  for (const [cause, pattern] of ROOT_CAUSE_HINTS) {
    if (pattern.test(text)) matches.push(cause);
  }
  return matches[0] ?? 'unknown';
}

function detectStatus(text) {
  const t = lower(text);
  if (/\b(löst|bekräftat löst|fungerar|fixat|åtgärdat|bytte .* löste|hittade felet)\b/i.test(t)) return 'confirmed_fix';
  if (/\b(trolig|sannolik|verkar|kan vara|misstänker|kandidat)\b/i.test(t)) return 'likely_cause';
  if (/\b(inte felet|uteslut|motbevis|funkade inte|hjälpte inte)\b/i.test(t)) return 'disproven';
  if (/\b(mät|testa|kontrollera|felsök|steg|schema)\b/i.test(t)) return 'diagnostic_step';
  return 'unknown';
}

function extractList(regex, text, normalizer = (value) => value) {
  const matches = text.match(regex) ?? [];
  return [...new Set(matches.map((match) => normalizer(normalizeText(match))))];
}

function inferTitle(conversation) {
  return normalizeText(conversation.title || conversation.name || 'untitled');
}

function makeExcerpt(messages, maxLength = 1800) {
  const joined = messages
    .slice(-10)
    .map((message) => `${message.role}: ${message.text}`)
    .join('\n');
  return joined.length > maxLength ? `${joined.slice(0, maxLength)}...` : joined;
}

function anonymizeText(text) {
  return normalizeText(text)
    .replace(/[A-ZÅÄÖ0-9._%+-]+@[A-ZÅÄÖ0-9.-]+\.[A-ZÅÄÖ]{2,}/gi, '[email]')
    .replace(/(?:\+46|0)\s?7[02369][\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g, '[phone]')
    .replace(/\b\d{6}[-+]?\d{4}\b/g, '[personnummer]');
}

function buildCandidate(conversation, index) {
  const messages = flattenConversation(conversation);
  const fullText = messages.map((message) => message.text).join('\n');
  const { score, hits } = keywordScore(fullText);
  if (score < 3) return null;

  const title = inferTitle(conversation);
  const excerpt = anonymizeText(makeExcerpt(messages));
  const combined = `${title}\n${fullText}`;
  const brand = detectBrand(combined);
  const rootCause = detectRootCause(combined);
  const status = detectStatus(combined);
  const errorCodes = extractList(ERROR_CODE_REGEX, combined, (value) => value.replace(/\s+/g, '').toUpperCase());
  const voltages = extractList(VOLTAGE_REGEX, combined, (value) => value.replace(',', '.').toLowerCase());
  const prices = extractList(PRICE_REGEX, combined, (value) => value.replace(/\s+/g, ' '));
  const timeMentions = extractList(TIME_REGEX, combined, (value) => value.replace(/\s+/g, ' '));

  return {
    id: `chatgpt_seed_${String(index + 1).padStart(5, '0')}`,
    source: 'chatgpt_history',
    sourceTitle: title,
    createTime: conversation.create_time ? new Date(conversation.create_time * 1000).toISOString() : null,
    updateTime: conversation.update_time ? new Date(conversation.update_time * 1000).toISOString() : null,
    brand,
    model: 'unknown',
    errorCodes,
    symptoms: [],
    testsPerformed: [],
    likelyRootCause: rootCause,
    confirmedRootCause: status === 'confirmed_fix' ? rootCause : null,
    resolution: null,
    partsMentioned: [],
    diagnosticLesson: null,
    confidence: score >= 10 ? 'medium' : 'low',
    status,
    reviewStatus: 'needs_review',
    keywordHits: hits,
    voltages,
    prices,
    timeMentions,
    privacyCleaned: true,
    excerpt
  };
}

function buildErrorCodeRows(candidates) {
  const rows = [];
  for (const candidate of candidates) {
    for (const errorCode of candidate.errorCodes) {
      rows.push({
        errorCode,
        brand: candidate.brand,
        sourceId: candidate.id,
        sourceTitle: candidate.sourceTitle,
        likelyRootCause: candidate.likelyRootCause,
        status: candidate.status,
        confidence: candidate.confidence
      });
    }
  }
  return rows;
}

async function main() {
  const [, , inputPath, outputArg] = process.argv;
  if (!inputPath || inputPath === '--help' || inputPath === '-h') {
    usage();
    process.exit(inputPath ? 0 : 1);
  }

  const outputDir = outputArg || DEFAULT_OUTPUT_DIR;
  const raw = await readFile(inputPath, 'utf8');
  const conversations = JSON.parse(raw);

  if (!Array.isArray(conversations)) {
    throw new Error('Expected conversations.json to contain an array of conversations.');
  }

  const candidates = conversations
    .map((conversation, index) => buildCandidate(conversation, index))
    .filter(Boolean)
    .sort((a, b) => (b.updateTime ?? '').localeCompare(a.updateTime ?? ''));

  await mkdir(outputDir, { recursive: true });

  const jsonl = candidates.map((candidate) => JSON.stringify(candidate)).join('\n') + (candidates.length ? '\n' : '');
  await writeFile(path.join(outputDir, 'repair_knowledge_seed.jsonl'), jsonl, 'utf8');

  const candidateColumns = [
    'id',
    'sourceTitle',
    'updateTime',
    'brand',
    'model',
    'errorCodes',
    'likelyRootCause',
    'status',
    'confidence',
    'reviewStatus',
    'keywordHits',
    'voltages',
    'prices',
    'timeMentions',
    'excerpt'
  ];

  const csvRows = candidates.map((candidate) => ({
    ...candidate,
    errorCodes: candidate.errorCodes.join(', '),
    keywordHits: candidate.keywordHits.join(', '),
    voltages: candidate.voltages.join(', '),
    prices: candidate.prices.join(', '),
    timeMentions: candidate.timeMentions.join(', ')
  }));
  await writeFile(path.join(outputDir, 'repair_cases_candidates.csv'), toCsv(csvRows, candidateColumns), 'utf8');

  const errorRows = buildErrorCodeRows(candidates);
  await writeFile(
    path.join(outputDir, 'error_code_index.csv'),
    toCsv(errorRows, ['errorCode', 'brand', 'sourceId', 'sourceTitle', 'likelyRootCause', 'status', 'confidence']),
    'utf8'
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    inputPath,
    outputDir,
    totalConversations: conversations.length,
    candidateCount: candidates.length,
    errorCodeMentions: errorRows.length,
    statusCounts: candidates.reduce((acc, candidate) => {
      acc[candidate.status] = (acc[candidate.status] ?? 0) + 1;
      return acc;
    }, {}),
    brandCounts: candidates.reduce((acc, candidate) => {
      acc[candidate.brand] = (acc[candidate.brand] ?? 0) + 1;
      return acc;
    }, {})
  };

  await writeFile(path.join(outputDir, 'extraction_summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(`Extracted ${candidates.length} candidate repair-knowledge records.`);
  console.log(`Wrote output to ${outputDir}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
