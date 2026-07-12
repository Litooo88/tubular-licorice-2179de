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
const store = new Store(defaultStorePath(BASE_DIR));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
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

server.listen(PORT, "127.0.0.1", () => {
  const configured = Boolean(String(process.env.NORDIC_BRIEF_URL || "").trim());
  // OBS: endast om variabeln finns — aldrig dess värde.
  console.log(`NEMOB OS kör på http://127.0.0.1:${PORT} (Nordic-källa: ${configured ? "konfigurerad" : "ej konfigurerad"})`);
});
