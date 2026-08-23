// Skrivande klient mot Nordic-admin — ENDAST två whitelistade åtgärder:
//   ring kund (POST /api/cases/:id/call) och SMS:a kund (POST /api/cases/:id/sms).
//
// SÄKERHETSKONTRAKT (utvidgning av lib/admin-cases.mjs, som förblir read-only):
// - Token läses ENDAST från env NORDIC_ADMIN_TOKEN, server-till-server.
//   Den loggas aldrig, returneras aldrig och når aldrig telefonen.
// - Inga andra admin-endpoints kan nås härifrån: path byggs från en fast
//   tabell, ärende-id valideras, ingen fri URL eller metod från anroparen.
// - Åtgärderna ändrar inte ärendestatus, bokar inte om och skickar ingen mail.
//   De skapar spårbar kundkontakt (timeline + logg) — inget annat.
// - Fel mappas till generiska koder — aldrig råa felmeddelanden vidare.

const FETCH_TIMEOUT_MS = 12000;
const CASE_ID = /^[A-Za-z0-9_\-:.]{4,120}$/;

const ACTIONS = {
  call: { path: (id) => `/api/cases/${encodeURIComponent(id)}/call` },
  sms: { path: (id) => `/api/cases/${encodeURIComponent(id)}/sms` },
};

const clean = (value, max = 1600) => String(value ?? "").trim().slice(0, max);

// Returnerar alltid ett säkert objekt:
//   { status: "ok", result }            — result = adminens svar (status, call/sms)
//   { status: "not_configured" }
//   { status: "rejected", code, error } — 4xx från admin (t.ex. dubblettskydd)
//   { status: "down", code }
export const runAdminAction = async (
  action,
  caseId,
  payload = {},
  { fetchImpl = fetch, env = process.env } = {},
) => {
  const spec = ACTIONS[action];
  if (!spec) return { status: "rejected", code: "unknown_action", error: "Okänd åtgärd." };
  if (!CASE_ID.test(String(caseId || ""))) return { status: "rejected", code: "invalid_case", error: "Ogiltigt ärende-id." };
  if (action === "sms" && !clean(payload.message)) return { status: "rejected", code: "missing_message", error: "Skriv ett meddelande först." };

  const token = String(env.NORDIC_ADMIN_TOKEN || "").trim();
  if (!token) return { status: "not_configured" };
  const base = String(env.NORDIC_SITE_URL || "https://www.nordicemobility.se").replace(/\/$/, "");

  const body = action === "sms"
    ? { message: clean(payload.message), kind: "generic", operator: "NEMOB OS" }
    : { operator: "NEMOB OS" };

  let response;
  try {
    response = await fetchImpl(`${base}${spec.path(caseId)}`, {
      method: "POST",
      headers: { "x-admin-token": token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return { status: "down", code: error?.name === "TimeoutError" ? "timeout" : "unreachable" };
  }

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) return { status: "down", code: "unauthorized" };
  if (response.status >= 500) return { status: "down", code: `http_${response.status}` };
  if (!response.ok) return { status: "rejected", code: `http_${response.status}`, error: clean(data?.error, 200) || "Åtgärden avvisades." };
  if (data?.status === "not_configured") return { status: "not_configured" };
  return { status: "ok", result: { status: clean(data?.status, 40), call: data?.call || null, sms: data?.sms || null } };
};
