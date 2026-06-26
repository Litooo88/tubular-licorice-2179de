const { clean, json, requireAdmin } = require("./_shared/http");
const { list } = require("./_shared/storage");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PLACEHOLDERS = new Set(["email@example.com", "test@example.com"]);

const normalizeEmail = (value) => clean(value, 240).toLowerCase();

const isValidCustomerEmail = (value) => {
  const email = normalizeEmail(value);
  return Boolean(email) && EMAIL_RE.test(email) && !PLACEHOLDERS.has(email);
};

const addEmailCandidate = (map, { email, name, phone, caseId, customerId, source }) => {
  const normalized = normalizeEmail(email);
  if (!isValidCustomerEmail(normalized)) return;
  const existing = map.get(normalized) || {
    email: normalized,
    name: "",
    phone: "",
    customerId: "",
    caseIds: [],
    sources: [],
  };
  existing.name = existing.name || clean(name, 160);
  existing.phone = existing.phone || clean(phone, 80);
  existing.customerId = existing.customerId || clean(customerId, 180);
  if (caseId && !existing.caseIds.includes(caseId)) existing.caseIds.push(clean(caseId, 180));
  if (source && !existing.sources.includes(source)) existing.sources.push(source);
  map.set(normalized, existing);
};

const collectFromCase = (map, item, source) => {
  const customer = item?.customer || {};
  addEmailCandidate(map, {
    email: customer.email || item.email || item.customerEmail,
    name: customer.name || item.customerName,
    phone: customer.phone || item.customerPhone,
    caseId: item.id || item.caseId,
    customerId: item.customerId || customer.id,
    source,
  });
};

const collectFromCustomer = (map, item, source) => {
  addEmailCandidate(map, {
    email: item?.email || item?.customerEmail,
    name: item?.name || item?.customerName,
    phone: item?.phone || item?.customerPhone,
    customerId: item?.id || item?.customerId,
    source,
  });
};

const readSource = async (entity, collector, map, warnings) => {
  try {
    const rows = await list(entity);
    if (!rows.length) {
      warnings.push(`${entity}: tom eller saknar poster.`);
      return { source: entity, count: 0 };
    }
    rows.forEach((row) => collector(map, row, entity));
    return { source: entity, count: rows.length };
  } catch (error) {
    const code = clean(error?.code || error?.name || "STORAGE_UNAVAILABLE", 80);
    const message = clean(error?.message || "Kallan kunde inte lasas.", 240);
    console.error("customer-export source failed", { source: entity, code, message });
    warnings.push(`${entity}: kunde inte lasas (${code}).`);
    return { source: entity, count: 0, error: code };
  }
};

exports.handler = async (event) => {
  try {
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const warnings = [];
    const customersByEmail = new Map();
    const sources = [];

    sources.push(await readSource("service_cases", collectFromCase, customersByEmail, warnings));
    sources.push(await readSource("customers", collectFromCustomer, customersByEmail, warnings));
    sources.push(await readSource("communication_events", (map, item, source) => {
      addEmailCandidate(map, {
        email: item?.from,
        name: item?.from,
        caseId: item?.caseId,
        customerId: item?.customerId,
        source,
      });
    }, customersByEmail, warnings));

    const customers = [...customersByEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
    const emails = customers.map((customer) => customer.email);
    if (!emails.length) warnings.push("Inga riktiga kund-e-postadresser hittades. Placeholder/testadresser filtrerades bort.");

    return json(200, {
      customers,
      emails,
      count: emails.length,
      sources,
      warnings,
      readOnly: true,
      sendsEmail: false,
      sendsSms: false,
    });
  } catch (error) {
    console.error("customer-export failed", {
      code: clean(error?.code || error?.name || "CUSTOMER_EXPORT_ERROR", 80),
      message: clean(error?.message || "", 240),
    });
    return json(500, {
      error: "Function error",
      code: clean(error?.code || error?.name || "CUSTOMER_EXPORT_ERROR", 80),
      customers: [],
      emails: [],
      count: 0,
      sources: [],
      warnings: ["customer-export: ovantat fel, ingen export skapad."],
    });
  }
};
