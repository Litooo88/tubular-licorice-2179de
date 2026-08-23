import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { normalizePhone } from "./_shared/sms.mjs";

// POST /api/cases/:id/call — click-to-call via 46elks.
//
// Flöde: 46elks ringer först upp teknikerns mobil (från företagsnumret), och
// när den svarar kopplas kunden in. Kunden ser 010-numret. Samtalet hamnar i
// 46elks samtalslogg som ett utgående samtal (spårbart i samtalsrapporten)
// och får en rad i ärendets timeline + callLog.
//
// Body: { operator?: string }
// Svar: { status: "calling"|"not_configured"|..., call?: {id, to, agent} }
// - not_configured => UI:t faller tillbaka till tel:-länk (safe-läge).
// - Teknikerns mobil tas ENDAST från env (VOICE_SEBASTIAN_PHONE /
//   VOICE_PRIMARY_NUMBER) — aldrig från request-body, så API:t kan inte
//   användas för att koppla samtal till godtyckliga nummer.
// - Dubblettskydd: ny uppringning till samma ärende inom 60 s => 409.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 200) => String(value || "").trim().slice(0, max);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const DUPLICATE_WINDOW_MS = 60 * 1000;

export const startCall = async ({ agent, customer, companyNumber, username, password, fetchImpl = fetch }) => {
  const response = await fetchImpl("https://api.46elks.com/a1/calls", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      from: companyNumber,
      to: agent,
      voice_start: JSON.stringify({ connect: customer, callerid: companyNumber }),
      timeout: "30",
    }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { status: "failed", error: clean(body.error || response.statusText, 180) };
  return { status: "calling", id: clean(body.id, 120) };
};

export default async (request, context) => {
  const auth = requireAdminToken(request, json, "ADMIN_TOKEN saknas i Netlify miljovariabler.");
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const id = context.params?.id;
  if (!id) return json({ error: "Missing case id" }, 400);

  const body = await request.json().catch(() => ({}));
  const operator = clean(body.operator || body.operatorName, 80);

  const username = env("ELKS_USERNAME");
  const password = env("ELKS_PASSWORD");
  const agent = normalizePhone(env("VOICE_SEBASTIAN_PHONE") || env("VOICE_PRIMARY_NUMBER"));
  const companyNumber = normalizePhone(env("ELKS_NUMBER") || "+46101385498");
  if (!username || !password || !agent) return json({ status: "not_configured" });

  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const item = await store.get(id, { type: "json" });
  if (!item) return json({ error: "Ärendet finns inte." }, 404);

  const customer = normalizePhone(item?.customer?.phone);
  if (!customer) return json({ error: "Kundtelefon saknas på ärendet." }, 400);
  if (customer === agent || customer === companyNumber) return json({ error: "Kan inte ringa eget nummer." }, 400);

  const log = Array.isArray(item.callLog) ? item.callLog : [];
  const last = log[log.length - 1];
  if (last && last.direction === "outgoing" && Date.now() - new Date(last.at || 0).getTime() < DUPLICATE_WINDOW_MS) {
    return json({ error: "Uppringning till detta ärende startades nyss (dubblettskydd)." }, 409);
  }

  const call = await startCall({ agent, customer, companyNumber, username, password });
  if (call.status !== "calling") return json({ status: call.status, error: call.error || "Samtalet kunde inte startas." }, 502);

  const now = new Date().toISOString();
  await store.setJSON(id, {
    ...item,
    callLog: [...log, { at: now, direction: "outgoing", to: customer, providerId: call.id, operator }].slice(-50),
    timeline: [
      ...(Array.isArray(item.timeline) ? item.timeline : []),
      { at: now, event: `Ringde kunden via växeln (click-to-call)${operator ? ` – ${operator}` : ""}.` },
    ],
    updatedAt: now,
  });

  return json({ status: "calling", call: { id: call.id, to: customer, at: now } });
};

export const config = {
  path: "/api/cases/:id/call",
};
