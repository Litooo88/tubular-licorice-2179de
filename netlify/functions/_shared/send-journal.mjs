// Beständig journal för kundutskick (SMS/mejl) kopplade till ärenden.
//
// Problemet: flera kodvägar skickar SMS/mejl FÖRE ärendeskrivningen. Om
// skrivningen misslyckas efter utskicket (konflikt efter alla omförsök,
// lagringsfel, krasch) saknar ärendet historiken, och ett nytt försök från
// operatören skickar en gång till. 46elks saknar idempotensnycklar, så
// exakt-en-gång kan inte garanteras av leverantören. Det vi kan garantera:
//
//   1. Planerad åtgärd reserveras i journalen INNAN utskicket (`reserved`).
//   2. Utskickets resultat (leverantörens meddelande-id, fel) skrivs direkt
//      efter (`sent` / `failed` / `not_sent` / `queued_approval`).
//   3. När ärendet är versionerat uppdaterat markeras posten `committed`.
//   4. Poster som stannat i `sent`/`failed` utan `committed` (ärendeskrivningen
//      föll) återappliceras av `reconcileSendJournal` (schemalagt), idempotent
//      via `journalKey` på loggposten. Poster som stannat i `reserved` längre
//      än STALE_RESERVATION_MS (krasch mellan reservation och resultat) blir
//      `unknown` och får en tidslinjerad på ärendet: "kontrollera hos 46elks".
//   5. Identiskt SMS till samma ärende inom DUPLICATE_WINDOW_MS avvisas
//      (`duplicate_recent`) om inte `force`. Med en klient-given
//      `idempotencyKey` (NEMOB OS 2.0) är nyckeln själva dedupen: samma nyckel
//      igen ger det sparade resultatet tillbaka utan nytt utskick.
//
// Store: "send-journal". Nycklar: `${caseId}_${channel}_${tid}_${slump}` eller
// `idem_${idempotencyKey}`. Aldrig kunddata utöver mottagare + text (samma
// som sms-log). Gallras efter RETENTION_DAYS av reconcile.

import { getStore } from "@netlify/blobs";
import { caseStore, commitJson, createIfAbsent, readWithEtag, safeKey, stampKey } from "./case-store.mjs";

export const JOURNAL_STORE = "send-journal";
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
export const STALE_RESERVATION_MS = 10 * 60 * 1000;
export const RECONCILE_MIN_AGE_MS = 60 * 1000;
export const RETENTION_DAYS = 30;

const clean = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
export const journalStore = () => getStore({ name: JOURNAL_STORE, consistency: "strong" });

const lifecycleFor = (result) => {
  const status = clean(result?.status, 40);
  if (status === "sent") return "sent";
  if (status === "pending_approval") return "queued_approval";
  if (["not_configured", "invalid_phone", "missing_message", "dry_run_no_credentials", "skipped"].includes(status)) return "not_sent";
  return "failed";
};

const listAll = async (store, prefix = "") => {
  const keys = [];
  let cursor;
  do {
    const page = await store.list({ ...(prefix ? { prefix } : {}), ...(cursor ? { cursor } : {}) }).catch(() => ({ blobs: [] }));
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  return keys;
};

export const newJournalKey = (caseId, channel = "sms", now = new Date()) =>
  safeKey(caseId, channel, stampKey(now), Math.random().toString(36).slice(2, 8));

// Reservera ett utskick. Returnerar { ok: true, key, record } eller
// { ok: false, reason: "duplicate_recent" | "in_flight" | "already_sent" | "unversioned", existing }.
export const reserveSend = async ({
  store = journalStore(), caseId, channel = "sms", to, message, source = "", operator = "", action = "",
  apply = null, idempotencyKey = "", force = false, now = new Date(),
} = {}) => {
  const base = {
    caseId: clean(caseId, 180), channel: clean(channel, 20) || "sms", to: clean(to, 40), message: clean(message, 2000),
    source: clean(source, 60), operator: clean(operator, 80), action: clean(action, 60),
    apply: apply && typeof apply === "object" ? apply : null,
    status: "reserved", reservedAt: now.toISOString(), attempts: 0,
  };
  try {
    if (idempotencyKey) {
      const key = safeKey("idem", clean(idempotencyKey, 120));
      const created = await createIfAbsent(store, key, { ...base, key, idempotencyKey: clean(idempotencyKey, 120) });
      if (!created.created) {
        const existing = created.item || {};
        if (existing.status === "reserved") return { ok: false, reason: "in_flight", existing, key };
        // Misslyckat/okänt/aldrig skickat: samma nyckel får försöka igen (ta
        // över raden). Bara ett lyckat utskick återspelas utan nytt försök.
        if (["failed", "not_sent", "unknown", "orphan"].includes(existing.status)) {
          const taken = await commitJson(store, key, (row) => (row.status === existing.status
            ? { ...row, status: "reserved", reservedAt: now.toISOString(), previousStatus: row.status, previousError: row.error || "" }
            : null), { current: existing, etag: created.etag });
          if (taken.ok) return { ok: true, key, record: taken.item, retried: true };
          return { ok: false, reason: "in_flight", existing, key };
        }
        return { ok: false, reason: "already_sent", existing, key };
      }
      return { ok: true, key, record: { ...base, key } };
    }
    if (!force && base.caseId && base.to && base.message) {
      const prefix = `${safeKey(base.caseId)}_${base.channel}_`;
      const keys = await listAll(store, prefix);
      const recent = keys.filter((k) => k.slice(prefix.length, prefix.length + 24) >= stampKey(new Date(now.getTime() - DUPLICATE_WINDOW_MS)).slice(0, 24));
      for (const k of recent) {
        const row = await store.get(k, { type: "json" }).catch(() => null);
        if (!row || row.to !== base.to || row.message !== base.message) continue;
        if (!["reserved", "sent", "committed", "queued_approval"].includes(row.status)) continue;
        return { ok: false, reason: "duplicate_recent", existing: row, key: k };
      }
    }
    const key = newJournalKey(base.caseId || "ingen", base.channel, now);
    const created = await createIfAbsent(store, key, { ...base, key });
    if (!created.created) return reserveSend({ store, caseId, channel, to, message, source, operator, action, apply, force: true, now: new Date(now.getTime() + 1) });
    return { ok: true, key, record: { ...base, key } };
  } catch (error) {
    if (error?.name === "UnversionedStoreError") return { ok: false, reason: "unversioned", code: error.code };
    throw error;
  }
};

export const recordSendResult = async (key, result, { store = journalStore() } = {}) => {
  const sentAt = clean(result?.sentAt, 40) || new Date().toISOString();
  return commitJson(store, key, (row) => ({
    ...row,
    status: lifecycleFor(result),
    sendStatus: clean(result?.status, 40) || "unknown",
    providerId: clean(result?.id || result?.providerId, 120),
    provider: clean(result?.provider, 40) || (row.channel === "email" ? "resend" : "46elks"),
    error: clean(result?.error, 200),
    sentAt,
    attempts: (Number(row.attempts) || 0) + 1,
    result: { status: clean(result?.status, 40), id: clean(result?.id, 120), error: clean(result?.error, 200), to: clean(result?.to, 40) },
  }));
};

export const markCommitted = async (key, { store = journalStore(), caseEtag = "" } = {}) =>
  commitJson(store, key, (row) => ({ ...row, status: "committed", committedAt: new Date().toISOString(), caseEtag: clean(caseEtag, 120) }));

// Finns journalposten redan på ärendet (återspelning med samma idempotencyKey)?
export const hasJournalEntry = (item, key) => Boolean(key) && ["outboundMessages", "smsLog"].some((field) =>
  (Array.isArray(item?.[field]) ? item[field] : []).some((entry) => entry?.journalKey === key));

// Ren funktion: lägg journalpostens resultat på ärendet (loggpost + tidslinje
// + ev. statusövergång). Idempotent via journalKey. null = redan applicerat.
export const applyJournalToCase = (current, record) => {
  if (!current || !record?.apply) return null;
  const apply = record.apply;
  const target = apply.log === "smsLog" ? "smsLog" : "outboundMessages";
  const existing = Array.isArray(current[target]) ? current[target] : [];
  if (existing.some((entry) => entry?.journalKey && entry.journalKey === record.key)) return null;
  const at = record.sentAt || record.reservedAt || new Date().toISOString();
  const sendStatus = record.sendStatus || (record.status === "sent" ? "sent" : record.status);
  const entry = target === "smsLog"
    ? { at, kind: clean(apply.kind, 40) || "generic", to: record.to, message: record.message, status: sendStatus, providerId: record.providerId || "", operator: record.operator || "", journalKey: record.key }
    : { at, type: clean(apply.type, 60) || "manual_sms", to: record.to, status: sendStatus, provider: record.provider || "46elks", message: record.message, caseId: current.id, journalKey: record.key };
  const from = Array.isArray(apply.statusFrom) ? apply.statusFrom : [];
  const moveStatus = sendStatus === "sent" && apply.statusTo && from.includes(current.status);
  const event = clean(apply.event, 300) || `Utskick (${record.channel}) ${sendStatus === "sent" ? "skickat" : sendStatus} – återställt från utskicksjournalen.`;
  return {
    ...current,
    updatedAt: at,
    status: moveStatus ? apply.statusTo : current.status,
    [target]: [...existing, entry].slice(-50),
    timeline: [...(Array.isArray(current.timeline) ? current.timeline : []), { at, event: `${event} (återställt från utskicksjournalen)` }],
  };
};

// Reservera → skicka → spara resultat. Själva ärendeskrivningen gör anroparen
// (den vet hur ärendet ska se ut) och anropar sedan markCommitted(journalKey).
// Returnerar { status, result, journalKey } där status är resultatets status
// eller "duplicate_recent" | "in_flight" | "already_sent" | "unversioned".
export const sendJournaled = async ({ send, store = journalStore(), ...reservation } = {}) => {
  const reserved = await reserveSend({ store, ...reservation });
  if (!reserved.ok) {
    if (reserved.reason === "already_sent") {
      const existing = reserved.existing || {};
      return { status: existing.sendStatus || existing.status || "sent", result: existing.result || { status: existing.sendStatus || "sent", id: existing.providerId || "" }, journalKey: reserved.key, replayed: true };
    }
    return { status: reserved.reason, result: null, journalKey: reserved.key || "", existing: reserved.existing || null, code: reserved.code || "" };
  }
  let result;
  try {
    result = await send();
  } catch (error) {
    result = { status: "failed", error: clean(error?.message, 180) };
  }
  if (!result || typeof result !== "object") result = { status: "failed", error: "tomt svar från avsändaren" };
  // Resultatet är det enda beviset på vad leverantören gjorde: ett extra försök
  // innan raden lämnas som "reserved" (→ unknown i reconcile).
  let recorded = await recordSendResult(reserved.key, result, { store }).catch(() => ({ ok: false }));
  if (!recorded.ok) recorded = await recordSendResult(reserved.key, result, { store }).catch(() => ({ ok: false }));
  if (!recorded.ok) console.error("send-journal: kunde inte spara resultat", { key: reserved.key, reason: recorded.reason || "threw" });
  return { status: clean(result.status, 40) || "failed", result, journalKey: reserved.key, resultRecorded: Boolean(recorded.ok) };
};

// Schemalagd återhämtning. Kastar aldrig. { reapplied, unknown, orphaned, pruned, skipped }.
export const reconcileSendJournal = async ({ store = journalStore(), cases = caseStore(), now = Date.now() } = {}) => {
  const counts = { reapplied: 0, unknown: 0, orphaned: 0, pruned: 0, skipped: 0, errors: 0 };
  const cutoff = now - RETENTION_DAYS * 86400000;
  for (const key of await listAll(store)) {
    try {
      const { item: row, etag } = await readWithEtag(store, key);
      if (!row) continue;
      const stamp = new Date(row.sentAt || row.reservedAt || 0).getTime();
      if (["committed", "unknown", "not_sent", "orphan", "queued_approval"].includes(row.status)) {
        if (stamp && stamp < cutoff) { await store.delete(key).catch(() => {}); counts.pruned += 1; }
        continue;
      }
      if (row.status === "reserved") {
        if (now - stamp < STALE_RESERVATION_MS) { counts.skipped += 1; continue; }
        // Krasch mellan reservation och resultat: vi vet inte om 46elks skickade.
        if (row.caseId) {
          await commitJson(cases, row.caseId, (fresh) => {
            const timeline = Array.isArray(fresh.timeline) ? fresh.timeline : [];
            if (timeline.some((t) => t?.journalKey === key)) return null;
            return { ...fresh, timeline: [...timeline, { at: new Date(now).toISOString(), journalKey: key, event: `Utskick (${row.channel}) till ${row.to} fick aldrig ett resultat – kontrollera i 46elks-loggen om det gick iväg innan du skickar igen.` }] };
          });
        }
        await commitJson(store, key, (r) => ({ ...r, status: "unknown", unknownAt: new Date(now).toISOString() }), { current: row, etag });
        counts.unknown += 1;
        continue;
      }
      if (["sent", "failed"].includes(row.status)) {
        if (now - stamp < RECONCILE_MIN_AGE_MS) { counts.skipped += 1; continue; }
        if (!row.caseId || !row.apply) { await markCommitted(key, { store }); counts.skipped += 1; continue; }
        const saved = await commitJson(cases, row.caseId, (fresh) => applyJournalToCase(fresh, row));
        if (saved.ok || saved.reason === "aborted") { await markCommitted(key, { store, caseEtag: saved.etag || "" }); counts.reapplied += saved.ok ? 1 : 0; continue; }
        if (saved.reason === "not_found") { await commitJson(store, key, (r) => ({ ...r, status: "orphan" }), { current: row, etag }); counts.orphaned += 1; continue; }
        counts.skipped += 1;
      }
    } catch (error) {
      counts.errors += 1;
      console.error("send-journal reconcile", { key, error: clean(error?.message, 120) });
    }
  }
  return counts;
};
