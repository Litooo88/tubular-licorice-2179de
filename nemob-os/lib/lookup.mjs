// Sök/uppslag i verkstadsärenden. Rena funktioner utan I/O.
//
// Integritetsprincip: telefonen får ALDRIG hela ärendedatabasen — servern
// filtrerar och skickar bara whitelistade fält för träffarna (max 20).

const CLOSED_STATUSES = new Set(["done", "archived", "closed"]);
const DAY_MS = 24 * 60 * 60 * 1000;

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

// Telefonnummer normaliseras till bara siffror utan landsprefix, så att
// "070-123 45 67", "+46701234567" och "0046 70 ..." matchar varandra.
export const normalizePhoneDigits = (value) => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0046")) digits = digits.slice(4);
  else if (digits.startsWith("46")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
};

const daysOpen = (item, now) => {
  const created = new Date(item?.createdAt || 0).getTime();
  if (!Number.isFinite(created) || created <= 0) return null;
  return Math.max(0, Math.floor((now.getTime() - created) / DAY_MS));
};

// Whitelist: exakt de fält telefonen behöver — inget annat läcker ut.
export const compactCase = (item, now = new Date()) => ({
  id: clean(item?.id, 120),
  serviceNumber: clean(item?.serviceNumber, 40) || null,
  name: clean(item?.customer?.name, 140) || null,
  phone: clean(item?.customer?.phone, 40) || null,
  vehicle: clean(item?.vehicle?.model || item?.model, 140) || null,
  service: clean(item?.service, 140) || null,
  status: clean(item?.status, 60) || null,
  paymentStatus: clean(item?.payment?.status, 40) || null,
  daysOpen: daysOpen(item, now),
  updatedAt: clean(item?.updatedAt || item?.createdAt, 40) || null,
});

const haystack = (item) =>
  [
    item?.customer?.name,
    item?.vehicle?.model,
    item?.model,
    item?.service,
    item?.status,
    item?.id,
    item?.serviceNumber,
  ]
    .map((part) => String(part || "").toLowerCase())
    .join(" ");

export const searchCases = (cases, query, { now = new Date(), limit = 20 } = {}) => {
  const q = clean(query, 120).toLowerCase();
  if (!q) return [];
  const phoneQuery = normalizePhoneDigits(q);
  const isPhoneSearch = phoneQuery.length >= 5 && /^[\d\s+\-()]+$/.test(q);

  const matches = (cases || []).filter((item) => {
    if (isPhoneSearch) {
      return normalizePhoneDigits(item?.customer?.phone).includes(phoneQuery);
    }
    return haystack(item).includes(q);
  });

  return matches
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, limit)
    .map((item) => compactCase(item, now));
};

// Prioriterad lista över pågående arbeten: äldst öppna först.
export const openCasesPrioritized = (cases, { now = new Date(), limit = 40 } = {}) =>
  (cases || [])
    .filter((item) => !CLOSED_STATUSES.has(clean(item?.status, 60)))
    .map((item) => compactCase(item, now))
    .sort((a, b) => (b.daysOpen ?? -1) - (a.daysOpen ?? -1))
    .slice(0, limit);
