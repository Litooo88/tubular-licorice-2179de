const { getStore } = require("@netlify/blobs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { clean } = require("./http");

const ENTITIES = Object.freeze({
  customers: { store: "customers" },
  service_cases: { store: "workshop-cases" },
  case_events: { store: "case-events" },
  sms_drafts: { store: "sms-drafts" },
  call_logs: { store: "call-logs" },
  part_needs: { store: "part-needs" },
  price_rules: { store: "price-catalog", collectionKey: "items" },
  ai_recommendations: { store: "ai-recommendations" },
  payments: { store: "payments" },
});

const idFor = (prefix = "item") =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const storeFor = (entity) => {
  const config = ENTITIES[entity];
  if (!config) throw new Error(`Okand storage-entitet: ${entity}`);
  if (process.env.NORDIC_LOCAL_STORAGE_FALLBACK === "1") return localStore(config.store);
  return getStore({ name: config.store, consistency: "strong" });
};

const localRoot = () => path.join(process.cwd(), ".local", "nordic-storage");

const encodeKey = (key) => encodeURIComponent(String(key));
const decodeKey = (key) => decodeURIComponent(String(key).replace(/\.json$/, ""));

const localStore = (storeName) => {
  const dir = path.join(localRoot(), clean(storeName, 64));
  const fileFor = (key) => path.join(dir, `${encodeKey(key)}.json`);
  const ensureDir = async () => {
    await fs.mkdir(dir, { recursive: true });
  };
  return {
    async list() {
      await ensureDir();
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      return {
        blobs: entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => ({ key: decodeKey(entry.name) })),
      };
    },
    async get(key, options = {}) {
      await ensureDir();
      const raw = await fs.readFile(fileFor(key), "utf8").catch(() => null);
      if (raw === null) return null;
      return options.type === "json" ? JSON.parse(raw) : raw;
    },
    async getJSON(key) {
      return this.get(key, { type: "json" });
    },
    async setJSON(key, value) {
      await ensureDir();
      await fs.writeFile(fileFor(key), JSON.stringify(value, null, 2), "utf8");
    },
    async set(key, value) {
      await ensureDir();
      await fs.writeFile(fileFor(key), typeof value === "string" ? value : JSON.stringify(value), "utf8");
    },
    async delete(key) {
      await fs.rm(fileFor(key), { force: true });
    },
  };
};

const allKeys = async (store) => {
  const keys = [];
  let cursor;
  do {
    const result = await store.list(cursor ? { cursor } : undefined);
    keys.push(...(result.blobs || []).map((blob) => blob.key).filter(Boolean));
    cursor = result.cursor;
  } while (cursor);
  return keys;
};

const get = async (entity, id) => {
  if (!id) return null;
  return storeFor(entity).get(id, { type: "json" }).catch(() => null);
};

const list = async (entity, options = {}) => {
  const config = ENTITIES[entity];
  const store = storeFor(entity);
  const keys = await allKeys(store);
  const rows = (await Promise.all(keys.map((key) => store.get(key, { type: "json" }).catch(() => null)))).filter(Boolean);
  const expanded = config.collectionKey
    ? rows.flatMap((row) => (Array.isArray(row?.[config.collectionKey]) ? row[config.collectionKey] : [row]))
    : rows;
  const filtered = expanded.filter((row) => {
    if (options.caseId && row.caseId !== options.caseId) return false;
    if (options.status && row.status !== options.status) return false;
    return true;
  });
  const sorted = filtered.sort((a, b) =>
    String(b.updatedAt || b.createdAt || b.at || "").localeCompare(String(a.updatedAt || a.createdAt || a.at || ""))
  );
  return Number(options.limit) > 0 ? sorted.slice(0, Number(options.limit)) : sorted;
};

const put = async (entity, value, options = {}) => {
  const now = new Date().toISOString();
  const id = clean(options.id || value?.id || idFor(entity.replace(/s$/, "")), 180);
  const item = {
    ...(value || {}),
    id,
    createdAt: value?.createdAt || now,
    updatedAt: now,
  };
  await storeFor(entity).setJSON(id, item);
  return item;
};

const remove = async (entity, id) => {
  await storeFor(entity).delete(id);
  return { ok: true, id };
};

const timelineText = (type, content, metadata = {}) => {
  const labels = {
    sms: "SMS",
    call: "Samtal",
    status: "Statusandring",
    status_change: "Statusandring",
    quote: "Prisforslag",
    payment: "Betalning",
    part: "Reservdel",
    note: "Intern notering",
    ai: "AI-forslag",
    ai_suggestion: "AI-forslag",
    booking: "Bokning",
  };
  return clean(
    `${labels[type] || type}: ${content || metadata.summary || metadata.message || metadata.status || metadata.text || "handelse registrerad"}`,
    600
  );
};

const appendCaseEvent = async ({
  id,
  caseId,
  customerId,
  type,
  direction = "internal",
  content,
  metadata,
  createdBy,
  createdAt,
  data = {},
  actor,
  at,
}) => {
  if (!caseId) throw new Error("caseId kravs.");
  const eventMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : data;
  const eventContent = clean(
    content || eventMetadata.summary || eventMetadata.message || eventMetadata.status || eventMetadata.text || "Handelse registrerad.",
    2000
  );
  const event = await put("case_events", {
    caseId: clean(caseId, 180),
    customerId: clean(customerId, 180),
    type: clean(type, 60),
    direction: clean(direction, 30) || "internal",
    content: eventContent,
    metadata: eventMetadata,
    createdBy: clean(createdBy || actor, 120) || "system",
    createdAt: createdAt || at || new Date().toISOString(),
  }, { id });
  const caseItem = await get("service_cases", caseId);
  if (caseItem) {
    caseItem.timeline = Array.isArray(caseItem.timeline) ? caseItem.timeline : [];
    caseItem.timeline.push({
      at: event.createdAt,
      event: timelineText(event.type, event.content, event.metadata),
      type: event.type,
      eventId: event.id,
    });
    caseItem.updatedAt = event.createdAt;
    await storeFor("service_cases").setJSON(caseId, caseItem);
  }
  return event;
};

module.exports = { ENTITIES, appendCaseEvent, get, idFor, list, put, remove, storeFor };
