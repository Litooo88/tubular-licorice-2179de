// Read-only-klient mot Nordic E-Mobilitys briefing-endpoint.
//
// SÄKERHETSKONTRAKT:
// - URL:en läses ENDAST från miljövariabeln NORDIC_BRIEF_URL.
// - URL:en får aldrig loggas, aldrig returneras i API-svar och aldrig ingå i
//   felmeddelanden (fetch-fel kan innehålla adressen i error.cause — därför
//   mappas alla fel till generiska koder här och råfelet släpps aldrig vidare).
// - Endast GET. Ingen kod här kan göra writes mot Nordic.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { mapBrief } from "./brief.mjs";

const FETCH_TIMEOUT_MS = 8000;

const readCache = (cachePath) => {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.data) return parsed;
  } catch {
    // Ingen cache ännu — helt ok.
  }
  return null;
};

const writeCache = (cachePath, entry) => {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(entry), "utf8");
    renameSync(tmpPath, cachePath);
  } catch {
    // Cache är best effort — ett cachefel får inte fälla hämtningen.
  }
};

// Returnerar alltid ett säkert objekt:
//   { status: "ok", fetchedAt, brief }
//   { status: "not_configured" }
//   { status: "down", code, cache: { fetchedAt, brief } | null }
export const fetchNordicBrief = async ({ cachePath, fetchImpl = fetch, env = process.env } = {}) => {
  const url = String(env.NORDIC_BRIEF_URL || "").trim();
  if (!url) return { status: "not_configured" };

  const cached = () => {
    const entry = readCache(cachePath);
    if (!entry) return null;
    const brief = mapBrief(entry.data);
    return brief.valid ? { fetchedAt: entry.fetchedAt, brief } : null;
  };

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const code = error?.name === "TimeoutError" ? "timeout" : "unreachable";
    return { status: "down", code, cache: cached() };
  }

  if (!response.ok) {
    return { status: "down", code: `http_${response.status}`, cache: cached() };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { status: "down", code: "invalid_json", cache: cached() };
  }

  const brief = mapBrief(data);
  if (!brief.valid) {
    return { status: "down", code: "invalid_payload", cache: cached() };
  }

  const fetchedAt = new Date().toISOString();
  if (cachePath) writeCache(cachePath, { fetchedAt, data });
  return { status: "ok", fetchedAt, brief };
};
