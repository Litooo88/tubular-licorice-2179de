import { getStore } from "@netlify/blobs";

const CATALOG_KEY = "items";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 800) => String(value || "").trim().slice(0, max);
const toNumber = (value, fallback = 0) => {
  const number = Number(String(value ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
};
const boolValue = (value) => value === true || value === "true" || value === "on" || value === 1 || value === "1";

const requireAdmin = (request) => {
  const expected = process.env.ADMIN_TOKEN || globalThis.Netlify?.env?.get?.("ADMIN_TOKEN");
  const provided = request.headers.get("x-admin-token") || "";

  if (!expected) return { ok: false, response: json({ error: "ADMIN_TOKEN saknas i Netlify miljo variabler." }, 503) };
  if (provided !== expected) return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  return { ok: true };
};

const seedItems = () => [
  { sku: "PUN-85-LAGA", category: "Dack & punktering", name: "8.5 tum laga punktering", price: 349, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "Xiaomi m.fl. Kontroll och efterdragning ingar." },
  { sku: "PUN-85-SLANG", category: "Dack & punktering", name: "8.5 tum byte slang inkl. slang", price: 449, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "PUN-85-SOLID", category: "Dack & punktering", name: "8.5 tum punkteringsfritt dack inkl. montering", price: 749, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "PUN-10-SLANG", category: "Dack & punktering", name: "10 tum byte slang inkl. slang", price: 499, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "Ninebot, NAVEE m.fl." },
  { sku: "PUN-10-DACK-SLANG", category: "Dack & punktering", name: "10 tum byte dack + slang inkl. allt", price: 649, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "PUN-10-SOLID", category: "Dack & punktering", name: "10 tum punkteringsfritt dack inkl. montering", price: 845, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "TUBELESS-MONT", category: "Tubeless / motorhjul", name: "Tubeless montering", price: 595, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "TUBELESS-SEAL", category: "Tubeless / motorhjul", name: "Tubeless + tatningsvatska", price: 695, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "TUBELESS-KOMPLETT", category: "Tubeless / motorhjul", name: "Komplett dack + montering", price: 895, unit: "fran", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "Franpris." },
  { sku: "BAT-GRUND", category: "Batteri & felsokning", name: "Batterifelsokning grund", price: 745, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "Cell, BMS och laddning." },
  { sku: "BAT-AVANCERAD", category: "Batteri & felsokning", name: "Avancerad batteridiagnos", price: 945, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "EL-FELSOK", category: "Batteri & felsokning", name: "Felsokning elsystem", price: 395, unit: "fran", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "Franpris." },
  { sku: "SERVICE-GRUND", category: "Service & paket", name: "Grundservice", price: 395, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "BROMS-JUST", category: "Service & paket", name: "Bromsjustering", price: 295, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "SERVICE-CHECK", category: "Service & paket", name: "Var-/hostcheck", price: 695, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "SERVICE-HAMT", category: "Service & paket", name: "Hamtning + service + leverans", price: 995, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "SERVICE-PREMIUM", category: "Service & paket", name: "Premium sakerhetsgenomgang", price: 1295, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
  { sku: "LOGISTIK", category: "Extra tjanster", name: "Upphamtning / leverans", price: 199, unit: "fran", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "Franpris." },
  { sku: "PRIO", category: "Extra tjanster", name: "Akutjobb / prio", price: 299, unit: "st", vatRate: 25, fortnoxArticleNumber: "", active: true, notes: "" },
];

const normalizeItem = (item, index = 0) => {
  const sku = clean(item.sku || item.id || `PRICE-${index + 1}`, 80).toUpperCase();
  return {
    id: clean(item.id || sku, 100) || `PRICE-${index + 1}`,
    sku,
    category: clean(item.category, 120) || "Ovrigt",
    name: clean(item.name, 180) || "Namnlös prisrad",
    price: Math.max(0, Math.round(toNumber(item.price, 0))),
    unit: clean(item.unit, 40) || "st",
    vatRate: toNumber(item.vatRate, 25),
    fortnoxArticleNumber: clean(item.fortnoxArticleNumber, 80),
    active: item.active === undefined ? true : boolValue(item.active),
    notes: clean(item.notes, 800),
    updatedAt: clean(item.updatedAt, 80) || new Date().toISOString(),
  };
};

const loadCatalog = async (store) => {
  const saved = await store.get(CATALOG_KEY, { type: "json" });
  if (saved?.items?.length) return saved.items.map(normalizeItem);
  const now = new Date().toISOString();
  const items = seedItems().map((item, index) => normalizeItem({ ...item, updatedAt: now }, index));
  await store.setJSON(CATALOG_KEY, { items, updatedAt: now });
  return items;
};

export default async (request) => {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  const store = getStore({ name: "price-catalog", consistency: "strong" });

  if (request.method === "GET") {
    const items = await loadCatalog(store);
    return json({ items, updatedAt: new Date().toISOString() });
  }

  if (request.method === "PUT" || request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const items = Array.isArray(body.items) ? body.items.map((item, index) => normalizeItem({ ...item, updatedAt: now }, index)) : [];
    if (!items.length) return json({ error: "Minst en prisrad kravs." }, 400);
    await store.setJSON(CATALOG_KEY, { items, updatedAt: now });
    return json({ ok: true, items, updatedAt: now });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/price-catalog",
};
