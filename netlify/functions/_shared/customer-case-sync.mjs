import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { allowUnversioned, caseStore, commitJson, createIfAbsent, readWithEtag, writeIfMatch } from "./case-store.mjs";
import { appendCustomerUpdate } from "./customer-updates.mjs";
import { normalizeServiceNumber, serviceNumberForCase } from "./service-number.mjs";

export const SYNC_STORE = "customer-case-sync";
const queueStore = () => getStore({ name: SYNC_STORE, consistency: "strong" });
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const terminal = (state) => state === "synced" || state === "rejected";

export const SAFE_WORKSHOP_STATUSES = ["diagnosing", "repairing", "waiting_parts", "waiting_customer"];
export const CHANGE_SCOPES = Object.freeze({
  customerUpdate: "case_updates:append",
  status: "case_status:write",
  followupDeadline: "case_followup:write",
  nextAction: "case_next_action:write",
  note: "journal:append",
  workDone: "journal:append",
  blockers: "case_next_action:write",
});

export const SYNC_ERRORS = {
  case_not_found: "Ärendet hittades inte. Kontrollera ärende-ID eller servicenummer.",
  ambiguous_service_number: "Flera ärenden har samma servicenummer. Använd ärende-ID.",
  version_conflict: "Läs om kundkortet och granska ändringarna. Skicka ett nytt förslag med ny nyckel efter granskning.",
  version_unavailable: "Versionsstyrd lagring är inte tillgänglig. Ingen säker skrivning kunde bekräftas.",
  idempotency_conflict: "Nyckeln används redan för ett annat innehåll eller en annan version.",
  review_required: "En operatör behöver granska kundtexten och godkänna den sparade ändringen.",
  approval_required: "Den här statusövergången hanteras i ordinarie adminflöde.",
  storage_unavailable: "Kön kunde inte bekräftas. Försök igen med samma nyckel.",
  verification_failed: "Kundkortet kunde inte verifieras. Ändringen finns i kön. Försök igen med samma nyckel.",
  superseded: "Ändringen avvisades av en operatör.",
  empty_changes: "Ange minst en ändring med ett värde.",
  invalid_deadline: "Ange ett giltigt datum och klockslag med UTC-offset, exempelvis 2026-11-27T16:00:00+01:00.",
};
export const syncError = (error, fields = {}) => ({ status: "rejected", error, description: SYNC_ERRORS[error], ...fields });

export async function findSyncCase({ id, serviceNumber }, store = caseStore()) {
  if (id) return readWithEtag(store, id);
  const normalized = normalizeServiceNumber(serviceNumber);
  if (!normalized) return { item: null };
  // Kontrollera hela mängden även om det finns ett index, så dubbelregistrerade
  // servicenummer aldrig väljer ett godtyckligt kundkort för skrivning.
  let match;
  for await (const page of store.list({ paginate: true })) {
    for (let offset = 0; offset < page.blobs.length; offset += 40) {
      const rows = await Promise.all(page.blobs.slice(offset, offset + 40).map(({ key }) => store.get(key, { type: "json" })));
      for (const row of rows) {
        if (serviceNumberForCase(row) !== normalized) continue;
        if (match) return { item: null, error: "ambiguous_service_number" };
        match = row.id;
      }
    }
  }
  if (!match) return { item: null };
  const read = await readWithEtag(store, match);
  return serviceNumberForCase(read.item) === normalized ? read : { item: null };
}

export function normalizeSyncChanges(input) {
  const changes = {};
  for (const field of Object.keys(CHANGE_SCOPES)) {
    if (input[field] === undefined) continue;
    const value = typeof input[field] === "string" ? input[field].trim() : "";
    if (!value) return { error: "empty_changes" };
    changes[field] = value;
  }
  if (changes.followupDeadline) {
    const value = changes.followupDeadline;
    const parts = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
    const timestamp = Date.parse(value);
    const day = Date.parse(value.slice(0, 10));
    if (!parts || !Number.isFinite(timestamp) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== parts[1]) {
      return { error: "invalid_deadline" };
    }
    changes.followupDeadline = new Date(timestamp).toISOString();
  }
  return Object.keys(changes).length ? { changes } : { error: "empty_changes" };
}

function validateStatus(item, changes) {
  if (!changes.status || changes.status === item.status) return null;
  if (!SAFE_WORKSHOP_STATUSES.includes(changes.status) || !["checked_in", ...SAFE_WORKSHOP_STATUSES].includes(item.status)) {
    return "approval_required";
  }
  return null;
}

function applyChanges(item, entry, actor, at) {
  const changes = entry.changes;
  const next = { ...item, updatedAt: at, updatedBy: { name: actor, source: "customer-case-sync", at } };
  if (changes.customerUpdate) next.customerUpdates = appendCustomerUpdate(item, changes.customerUpdate, at);
  if (changes.status) next.status = changes.status;
  if (changes.note) next.notes = [...(Array.isArray(item.notes) ? item.notes : []), { at, text: changes.note }];
  if (changes.nextAction || changes.workDone) {
    next.workshop = { ...item.workshop };
    if (changes.nextAction) next.workshop.nextAction = changes.nextAction;
    if (changes.workDone) next.workshop.workDone = changes.workDone;
  }
  if (changes.nextAction || changes.followupDeadline || changes.blockers) {
    next.casePlan = { ...item.casePlan, updatedAt: at };
    for (const field of ["followupDeadline", "blockers"]) {
      if (changes[field]) next.casePlan[field] = changes[field];
    }
  }
  next.timeline = [...(Array.isArray(item.timeline) ? item.timeline : []),
    { at, event: "Kundkort synkroniserat", actor, changes: entry.fields, syncId: entry.id }];
  return next;
}

export const syncEntryView = (entry) => ({
  syncId: entry.id, id: entry.caseId, serviceNumber: entry.serviceNumber,
  syncState: entry.state, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
  actor: entry.actor, fields: entry.fields, reason: entry.reason || null,
});

function outcome(entry, state, version, reason) {
  const fields = { ...syncEntryView({ ...entry, state, reason }), version: version || null,
    verified: state === "synced", applied: state === "synced" ? entry.fields : [],
    remaining: terminal(state) ? [] : entry.fields };
  if (state === "synced") return { status: "ok", ...fields };
  if (state === "pending") return { ...fields, status: "pending", requiresApproval: !entry.approvedBy, ...(reason ? { error: reason, description: SYNC_ERRORS[reason] } : {}) };
  if (state === "failed") return { ...syncError(reason, fields), status: "failed", applied: null };
  return syncError(reason, fields);
}

async function saveOutcome(queue, entry, state, reason, version, now) {
  const saved = await commitJson(queue, entry.id, (current) => {
    if (terminal(current.state) || (state === "pending" && current.approvedBy) || (current.state === state && current.reason === reason && current.version === version)) return null;
    const next = { ...current, state, reason, version: version || null, updatedAt: now };
    if (terminal(state)) delete next.changes;
    return next;
  });
  if (saved.ok || saved.reason === "aborted") {
    return outcome(saved.item, saved.item.state, version || saved.item.version, saved.item.reason);
  }
  if (terminal(state)) return { ...outcome(entry, state, version, reason), queueFinalizationPending: true };
  return outcome(entry, state, version, reason);
}

async function processEntry(queue, store, entry, { now, operator, reject = false }) {
  if (terminal(entry.state)) return outcome(entry, entry.state, entry.version, entry.reason);
  const at = new Date(now).toISOString();
  const finish = (state, reason, version) => saveOutcome(queue, entry, state, reason, version, at);
  const read = await readWithEtag(store, entry.caseId).catch(() => null);
  if (!read) return finish("failed", "verification_failed");
  const { item, etag } = read;
  const existing = item?.caseSyncReceipts?.[entry.id];
  if (existing) return finish(existing.state, existing.state === "rejected" ? "superseded" : "", etag);
  if (!item) return reject ? finish("rejected", "superseded") : finish("failed", "case_not_found");
  if (!etag || allowUnversioned()) return outcome(entry, "failed", etag, "version_unavailable");
  if (!reject && etag !== entry.baseVersion) return finish("conflict", "version_conflict", etag);
  if (!reject && entry.changes.customerUpdate && !entry.approvedBy) return finish("pending", "review_required", etag);
  const invalidStatus = !reject && validateStatus(item, entry.changes);
  if (invalidStatus) return finish("failed", invalidStatus, etag);

  const actor = operator || entry.actor;
  const state = reject ? "rejected" : "synced";
  const next = reject ? { ...item } : applyChanges(item, entry, actor, at);
  next.caseSyncReceipts = { ...item.caseSyncReceipts, [entry.id]: { state, at, actor, requestedBy: entry.actor, approvedBy: entry.approvedBy || null, fields: entry.fields } };
  const written = await writeIfMatch(store, item.id, next, etag).catch(() => null);
  // Även ett timeout-svar kan dölja en genomförd skrivning. Läs alltid tillbaka
  // kvittot som skrevs atomiskt med fälten, även när en konkurrent vann CAS.
  const verified = await readWithEtag(store, item.id).catch(() => null);
  const receipt = verified?.item?.caseSyncReceipts?.[entry.id];
  if (receipt) return finish(receipt.state, receipt.state === "rejected" ? "superseded" : "", verified.etag);
  if (written?.modified === false) return finish("conflict", "version_conflict", verified?.etag);
  return finish("failed", "verification_failed", verified?.etag);
}

export async function submitCaseSync({ item, etag, version, idempotencyKey, changes, actor, now, dryRun, store }) {
  if (!etag || allowUnversioned()) return syncError("version_unavailable");
  const statusError = validateStatus(item, changes);
  const fields = Object.keys(changes);
  if (dryRun) {
    if (etag !== version) return syncError("version_conflict", { version: etag });
    if (statusError) return syncError(statusError);
    return { status: "ok", dryRun: true, id: item.id, version: etag, applied: [], remaining: fields, requiresApproval: Boolean(changes.customerUpdate) };
  }
  const at = new Date(now).toISOString();
  const id = hash([item.id, idempotencyKey]);
  const fingerprint = hash([version, changes]);
  const queue = queueStore();
  const entry = {
    id, fingerprint, caseId: item.id, serviceNumber: serviceNumberForCase(item),
    actor, baseVersion: version, fields, changes, state: "pending", createdAt: at, updatedAt: at,
  };
  const reserved = await createIfAbsent(queue, id, entry).catch(() => null);
  if (!reserved?.verified || !reserved.item) return syncError("storage_unavailable");
  if (reserved.item.fingerprint !== fingerprint) return syncError("idempotency_conflict");
  return processEntry(queue, store, reserved.item, { now });
}

export async function listUnsyncedCases({ store = caseStore() } = {}) {
  const queue = queueStore();
  const entries = [];
  for await (const page of queue.list({ paginate: true })) {
    for (let offset = 0; offset < page.blobs.length; offset += 30) {
      const batch = await Promise.all(page.blobs.slice(offset, offset + 30).map(async ({ key }) => {
        const entry = await queue.get(key, { type: "json" });
        if (!entry || terminal(entry.state)) return null;
        const item = await store.get(entry.caseId, { type: "json" });
        return item?.caseSyncReceipts?.[entry.id] ? null : entry;
      }));
      entries.push(...batch.filter(Boolean));
    }
  }
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return entries;
}

export async function readSyncEntry(id) {
  return readWithEtag(queueStore(), id);
}

export async function approveSyncEntry(entry, etag, operator, now) {
  if (terminal(entry.state) || entry.approvedBy) return outcome(entry, entry.state, entry.version, entry.reason);
  if (!etag || allowUnversioned()) return syncError("version_unavailable");
  const store = caseStore();
  const { item, etag: currentVersion } = await readWithEtag(store, entry.caseId);
  if (!item) return syncError("case_not_found");
  if (currentVersion !== entry.baseVersion) return syncError("version_conflict");
  const at = new Date(now).toISOString();
  const next = { ...entry, approvedBy: operator, approvedAt: at, updatedAt: at, reason: "" };
  const saved = await writeIfMatch(queueStore(), entry.id, next, etag);
  return saved.modified ? outcome(next, next.state, currentVersion, "") : syncError("version_conflict");
}

export async function reviewSyncEntry(entry, { operator, reject, now }) {
  return processEntry(queueStore(), caseStore(), entry, { operator, reject, now });
}
