// Intern batteriprisreferens (konkurrentbaserad, konverterad från
// Nordic_Batteriprisreferens-arket). Ren modul utan I/O förutom filladdning.
//
// VIKTIGA REGLER (från källarket, upprätthålls i kod):
// - Detta är INTERNT REFERENSMATERIAL — aldrig automatisk offert. Bannern
//   följer alltid med i API-svaren så UI:t inte kan glömma den.
// - Datafilen ligger UTANFÖR repot (env NEMOB_BATTERIREF_PATH) eftersom
//   konkurrentdata aldrig får committas eller publiceras.

import { readFileSync } from "node:fs";

let cache = { path: null, mtimeCheck: 0, data: null };

export const loadBatteriref = (path) => {
  if (!path) return { status: "not_configured" };
  try {
    // Enkel cache: läs om max var 60:e sekund.
    if (!cache.data || cache.path !== path || Date.now() - cache.mtimeCheck > 60_000) {
      cache = { path, mtimeCheck: Date.now(), data: JSON.parse(readFileSync(path, "utf8")) };
    }
    return { status: "ok", data: cache.data };
  } catch {
    return { status: "unreadable" };
  }
};

const norm = (value) => String(value || "").toLowerCase().replace(/[,]/g, ".");

// Sök i prisraderna: alla sökord måste prefix-matcha något ord i raden
// ("niu" träffar "NIU 4803" men inte "PROTANIUM").
const tokens = (text) => norm(text).split(/[^a-z0-9åäö.]+/).filter(Boolean);
const wordsMatch = (words, hayTokens) =>
  words.every((w) => hayTokens.some((t) => t.startsWith(w)));

export const searchRows = (data, query, { limit = 30 } = {}) => {
  const words = norm(query).split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  const rows = data?.prisrader || [];
  const scored = [];
  for (const row of rows) {
    const hayTokens = tokens(`${row.kategori} ${row.modell} ${row.variant} ${row.tjanst}`);
    if (!wordsMatch(words, hayTokens)) continue;
    // Modellträff rankas före ren tjänstetextträff.
    const modelTokens = tokens(`${row.modell} ${row.variant}`);
    const score = words.filter((w) => modelTokens.some((t) => t.startsWith(w))).length;
    scored.push({ row, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => row);
};

export const banner = (data) =>
  data?.status || "INTERNT REFERENSMATERIAL - inte automatisk offert. Publiceras aldrig.";

export const beslutsstod = (data) => ({
  regler: data?.regler || [],
  balanseringsregel: data?.balanseringsregel || [],
  niu4803: data?.niu4803 || null,
  prisfaktor: data?.prisfaktor ?? null,
  version: data?.version || null,
  kalla: data?.kalla || "",
});
