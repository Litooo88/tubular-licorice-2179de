// Sebastians tillgänglighet för samtal (presence) – transaktionell och spårbar.
//
// Store "presence", nyckel "current":
//   { status, until, note, setBy, setAt, routing: { mode, plan, applied, dryRun }, history: [...] }
// Statusar:
//   available_workshop  – samtal kopplas som vanligt (Sebastian/verkstaden)
//   nova_only           – Nova (röstagenten) tar alla samtal
//   unavailable         – ingen koppling, röstbrevlåda/notis
// `until` (ISO) ger automatisk återställning till available_workshop: både
// läsning och skrivning normaliserar en passerad sluttid och loggar
// återställningen i historiken ("auto_reset").
//
// VIKTIGT: den faktiska telefonroutingen ändras INTE av den här modulen.
// `routing.plan` beskriver vad voice-simple SKULLE göra; `applied` blir sant
// först när env PRESENCE_ROUTING_ENABLED=1 är satt OCH voice-simple läser
// presence (separat, godkänt uppdrag med testad fallback). Tills dess är
// allt dry-run och verifierbart i historiken.

import { getStore } from "@netlify/blobs";
import { commitJson, createIfAbsent, readWithEtag } from "./case-store.mjs";

export const PRESENCE_STORE = "presence";
export const PRESENCE_KEY = "current";
export const PRESENCE_STATUSES = Object.freeze({
  available_workshop: { label: "Tillgänglig (verkstad)", routing: { connect: "sebastian_then_fallback", voicemail: true } },
  nova_only: { label: "Bara Nova", routing: { connect: "nova_agent", voicemail: true } },
  unavailable: { label: "Otillgänglig", routing: { connect: "none", voicemail: true, notify: true } },
});
export const DEFAULT_STATUS = "available_workshop";
export const MAX_HISTORY = 50;
export const MAX_DURATION_MINUTES = 7 * 24 * 60;

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
export const routingEnabled = () => /^(1|true|yes)$/i.test(String(env("PRESENCE_ROUTING_ENABLED") || "").trim());
const store = () => getStore({ name: PRESENCE_STORE, consistency: "strong" });

export const defaultPresence = (now = Date.now()) => ({
  status: DEFAULT_STATUS, until: "", note: "", setBy: "system", setAt: new Date(now).toISOString(),
  routing: { mode: DEFAULT_STATUS, plan: PRESENCE_STATUSES[DEFAULT_STATUS].routing, applied: false, dryRun: !routingEnabled() },
  history: [],
});

// Ren: applicerar automatisk sluttid. Returnerar { presence, changed }.
export const normalizePresence = (current, now = Date.now()) => {
  const base = current && typeof current === "object" ? current : defaultPresence(now);
  const status = PRESENCE_STATUSES[base.status] ? base.status : DEFAULT_STATUS;
  const untilMs = base.until ? new Date(base.until).getTime() : 0;
  if (status !== DEFAULT_STATUS && untilMs && untilMs <= now) {
    const resetAt = new Date(now).toISOString();
    return {
      changed: true,
      presence: {
        ...base, status: DEFAULT_STATUS, until: "", note: "", setBy: "auto_reset", setAt: resetAt,
        routing: { mode: DEFAULT_STATUS, plan: PRESENCE_STATUSES[DEFAULT_STATUS].routing, applied: false, dryRun: !routingEnabled() },
        history: [...(Array.isArray(base.history) ? base.history : []), { at: resetAt, status: DEFAULT_STATUS, by: "auto_reset", from: status, reason: `sluttid ${base.until} passerad` }].slice(-MAX_HISTORY),
      },
    };
  }
  return { changed: false, presence: { ...base, status, history: Array.isArray(base.history) ? base.history : [] } };
};

export const presenceView = (presence, now = Date.now()) => ({
  status: presence.status,
  label: PRESENCE_STATUSES[presence.status]?.label || presence.status,
  until: presence.until || null,
  remainingMinutes: presence.until ? Math.max(0, Math.round((new Date(presence.until).getTime() - now) / 60000)) : null,
  note: presence.note || "",
  setBy: presence.setBy || "",
  setAt: presence.setAt || "",
  // applied = telefonisystemet har faktiskt läst statusen och satt appliedAt.
  // Varken set_presence eller env-flaggan kan göra den sann.
  routing: { ...(presence.routing || {}), applied: routingEnabled() && Boolean(presence.routing?.appliedAt), dryRun: !routingEnabled() },
  recentHistory: (presence.history || []).slice(-5).reverse(),
});

// Läser (och persisterar en ev. automatisk återställning). Kastar aldrig på saknad post.
export const getPresence = async ({ now = Date.now() } = {}) => {
  const s = store();
  const { item, etag } = await readWithEtag(s, PRESENCE_KEY, { allowMissingEtag: true });
  if (!item) return { presence: defaultPresence(now), etag: undefined, exists: false };
  const normalized = normalizePresence(item, now);
  if (normalized.changed) {
    const saved = await commitJson(s, PRESENCE_KEY, (fresh) => normalizePresence(fresh, now).presence, { current: item, etag });
    return { presence: saved.ok ? saved.item : normalized.presence, etag: saved.etag, exists: true, autoReset: true };
  }
  return { presence: normalized.presence, etag, exists: true };
};

// Sätter status transaktionellt (versionerad skrivning). { ok, presence, previous } eller { ok: false, error }.
export const setPresence = async ({ status, untilMinutes = null, until = null, note = "", by = "ai-gateway", now = Date.now() } = {}) => {
  const next = clean(status, 40);
  if (!PRESENCE_STATUSES[next]) return { ok: false, error: "invalid_status", description: `Tillåtna: ${Object.keys(PRESENCE_STATUSES).join(", ")}` };
  let untilIso = "";
  if (until) {
    const t = new Date(until).getTime();
    if (!Number.isFinite(t) || t <= now) return { ok: false, error: "invalid_until", description: "until måste vara en framtida ISO-tid." };
    if (t - now > MAX_DURATION_MINUTES * 60000) return { ok: false, error: "invalid_until", description: `Max ${MAX_DURATION_MINUTES} minuter.` };
    untilIso = new Date(t).toISOString();
  } else if (untilMinutes !== null && untilMinutes !== undefined) {
    const minutes = Number(untilMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_DURATION_MINUTES) return { ok: false, error: "invalid_until", description: `untilMinutes måste vara 1–${MAX_DURATION_MINUTES}.` };
    untilIso = new Date(now + minutes * 60000).toISOString();
  }
  if (next !== DEFAULT_STATUS && !untilIso) return { ok: false, error: "until_required", description: "nova_only och unavailable kräver en sluttid (untilMinutes eller until) så att routingen alltid återställs." };

  const s = store();
  const setAt = new Date(now).toISOString();
  const build = (fresh) => {
    const current = normalizePresence(fresh, now).presence;
    return {
      ...current, status: next, until: untilIso, note: clean(note, 200), setBy: clean(by, 60), setAt,
      routing: { mode: next, plan: PRESENCE_STATUSES[next].routing, applied: false, dryRun: !routingEnabled(), appliedAt: "" },
      history: [...current.history, { at: setAt, status: next, until: untilIso, by: clean(by, 60), note: clean(note, 200), from: current.status }].slice(-MAX_HISTORY),
    };
  };
  const existing = await readWithEtag(s, PRESENCE_KEY, { allowMissingEtag: true });
  let saved;
  if (!existing.item) {
    const created = await createIfAbsent(s, PRESENCE_KEY, build(defaultPresence(now)));
    saved = created.created ? { ok: true, item: created.item } : await commitJson(s, PRESENCE_KEY, build);
  } else {
    saved = await commitJson(s, PRESENCE_KEY, build, { current: existing.item, etag: existing.etag });
  }
  if (!saved.ok) return { ok: false, error: saved.reason === "unversioned" ? "storage_unversioned" : "conflict", description: "Tillgängligheten kunde inte sparas säkert. Inget ändrades." };
  const previous = existing.item ? normalizePresence(existing.item, now).presence.status : DEFAULT_STATUS;
  return { ok: true, presence: saved.item, previous, routingApplied: false, dryRun: !routingEnabled() };
};
