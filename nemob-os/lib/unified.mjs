import { fetchAdminCases } from "./admin-cases.mjs";
import { prioritize } from "./priority.mjs";
import { stockholmDate } from "./constants.mjs";

const DEFAULT_ORIGIN = "https://www.nordicemobility.se";

export function resolveNordicOrigin(env = process.env) {
  try {
    const url = new URL(env.NORDIC_SITE_URL || DEFAULT_ORIGIN);
    if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1")) {
      return url.origin;
    }
  } catch {
    // Bad configuration is surfaced as an unavailable source.
  }
  return null;
}

const CLOSED = new Set(["done", "archived", "closed", "cancelled"]);
const text = (value) => typeof value === "string" ? value.trim().slice(0, 140) : "";
const count = (value) => Number.isInteger(value) && value >= 0;

function caseRow(item) {
  return {
    id: text(item.id),
    reference: text(item.serviceNumber),
    title: text(item.vehicle?.model || item.service) || "Verkstadsärende",
    status: text(item.status),
  };
}

export function summarizeCases(result, now = new Date()) {
  if (result.status !== "ok") return { status: result.status };
  const open = result.cases.filter((item) => item?.id && !CLOSED.has(item.status));
  const pending = open.filter((item) => item.bookingRequest?.status === "pending");
  const review = open.filter((item) => item.workshop?.needsSebastianReview === true);
  const decisions = [...new Set([...pending, ...review])];
  const today = stockholmDate(now);
  const bookingDate = (item) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(item.preferredDate || "")
    ? item.preferredDate.slice(0, 16) : "";
  const bookingRow = (item) => ({
    ...caseRow(item),
    date: bookingDate(item),
    customer: text(item.customer?.name),
    vehicle: [text(item.vehicle?.brand), text(item.vehicle?.model)].filter(Boolean).join(" "),
    confirmed: item.bookingRequest?.status === "confirmed" || item.bookingMode === "direct",
  });
  const byDate = (a, b) => (a.date || "9999").localeCompare(b.date || "9999");
  const bookingQueue = pending.map(bookingRow).sort(byDate);
  const bookings = open
    .filter((item) => item.source === "website-booking" &&
      !["declined", "pending"].includes(item.bookingRequest?.status))
    .map(bookingRow)
    .filter((row) => row.date && row.date.slice(0, 10) >= today)
    .sort(byDate);
  const ready = open.filter((item) => item.status === "ready" && item.payment?.status === "unpaid");
  return {
    status: "ok",
    fetchedAt: result.fetchedAt,
    open: open.length,
    pending: pending.length,
    review: review.length,
    workshopDecisions: review.map(caseRow),
    upcoming: bookings.length,
    readyUnpaid: ready.length,
    cases: open.slice(0, 8).map(caseRow),
    decisions: decisions.slice(0, 5).map((item) => ({
      ...caseRow(item),
      reason: item.bookingRequest?.status === "pending" ? "Bokningsförfrågan" : "Verkstaden behöver besked",
    })),
    bookingQueue,
    bookings,
    ready: ready.slice(0, 8).map(caseRow),
  };
}

export async function fetchCommunication({ env = process.env, fetchImpl = fetch } = {}) {
  const token = env.NORDIC_ADMIN_TOKEN?.trim();
  if (!token) return { status: "not_configured" };
  try {
    const origin = resolveNordicOrigin(env);
    if (!origin) return { status: "down" };
    const url = new URL("/api/kommunikation?days=7", origin);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "x-admin-token": token },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { status: "down" };
    const data = await response.json();
    const nova = data.today?.nova;
    if (!Array.isArray(data.pending) || !Array.isArray(data.contacts) || !count(data.counts?.waiting) ||
      !count(nova?.smsOut) || !count(nova.callsIn) || !count(nova.chats)) return { status: "down" };
    return {
      status: "ok",
      partial: data.sources?.elksCalls !== "ok" || data.sources?.elksSms !== "ok",
      waiting: data.counts.waiting,
      pending: data.pending.length,
      queuedSms: data.pending.filter((item) => item && typeof item.message === "string").map((item) => ({
        source: text(item.sourceLabel || item.source), message: item.message.slice(0, 1600),
      })),
      contacts: data.contacts.filter((item) => item?.waiting === true).slice(0, 3).map((item) => ({
        name: text(item.name) || "Kund utan registrerat namn",
        hours: Number.isFinite(item.waitingHours) ? Math.max(0, Math.floor(item.waitingHours)) : null,
      })),
      nova: { smsOut: nova.smsOut, callsIn: nova.callsIn, chats: nova.chats },
    };
  } catch {
    return { status: "down" };
  }
}

export async function fetchDrafts({ env = process.env, fetchImpl = fetch } = {}) {
  const token = env.NORDIC_ADMIN_TOKEN?.trim();
  if (!token) return { status: "not_configured" };
  try {
    const origin = resolveNordicOrigin(env);
    if (!origin) return { status: "down" };
    const response = await fetchImpl(new URL("/api/sms-drafts", origin), {
      method: "GET",
      headers: { Accept: "application/json", "x-admin-token": token },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { status: "down" };
    const data = await response.json();
    if (!Array.isArray(data.drafts)) return { status: "down" };
    return { status: "ok", drafts: data.drafts.filter((item) => item && typeof item.message === "string")
      .map((item) => ({ customer: text(item.meta?.namn), message: item.message.slice(0, 1600) })) };
  } catch {
    return { status: "down" };
  }
}

export async function readUnifiedBusiness() {
  const origin = resolveNordicOrigin();
  const [cases, communication, drafts] = await Promise.all([
    origin ? fetchAdminCases({ env: { ...process.env, NORDIC_SITE_URL: origin } }) : { status: "down" },
    fetchCommunication(),
    fetchDrafts(),
  ]);
  return { cases: summarizeCases(cases), communication, drafts, origin };
}

export function readUnifiedPlanning(tasks) {
  const row = (task, reason) => ({
    title: text(task.title), next: text(task.nextStep), reason: text(reason), status: text(task.status),
  });
  return {
    priorities: prioritize(tasks).slice(0, 3).map(({ task, reason }) => row(task, reason)),
    tasks: tasks.map((task) => row(task)),
  };
}
