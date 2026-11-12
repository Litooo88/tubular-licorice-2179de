// Delad testhjälpare (ingen testfil: node --test ska inte köra den).
// Minnesstore som beter sig som @netlify/blobs ≥ 9: etag per version,
// onlyIfMatch/onlyIfNew → { modified }.
export const etagStore = () => {
  const rows = new Map();
  let version = 0;
  const etagOf = (key) => rows.get(key)?.etag;
  return {
    rows,
    writes: 0,
    async get(key) { return structuredClone(rows.get(key)?.value ?? null); },
    async getWithMetadata(key) {
      const row = rows.get(key);
      return row ? { data: structuredClone(row.value), etag: row.etag, metadata: {} } : null;
    },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && rows.has(key)) return { modified: false };
      if (options.onlyIfMatch && etagOf(key) !== options.onlyIfMatch) return { modified: false };
      this.writes += 1;
      const etag = `"v${++version}"`;
      rows.set(key, { value: structuredClone(value), etag });
      return { modified: true, etag };
    },
    async delete(key) { rows.delete(key); },
    async list({ prefix = "" } = {}) { return { blobs: [...rows.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: rows.get(key).etag })) }; },
  };
};
