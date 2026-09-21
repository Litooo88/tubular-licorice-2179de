// Spärrlista för inkommande samtal och SMS. Numren lagras ENDAST i
// Netlify Blobs (store "call-blocklist", nyckel = normaliserat nummer) och
// hanteras via call-dashboard i admin — aldrig i kod eller miljövariabler,
// eftersom repo och loggar inte ska innehålla personuppgifter av det slaget.
//
// Fail-open: om blob-läsningen fallerar släpps samtalet igenom. En spärr som
// brister är bättre än en telefonlinje som dör när lagringen hickar.

import { getStore } from "@netlify/blobs";

const clean = (value, max = 200) => String(value || "").trim().slice(0, max);

export const normalizeBlockPhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const blocklistStore = () => getStore({ name: "call-blocklist", consistency: "strong" });

export const isBlockedCaller = async (phone) => {
  const key = normalizeBlockPhone(phone);
  if (!key) return false;
  try {
    const entry = await blocklistStore().get(key, { type: "json" });
    return Boolean(entry);
  } catch (error) {
    console.warn("blocklist_read_failed", { message: clean(error?.message, 180) });
    return false;
  }
};

export const blockNumber = async (phone, { reason = "", by = "admin" } = {}) => {
  const key = normalizeBlockPhone(phone);
  if (!key) return { ok: false, error: "Ogiltigt nummer." };
  await blocklistStore().setJSON(key, {
    number: key,
    reason: clean(reason, 200),
    by: clean(by, 80),
    at: new Date().toISOString(),
  });
  return { ok: true, number: key };
};

export const unblockNumber = async (phone) => {
  const key = normalizeBlockPhone(phone);
  if (!key) return { ok: false, error: "Ogiltigt nummer." };
  await blocklistStore().delete(key);
  return { ok: true, number: key };
};

export const listBlockedNumbers = async () => {
  try {
    const store = blocklistStore();
    const keys = [];
    let cursor;
    do {
      const page = await store.list(cursor ? { cursor } : undefined);
      keys.push(...(page.blobs || []).map((item) => item.key).filter(Boolean));
      cursor = page.cursor;
    } while (cursor);
    const entries = await Promise.all(keys.map((key) => store.get(key, { type: "json" }).catch(() => null)));
    return entries.filter(Boolean).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  } catch (error) {
    console.warn("blocklist_list_failed", { message: clean(error?.message, 180) });
    return [];
  }
};
