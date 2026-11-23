import { allowUnversioned, caseStore, readWithEtag, writeIfMatch } from "./case-store.mjs";

const string = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const schema = (fields) => ({ type: "object", properties: fields, required: Object.keys(fields), additionalProperties: false });
const rejected = (error) => ({ status: "rejected", error });

function tool(name, scope, description, fields, action) {
  return {
    name, scope, description, inputSchema: schema({ id: string(160), ...fields }),
    run: async (args, ctx) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(args.id)) return rejected("invalid_id");
      const store = caseStore();
      const { item, etag } = await readWithEtag(store, args.id);
      if (!item || item.id !== args.id) return rejected("case_not_found");
      return action({ args, item, etag, store, ctx });
    },
  };
}

function edit(name, scope, description, field, max, update) {
  return tool(name, scope, description, { version: string(200), [field]: string(max) }, async ({ args, item, etag, store, ctx }) => {
    if (!etag || etag !== args.version || allowUnversioned()) return rejected("version_conflict");
    const value = args[field]?.trim();
    if (!value) return rejected("missing_value");
    const at = new Date(ctx.now).toISOString();
    const actor = ctx.principal.client.id;
    const next = { ...item, ...update(item, value, at), updatedAt: at, updatedBy: { name: actor, source: "ai-gateway", at } };
    const result = await writeIfMatch(store, args.id, next, etag);
    return result.modified ? { status: "ok", id: args.id, version: result.etag } : rejected("version_conflict");
  });
}

export const workshopTools = [
  tool("get_workshop_record", "journal:read", "Läs intern verkstadsjournal och belopp för ett ärende.", {}, ({ item, etag }) => ({
    status: "ok", id: item.id, version: etag, customerName: item.customer?.name ?? null,
    workDone: item.workshop?.workDone ?? null, partsUsed: item.workshop?.partsUsed ?? null,
    issuesFound: item.workshop?.issuesFound ?? null,
    notes: (item.notes ?? []).map(({ at, text }) => ({ at, text })),
    estimate: item.estimatedValue ?? null, completionTotal: item.completion?.totalCost ?? null,
    paymentAmount: item.payment?.amount ?? null, paymentStatus: item.payment?.status ?? null,
    paidAt: item.payment?.paidAt ?? null,
  })),
  edit("append_workshop_note", "journal:append", "Lägg till en intern notering efter uttrycklig begäran.", "note", 1000,
    (item, text, at) => ({ notes: [...(item.notes ?? []), { at, text }] })),
  edit("correct_customer_name", "customer:name", "Rätta namnet på det angivna kundkortet efter uttrycklig begäran.", "name", 160,
    (item, name) => ({ customer: { ...item.customer, name } })),
];
