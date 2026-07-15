// Read-only-klient mot Nordic-adminens ärendelista (GET /api/cases).
//
// SÄKERHETSKONTRAKT (samma modell som lib/nordic.mjs):
// - Token läses ENDAST från env NORDIC_ADMIN_TOKEN och skickas som
//   x-admin-token server-till-server. Den loggas aldrig, returneras aldrig
//   och når aldrig telefonen.
// - Endast GET. Ingen kod här kan skriva mot admin-API:t.
// - Fel mappas till generiska koder — aldrig råa felmeddelanden vidare.
// - Hela ärendelistan stannar i serverns minne; anroparen ansvarar för att
//   bara skicka filtrerade, whitelistade träffar vidare (lib/lookup.mjs).

const FETCH_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 60 * 1000;

let memoryCache = { fetchedAt: 0, cases: null };

export const resetCasesCache = () => {
  memoryCache = { fetchedAt: 0, cases: null };
};

// Returnerar alltid ett säkert objekt:
//   { status: "ok", cases, fetchedAt, fromCache }
//   { status: "not_configured" }
//   { status: "down", code, cases: <stale cache>|null }
export const fetchAdminCases = async ({ fetchImpl = fetch, env = process.env, now = () => Date.now() } = {}) => {
  const token = String(env.NORDIC_ADMIN_TOKEN || "").trim();
  if (!token) return { status: "not_configured" };
  const base = String(env.NORDIC_SITE_URL || "https://www.nordicemobility.se").replace(/\/$/, "");

  if (memoryCache.cases && now() - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return { status: "ok", cases: memoryCache.cases, fetchedAt: memoryCache.fetchedAt, fromCache: true };
  }

  let response;
  try {
    response = await fetchImpl(`${base}/api/cases`, {
      method: "GET",
      headers: { "x-admin-token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const code = error?.name === "TimeoutError" ? "timeout" : "unreachable";
    return { status: "down", code, cases: memoryCache.cases };
  }

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "unauthorized" : `http_${response.status}`;
    return { status: "down", code, cases: memoryCache.cases };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { status: "down", code: "invalid_json", cases: memoryCache.cases };
  }

  const cases = Array.isArray(data?.cases) ? data.cases : null;
  if (!cases) return { status: "down", code: "invalid_payload", cases: memoryCache.cases };

  memoryCache = { fetchedAt: now(), cases };
  return { status: "ok", cases, fetchedAt: memoryCache.fetchedAt, fromCache: false };
};
