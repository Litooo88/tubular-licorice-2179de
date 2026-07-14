// Åtkomstskydd för NEMOB OS när servern binds mot annat än loopback.
//
// Modell: dashboarden innehåller personlig data (LVU, hälsa, ekonomi) och får
// därför ALDRIG exponeras utanför datorn utan skydd. Regler:
// - Loopback-bindning (127.0.0.1/::1/localhost) => ingen PIN krävs (som förut).
// - All annan bindning KRÄVER NEMOB_OS_PIN (minst 6 tecken) — annars vägrar
//   servern starta. Fail-safe: hellre ingen mobilåtkomst än oskyddad.
// - Rätt PIN => HttpOnly-cookie med slumpad sessionstoken (PIN:en själv läggs
//   aldrig i cookien). Tokens lever i minnet och dör med processen.

import { randomBytes, timingSafeEqual } from "node:crypto";

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const COOKIE_NAME = "nemob_session";
const MIN_PIN_LENGTH = 6;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagar

export const resolveAuthConfig = (env = process.env) => {
  const host = String(env.NEMOB_OS_HOST || "127.0.0.1").trim() || "127.0.0.1";
  const pin = String(env.NEMOB_OS_PIN || "").trim();
  const required = !LOOPBACK_HOSTS.has(host);
  if (required && pin.length < MIN_PIN_LENGTH) {
    return {
      host,
      required,
      error:
        `NEMOB_OS_HOST=${host} kräver NEMOB_OS_PIN (minst ${MIN_PIN_LENGTH} tecken) i nemob-os/.env. ` +
        "Servern startar inte oskyddad utanför 127.0.0.1.",
    };
  }
  return { host, pin, required, error: null };
};

export const pinMatches = (provided, expected) => {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  return b.length >= MIN_PIN_LENGTH && a.length === b.length && timingSafeEqual(a, b);
};

export const parseCookies = (header) => {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
};

// Sessionsregister i minnet: token -> utgångstid.
export class SessionStore {
  constructor(now = () => Date.now()) {
    this.sessions = new Map();
    this.now = now;
  }

  create() {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, this.now() + SESSION_TTL_MS);
    return token;
  }

  isValid(token) {
    const expires = this.sessions.get(String(token || ""));
    if (!expires) return false;
    if (this.now() > expires) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }
}

export const sessionCookie = (token) =>
  `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;

export const requestSessionToken = (req) => parseCookies(req.headers?.cookie)[COOKIE_NAME] || "";
