// Versionerade skrivningar mot Netlify Blobs (etag + onlyIfMatch).
//
// Problemet (audit F02, 2026-09-07): alla ärendeskrivare gör `get` → ändra →
// `setJSON`. Två parallella anrop (admin-PATCH + outbox-flush, Nova-webhook +
// case-sms, två flikar i admin) läser samma version och den som skriver sist
// vinner — den andras ändring försvinner tyst.
//
// Så fungerar @netlify/blobs 10.7.13 (verifierat i dist/main.js):
//   - `setJSON(key, value, { onlyIfMatch: etag })` skickar `If-Match` och
//     returnerar `{ modified: false }` vid HTTP 412, annars `{ etag, modified: true }`.
//   - `setJSON(key, value, { onlyIfNew: true })` skickar `If-None-Match: *`
//     med samma svarsform.
//   - utan villkor returneras `{ etag, modified: true }`; SDK < 9 returnerar
//     `undefined`.
//   - `getWithMetadata` ger `{ data, etag, metadata }`. Den lokala
//     utvecklingsservern (@netlify/blobs/server) sätter etag på PUT och list men
//     INTE på GET; därför finns ett list-uppslag som reserv.
//
// Viktigt: en backend som IGNORERAR villkorshuvudena svarar 200 och SDK:n
// rapporterar då `modified: true` trots att inget kontrollerades. Det syns
// inte på en enskild skrivning. Därför verifieras stödet med en isolerad probe
// (egen store, aldrig kunddata) en gång per process innan den första
// villkorade skrivningen släpps igenom. Saknas stödet stoppas skrivningen
// (`UnversionedStoreError`) i stället för att tyst falla tillbaka på "sist
// vinner". Bakåtkompatibelt API-format behålls; dataintegriteten offras inte.
//
// Nödventil: miljövariabeln CASE_STORE_ALLOW_UNVERSIONED=1 tillåter ovillkorad
// skrivning (gamla beteendet) under en incident. Varje sådan skrivning loggas.
//
// Mönstret: läs med etag, bygg nästa version med en REN funktion
// `build(current)`, skriv villkorat, och kör `build` igen på färsk data vid
// konflikt. Sidoeffekter (SMS, mejl, kalender) görs EN gång före `commitCase`
// och resultatet fångas i closuren, så att ett omförsök bara applicerar samma
// resultat på den nya versionen — aldrig skickar om. Beständig spårning av
// själva utskicket finns i `send-journal.mjs`.

import { getStore } from "@netlify/blobs";

export const CASE_STORE = "workshop-cases";
export const PROBE_STORE = "case-store-probe";
export const DEFAULT_RETRIES = 3;

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

export const caseStore = () => getStore({ name: CASE_STORE, consistency: "strong" });

export class UnversionedStoreError extends Error {
  constructor(code, detail = {}) {
    super(`Versionerad lagring kan inte garanteras (${code}).`);
    this.name = "UnversionedStoreError";
    this.code = code;
    this.detail = detail;
  }
}

export const allowUnversioned = () => /^(1|true|yes)$/i.test(String(env("CASE_STORE_ALLOW_UNVERSIONED") || "").trim());

const hasMetadataRead = (store) => typeof store?.getWithMetadata === "function";
const isWriteResult = (result) => Boolean(result) && typeof result.modified === "boolean";

// ---------------------------------------------------------------------------
// Verifiering av villkorade skrivningar (isolerad probe-store).
// ---------------------------------------------------------------------------

// Kör hela protokollet mot en store som bara innehåller probe-nycklar:
//   1. onlyIfNew på ny nyckel      → modified: true
//   2. onlyIfNew igen              → modified: false
//   3. läs etag (GET, annars list) → etag finns
//   4. onlyIfMatch med fel etag    → modified: false
//   5. onlyIfMatch med rätt etag   → modified: true, ny etag
//   6. städa.
// Returnerar { ok, steps, etagSource, error }. Kastar aldrig.
export const verifyConditionalWrites = async (store) => {
  const key = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const steps = {};
  try {
    const create = await store.setJSON(key, { probe: true, at: new Date().toISOString(), n: 1 }, { onlyIfNew: true });
    steps.onlyIfNewCreate = isWriteResult(create) ? create.modified === true : "no_result";
    const duplicate = await store.setJSON(key, { probe: true, n: 2 }, { onlyIfNew: true });
    steps.onlyIfNewDuplicate = isWriteResult(duplicate) ? duplicate.modified === false : "no_result";
    const read = await readWithEtag(store, key, { allowMissingEtag: true });
    steps.etagOnRead = Boolean(read.etag);
    const stale = read.etag ? await store.setJSON(key, { probe: true, n: 3 }, { onlyIfMatch: `"not-${Date.now()}"` }) : null;
    steps.onlyIfMatchStale = stale ? (isWriteResult(stale) ? stale.modified === false : "no_result") : "skipped";
    const fresh = read.etag ? await store.setJSON(key, { probe: true, n: 4 }, { onlyIfMatch: read.etag }) : null;
    steps.onlyIfMatchFresh = fresh ? (isWriteResult(fresh) ? fresh.modified === true : "no_result") : "skipped";
    const after = read.etag ? await readWithEtag(store, key, { allowMissingEtag: true }) : { item: null };
    steps.valueAfterFresh = after.item?.n === 4;
    const ok = Object.values(steps).every((value) => value === true);
    return { ok, steps, etagSource: read.etagSource || "none", checkedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, steps, error: String(error?.code || error?.message || error).slice(0, 160), checkedAt: new Date().toISOString() };
  } finally {
    await store.delete?.(key).catch?.(() => {});
  }
};

let probeFactory = () => getStore({ name: PROBE_STORE, consistency: "strong" });
let verification = null;

// Testkrok: byt ut probe-storen (minnesstore) eller nollställ minnet.
export const setProbeStoreFactory = (factory) => { probeFactory = factory; verification = null; };
export const resetVerification = () => { verification = null; };
export const lastVerification = () => verification?.result ?? null;

// En gång per process (memoiserad). Kastar UnversionedStoreError om stödet
// saknas och nödventilen inte är öppen. Ett misslyckat probe-anrop (nätfel)
// memoiseras inte, så nästa skrivning försöker igen.
export const ensureConditionalWrites = async () => {
  if (verification?.result?.ok) return verification.result;
  if (!verification) {
    verification = { promise: verifyConditionalWrites(probeFactory()) };
    verification.result = await verification.promise;
  } else if (verification.promise) {
    verification.result = await verification.promise;
  }
  const result = verification.result;
  if (result.ok) return result;
  if (result.error) verification = null; // transient: försök igen nästa gång
  if (allowUnversioned()) {
    console.error("case-store: villkorade skrivningar kunde inte verifieras men CASE_STORE_ALLOW_UNVERSIONED är satt - skriver OVILLKORAT.", result);
    return result;
  }
  throw new UnversionedStoreError("conditional_writes_unverified", result);
};

// ---------------------------------------------------------------------------
// Läs / skriv
// ---------------------------------------------------------------------------

// { item, etag, etagSource }. etag är undefined om bloben saknas eller SDK:n
// inte ger någon (då är versionerad skrivning omöjlig; writeIfMatch stoppar).
export const readWithEtag = async (store, key, { allowMissingEtag = false } = {}) => {
  if (!key) return { item: null, etag: undefined, etagSource: "none" };
  if (!hasMetadataRead(store)) {
    if (!allowMissingEtag && !allowUnversioned()) throw new UnversionedStoreError("sdk_without_metadata_read");
    const item = await store.get(key, { type: "json" });
    return { item: item ?? null, etag: undefined, etagSource: "none" };
  }
  const result = await store.getWithMetadata(key, { type: "json" });
  if (!result) return { item: null, etag: undefined, etagSource: "none" };
  let item = result.data ?? null;
  let etag = typeof result.etag === "string" && result.etag ? result.etag : undefined;
  let etagSource = etag ? "get" : "none";
  // Lokala utvecklingsservern: etag bara på list. I produktion kommer den med GET.
  if (!etag && typeof store.list === "function") {
    // Lokala servern URL-kodar nycklar i list-svaret (":" → "%3A"); jämför avkodat.
    const decode = (value) => { try { return decodeURIComponent(String(value ?? "")); } catch { return String(value ?? ""); } };
    const find = (page) => (page?.blobs || []).find((blob) => blob?.key === key || decode(blob?.key) === key);
    let entry = find(await store.list({ prefix: key }).catch(() => null));
    if (!entry && encodeURIComponent(key) !== key) entry = find(await store.list({ prefix: encodeURIComponent(key) }).catch(() => null));
    if (entry && typeof entry.etag === "string" && entry.etag) {
      etag = entry.etag;
      etagSource = "list";
      // Data och etag kommer från två anrop. Läs datan IGEN efter etag-uppslaget:
      // skriver någon emellan får vi ny data med gammal etag, och den villkorade
      // skrivningen faller (412) i stället för att tyst vinna med gammal data.
      const again = await store.getWithMetadata(key, { type: "json" });
      item = again?.data ?? item;
    }
  }
  return { item, etag, etagSource };
};

// Villkorad skrivning. { modified, etag, conditional }.
// Utan etag, eller om SDK:n inte svarar med { modified }, kastas
// UnversionedStoreError — om inte nödventilen är öppen (då skrivs ovillkorat
// och conditional: false rapporteras).
export const writeIfMatch = async (store, key, value, etag) => {
  if (!etag) {
    if (!allowUnversioned()) throw new UnversionedStoreError("etag_missing", { key });
    console.error("case-store: skriver OVILLKORAT utan etag (CASE_STORE_ALLOW_UNVERSIONED).", { key });
    const result = await store.setJSON(key, value);
    return { modified: true, etag: isWriteResult(result) ? result.etag : undefined, conditional: false };
  }
  await ensureConditionalWrites();
  const result = await store.setJSON(key, value, { onlyIfMatch: etag });
  if (!isWriteResult(result)) {
    if (!allowUnversioned()) throw new UnversionedStoreError("sdk_without_conditional_writes", { key });
    return { modified: true, etag: undefined, conditional: false };
  }
  return { modified: result.modified, etag: result.etag, conditional: true };
};

// Skapa-om-saknas. { created, item, verified }.
//   created: true  → vi skapade posten (verifierat av onlyIfNew)
//   created: false → någon annan hann före; `item` är vinnaren
// Kan dedupliceringen inte verifieras (SDK utan { modified }) kastas
// UnversionedStoreError; med nödventilen öppen returneras
// { created: true, verified: false } — ALDRIG ett verifierat "dublett".
export const createIfAbsent = async (store, key, value) => {
  await ensureConditionalWrites();
  const result = await store.setJSON(key, value, { onlyIfNew: true });
  if (!isWriteResult(result)) {
    if (!allowUnversioned()) throw new UnversionedStoreError("sdk_without_conditional_writes", { key });
    return { created: true, item: value, verified: false, etag: undefined };
  }
  if (result.modified) return { created: true, item: value, verified: true, etag: result.etag };
  const winner = await readWithEtag(store, key, { allowMissingEtag: true }).catch(() => ({ item: null }));
  return { created: false, item: winner.item, verified: true, etag: winner.etag };
};

// Läs–bygg–skriv med omförsök (generisk för alla JSON-poster).
//   build(current, { attempt }) -> next | null (null = avbryt utan att skriva)
//   { current, etag } från readWithEtag om anroparen redan läst; annars läses här.
// Returnerar { ok: true, item, attempts, conflict, etag, conditional } eller
// { ok: false, reason: "not_found" | "aborted" | "conflict" | "unversioned" }.
// Kastar aldrig för lagringsproblem — anroparen får ett svar att mappa.
export const commitJson = async (store, key, build, { current = null, etag, retries = DEFAULT_RETRIES } = {}) => {
  let item = current;
  let version = etag;
  let conditional = false;
  const maxAttempts = Math.max(1, Number(retries) || 0) + 1;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!item || attempt > 1) {
        const read = await readWithEtag(store, key);
        item = read.item;
        version = read.etag;
        if (!item) return { ok: false, reason: "not_found", attempts: attempt };
      }
      const next = await build(item, { attempt });
      if (!next) return { ok: false, reason: "aborted", attempts: attempt, item };
      const written = await writeIfMatch(store, key, next, version);
      conditional = written.conditional;
      if (written.modified) {
        return { ok: true, item: next, attempts: attempt, conflict: attempt > 1, etag: written.etag, conditional };
      }
    }
    return { ok: false, reason: "conflict", attempts: maxAttempts, conditional };
  } catch (error) {
    if (error instanceof UnversionedStoreError) {
      console.error("case-store: skrivning stoppad, versionskontroll kan inte garanteras.", { key, code: error.code });
      return { ok: false, reason: "unversioned", code: error.code, detail: error.detail, attempts: 0 };
    }
    // Nätfel/5xx efter SDK:ns egna omförsök: ett svar att mappa (503), inte
    // ett ofångat undantag som döljer att ett utskick redan gått.
    console.error("case-store: lagringsfel", { key, error: String(error?.message || error).slice(0, 160) });
    return { ok: false, reason: "storage_error", error: String(error?.message || error).slice(0, 160), attempts: 0 };
  }
};
export const commitCase = commitJson;

// Hjälp för HTTP-svar: 409 vid konflikt efter alla omförsök, 404 om posten
// försvann under tiden, 503 om lagringen inte kan garantera versionskontroll.
// `json` = funktionens egna svarsbyggare.
export const commitFailureResponse = (result, json) => {
  if (result.reason === "not_found") return json({ error: "Ärendet finns inte längre.", code: "not_found" }, 404);
  if (result.reason === "conflict") {
    return json({ error: "Ärendet ändrades samtidigt av någon annan. Ladda om och försök igen.", code: "conflict", attempts: result.attempts }, 409);
  }
  if (result.reason === "unversioned") {
    return json({ error: "Lagringen kan inte garantera versionskontroll just nu. Ändringen sparades inte.", code: "storage_unversioned", detail: result.code || "" }, 503);
  }
  if (result.reason === "storage_error") {
    return json({ error: "Lagringen svarade inte. Ändringen sparades inte.", code: "storage_error" }, 503);
  }
  return json({ error: "Ändringen avbröts.", code: result.reason || "aborted" }, 409);
};

// Svag etag-kontroll för klienter som skickar If-Match (NEMOB OS 2.0). Tom
// header = ingen kontroll (bakåtkompatibelt med admin-sidorna).
export const ifMatchSatisfied = (request, etag) => {
  const header = String(request?.headers?.get?.("if-match") || "").trim();
  if (!header || header === "*") return true;
  if (!etag) return false;
  const wanted = header.split(",").map((part) => part.trim().replace(/^W\//, "").replace(/^"|"$/g, ""));
  const mine = String(etag).replace(/^W\//, "").replace(/^"|"$/g, "");
  return wanted.includes(mine);
};

export const etagHeaders = (etag) => (etag ? { ETag: String(etag) } : {});

// Filsäker nyckel (lokala servern lagrar nycklar som filnamn; kolon fungerar
// inte på Windows). ISO-tid utan kolon/punkt + valfria delar.
export const safeKey = (...parts) => parts
  .map((part) => String(part ?? "").replace(/[^A-Za-z0-9_+.-]/g, "-"))
  .filter(Boolean)
  .join("_")
  .slice(0, 180);
export const stampKey = (date = new Date()) => date.toISOString().replace(/[:.]/g, "-");

// Reservation ("claim") av en köpost innan den bearbetas: två överlappande
// körningar (schemalagd flush som drar över, dubbelklick på Godkänn, två
// parallella webhook-leveranser) får inte båda skicka. Den som vinner den
// villkorade skrivningen äger posten; en reservation äldre än `staleMs`
// räknas som övergiven (krasch mitt i) och får tas över.
// Returnerar { ok: true, item, etag } eller { ok: false, reason: "not_found" | "in_flight" | "unversioned" | "conflict" }.
export const claimJson = async (store, key, { staleMs = 10 * 60 * 1000, by = "", now = Date.now(), current = null, etag } = {}) => {
  try {
    let item = current;
    let version = etag;
    if (!item) {
      const read = await readWithEtag(store, key);
      item = read.item;
      version = read.etag;
    }
    if (!item) return { ok: false, reason: "not_found" };
    const claimedAt = new Date(item.claimedAt || 0).getTime();
    if (Number.isFinite(claimedAt) && claimedAt > 0 && now - claimedAt < staleMs) return { ok: false, reason: "in_flight", item };
    const next = { ...item, claimedAt: new Date(now).toISOString(), claimedBy: String(by || "").slice(0, 80), claimCount: (Number(item.claimCount) || 0) + 1 };
    const written = await writeIfMatch(store, key, next, version);
    if (!written.modified) return { ok: false, reason: "conflict" };
    return { ok: true, item: next, etag: written.etag, conditional: written.conditional };
  } catch (error) {
    if (error instanceof UnversionedStoreError) return { ok: false, reason: "unversioned", code: error.code };
    throw error;
  }
};
