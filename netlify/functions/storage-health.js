const { clean, env, json, requireAdmin } = require("./_shared/http");

let getStore;

const loadGetStore = () => {
  if (!getStore) ({ getStore } = require("@netlify/blobs"));
  return getStore;
};

const STORE_NAMES = [
  "workshop-cases",
  "customers",
  "communication-events",
  "call-logs",
  "case-events",
  "sms-drafts",
];

const hasAnyEnv = (names) => names.some((name) => Boolean(env(name)));

const codeFor = (error) => clean(error?.code || error?.name || "STORAGE_UNAVAILABLE", 120);

const checkStore = async (storeName) => {
  try {
    const store = loadGetStore()({ name: storeName, consistency: "strong" });
    await store.list();
    return { store: storeName, ok: true };
  } catch (error) {
    return { store: storeName, ok: false, errorCode: codeFor(error) };
  }
};

exports.handler = async (event) => {
  try {
    const auth = requireAdmin(event);
    if (!auth.ok) return auth.response;
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const storesChecked = [];
    for (const storeName of STORE_NAMES) {
      storesChecked.push(await checkStore(storeName));
    }

    const failed = storesChecked.filter((entry) => !entry.ok);
    const warnings = failed.map((entry) => `${entry.store}: ${entry.errorCode}`);

    return json(200, {
      ok: true,
      blobsAvailable: failed.length === 0,
      hasSiteId: hasAnyEnv(["NETLIFY_SITE_ID", "SITE_ID", "BLOBS_SITE_ID", "NETLIFY_BLOBS_SITE_ID"]),
      hasToken: hasAnyEnv(["NETLIFY_AUTH_TOKEN", "NETLIFY_API_TOKEN", "BLOBS_TOKEN", "NETLIFY_BLOBS_TOKEN"]),
      storesChecked,
      warnings,
      readOnly: true,
      localFallback: env("NORDIC_LOCAL_STORAGE_FALLBACK") === "1",
    });
  } catch (error) {
    console.error("storage-health failed", {
      code: codeFor(error),
      message: clean(error?.message || "", 240),
    });
    return json(500, {
      ok: false,
      error: "Function error",
      code: codeFor(error),
      blobsAvailable: false,
      hasSiteId: hasAnyEnv(["NETLIFY_SITE_ID", "SITE_ID", "BLOBS_SITE_ID", "NETLIFY_BLOBS_SITE_ID"]),
      hasToken: hasAnyEnv(["NETLIFY_AUTH_TOKEN", "NETLIFY_API_TOKEN", "BLOBS_TOKEN", "NETLIFY_BLOBS_TOKEN"]),
      storesChecked: [],
      warnings: ["storage-health: ovantat fel."],
      readOnly: true,
    });
  }
};
