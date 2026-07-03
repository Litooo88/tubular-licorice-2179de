import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

// Read-only briefing endpoint for AI-assistenten.
// GET /api/claude-brief/:slug — slug jämförs mot env CLAUDE_BRIEF_SLUG.
// Fel eller saknad slug → 404 (aldrig 401; endpointen ska inte gå att skilja
// från en sida som inte finns). Inga writes någonstans i denna fil.

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });

const notFound = () => json({ error: "Not found" }, 404);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

const slugMatches = (provided) => {
  const expected = env("CLAUDE_BRIEF_SLUG");
  // Ej konfigurerad → endpointen finns inte (safe not_configured-läge).
  if (!expected || expected.length < 48) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(clean(provided, 512));
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
};

// Rate limit 60 req/h. Medvetet in-memory (sliding window) eftersom endpointen
// inte får göra writes — en Blobs-baserad räknare vore en write per anrop.
// Begränsningen gäller därmed per varm funktionsinstans och nollställs vid
// cold start; det räcker som skydd mot skrapning/brute force i kombination
// med 404-beteendet och den långa slugen.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const requestTimes = [];
const rateLimited = (now) => {
  while (requestTimes.length && now - requestTimes[0] > RATE_WINDOW_MS) requestTimes.shift();
  if (requestTimes.length >= RATE_LIMIT) return true;
  requestTimes.push(now);
  return false;
};

const CLOSED_STATUSES = new Set(["done", "archived", "closed"]);
const STOCKHOLM = "Europe/Stockholm";

const stockholmDateString = (date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: STOCKHOLM, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// preferredDate lagras som fri text i stil med "2026-07-03 10:00" eller "2026-07-03T10:00".
const preferredDateParts = (value) => {
  const match = clean(value, 120).match(/^(\d{4}-\d{2}-\d{2})[T\s]?(\d{2}:\d{2})?/);
  return match ? { date: match[1], time: match[2] || "" } : null;
};

const firstNameOf = (item) => clean(item?.customer?.name, 140).split(/\s+/).filter(Boolean)[0] || "";
const vehicleOf = (item) => clean(item?.vehicle?.model || item?.model, 180) || "Okänd modell";
const paymentStatus = (item) => clean(item?.payment?.status, 80) || "unpaid";
const quotedAmount = (item) =>
  Number(item?.quote?.amount || item?.completion?.totalCost || item?.estimatedValue || 0);

export const buildBriefData = (cases, now = new Date()) => {
  const today = stockholmDateString(now);
  const startOfYesterday = new Date(now);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const yesterday = stockholmDateString(startOfYesterday);
  const dayMs = 24 * 60 * 60 * 1000;

  const active = cases.filter((item) => !CLOSED_STATUSES.has(clean(item?.status, 60)));

  const todaysBookings = active
    .map((item) => ({ item, parts: preferredDateParts(item.preferredDate) }))
    .filter(({ parts }) => parts && parts.date === today)
    .sort((a, b) => a.parts.time.localeCompare(b.parts.time))
    .map(({ item, parts }) => ({
      time: parts.time,
      first_name: firstNameOf(item),
      vehicle: vehicleOf(item),
      case_type: clean(item.service, 120) || "Service",
      status: clean(item.status, 60),
    }));

  const openJobs = active
    .map((item) => {
      const created = new Date(item.createdAt || 0).getTime();
      const daysOpen = Number.isFinite(created) && created > 0 ? Math.floor((now.getTime() - created) / dayMs) : null;
      return {
        id: clean(item.id, 120),
        vehicle: vehicleOf(item),
        status: clean(item.status, 60),
        days_open: daysOpen,
      };
    })
    .sort((a, b) => (b.days_open ?? -1) - (a.days_open ?? -1));

  // Offert = aktivt ärende med prisförslag som väntar på kundsvar.
  // "Försenad" = ingen uppdatering på över 3 dygn.
  const overdueOffers = active.filter((item) => {
    if (!["contacted", "waiting_customer"].includes(clean(item.status, 60))) return false;
    if (!(quotedAmount(item) > 0)) return false;
    const updated = new Date(item.updatedAt || item.createdAt || 0).getTime();
    return Number.isFinite(updated) && updated > 0 && now.getTime() - updated > 3 * dayMs;
  });

  const unpaidInvoices = cases.filter((item) => paymentStatus(item) === "invoiced");

  const weekRevenue = cases.reduce((sum, item) => {
    if (paymentStatus(item) !== "paid") return sum;
    const paidAt = new Date(item?.payment?.updatedAt || item?.updatedAt || 0).getTime();
    if (!Number.isFinite(paidAt) || paidAt <= 0 || now.getTime() - paidAt > 7 * dayMs) return sum;
    return sum + Number(item?.payment?.amount || item?.completion?.totalCost || 0);
  }, 0);

  // Bokningar = kundinitierade ärenden (booking.mjs/chat sätter channel; admins
  // interna drop-in-ärenden har channel "internal"). "Sedan igår" = skapade
  // igår eller idag, Stockholm-tid.
  const newBookings = cases.filter((item) => {
    if (clean(item.channel, 40) === "internal") return false;
    const createdAt = item.createdAt ? stockholmDateString(new Date(item.createdAt)) : "";
    return createdAt === today || createdAt === yesterday;
  });

  return {
    generated_at: now.toISOString(),
    todays_bookings: todaysBookings,
    open_jobs: openJobs,
    overdue_offers_count: overdueOffers.length,
    unpaid_invoices_count: unpaidInvoices.length,
    week_revenue_sek: Math.round(weekRevenue),
    new_bookings_since_yesterday: newBookings.length,
  };
};

export default async (request, context) => {
  if (!slugMatches(context.params?.slug)) return notFound();
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (rateLimited(Date.now())) return json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "3600" });

  try {
    const store = getStore({ name: "workshop-cases" });
    const { blobs } = await store.list();
    const cases = [];
    for (const blob of blobs) {
      const item = await store.get(blob.key, { type: "json" }).catch(() => null);
      if (item && typeof item === "object") cases.push(item);
    }
    return json(buildBriefData(cases));
  } catch (error) {
    const code = clean(error?.code || error?.name || "CLAUDE_BRIEF_ERROR", 80);
    console.error("claude-brief failed", { code, message: clean(error?.message, 240) });
    return json({ error: "Function error", code }, 500);
  }
};

export const config = {
  path: "/api/claude-brief/:slug",
};
