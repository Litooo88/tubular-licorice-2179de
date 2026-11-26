import { hasScope } from "./ai-auth.mjs";
import { caseStore } from "./case-store.mjs";
import { customerUpdatesView } from "./customer-updates.mjs";
import { serviceNumberForCase } from "./service-number.mjs";
import {
  CHANGE_SCOPES, SAFE_WORKSHOP_STATUSES, findSyncCase, listUnsyncedCases,
  normalizeSyncChanges, submitCaseSync, syncEntryView, syncError,
} from "./customer-case-sync.mjs";

const string = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const identity = { id: string(160), serviceNumber: string(40) };
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const fields = {
  customerUpdate: { ...string(1200), description: "Saklig kundtext för granskning, utan privata uppgifter eller obekräftade påståenden." },
  status: { type: "string", enum: SAFE_WORKSHOP_STATUSES },
  followupDeadline: { ...string(40), description: "Nästa utlovade återkoppling som exakt ISO-tid med UTC-offset." },
  nextAction: string(1200),
  note: string(1000),
  workDone: { ...string(1200), description: "Uppdaterad sammanfattning av genomförda arbetsmoment, inklusive tidigare arbete som ska bevaras." },
  blockers: string(1200),
};
const writes = { version: string(200), idempotencyKey: string(120), dryRun: { type: "boolean" } };

function caseTool(name, scope, description, inputSchema, run, readOnlyHint) {
  return {
    name, scope, description, inputSchema, privateArgs: true,
    annotations: { readOnlyHint, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args, ctx) => {
      const id = args.id;
      const serviceNumber = args.serviceNumber;
      if (Boolean(id) === Boolean(serviceNumber) || (id && !/^[a-zA-Z0-9_-]+$/.test(id))) {
        return { status: "invalid", error: "invalid_case_identity", description: "Ange exakt ett giltigt ärende-ID eller servicenummer." };
      }
      const store = caseStore();
      const read = await findSyncCase({ id, serviceNumber }, store);
      if (!read.item?.id || (id && read.item.id !== id)) return syncError(read.error || "case_not_found");
      return run(args, ctx, { ...read, store });
    },
  };
}

function writeTool(name, scope, description, field) {
  const properties = field ? { [field]: fields[field] } : fields;
  return caseTool(name, scope, description, schema({ ...identity, ...writes, ...properties },
    ["version", "idempotencyKey", ...(field ? [field] : [])]), async (args, ctx, target) => {
    const { changes, error } = normalizeSyncChanges(args);
    if (error) return syncError(error);
    const missingScope = Object.keys(changes).map((key) => CHANGE_SCOPES[key]).find((required) => !hasScope(ctx.principal, required));
    if (missingScope) return { status: "rejected", error: "forbidden_scope", required: missingScope, description: `Ändringen kräver scope ${missingScope}.` };
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(args.idempotencyKey)) {
      return { status: "invalid", error: "invalid_idempotency_key", description: "Använd en unik nyckel på 8–120 tecken, exempelvis ett UUID." };
    }
    return submitCaseSync({ ...target, version: args.version, idempotencyKey: args.idempotencyKey,
      dryRun: args.dryRun, changes, actor: ctx.principal.client.id, now: ctx.now });
  }, false);
}

export const caseSyncTools = [
  caseTool("get_customer_updates", "case_updates:read", "Läs publicerade kunduppdateringar och aktuell version för ett ärende.", schema(identity),
    (_args, _ctx, { item, etag }) => ({ status: "ok", id: item.id, serviceNumber: serviceNumberForCase(item), version: etag, customerUpdates: customerUpdatesView(item) }), true),
  writeTool("append_customer_update", CHANGE_SCOPES.customerUpdate, "Köa en kundsynlig status för operatörens granskning. Läs tillbaka efter publicering. Inget SMS eller mejl.", "customerUpdate"),
  writeTool("update_case_status", CHANGE_SCOPES.status, "Spara en godkänd pågående verkstadsstatus. Läs kundkortet och använd dess version.", "status"),
  writeTool("set_followup_deadline", CHANGE_SCOPES.followupDeadline, "Spara överenskommen återkopplingstid i arbetsplaneringen.", "followupDeadline"),
  writeTool("set_next_action", CHANGE_SCOPES.nextAction, "Spara nästa konkreta interna arbetsmoment i arbetsplaneringen.", "nextAction"),
  caseTool("get_case_details", "case_details:read", "Läs aktuellt kundkort, version och arbetsplan. Journal och kunduppdateringar läses med respektive verktyg.", schema(identity),
    (_args, _ctx, { item, etag }) => ({
      status: "ok", id: item.id, serviceNumber: serviceNumberForCase(item), version: etag,
      caseStatus: clean(item.status, 60), service: clean(item.service, 160),
      vehicle: { brand: clean(item.vehicle?.brand, 80), model: clean(item.vehicle?.model, 180) },
      updatedAt: clean(item.updatedAt, 40), nextAction: clean(item.workshop?.nextAction, 1200) || null,
      followupDeadline: clean(item.casePlan?.followupDeadline, 40) || null, blockers: clean(item.casePlan?.blockers, 1200) || null,
    }), true),
  {
    name: "get_unsynced_cases", scope: "case_sync:read", description: "Lista väntande, misslyckade och konfliktdrabbade kundkortssynkar i arbetsplaneringen.",
    privateArgs: true, inputSchema: schema({ limit: { type: "integer", minimum: 1, maximum: 50 }, offset: { type: "integer", minimum: 0 } }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ limit = 3, offset = 0 }) => {
      const entries = await listUnsyncedCases();
      const cases = entries.slice(offset, offset + limit).map(syncEntryView);
      return { status: "ok", cases, total: entries.length, nextOffset: offset + cases.length < entries.length ? offset + cases.length : null };
    },
  },
  writeTool("sync_customer_case", "case_sync:write", "Spara valda ändringar tillsammans på samma versionsstyrda kundkort. Kundtext granskas av en operatör före hela skrivningen. Återanvänd samma idempotencyKey vid omförsök."),
];
