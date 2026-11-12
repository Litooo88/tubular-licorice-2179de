import { resolveNordicOrigin } from "./unified.mjs";

const clean = (value) => typeof value === "string" ? value.trim().slice(0, 160) : "";
const rows = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const searches = {
  calls: "search_calls",
  customers: "search_customer",
  presence: "get_presence",
};

export async function readAssistant(kind, query, { env = process.env, fetchImpl = fetch } = {}) {
  if (!Object.hasOwn(searches, kind)) return { status: "invalid" };
  const token = env.NEMOB_GATEWAY_TOKEN?.trim();
  if (!token) return { status: "not_configured" };
  const origin = resolveNordicOrigin(env);
  if (!origin) return { status: "down" };
  const value = clean(query);
  if (kind === "customers" && value.length < 2) return { status: "invalid" };
  if (kind === "calls" && value && (!/^\+?[0-9 ()-]+$/.test(value) || value.replace(/\D/g, "").length < 3)) {
    return { status: "invalid" };
  }
  const body = kind === "calls" ? { limit: 25, ...(value ? { phone: value } : {}) }
    : kind === "customers" ? { query: value, limit: 25 } : {};
  try {
    const response = await fetchImpl(new URL("/api/ai/tools/" + searches[kind], origin), {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(25000),
    });
    if (response.status === 401 || response.status === 403) return { status: "forbidden" };
    if (response.status === 429) return { status: "rate_limited" };
    if (!response.ok) return { status: "down" };
    const data = await response.json();
    if (data.status === "not_configured") return { status: "not_configured" };
    if (!["ok", "partial"].includes(data.status)) return { status: data.status === "invalid" ? "invalid" : "down" };
    const partial = data.status === "partial" || data.truncated === true;
    if (kind === "calls" && Array.isArray(data.calls)) return { status: "ok", partial, rows: rows(data.calls).map((row) =>
      [row.at, row.direction === "incoming" ? "Inkommande" : "Utgående", row.from, row.to, row.outcomeLabel].map(clean).filter(Boolean)) };
    if (kind === "customers" && Array.isArray(data.cases)) return { status: "ok", partial, rows: rows(data.cases).map((row) =>
      [row.serviceNumber, row.customer?.name, row.vehicle?.model, row.service, row.status].map(clean).filter(Boolean)) };
    if (kind === "presence" && data.presence) {
      const presence = data.presence;
      return { status: "ok", partial, label: clean(presence.label), until: clean(presence.until),
        routing: presence.routing?.applied === true ? "Bekräftad" : "Ej bekräftad",
        history: rows(presence.recentHistory).map((row) => [row.at, row.from, row.status].map(clean).filter(Boolean)),
        options: Object.fromEntries(Object.entries(data.statuses || {}).filter(([key]) =>
          ["available_workshop", "nova_only", "unavailable"].includes(key)).map(([key, label]) => [key, clean(label)])),
      };
    }
    return { status: "down" };
  } catch {
    return { status: "down" };
  }
}
