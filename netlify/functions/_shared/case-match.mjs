// Ärendematchning för inkommande meddelanden (SMS, senare e-post).
//
// Regel (uppdraget 2026-11-11): flera meddelanden från samma kund får ALDRIG
// kopplas automatiskt till fel ärende. Därför:
//   - exakt ETT aktivt ärende på numret/adressen  → "matched" (kopplas)
//   - flera aktiva ärenden                         → "ambiguous" (kandidater,
//                                                    kopplas inte, Sebastian väljer)
//   - inget aktivt men avslutade finns            → "closed_only" (kopplas inte;
//                                                    ett stängt ärende öppnas
//                                                    aldrig tyst av ett SMS)
//   - inget alls                                   → "none"
// Rena funktioner utan lagring, så att reglerna kan testas.

import { normalizePhone } from "./sms.mjs";

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

// Samma aktiva statusar som statusportalen/Nova, plus "new" (obesvarad
// bokning/förfrågan är i allra högsta grad ett pågående ärende för ett SMS).
export const OPEN_STATUSES = new Set(["new", "contacted", "checked_in", "diagnosing", "repairing", "waiting_parts", "waiting_customer", "ready"]);

const phoneOf = (item) => normalizePhone(item?.customer?.phone || item?.customerPhone || "");
const emailOf = (item) => clean(item?.customer?.email || item?.customerEmail, 240).toLowerCase();
const updatedOf = (item) => String(item?.updatedAt || item?.createdAt || "");

export const candidateRow = (item) => ({
  id: clean(item?.id, 180),
  serviceNumber: clean(item?.serviceNumber, 40),
  status: clean(item?.status, 40),
  service: clean(item?.service, 120),
  vehicle: clean(item?.vehicle?.model, 120),
  updatedAt: clean(updatedOf(item), 40),
});

const decide = (mine) => {
  const open = mine.filter((c) => OPEN_STATUSES.has(clean(c?.status, 40))).sort((a, b) => updatedOf(b).localeCompare(updatedOf(a)));
  const closed = mine.filter((c) => !OPEN_STATUSES.has(clean(c?.status, 40))).sort((a, b) => updatedOf(b).localeCompare(updatedOf(a)));
  if (open.length === 1) return { status: "matched", caseId: open[0].id, candidates: [candidateRow(open[0])] };
  if (open.length > 1) return { status: "ambiguous", caseId: "", candidates: open.slice(0, 5).map(candidateRow) };
  if (closed.length) return { status: "closed_only", caseId: "", candidates: closed.slice(0, 3).map(candidateRow) };
  return { status: "none", caseId: "", candidates: [] };
};

export const matchCaseByPhone = (cases, phone) => {
  const wanted = normalizePhone(phone);
  if (!wanted) return { status: "none", caseId: "", candidates: [] };
  return decide((Array.isArray(cases) ? cases : []).filter((c) => c && phoneOf(c) === wanted));
};

export const matchCaseByEmail = (cases, email) => {
  const wanted = clean(email, 240).toLowerCase();
  if (!wanted || !wanted.includes("@")) return { status: "none", caseId: "", candidates: [] };
  return decide((Array.isArray(cases) ? cases : []).filter((c) => c && emailOf(c) === wanted));
};

// Tidslinjerad + inkorgspost på ärendet. Ren: returnerar nästa version.
export const attachInboundToCase = (current, { channel = "sms", from = "", text = "", at = "", providerId = "", inboundKey = "" } = {}) => {
  const when = clean(at, 40) || new Date().toISOString();
  const entry = {
    at: when,
    channel: clean(channel, 20) || "sms",
    from: clean(from, 240),
    text: clean(text, 2000),
    providerId: clean(providerId, 120),
    inboundKey: clean(inboundKey, 200),
  };
  const existing = Array.isArray(current?.inboundMessages) ? current.inboundMessages : [];
  // Idempotent: samma leverans (providerId eller nyckel) läggs inte in två gånger.
  const duplicate = existing.some((e) => (entry.providerId && e?.providerId === entry.providerId) || (entry.inboundKey && e?.inboundKey === entry.inboundKey));
  if (duplicate) return null;
  const label = channel === "email" ? "Mejl" : "SMS";
  return {
    ...current,
    updatedAt: when,
    inboundMessages: [...existing, entry].slice(-50),
    lastInboundAt: when,
    timeline: [...(Array.isArray(current?.timeline) ? current.timeline : []), { at: when, event: `${label} från kund mottaget: "${clean(text, 160)}"` }],
  };
};
