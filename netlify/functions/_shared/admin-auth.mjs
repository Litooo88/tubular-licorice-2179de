import { timingSafeEqual } from "node:crypto";

export const envValue = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

export const tokenMatches = (expected, provided) => {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(String(expected));
  const providedBuffer = Buffer.from(String(provided));
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
};

export const adminTokenMatches = (request) => {
  const expected = envValue("ADMIN_TOKEN");
  const provided = request.headers.get("x-admin-token") || "";
  return tokenMatches(expected, provided);
};

export const requireAdminToken = (request, json, missingMessage = "ADMIN_TOKEN saknas i Netlify.") => {
  const expected = envValue("ADMIN_TOKEN");
  const provided = request.headers.get("x-admin-token") || "";
  if (!expected) return { ok: false, response: json({ error: missingMessage }, 503) };
  if (!tokenMatches(expected, provided)) return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  return { ok: true };
};
