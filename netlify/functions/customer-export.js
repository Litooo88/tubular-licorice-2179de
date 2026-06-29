const { clean, json, requireAdmin } = require("./_shared/http");
const { connectBlobs, list } = require("./_shared/storage");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PLACEHOLDERS = new Set(["email@example.com", "test@example.com"]);
const MISSING_BLOBS_RE = /MissingBlobsEnvironmentError|BlobsEnvironment|not been configured to use Netlify Blobs/i;
const EXPORT_VERSION = "customer-export-v2-api-cases";
const PHONE_PLACEHOLDERS = new Set(["saknas", "telefon saknas", "unknown", "okand", "okänd", "test"]);

const normalizeEmail = (value) => clean(value, 240).toLowerCase();
const normalizePhone = (value) => {
  const raw = clean(value, 80);
  if (!raw || PHONE_PLACEHOLDERS.has(raw.toLowerCase())) return "";
  const compact = raw.replace(/[^\d+]/g, "");
  if (!compact || compact.replace(/\D/g, "").length < 6) return "";
  return raw;
};

const isValidCustomerEmail = (value) => {
  const email = normalizeEmail(value);
  return Boolean(email) && EMAIL_RE.test(email) && !PLACEHOLDERS.has(email);
};

const addEmailCandidate = (emailMap, phoneMap, { email, name, phone, caseId, customerId, source }) => {
  const normalized = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const base = {
    name: clean(name, 160),
    phone: normalizedPhone,
    customerId: clean(customerId, 180),
    caseIds: [],
    sources: [],
  };
  if (caseId) base.caseIds.push(clean(caseId, 180));
  if (source) base.sources.push(source);

  if (isValidCustomerEmail(normalized)) {
    const existing = emailMap.get(normalized) || { email: normalized, ...base };
    existing.name = existing.name || base.name;
    existing.phone = existing.phone || base.phone;
    existing.customerId = existing.customerId || base.customerId;
    for (const id of base.caseIds) if (id && !existing.caseIds.includes(id)) existing.caseIds.push(id);
    for (const sourceName of base.sources) if (sourceName && !existing.sources.includes(sourceName)) existing.sources.push(sourceName);
    emailMap.set(normalized, existing);
  }

  if (normalizedPhone) {
    const phoneKey = normalizedPhone.replace(/[^\d+]/g, "");
    const existing = phoneMap.get(phoneKey) || { phone: normalizedPhone, email: isValidCustomerEmail(normalized) ? normalized : "", ...base };
    existing.name = existing.name || base.name;
    existing.email = existing.email || (isValidCustomerEmail(normalized) ? normalized : "");
    existing.customerId = existing.customerId || base.customerId;
    for (const id of base.caseIds) if (id && !existing.caseIds.includes(id)) existing.caseIds.push(id);
    for (const sourceName of base.sources) if (sourceName && !existing.sources.includes(sourceName)) existing.sources.push(sourceName);
    phoneMap.set(phoneKey, existing);
  }
};

const collectFromCase = (emailMap, phoneMap, item, source) => {
  const customer = item?.customer || {};
  addEmailCandidate(emailMap, phoneMap, {
    email: customer.email || item.email || item.customerEmail,
    name: customer.name || item.customerName,
    phone: customer.phone || item.customerPhone,
    caseId: item.id || item.caseId,
    customerId: item.customerId || customer.id,
    source,
  });
};

const collectFromCustomer = (emailMap, phoneMap, item, source) => {
  addEmailCandidate(emailMap, phoneMap, {
    email: item?.email || item?.customerEmail,
    name: item?.name || item?.customerName,
    phone: item?.phone || item?.customerPhone,
    customerId: item?.id || item?.customerId,
    source,
  });
};

const isMissingBlobsEnvironment = (error) =>
  MISSING_BLOBS_RE.test(`${error?.code || ""} ${error?.name || ""} ${error?.message || ""}`);

const sourceLabel = (entity) => ({
  service_cases: "workshop_cases",
  customers: "customers",
  communication_events: "communication_events",
})[entity] || entity;

const readSource = async (entity, collector, emailMap, phoneMap, warnings, options = {}) => {
  const label = options.label || sourceLabel(entity);
  try {
    const rows = await list(entity);
    if (!rows.length) {
      if (!options.optional) warnings.push(`${label}: tom eller saknar poster.`);
      return { source: label, entity, count: 0, optional: Boolean(options.optional) };
    }
    rows.forEach((row) => collector(emailMap, phoneMap, row, label));
    return { source: label, entity, count: rows.length, optional: Boolean(options.optional) };
  } catch (error) {
    const code = clean(error?.code || error?.name || "STORAGE_UNAVAILABLE", 80);
    const message = clean(error?.message || "Kallan kunde inte lasas.", 240);
    console.error("customer-export source failed", { source: entity, code, message });
    const sourceUnavailable = isMissingBlobsEnvironment(error);
    if (!options.optional) {
      warnings.push(sourceUnavailable
        ? `${label}: storage ej konfigurerad for denna function.`
        : `${label}: kunde inte lasas (${code}).`);
    }
    return {
      source: label,
      entity,
      count: 0,
      error: code,
      optional: Boolean(options.optional),
      sourceUnavailable,
    };
  }
};

const header = (event, name) => {
  const headers = event?.headers || {};
  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  return key ? String(headers[key] || "") : "";
};

const originFor = (event) => {
  const host = header(event, "host");
  if (!host) return "";
  const forwardedProto = header(event, "x-forwarded-proto");
  const protocol = forwardedProto || (host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
};

const readAdminCasesSource = async (event, emailMap, phoneMap, warnings) => {
  const origin = originFor(event);
  if (!origin) {
    warnings.push("admin_cases_api: kunde inte bygga intern URL.");
    return { source: "admin_cases_api", count: 0, error: "MISSING_ORIGIN" };
  }
  try {
    const response = await fetch(`${origin}/api/cases`, {
      headers: { "x-admin-token": header(event, "x-admin-token") },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = clean(data?.error || response.statusText || `HTTP_${response.status}`, 120);
      warnings.push(`admin_cases_api: kunde inte lasas (${code}).`);
      return { source: "admin_cases_api", count: 0, error: code };
    }
    const rows = Array.isArray(data.cases) ? data.cases : [];
    if (!rows.length) {
      warnings.push("admin_cases_api: tom eller saknar poster.");
      return { source: "admin_cases_api", count: 0 };
    }
    rows.forEach((row) => collectFromCase(emailMap, phoneMap, row, "admin_cases_api"));
    return { source: "admin_cases_api", count: rows.length };
  } catch (error) {
    const code = clean(error?.code || error?.name || "ADMIN_CASES_API_UNAVAILABLE", 80);
    const message = clean(error?.message || "Admin cases API kunde inte lasas.", 240);
    console.error("customer-export admin cases source failed", { code, message });
    warnings.push(`admin_cases_api: kunde inte lasas (${code}).`);
    return { source: "admin_cases_api", count: 0, error: code };
  }
};

exports.handler = async (event) => {
  connectBlobs(event);
  try {
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const warnings = [];
    const customersByEmail = new Map();
    const customersByPhone = new Map();
    const sources = [];

    const adminCasesSource = await readAdminCasesSource(event, customersByEmail, customersByPhone, warnings);
    sources.push(adminCasesSource);
    if (!adminCasesSource.count) {
      sources.push(await readSource("service_cases", collectFromCase, customersByEmail, customersByPhone, warnings, {
        label: "workshop_cases_direct",
      }));
    } else {
      sources.push({
        source: "workshop_cases_direct",
        entity: "service_cases",
        count: 0,
        skipped: true,
        reason: "admin_cases_api already read workshop-cases",
      });
    }
    sources.push(await readSource("customers", collectFromCustomer, customersByEmail, customersByPhone, warnings, { optional: true }));
    sources.push(await readSource("communication_events", (emailMap, phoneMap, item, source) => {
      addEmailCandidate(emailMap, phoneMap, {
        email: item?.from,
        name: item?.from,
        phone: item?.phone || item?.fromPhone,
        caseId: item?.caseId,
        customerId: item?.customerId,
        source,
      });
    }, customersByEmail, customersByPhone, warnings, { optional: true }));

    const customers = [...customersByEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
    const emails = customers.map((customer) => customer.email);
    const phoneCustomers = [...customersByPhone.values()].sort((a, b) => a.phone.localeCompare(b.phone));
    const phones = phoneCustomers.map((customer) => customer.phone);
    const unavailableSources = sources.filter((source) => source.sourceUnavailable);
    const storageHealth = {
      ok: unavailableSources.length === 0,
      storageAvailable: unavailableSources.length === 0,
      unavailableSources: unavailableSources.map((source) => source.entity || source.source).filter(Boolean),
      warnings: unavailableSources.map((source) => `${source.entity || source.source}: ${source.error || "storage_unavailable"}`),
    };
    if (unavailableSources.length) {
      warnings.push(`Customer export storage unavailable: ${storageHealth.unavailableSources.join(", ")} (${storageHealth.warnings.join(" | ")}).`);
    }
    if (!emails.length && phones.length) warnings.push(`Inga e-postadresser hittades, men ${phones.length} telefonnummer finns.`);
    if (!emails.length && !phones.length) {
      const primaryUnavailable = sources.some((source) => !source.optional && source.sourceUnavailable);
      warnings.push(primaryUnavailable
        ? "Kundkortskallan kunde inte lasas fran denna function. Admin kan fortfarande anvanda redan laddade kundkort fran /api/cases."
        : "Inga riktiga kund-e-postadresser eller telefonnummer hittades. Placeholder/testadresser filtrerades bort.");
    }

    return json(200, {
      version: EXPORT_VERSION,
      customers,
      emails,
      phones,
      emailCount: emails.length,
      phoneCount: phones.length,
      count: emails.length,
      phoneCustomers,
      sources,
      storageHealth,
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
      version: EXPORT_VERSION,
      error: "Function error",
      code: clean(error?.code || error?.name || "CUSTOMER_EXPORT_ERROR", 80),
      customers: [],
      emails: [],
      phones: [],
      emailCount: 0,
      phoneCount: 0,
      count: 0,
      sources: [],
      storageHealth: {
        ok: false,
        storageAvailable: false,
        unavailableSources: [],
        warnings: ["customer-export: ovantat fel."],
      },
      warnings: ["customer-export: ovantat fel, ingen export skapad."],
      readOnly: true,
      sendsEmail: false,
      sendsSms: false,
    });
  }
};
