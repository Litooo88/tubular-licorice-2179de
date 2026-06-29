// v2 Netlify Function (export default + Web Request/Response).
// Converted from the legacy v1 `exports.handler` form: in this deploy only v2
// functions receive the Netlify Blobs context, so v1 functions threw
// `MissingBlobsEnvironmentError` on the SAME stores that the working v2
// `workshop-cases.mjs` reads fine. This endpoint is the diagnostic probe that
// confirms the fix — `hasBlobsContext`/`blobsAvailable` should now be true.
import { getStore } from "@netlify/blobs";
import { adminTokenMatches, envValue } from "./_shared/admin-auth.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const codeFor = (error) => clean(error?.code || error?.name || "STORAGE_UNAVAILABLE", 120);

const STORE_NAMES = [
  "workshop-cases",
  "customers",
  "communication-events",
  "call-logs",
  "case-events",
  "sms-drafts",
];

const checkStore = async (storeName) => {
  try {
    const store = getStore({ name: storeName, consistency: "strong" });
    await store.list();
    return { store: storeName, ok: true };
  } catch (error) {
    return { store: storeName, ok: false, errorCode: codeFor(error) };
  }
};

export default async (request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!envValue("ADMIN_TOKEN")) return json({ error: "ADMIN_TOKEN saknas i Netlify." }, 503);
  if (!adminTokenMatches(request)) return json({ error: "Unauthorized" }, 401);

  try {
    const storesChecked = [];
    for (const storeName of STORE_NAMES) {
      storesChecked.push(await checkStore(storeName));
    }
    const failed = storesChecked.filter((entry) => !entry.ok);

    return json({
      ok: true,
      functionVersion: "v2",
      blobsAvailable: failed.length === 0,
      // The real signal: Netlify injects Blobs config here, not via SITE_ID/token env vars.
      hasBlobsContext: Boolean(envValue("NETLIFY_BLOBS_CONTEXT")),
      hasSiteId: Boolean(
        envValue("NETLIFY_SITE_ID") || envValue("SITE_ID") ||
        envValue("BLOBS_SITE_ID") || envValue("NETLIFY_BLOBS_SITE_ID"),
      ),
      storesChecked,
      warnings: failed.map((entry) => `${entry.store}: ${entry.errorCode}`),
      readOnly: true,
    });
  } catch (error) {
    return json({
      ok: false,
      functionVersion: "v2",
      error: "Function error",
      code: codeFor(error),
      blobsAvailable: false,
      hasBlobsContext: Boolean(envValue("NETLIFY_BLOBS_CONTEXT")),
      storesChecked: [],
      warnings: ["storage-health: ovantat fel."],
      readOnly: true,
    }, 500);
  }
};
