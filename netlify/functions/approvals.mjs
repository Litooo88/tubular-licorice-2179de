// GET /api/approvals — fokuslägets "beslut just nu" för NEMOB OS 2.0.
//
// Slår ihop de tre godkännandekällorna till EN lista utan att äga någon av
// dem: posterna läses som de är, och varje rad pekar på den BEFINTLIGA rutten
// som godkänner/avvisar (kommunikation approve/reject, sms-drafts
// approve/skip, cases PATCH confirm/decline_booking_request). Här skickas
// aldrig något, och ingen kö skrivs.
//
//   sms             sms-pending (godkännandespärren, _shared/comm-log.mjs)
//   draft           sms-drafts (AI-utkast, sms-draft-inbox.mjs)
//   booking_request workshop-cases med bookingMode "request" och
//                   bookingRequest.status "pending" (_shared/booking-request.mjs)
//
// Svar: { items[], counts, smsApproval, sources, generatedAt }. Fel i en
// källa fäller inte anropet: källan markeras i `sources` och listan byggs av
// det som finns (Codex visar "delvis"). Sortering: längst väntande först.
//
// Query: ?kind=sms,draft,booking_request (filter), ?limit=N (standard 200).

import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { readPendingSms, readSmsApproval, SMS_SOURCES } from "./_shared/comm-log.mjs";
import { normalizeDraft } from "./sms-draft-inbox.mjs";
import { isPendingRequest } from "./_shared/booking-request.mjs";
import { caseStore } from "./_shared/case-store.mjs";
import { normalizePhone } from "./_shared/sms.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const clean = (value, max = 300) => String(value ?? "").trim().slice(0, max);
export const KINDS = ["sms", "draft", "booking_request"];
const STALE_CLAIM_MS = 10 * 60 * 1000;

const inFlight = (claimedAt, now) => {
  const t = new Date(claimedAt || 0).getTime();
  return Number.isFinite(t) && t > 0 && now - t < STALE_CLAIM_MS;
};

// Rena byggare per källa (testbara utan lagring).
export const smsItem = (entry, now = Date.now()) => ({
  kind: "sms",
  id: clean(entry.id, 200),
  caseId: "",
  to: normalizePhone(entry.to),
  name: "",
  text: clean(entry.message, 2000),
  at: clean(entry.at, 40),
  source: clean(entry.source, 60),
  sourceLabel: SMS_SOURCES[clean(entry.source, 60)] || clean(entry.source, 60) || "okänd",
  inFlight: inFlight(entry.claimedAt, now),
  lastError: clean(entry.lastError, 200),
  approve: { method: "POST", url: "/api/kommunikation/approve", body: { id: clean(entry.id, 200) } },
  reject: { method: "POST", url: "/api/kommunikation/reject", body: { id: clean(entry.id, 200) } },
  approveUrl: "/api/kommunikation/approve",
  rejectUrl: "/api/kommunikation/reject",
});

export const draftItem = (draft, now = Date.now()) => ({
  kind: "draft",
  id: clean(draft.caseId, 200),
  caseId: clean(draft.linkedCaseId || draft.caseId, 200),
  to: normalizePhone(draft.meta?.telefon),
  name: clean(draft.meta?.namn, 140),
  text: clean(draft.message, 2000),
  at: clean(draft.importedAt || draft.createdAt, 40),
  category: clean(draft.category, 1) || "C",
  priority: Number(draft.priority) || 0,
  closeProbability: Number(draft.closeProbability) || 0,
  service: clean(draft.meta?.tjanst, 140),
  ageDays: Number(draft.meta?.alderDagar) || 0,
  inFlight: inFlight(draft.claimedAt, now),
  approve: { method: "POST", url: `/api/sms-drafts/${encodeURIComponent(clean(draft.caseId, 200))}/approve`, body: { operatorName: "", message: null } },
  reject: { method: "POST", url: `/api/sms-drafts/${encodeURIComponent(clean(draft.caseId, 200))}/skip`, body: {} },
  approveUrl: `/api/sms-drafts/${encodeURIComponent(clean(draft.caseId, 200))}/approve`,
  rejectUrl: `/api/sms-drafts/${encodeURIComponent(clean(draft.caseId, 200))}/skip`,
});

export const bookingRequestItem = (item) => {
  const id = clean(item.id, 200);
  const when = clean(item.preferredDate, 20);
  const parts = [when ? `Önskar ${when.replace("T", " ")}` : "Önskad tid saknas", clean(item.service, 120), clean(item.vehicle?.model, 120)].filter(Boolean);
  return {
    kind: "booking_request",
    id,
    caseId: id,
    serviceNumber: clean(item.serviceNumber, 40),
    to: normalizePhone(item.customer?.phone),
    name: clean(item.customer?.name, 140),
    text: parts.join(" · "),
    at: clean(item.bookingRequest?.requestedAt || item.createdAt, 40),
    requestedDate: when,
    service: clean(item.service, 120),
    vehicle: clean(item.vehicle?.model, 120),
    message: clean(item.message, 600),
    approve: { method: "PATCH", url: `/api/cases/${encodeURIComponent(id)}`, body: { action: "confirm_booking_request" } },
    reject: { method: "PATCH", url: `/api/cases/${encodeURIComponent(id)}`, body: { action: "decline_booking_request" } },
    reschedule: { method: "PATCH", url: `/api/cases/${encodeURIComponent(id)}`, body: { action: "reschedule_booking_request", preferredDate: "YYYY-MM-DDTHH:MM" } },
    approveUrl: `/api/cases/${encodeURIComponent(id)}`,
    rejectUrl: `/api/cases/${encodeURIComponent(id)}`,
  };
};

const listKeys = async (store) => {
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined);
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  return keys;
};

const loadAll = async (store) => {
  const keys = await listKeys(store);
  const items = [];
  for (let i = 0; i < keys.length; i += 40) {
    const part = await Promise.all(keys.slice(i, i + 40).map(async (key) => [key, await store.get(key, { type: "json" }).catch(() => null)]));
    items.push(...part.filter(([, value]) => value));
  }
  return items;
};

// Varje källa: { items, error }. Kastar aldrig.
const readSmsQueue = async (now) => {
  try {
    return { items: (await readPendingSms()).map((entry) => smsItem(entry, now)) };
  } catch (error) {
    return { items: [], error: clean(error?.message, 160) || "fel" };
  }
};
const readDrafts = async (now) => {
  try {
    const rows = await loadAll(getStore({ name: "sms-drafts", consistency: "strong" }));
    return { items: rows.map(([key, value]) => normalizeDraft(value, key)).filter(Boolean).map((draft) => draftItem(draft, now)) };
  } catch (error) {
    return { items: [], error: clean(error?.message, 160) || "fel" };
  }
};
const readBookingRequests = async () => {
  try {
    const rows = await loadAll(caseStore());
    return { items: rows.map(([, value]) => value).filter((item) => isPendingRequest(item)).map(bookingRequestItem) };
  } catch (error) {
    return { items: [], error: clean(error?.message, 160) || "fel" };
  }
};

export const buildApprovals = async ({ kinds = KINDS, limit = 200, now = Date.now() } = {}) => {
  const wanted = new Set(kinds.filter((k) => KINDS.includes(k)));
  const [sms, drafts, bookings, smsApproval] = await Promise.all([
    wanted.has("sms") ? readSmsQueue(now) : { items: [], skipped: true },
    wanted.has("draft") ? readDrafts(now) : { items: [], skipped: true },
    wanted.has("booking_request") ? readBookingRequests() : { items: [], skipped: true },
    readSmsApproval(),
  ]);
  const items = [...bookings.items, ...drafts.items, ...sms.items]
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
    .slice(0, limit);
  const status = (source) => (source.skipped ? "skipped" : source.error ? `error: ${source.error}` : "ok");
  return {
    items,
    counts: { total: items.length, sms: sms.items.length, draft: drafts.items.length, booking_request: bookings.items.length },
    smsApproval,
    sources: { sms: status(sms), drafts: status(drafts), bookings: status(bookings) },
    partial: Boolean(sms.error || drafts.error || bookings.error),
    generatedAt: new Date(now).toISOString(),
  };
};

export default async (request) => {
  const auth = requireAdminToken(request, json, "ADMIN_TOKEN saknas i Netlify miljovariabler.");
  if (!auth.ok) return auth.response;
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const url = new URL(request.url);
  const kindParam = clean(url.searchParams.get("kind"), 100);
  const kinds = kindParam ? kindParam.split(",").map((k) => k.trim()).filter(Boolean) : KINDS;
  if (kinds.some((k) => !KINDS.includes(k))) return json({ error: `Okänd kind. Tillåtna: ${KINDS.join(", ")}.` }, 400);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 500);
  return json(await buildApprovals({ kinds, limit }));
};

export const config = {
  path: "/api/approvals",
};
