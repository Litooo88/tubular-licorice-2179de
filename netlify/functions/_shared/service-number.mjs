import { randomBytes } from "node:crypto";

const SERVICE_NUMBER_PATTERN = /^NEM-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})$/;

export const normalizeServiceNumber = (value) => {
  const compact = String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const match = compact.match(/^NEM([0-9A-F]{12})$/);
  if (!match) return "";
  const token = match[1];
  return `NEM-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
};

export const isServiceNumber = (value) => SERVICE_NUMBER_PATTERN.test(normalizeServiceNumber(value));

export const createServiceNumber = () => {
  const token = randomBytes(6).toString("hex").toUpperCase();
  return `NEM-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
};

export const serviceNumberForCase = (caseItem) => normalizeServiceNumber(caseItem?.serviceNumber);

export const reserveServiceNumber = async (indexStore, caseId, preferred = "") => {
  const normalizedPreferred = normalizeServiceNumber(preferred);
  if (normalizedPreferred) {
    const existing = await indexStore.get(normalizedPreferred, { type: "json" }).catch(() => null);
    if (!existing?.caseId || existing.caseId === caseId) {
      await indexStore.setJSON(normalizedPreferred, { caseId, serviceNumber: normalizedPreferred });
      return normalizedPreferred;
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const serviceNumber = createServiceNumber();
    const existing = await indexStore.get(serviceNumber, { type: "json" }).catch(() => null);
    if (existing?.caseId) continue;
    await indexStore.setJSON(serviceNumber, { caseId, serviceNumber });
    return serviceNumber;
  }

  throw new Error("Kunde inte skapa ett unikt servicenummer.");
};

const listAllKeys = async (store) => {
  const keys = [];
  let cursor;
  do {
    const result = await store.list(cursor ? { cursor } : undefined);
    keys.push(...(result.blobs || []).map((blob) => blob.key).filter(Boolean));
    cursor = result.cursor;
  } while (cursor);
  return keys;
};

export const findCaseByServiceNumber = async ({ caseStore, indexStore, serviceNumber }) => {
  const normalized = normalizeServiceNumber(serviceNumber);
  if (!normalized) return null;

  const indexed = await indexStore.get(normalized, { type: "json" }).catch(() => null);
  if (indexed?.caseId) {
    const item = await caseStore.get(indexed.caseId, { type: "json" }).catch(() => null);
    if (item && serviceNumberForCase(item) === normalized) return item;
  }

  const keys = await listAllKeys(caseStore);
  for (let offset = 0; offset < keys.length; offset += 25) {
    const batch = keys.slice(offset, offset + 25);
    const items = await Promise.all(batch.map((key) => caseStore.get(key, { type: "json" }).catch(() => null)));
    const match = items.find((item) => item && serviceNumberForCase(item) === normalized);
    if (!match) continue;
    await indexStore.setJSON(normalized, { caseId: match.id, serviceNumber: normalized }).catch(() => {});
    return match;
  }

  return null;
};
