import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { ROOT_CAUSES } from "./_shared/repair-index.mjs";

// Repair Intelligence Loop, steg 2–4 (läsvägen):
//
//   GET /api/case-similar?jobType=&brand=&q=&limit=
//       "Liknande fall" — matchande rader ur repair-index + aggregat
//       (vanligaste grundorsak, prisintervall P25–P75, snittid) + kanontips.
//   PUT /api/repair-canon   body {posts: [...]}
//       Synkar kunskapsbanken (kanon, ingen PII) till blob "repair-canon"
//       så att liknande fall kan berikas med bekräftad verkstadskunskap.
//   GET /api/repair-stats
//       Mätningen: ifyllnadsgrad på nya avslut, indexstorlek, träffräknare,
//       pris per jobbtyp. Ingen dashboard — JSON räcker.
//
// Allt admin-token-gatat. Ren filtrering och ordmatchning — ingen AI här.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 200) => String(value || "").trim().slice(0, max);

const readAll = async (store) => {
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  const keys = (blobs || []).map((blob) => blob.key);
  const items = [];
  for (let i = 0; i < keys.length; i += 25) {
    const batch = await Promise.all(keys.slice(i, i + 25).map((key) => store.get(key, { type: "json" }).catch(() => null)));
    for (const item of batch) if (item) items.push(item);
  }
  return items;
};

const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index];
};

const words = (value) => clean(value, 300).toLowerCase().split(/[^a-zåäö0-9]+/).filter((w) => w.length >= 3);

export default async (request) => {
  const auth = requireAdminToken(request, json, "ADMIN_TOKEN saknas i Netlify miljovariabler.");
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/repair-canon" && request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const posts = Array.isArray(body.posts) ? body.posts : [];
    if (!posts.length) return json({ error: "Inga kanonposter i importen." }, 400);
    // Grov PII-vakt: kanon ska aldrig innehålla telefonnummer.
    const suspect = posts.filter((p) => /\+?46\s?7\d[\d\s-]{6,}/.test(JSON.stringify(p)));
    if (suspect.length) return json({ error: `PII-vakt: ${suspect.length} poster ser ut att innehålla telefonnummer — import stoppad.` }, 400);
    await getStore({ name: "repair-canon", consistency: "strong" }).setJSON("canon", {
      posts,
      count: posts.length,
      importedAt: new Date().toISOString(),
      version: clean(body.version, 40),
    });
    return json({ ok: true, stored: posts.length });
  }

  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const index = getStore({ name: "repair-index", consistency: "strong" });

  if (path === "/api/repair-stats") {
    const rows = (await readAll(index)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const recent = rows.slice(0, 30);
    const filled = (field) => recent.filter((r) => r[field] !== null && r[field] !== "" && r[field] !== undefined).length;
    const byJob = {};
    for (const r of rows) {
      if (!r.totalCost) continue;
      (byJob[r.jobType] = byJob[r.jobType] || []).push(r.totalCost);
    }
    const priceByJob = Object.fromEntries(Object.entries(byJob).map(([job, costs]) => {
      const sorted = costs.sort((a, b) => a - b);
      return [job, { n: sorted.length, p25: percentile(sorted, 25), median: percentile(sorted, 50), p75: percentile(sorted, 75) }];
    }));
    const hits = await getStore({ name: "repair-canon", consistency: "strong" }).get("similar-hits", { type: "json" }).catch(() => null);
    return json({
      indexRows: rows.length,
      last30: {
        n: recent.length,
        rootCauseFilled: filled("rootCause"),
        laborMinutesFilled: filled("laborMinutes"),
        symptomFilled: filled("symptom"),
        fillRatePercent: recent.length
          ? Math.round((100 * (filled("rootCause") + filled("laborMinutes") + filled("symptom"))) / (3 * recent.length))
          : 0,
      },
      priceByJob,
      similarLookups: hits || { total: 0, withMatches: 0 },
    });
  }

  // /api/case-similar
  const jobType = clean(url.searchParams.get("jobType"), 40);
  const brand = clean(url.searchParams.get("brand"), 60).toLowerCase();
  const qWords = words(url.searchParams.get("q"));
  const limit = Math.min(10, Number(url.searchParams.get("limit")) || 5);

  const rows = (await readAll(index)).filter((r) => {
    if (jobType && r.jobType !== jobType) return false;
    if (brand && String(r.brand || "").toLowerCase() !== brand) return false;
    if (qWords.length) {
      const hay = `${r.symptom} ${r.model} ${r.workSummary} ${r.rootCauseNote}`.toLowerCase();
      if (!qWords.some((w) => hay.includes(w))) return false;
    }
    return true;
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const causeCount = {};
  for (const r of rows) if (r.rootCause) causeCount[r.rootCause] = (causeCount[r.rootCause] || 0) + 1;
  const costs = rows.map((r) => r.totalCost).filter(Boolean).sort((a, b) => a - b);
  const minutes = rows.map((r) => r.laborMinutes).filter(Boolean);

  // Kanontips: bekräftad kunskap som matchar märke/sökord.
  const canonBlob = await getStore({ name: "repair-canon", consistency: "strong" }).get("canon", { type: "json" }).catch(() => null);
  const canonTips = (canonBlob?.posts || [])
    .filter((p) => {
      const hay = JSON.stringify([p.title, p.brands, p.models, p.symptom, p.errorCodes]).toLowerCase();
      const brandHit = brand && hay.includes(brand);
      const wordHit = qWords.length && qWords.some((w) => hay.includes(w));
      return brandHit || wordHit;
    })
    .sort((a, b) => (b.confidence === "bekräftad") - (a.confidence === "bekräftad"))
    .slice(0, 3)
    .map((p) => ({ id: p.id, title: p.title, confidence: p.confidence, rootCause: p.rootCause, fix: clean(p.fix, 250), safetyCritical: p.safetyCritical === true }));

  // Träffräknare för mätningen (best effort).
  const canonStore = getStore({ name: "repair-canon", consistency: "strong" });
  const hits = (await canonStore.get("similar-hits", { type: "json" }).catch(() => null)) || { total: 0, withMatches: 0 };
  await canonStore.setJSON("similar-hits", { total: hits.total + 1, withMatches: hits.withMatches + (rows.length || canonTips.length ? 1 : 0) }).catch(() => {});

  return json({
    count: rows.length,
    aggregate: {
      topRootCauses: Object.entries(causeCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([key, count]) => ({ key, label: ROOT_CAUSES[key] || key, count })),
      priceP25: percentile(costs, 25),
      priceMedian: percentile(costs, 50),
      priceP75: percentile(costs, 75),
      avgMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
    },
    rows: rows.slice(0, limit).map((r) => ({
      at: String(r.at).slice(0, 10), jobType: r.jobType, brand: r.brand, model: r.model, symptom: r.symptom,
      rootCause: r.rootCause, rootCauseLabel: ROOT_CAUSES[r.rootCause] || "", laborMinutes: r.laborMinutes, totalCost: r.totalCost, parts: r.parts,
    })),
    canonTips,
  });
};

export const config = {
  path: ["/api/case-similar", "/api/repair-canon", "/api/repair-stats"],
};
