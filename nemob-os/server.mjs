// NEMOB OS V1 — lokal server. Noll beroenden (node:http).
//
// Start:  node nemob-os/server.mjs   (från repo-roten)
// Konfig: nemob-os/.env  (se .env.example) eller vanliga miljövariabler.
//
// Servern serverar dashboarden (nemob-os/public) och ett litet JSON-API.
// All data sparas i nemob-os/data/ (gitignorerad). Nordic-källan används
// enbart read-only via lib/nordic.mjs.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, defaultStorePath } from "./lib/store.mjs";
import { newTask, taskPatch } from "./lib/tasks.mjs";
import { generatePlan, summarizeDay } from "./lib/plan.mjs";
import { fetchNordicBrief } from "./lib/nordic.mjs";
import { AREAS, RISK_LEVELS, STATUSES, stockholmDate } from "./lib/constants.mjs";
import {
  SessionStore,
  pinMatches,
  requestSessionToken,
  resolveAuthConfig,
  sessionCookie,
} from "./lib/auth.mjs";

const BASE_DIR = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = resolve(BASE_DIR, "public");
const DATA_DIR = resolve(BASE_DIR, "data");
const CACHE_PATH = join(DATA_DIR, "nordic-cache.json");

// Läs nemob-os/.env om den finns. Värden loggas aldrig och skriver inte
// över redan satta miljövariabler.
const loadDotEnv = () => {
  const envPath = join(BASE_DIR, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
};
loadDotEnv();

const PORT = Number(process.env.NEMOB_OS_PORT || 4571);
const AUTH = resolveAuthConfig(process.env);
if (AUTH.error) {
  // Fail-safe: starta aldrig oskyddad utanför loopback. (PIN-värdet loggas aldrig.)
  console.error(AUTH.error);
  process.exit(1);
}
const sessions = new SessionStore();
const store = new Store(defaultStorePath(BASE_DIR));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const loginHtml = (wrongPin) => `<!doctype html>
<html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>NEMOB OS — lås upp</title>
<style>
  body{background:#0d1210;color:#e8efe9;font-family:system-ui,sans-serif;display:flex;
       align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  form{background:#151d18;border:1px solid #2a3830;border-radius:12px;padding:28px;
       width:min(340px,100%);text-align:center}
  h1{font-size:18px;letter-spacing:.08em;margin:0 0 4px}h1 span{color:#47d178}
  p{color:#93a49a;font-size:13px;margin:0 0 16px}
  input{width:100%;box-sizing:border-box;background:#0d1210;border:1px solid #2a3830;color:#e8efe9;
        border-radius:8px;padding:14px;font-size:22px;text-align:center;letter-spacing:.3em}
  button{width:100%;margin-top:12px;background:#1f5c37;border:1px solid #2f7a4c;color:#e8efe9;
         border-radius:8px;padding:14px;font-size:16px;font-weight:600;cursor:pointer}
  .err{color:#f5c0b8;font-size:13px;margin-top:10px}
</style></head><body>
<form method="post" action="/api/login">
  <h1>NEMOB <span>OS</span></h1><p>Ange PIN för att låsa upp</p>
  <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus required>
  <button type="submit">Lås upp</button>
  ${wrongPin ? '<div class="err">Fel PIN — försök igen.</div>' : ""}
</form></body></html>`;

const json = (res, body, status = 200) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        rejectPromise(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        rejectPromise(new Error("invalid_json"));
      }
    });
    req.on("error", () => rejectPromise(new Error("read_error")));
  });

const serveStatic = (res, urlPath) => {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = resolve(PUBLIC_DIR, normalize(relative));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(filePath));
};

// Enkel motor för att kunna simulera Nordic-avbrott i test utan att röra
// riktiga endpointen: sätts via POST /api/dev/simulate-down (endast i minnet).
let simulateDown = false;

const nordicBrief = async () => {
  if (simulateDown) {
    return fetchNordicBrief({
      cachePath: CACHE_PATH,
      fetchImpl: async () => {
        throw new Error("simulated");
      },
    });
  }
  return fetchNordicBrief({ cachePath: CACHE_PATH });
};

const handleApi = async (req, res, url) => {
  const path = url.pathname;

  if (path === "/api/health" && req.method === "GET") {
    return json(res, { ok: true, now: new Date().toISOString(), date: stockholmDate() });
  }

  if (path === "/api/meta" && req.method === "GET") {
    return json(res, { areas: AREAS, statuses: STATUSES, riskLevels: RISK_LEVELS });
  }

  if (path === "/api/nordic-brief" && req.method === "GET") {
    return json(res, await nordicBrief());
  }

  if (path === "/api/dev/simulate-down" && req.method === "POST") {
    const body = await readBody(req);
    simulateDown = body.down === true;
    return json(res, { ok: true, simulateDown });
  }

  if (path === "/api/tasks" && req.method === "GET") {
    return json(res, { tasks: store.tasks });
  }

  if (path === "/api/tasks" && req.method === "POST") {
    const body = await readBody(req);
    const { task, error } = newTask(body);
    if (error) return json(res, { error }, 400);
    store.addTask(task);
    return json(res, { task }, 201);
  }

  const taskMatch = path.match(/^\/api\/tasks\/([A-Za-z0-9_]+)$/);
  if (taskMatch && req.method === "PATCH") {
    const existing = store.taskById(taskMatch[1]);
    if (!existing) return json(res, { error: "Uppgiften finns inte." }, 404);
    const body = await readBody(req);
    const { patch, error } = taskPatch(existing, body);
    if (error) return json(res, { error }, 400);
    const task = store.updateTask(existing.id, patch);
    return json(res, { task });
  }

  if (path === "/api/plan" && req.method === "GET") {
    const date = url.searchParams.get("date") || stockholmDate();
    const day = store.day(date);
    return json(res, {
      date,
      plan: day.plan,
      checkins: day.checkins,
      summary: summarizeDay(store.tasks),
    });
  }

  if (path === "/api/plan/generate" && req.method === "POST") {
    const plan = generatePlan(store.tasks);
    store.setPlan(plan.date, plan);
    return json(res, { plan });
  }

  if (path === "/api/checkins" && req.method === "POST") {
    const body = await readBody(req);
    const type = ["morning", "midday", "evening"].includes(body.type) ? body.type : null;
    if (!type) return json(res, { error: "Ogiltig checkin-typ." }, 400);
    const date = body.date || stockholmDate();
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const saved = store.setCheckin(date, type, answers, new Date().toISOString());
    return json(res, { checkin: saved });
  }

  return json(res, { error: "Not found" }, 404);
};

// Enkel broms mot PIN-gissning: max 20 misslyckade försök per timme.
const failedPinAttempts = [];
const pinAttemptsExceeded = () => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (failedPinAttempts.length && failedPinAttempts[0] < cutoff) failedPinAttempts.shift();
  return failedPinAttempts.length >= 20;
};

const readFormOrJson = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return {};
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if ((req.headers["content-type"] || "").includes("json")) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(raw));
};

const handleLogin = async (req, res) => {
  if (pinAttemptsExceeded()) {
    res.writeHead(429, { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "3600" });
    res.end("För många försök. Vänta en timme.");
    return;
  }
  const body = await readFormOrJson(req);
  if (pinMatches(body.pin, AUTH.pin)) {
    res.writeHead(303, { "Set-Cookie": sessionCookie(sessions.create()), Location: "/" });
    res.end();
    return;
  }
  failedPinAttempts.push(Date.now());
  res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
  res.end(loginHtml(true));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (AUTH.required) {
      if (url.pathname === "/api/login" && req.method === "POST") {
        await handleLogin(req, res);
        return;
      }
      if (!sessions.isValid(requestSessionToken(req))) {
        if (url.pathname.startsWith("/api/")) {
          json(res, { error: "unauthorized" }, 401);
          return;
        }
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
        res.end(loginHtml(false));
        return;
      }
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    // Aldrig råa felmeddelanden ut (kan i teorin innehålla känsliga strängar).
    const code = error?.message === "payload_too_large" || error?.message === "invalid_json"
      ? error.message
      : "server_error";
    json(res, { error: code }, code === "server_error" ? 500 : 400);
  }
});

server.listen(PORT, AUTH.host, () => {
  const configured = Boolean(String(process.env.NORDIC_BRIEF_URL || "").trim());
  // OBS: endast om variablerna finns — aldrig deras värden.
  console.log(
    `NEMOB OS kör på http://${AUTH.host}:${PORT} ` +
    `(Nordic-källa: ${configured ? "konfigurerad" : "ej konfigurerad"}, ` +
    `åtkomstskydd: ${AUTH.required ? "PIN aktiv" : "endast lokalt"})`,
  );
});
