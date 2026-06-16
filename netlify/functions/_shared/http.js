const clean = (value, max = 2000) => String(value ?? "").trim().slice(0, max);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
  body: JSON.stringify(body),
});

const parseBody = (event) => {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
};

const header = (event, name) => {
  const headers = event?.headers || {};
  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  return key ? String(headers[key] || "") : "";
};

const requireAdmin = (event) => {
  const expected = env("ADMIN_TOKEN");
  if (!expected) return { ok: false, response: json(503, { error: "ADMIN_TOKEN saknas i Netlify-miljon." }) };
  if (header(event, "x-admin-token") !== expected) return { ok: false, response: json(401, { error: "Unauthorized" }) };
  return { ok: true };
};

module.exports = { clean, env, header, json, parseBody, requireAdmin };
