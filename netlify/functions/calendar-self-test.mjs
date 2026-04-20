import { createSign } from "node:crypto";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const requireAdmin = (request) => {
  const expected = env("ADMIN_TOKEN");
  const provided = request.headers.get("x-admin-token") || "";

  if (!expected) return { ok: false, response: json({ error: "ADMIN_TOKEN saknas i Netlify." }, 503) };
  if (provided !== expected) return { ok: false, response: json({ error: "Unauthorized" }, 401) };

  return { ok: true };
};

const base64Url = (input) =>
  Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const googleConfig = () => {
  const calendarId = clean(env("GOOGLE_CALENDAR_ID"), 500);
  const serviceEmail = clean(env("GOOGLE_SERVICE_ACCOUNT_EMAIL"), 240);
  const privateKey = clean(env("GOOGLE_PRIVATE_KEY"), 5000).replace(/\\n/g, "\n").trim();
  const missing = [];
  const invalid = [];

  if (!calendarId) missing.push("GOOGLE_CALENDAR_ID");
  if (!serviceEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!privateKey) missing.push("GOOGLE_PRIVATE_KEY");
  if (calendarId && /^https?:\/\//i.test(calendarId)) invalid.push("GOOGLE_CALENDAR_ID_is_url_not_calendar_id");
  if (serviceEmail && !serviceEmail.endsWith(".iam.gserviceaccount.com")) invalid.push("GOOGLE_SERVICE_ACCOUNT_EMAIL_invalid");
  if (privateKey && !(privateKey.includes("BEGIN PRIVATE KEY") && privateKey.includes("END PRIVATE KEY"))) {
    invalid.push("GOOGLE_PRIVATE_KEY_invalid_pem");
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    calendarId,
    serviceEmail,
    privateKey,
  };
};

const googleError = async (response) => {
  const body = await response.json().catch(() => ({}));
  return {
    httpStatus: response.status,
    message: clean(body.error?.message || body.error_description || body.error || response.statusText, 500),
    reason: clean(body.error?.errors?.[0]?.reason || "", 160),
  };
};

const getAccessToken = async ({ serviceEmail, privateKey }) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceEmail,
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(privateKey))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    return { ok: false, stage: "token", error: await googleError(response) };
  }

  const body = await response.json().catch(() => ({}));
  if (!body.access_token) {
    return { ok: false, stage: "token", error: { message: "Google svarade utan access_token." } };
  }

  return { ok: true, token: body.access_token };
};

const calendarRequest = async (path, token, options = {}) => {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  return response;
};

export default async (request) => {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const config = googleConfig();
  const diagnostics = {
    calendarIdPresent: Boolean(config.calendarId),
    calendarIdLooksLikeId: Boolean(config.calendarId) && !/^https?:\/\//i.test(config.calendarId),
    serviceEmailPresent: Boolean(config.serviceEmail),
    serviceEmailLooksLikeServiceAccount: config.serviceEmail.endsWith(".iam.gserviceaccount.com"),
    privateKeyPresent: Boolean(config.privateKey),
    privateKeyLooksLikePem: config.privateKey.includes("BEGIN PRIVATE KEY") && config.privateKey.includes("END PRIVATE KEY"),
    privateKeyStartsWithBegin: config.privateKey.startsWith("-----BEGIN PRIVATE KEY-----"),
  };

  if (!config.ok) {
    return json({ ok: false, stage: "config", missing: config.missing, invalid: config.invalid, diagnostics }, 200);
  }

  try {
    const tokenResult = await getAccessToken(config);
    if (!tokenResult.ok) return json({ ok: false, ...tokenResult, diagnostics }, 200);

    const calendarId = encodeURIComponent(config.calendarId);
    const calendarResponse = await calendarRequest(`/calendars/${calendarId}`, tokenResult.token);
    if (!calendarResponse.ok) {
      return json({ ok: false, stage: "calendar_access", error: await googleError(calendarResponse), diagnostics }, 200);
    }
    const calendar = await calendarResponse.json().catch(() => ({}));

    const start = new Date(Date.now() + 15 * 60000);
    const end = new Date(start.getTime() + 5 * 60000);
    const insertResponse = await calendarRequest(`/calendars/${calendarId}/events`, tokenResult.token, {
      method: "POST",
      body: JSON.stringify({
        summary: "Nordic E-Mobility kalendertest",
        location: "Pistolvagen 6, Orebro",
        description: "Automatiskt test. Skapas och raderas direkt av adminpanelen.",
        start: { dateTime: start.toISOString(), timeZone: "Europe/Stockholm" },
        end: { dateTime: end.toISOString(), timeZone: "Europe/Stockholm" },
      }),
    });

    if (!insertResponse.ok) {
      return json({
        ok: false,
        stage: "event_insert",
        calendar: { id: clean(calendar.id, 500), summary: clean(calendar.summary, 240), timeZone: clean(calendar.timeZone, 80) },
        error: await googleError(insertResponse),
        diagnostics,
      }, 200);
    }

    const event = await insertResponse.json().catch(() => ({}));
    let deleteResult = { ok: false };
    if (event.id) {
      const deleteResponse = await calendarRequest(`/calendars/${calendarId}/events/${encodeURIComponent(event.id)}`, tokenResult.token, {
        method: "DELETE",
      });
      deleteResult = deleteResponse.ok
        ? { ok: true, httpStatus: deleteResponse.status }
        : { ok: false, error: await googleError(deleteResponse) };
    }

    return json({
      ok: true,
      stage: "done",
      calendar: { id: clean(calendar.id, 500), summary: clean(calendar.summary, 240), timeZone: clean(calendar.timeZone, 80) },
      eventInserted: Boolean(event.id),
      eventDeleted: deleteResult,
      diagnostics,
    });
  } catch (error) {
    return json({ ok: false, stage: "exception", error: { message: clean(error.message, 500) }, diagnostics }, 200);
  }
};

export const config = {
  path: "/api/calendar-self-test",
};
