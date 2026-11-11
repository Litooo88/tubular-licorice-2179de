// Versionerade skrivningar mot Netlify Blobs (etag + onlyIfMatch).
//
// Problemet (audit F02, 2026-09-07): alla ärendeskrivare gör `get` → ändra →
// `setJSON`. Två parallella anrop (admin-PATCH + outbox-flush, Nova-webhook +
// case-sms, två flikar i admin) läser samma version och den som skriver sist
// vinner — den andras ändring försvinner tyst. @netlify/blobs ≥ 9 kan skriva
// villkorat: `setJSON(key, value, { onlyIfMatch: etag })` returnerar
// `{ modified: false }` om bloben ändrats sedan läsningen.
//
// Mönstret här: läs med etag, bygg nästa version med en REN funktion
// `build(current)`, skriv villkorat, och kör `build` igen på färsk data vid
// konflikt. Sidoeffekter (SMS, mejl, kalender) görs EN gång före `commitCase`
// och resultatet fångas i closuren, så att ett omförsök bara applicerar samma
// resultat på den nya versionen — aldrig skickar om.
//
// Fallback: om SDK:n saknar villkorade skrivningar (8.x returnerar undefined)
// skrivs ovillkorat och `conditional: false` rapporteras, så att
// storage-health kan larma i stället för att alla skrivningar stoppas.

import { getStore } from "@netlify/blobs";

export const CASE_STORE = "workshop-cases";
export const DEFAULT_RETRIES = 3;

export const caseStore = () => getStore({ name: CASE_STORE, consistency: "strong" });

const hasMetadataRead = (store) => typeof store?.getWithMetadata === "function";

// { item, etag }. etag är undefined om bloben saknas eller SDK:n inte ger någon.
export const readWithEtag = async (store, key) => {
  if (!key) return { item: null, etag: undefined };
  if (!hasMetadataRead(store)) {
    const item = await store.get(key, { type: "json" });
    return { item: item ?? null, etag: undefined };
  }
  const result = await store.getWithMetadata(key, { type: "json" });
  if (!result) return { item: null, etag: undefined };
  const item = result.data ?? null;
  let etag = typeof result.etag === "string" && result.etag ? result.etag : undefined;
  // Netlifys lokala utvecklingsserver (@netlify/blobs/server) sätter etag på
  // PUT och list men inte på GET. I produktion kommer etag alltid med GET, så
  // list-uppslaget körs bara lokalt/i tester.
  if (!etag && typeof store.list === "function") {
    const page = await store.list({ prefix: key }).catch(() => null);
    const entry = (page?.blobs || []).find((blob) => blob?.key === key);
    if (entry && typeof entry.etag === "string" && entry.etag) etag = entry.etag;
  }
  return { item, etag };
};

// Villkorad skrivning. { modified, etag, conditional }. `conditional` säger om
// villkoret faktiskt tillämpades (etag fanns och SDK:n stöder det).
export const writeIfMatch = async (store, key, value, etag) => {
  const options = etag ? { onlyIfMatch: etag } : {};
  const result = await store.setJSON(key, value, options);
  if (!result || typeof result.modified !== "boolean") {
    return { modified: true, etag: undefined, conditional: false };
  }
  return { modified: result.modified, etag: result.etag, conditional: Boolean(etag) };
};

// Skapa-om-saknas. { created, item } — `item` är vinnaren om någon annan hann
// före (t.ex. två webhook-leveranser av samma bokning).
export const createIfAbsent = async (store, key, value) => {
  const result = await store.setJSON(key, value, { onlyIfNew: true });
  if (!result || typeof result.modified !== "boolean") return { created: true, item: value, conditional: false };
  if (result.modified) return { created: true, item: value, conditional: true };
  const winner = await store.get(key, { type: "json" }).catch(() => null);
  return { created: false, item: winner, conditional: true };
};

// Läs–bygg–skriv med omförsök.
//   build(current) -> next | null (null = avbryt utan att skriva)
//   { current, etag } från readWithEtag om anroparen redan läst; annars läses här.
// Returnerar { ok, item, attempts, conflict, conditional } eller
// { ok: false, reason: "not_found" | "aborted" | "conflict" }.
export const commitCase = async (store, key, build, { current = null, etag, retries = DEFAULT_RETRIES } = {}) => {
  let item = current;
  let version = etag;
  let conditional = false;
  const maxAttempts = Math.max(1, Number(retries) || 0) + 1;
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
};

// Hjälp för HTTP-svar: 409 vid konflikt efter alla omförsök, 404 om ärendet
// försvann under tiden. `json` = funktionens egna svarsbyggare.
export const commitFailureResponse = (result, json) => {
  if (result.reason === "not_found") return json({ error: "Ärendet finns inte längre.", code: "not_found" }, 404);
  if (result.reason === "conflict") {
    return json({ error: "Ärendet ändrades samtidigt av någon annan. Ladda om och försök igen.", code: "conflict", attempts: result.attempts }, 409);
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
