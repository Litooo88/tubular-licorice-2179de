// Verktygen i NEMOB AI Gateway. Varje verktyg: { name, description, scope,
// inputSchema (JSON Schema), run(args, ctx) → resultatobjekt }.
//
// Principer:
//   - Bara läsning av befintliga datakällor (workshop-cases, 46elks,
//     godkännandekön). Ingen kopia av kunddata, inget nytt ärendesystem.
//   - Fältvitlista på ärenden: aldrig interna anteckningar, media, privata
//     fält eller LVU-material (det finns inte i Netlify-lagringen alls; NEMOB OS
//     lokala personliga data nås aldrig härifrån).
//   - set_presence är den enda skrivningen, och routingen är dry-run tills
//     PRESENCE_ROUTING_ENABLED är satt efter separat godkännande.
//   - Inga kundutskick, inga godkännanden: get_business_overview visar kön,
//     besluten tas i NEMOB OS/admin.

import { caseStore } from "./case-store.mjs";
import { normalizePhone } from "./sms.mjs";
import { OPEN_STATUSES } from "./case-match.mjs";
import { fetchElksCalls, callRow, summarizeCalls } from "./elks-calls.mjs";
import { buildApprovals } from "../approvals.mjs";
import { getPresence, presenceView, setPresence, PRESENCE_STATUSES, routingEnabled } from "./presence.mjs";
import { hasScope } from "./ai-auth.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const digitsOf = (value) => String(value || "").replace(/\D/g, "");

const listAllCases = async () => {
  const store = caseStore();
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined);
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  const items = [];
  for (let i = 0; i < keys.length; i += 40) {
    const part = await Promise.all(keys.slice(i, i + 40).map((key) => store.get(key, { type: "json" }).catch(() => null)));
    items.push(...part.filter(Boolean));
  }
  return items;
};

// Behörig vy av ett ärende (vitlista). Inga anteckningar, media, workshop-
// kommentarer, kuponger eller interna fält.
export const customerCaseView = (item) => ({
  id: clean(item.id, 80),
  serviceNumber: clean(item.serviceNumber, 40),
  status: clean(item.status, 40),
  open: OPEN_STATUSES.has(clean(item.status, 40)),
  service: clean(item.service, 160),
  vehicle: { brand: clean(item.vehicle?.brand, 80), model: clean(item.vehicle?.model, 120) },
  customer: { name: clean(item.customer?.name, 140), phone: normalizePhone(item.customer?.phone) || "", email: clean(item.customer?.email, 160) },
  source: clean(item.source, 60),
  bookingMode: clean(item.bookingMode, 20),
  bookingRequest: item.bookingRequest ? { status: clean(item.bookingRequest.status, 20), requestedDate: clean(item.bookingRequest.requestedDate, 20) } : null,
  preferredDate: clean(item.preferredDate, 20),
  payment: { status: clean(item.payment?.status, 30), amount: Number(item.payment?.amount) || Number(item.completion?.totalCost) || 0 },
  estimatedValue: Number(item.estimatedValue) || 0,
  lastInboundAt: clean(item.lastInboundAt, 40),
  lastTimeline: (Array.isArray(item.timeline) ? item.timeline : []).slice(-3).map((e) => ({ at: clean(e?.at, 40), event: clean(e?.event, 200) })),
  createdAt: clean(item.createdAt, 40),
  updatedAt: clean(item.updatedAt, 40),
});

// Lägesvy utan kunduppgifter (overview:read utan cases:read).
export const overviewCaseView = (item) => ({
  id: clean(item.id, 80),
  serviceNumber: clean(item.serviceNumber, 40),
  status: clean(item.status, 40),
  open: OPEN_STATUSES.has(clean(item.status, 40)),
  service: clean(item.service, 160),
  vehicle: { brand: clean(item.vehicle?.brand, 80), model: clean(item.vehicle?.model, 120) },
  bookingMode: clean(item.bookingMode, 20),
  preferredDate: clean(item.preferredDate, 20),
  payment: { status: clean(item.payment?.status, 30) },
  updatedAt: clean(item.updatedAt, 40),
});

const matchesQuery = (item, q) => {
  const digits = digitsOf(q);
  if (digits.length >= 6) {
    const phone = digitsOf(item.customer?.phone || item.customerPhone);
    if (phone.endsWith(digits.slice(-9)) || phone.includes(digits)) return true;
  }
  const needle = q.toLowerCase();
  if (!needle) return false;
  const hay = [item.serviceNumber, item.id, item.customer?.name, item.customer?.email, item.vehicle?.model, item.vehicle?.brand, item.service]
    .map((v) => String(v || "").toLowerCase());
  return hay.some((h) => h && h.includes(needle));
};

const parseDate = (value, fallback) => {
  if (!value) return fallback;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : fallback;
};

export const TOOLS = [
  {
    name: "search_calls",
    scope: "calls:read",
    description: "Sök i 46elks samtalshistorik: antal inkommande/utgående, besvarade, missade och röstbrevlåda per dag, plus samtalsrader (tid, riktning, nummer, längd, vem som svarade). Filtrera på telefonnummer och datumintervall (standard senaste 30 dagarna, max 90).",
    inputSchema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Telefonnummer (valfritt format). Matchar både uppringare och uppringd." },
        from: { type: "string", description: "Startdatum/tid (ISO, t.ex. 2026-11-01). Standard: 30 dagar bakåt." },
        to: { type: "string", description: "Slutdatum/tid (ISO). Standard: nu." },
        direction: { type: "string", enum: ["incoming", "outgoing", "all"], description: "Standard all." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Max antal samtalsrader i svaret (standard 50). Summeringen räknar alla träffar." },
      },
      additionalProperties: false,
    },
    run: async (args = {}, ctx = {}) => {
      const now = ctx.now || Date.now();
      const untilMs = Math.min(parseDate(args.to, now), now);
      const sinceMs = Math.max(parseDate(args.from, now - 30 * 86400000), untilMs - 90 * 86400000);
      const result = await fetchElksCalls({ sinceMs, untilMs, fetchImpl: ctx.fetchImpl || fetch });
      if (!result.ok) return { status: result.status, error: result.error || "46elks kunde inte läsas.", window: { from: new Date(sinceMs).toISOString(), to: new Date(untilMs).toISOString() } };
      const staff = { sebastian: normalizePhone(env("VOICE_PRIMARY_NUMBER") || env("VOICE_SEBASTIAN_PHONE")), workshop: normalizePhone(env("VOICE_WORKSHOP_PHONE")) };
      const wantedDigits = digitsOf(args.phone);
      const direction = ["incoming", "outgoing"].includes(args.direction) ? args.direction : "all";
      const rows = result.calls.map((c) => callRow(c, staff)).filter((row) => {
        if (direction !== "all" && row.direction !== direction) return false;
        if (wantedDigits.length >= 6) {
          const tail = wantedDigits.slice(-9);
          return digitsOf(row.from).endsWith(tail) || digitsOf(row.to).endsWith(tail);
        }
        return true;
      }).sort((a, b) => b.at.localeCompare(a.at));
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
      return {
        status: "ok",
        window: { from: new Date(sinceMs).toISOString(), to: new Date(untilMs).toISOString() },
        filter: { phone: wantedDigits ? normalizePhone(args.phone) || clean(args.phone, 40) : "", direction },
        summary: summarizeCalls(rows),
        calls: rows.slice(0, limit),
        truncated: rows.length > limit || result.truncated,
        pagesFetched: result.pages,
      };
    },
  },
  {
    name: "search_customer",
    scope: "cases:read",
    description: "Sök kundärenden på telefonnummer, namn, e-post, fordonsmodell eller ärende-/servicenummer. Returnerar behöriga ärendefält (status, tjänst, fordon, kontakt, bokning, betalstatus, senaste händelser) – aldrig interna anteckningar eller media.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, description: "Telefonnummer, namn, e-post, modell, serviceNumber (NE-…) eller ärende-id." },
        onlyOpen: { type: "boolean", description: "Bara pågående ärenden (standard false)." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Standard 20." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (args = {}) => {
      const q = clean(args.query, 120);
      if (q.length < 2) return { status: "invalid", error: "query måste vara minst två tecken." };
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const all = await listAllCases();
      const hits = all.filter((item) => matchesQuery(item, q) && (!args.onlyOpen || OPEN_STATUSES.has(clean(item.status, 40))))
        .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
      return { status: "ok", query: q, total: hits.length, cases: hits.slice(0, limit).map(customerCaseView), truncated: hits.length > limit };
    },
  },
  {
    name: "get_business_overview",
    scope: "overview:read",
    description: "Verksamhetens läge just nu: väntande godkännanden (SMS, AI-utkast, bokningsförfrågningar), pågående ärenden per status, kommande bokningar (7 dagar), ärenden som väntar på kund eller är klara för hämtning, samt Sebastians tillgänglighet. Med enbart overview:read visas antal och ärendenummer utan kunduppgifter; kundkort kräver även cases:read, tillgänglighet kräver presence:read.",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 30, description: "Horisont för kommande bokningar (standard 7)." } }, additionalProperties: false },
    run: async (args = {}, ctx = {}) => {
      const now = ctx.now || Date.now();
      const days = Math.min(Math.max(Number(args.days) || 7, 1), 30);
      // Behörighetsmodell: overview:read ger lägesbilden (antal, status, ärende-
      // nummer, tider). Kunduppgifter (namn, telefon, e-post, meddelandetext)
      // följer med bara när klienten även har cases:read; tillgänglighet bara
      // med presence:read. En rapportklient ser alltså aldrig kundkort.
      const canSeeCustomers = hasScope(ctx.principal, "cases:read");
      const canSeePresence = hasScope(ctx.principal, "presence:read");
      const [approvals, cases, presence] = await Promise.all([
        buildApprovals({ now }).catch((error) => ({ error: clean(error?.message, 120), items: [], counts: {} })),
        listAllCases().catch(() => []),
        canSeePresence ? getPresence({ now }).catch(() => ({ presence: null })) : Promise.resolve({ presence: null }),
      ]);
      const view = (c) => (canSeeCustomers ? customerCaseView(c) : overviewCaseView(c));
      const open = cases.filter((c) => OPEN_STATUSES.has(clean(c.status, 40)));
      const byStatus = {};
      for (const c of open) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      const horizon = now + days * 86400000;
      const upcoming = cases
        .filter((c) => c.preferredDate && !["done", "archived"].includes(c.status))
        .map((c) => ({ ...view(c), when: new Date(c.preferredDate).getTime() }))
        .filter((c) => Number.isFinite(c.when) && c.when >= now - 3600000 && c.when <= horizon)
        .sort((a, b) => a.when - b.when)
        .map(({ when, ...rest }) => rest);
      const priority = open
        .filter((c) => ["ready", "waiting_customer", "new"].includes(c.status))
        .sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")))
        .slice(0, 10)
        .map(view);
      return {
        status: approvals.error ? "partial" : "ok",
        generatedAt: new Date(now).toISOString(),
        redacted: !canSeeCustomers,
        approvals: { counts: approvals.counts || {}, partial: Boolean(approvals.partial || approvals.error), items: (approvals.items || []).slice(0, 15).map((i) => (canSeeCustomers
          ? { kind: i.kind, id: i.id, caseId: i.caseId, name: i.name, to: i.to, text: clean(i.text, 160), at: i.at, inFlight: Boolean(i.inFlight) }
          : { kind: i.kind, id: i.id, caseId: i.caseId, at: i.at, inFlight: Boolean(i.inFlight) })) },
        cases: { open: open.length, byStatus, readyForPickup: byStatus.ready || 0, waitingCustomer: byStatus.waiting_customer || 0, unanswered: byStatus.new || 0 },
        upcomingBookings: { days, count: upcoming.length, items: upcoming.slice(0, 20) },
        priorityCases: priority,
        presence: presence.presence ? presenceView(presence.presence, now) : null,
        presenceOmitted: !canSeePresence,
        note: "Godkännanden utförs i NEMOB OS/admin, inte via den här gatewayen.",
      };
    },
  },
  {
    name: "get_presence",
    scope: "presence:read",
    description: "Sebastians aktuella tillgänglighet för samtal (available_workshop, nova_only, unavailable), eventuell sluttid och den routingplan som gäller. routing.dryRun=true betyder att telefonroutingen ännu inte styrs av statusen.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_args = {}, ctx = {}) => {
      const now = ctx.now || Date.now();
      const { presence, autoReset } = await getPresence({ now });
      return { status: "ok", presence: presenceView(presence, now), autoReset: Boolean(autoReset), routingEnabled: routingEnabled(), statuses: Object.fromEntries(Object.entries(PRESENCE_STATUSES).map(([k, v]) => [k, v.label])) };
    },
  },
  {
    name: "set_presence",
    scope: "presence:write",
    description: "Sätt Sebastians tillgänglighet för samtal med automatisk sluttid. nova_only och unavailable kräver untilMinutes (1–10080). Ändringen loggas och är transaktionell. OBS: den faktiska telefonroutingen ändras inte förrän PRESENCE_ROUTING_ENABLED är aktiverat efter godkännande (svaret visar dryRun).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: Object.keys(PRESENCE_STATUSES) },
        untilMinutes: { type: "integer", minimum: 1, maximum: MAX_DURATION_MINUTES_EXPORT() },
        until: { type: "string", description: "Alternativ till untilMinutes: framtida ISO-tid." },
        note: { type: "string", maxLength: 200 },
      },
      required: ["status"],
      additionalProperties: false,
    },
    run: async (args = {}, ctx = {}) => {
      const now = ctx.now || Date.now();
      const result = await setPresence({ status: args.status, untilMinutes: args.untilMinutes, until: args.until, note: args.note, by: ctx.principal ? `ai:${ctx.principal.client.id}` : "ai-gateway", now });
      if (!result.ok) return { status: "rejected", error: result.error, description: result.description };
      return { status: "ok", previous: result.previous, routingApplied: false, dryRun: result.dryRun, presence: presenceView(result.presence, now) };
    },
  },
];

function MAX_DURATION_MINUTES_EXPORT() { return 7 * 24 * 60; }

export const toolByName = (name) => TOOLS.find((t) => t.name === clean(name, 60)) || null;

// Minimal JSON Schema-validering (typ, enum, required, min/max) – räcker för
// våra platta scheman och ger tydliga fel till AI-klienten.
export const validateArgs = (schema, args) => {
  const errors = [];
  const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  for (const key of schema.required || []) if (input[key] === undefined || input[key] === null || input[key] === "") errors.push(`${key} krävs`);
  for (const [key, value] of Object.entries(input)) {
    const prop = schema.properties?.[key];
    if (!prop) { if (schema.additionalProperties === false) errors.push(`okänt fält: ${key}`); continue; }
    if (value === undefined || value === null) continue;
    if (prop.type === "string" && typeof value !== "string") errors.push(`${key} ska vara text`);
    if (prop.type === "integer" && (!Number.isInteger(value))) errors.push(`${key} ska vara heltal`);
    if (prop.type === "boolean" && typeof value !== "boolean") errors.push(`${key} ska vara true/false`);
    if (prop.enum && !prop.enum.includes(value)) errors.push(`${key} ska vara en av ${prop.enum.join(", ")}`);
    if (prop.minimum !== undefined && typeof value === "number" && value < prop.minimum) errors.push(`${key} minst ${prop.minimum}`);
    if (prop.maximum !== undefined && typeof value === "number" && value > prop.maximum) errors.push(`${key} högst ${prop.maximum}`);
    if (prop.minLength !== undefined && typeof value === "string" && value.length < prop.minLength) errors.push(`${key} minst ${prop.minLength} tecken`);
    if (prop.maxLength !== undefined && typeof value === "string" && value.length > prop.maxLength) errors.push(`${key} högst ${prop.maxLength} tecken`);
  }
  return errors;
};
