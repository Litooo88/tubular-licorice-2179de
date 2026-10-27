// Google Calendar via tjänstekonto (JWT → access token). Används av bokningen
// (skapa/läsa händelser) och av admin (bekräfta/avböja förfrågningar: ändra
// titel eller ta bort händelsen). Saknas konfiguration svarar allt med
// not_configured i stället för att kasta — kalendern får aldrig vara en
// single point of failure för verkstaden.

import { createSign } from "node:crypto";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};
const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

export const WORKSHOP_ORGANIZER = "info@nordicemobility.se";

export const looksLikeGooglePrivateKey = (value) => {
  const key = clean(value, 5000).replace(/\\n/g, "\n");
  return key.includes("BEGIN PRIVATE KEY") && key.includes("END PRIVATE KEY");
};

export const googleCalendarConfig = () => {
  const calendarId = clean(env("GOOGLE_CALENDAR_ID") || WORKSHOP_ORGANIZER, 500);
  const serviceEmail = clean(env("GOOGLE_SERVICE_ACCOUNT_EMAIL"), 240);
  const privateKey = clean(env("GOOGLE_PRIVATE_KEY"), 5000).replace(/\\n/g, "\n");
  const missing = [];
  const invalid = [];

  if (!calendarId) missing.push("GOOGLE_CALENDAR_ID");
  if (!serviceEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!privateKey) missing.push("GOOGLE_PRIVATE_KEY");

  if (calendarId && /^https?:\/\//i.test(calendarId)) {
    invalid.push("GOOGLE_CALENDAR_ID_must_be_calendar_id_not_url");
  }
  if (serviceEmail && !serviceEmail.endsWith(".iam.gserviceaccount.com")) {
    invalid.push("GOOGLE_SERVICE_ACCOUNT_EMAIL_must_be_service_account_email");
  }
  if (privateKey && !looksLikeGooglePrivateKey(privateKey)) {
    invalid.push("GOOGLE_PRIVATE_KEY_must_include_begin_and_end_private_key");
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    calendarId,
    serviceEmail,
  };
};

const base64Url = (input) =>
  Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

let googleTokenCache = { token: "", expiresAt: 0 };

export const getGoogleAccessToken = async () => {
  if (googleTokenCache.token && googleTokenCache.expiresAt > Date.now() + 60000) {
    return googleTokenCache.token;
  }

  const serviceEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n").trim();
  if (!serviceEmail || !looksLikeGooglePrivateKey(privateKey)) return "";

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
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(clean(body.error_description || body.error || response.statusText, 180));
  }
  googleTokenCache = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return googleTokenCache.token;
};

const eventUrl = (calendarId, eventId) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

// Ändrar delar av en händelse (t.ex. titeln när en förfrågan bekräftas).
export const patchCalendarEvent = async (eventId, patch) => {
  const config = googleCalendarConfig();
  if (!config.ok) return { status: "not_configured", provider: "google-calendar" };
  if (!eventId) return { status: "skipped", provider: "google-calendar", reason: "no_event_id" };
  try {
    const token = await getGoogleAccessToken();
    const response = await fetch(eventUrl(config.calendarId, eventId), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { status: "failed", provider: "google-calendar", error: clean(body.error?.message || response.statusText, 180) };
    return { status: "updated", provider: "google-calendar", id: clean(body.id, 160) };
  } catch (error) {
    return { status: "failed", provider: "google-calendar", error: clean(error?.message, 180) };
  }
};

// Tar bort en händelse (avböjd förfrågan). 404/410 räknas som redan borta.
export const deleteCalendarEvent = async (eventId) => {
  const config = googleCalendarConfig();
  if (!config.ok) return { status: "not_configured", provider: "google-calendar" };
  if (!eventId) return { status: "skipped", provider: "google-calendar", reason: "no_event_id" };
  try {
    const token = await getGoogleAccessToken();
    const response = await fetch(eventUrl(config.calendarId, eventId), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok || response.status === 404 || response.status === 410) {
      return { status: "deleted", provider: "google-calendar" };
    }
    const body = await response.json().catch(() => ({}));
    return { status: "failed", provider: "google-calendar", error: clean(body.error?.message || response.statusText, 180) };
  } catch (error) {
    return { status: "failed", provider: "google-calendar", error: clean(error?.message, 180) };
  }
};
