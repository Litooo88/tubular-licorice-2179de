import { getStore } from "@netlify/blobs";

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

const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

const stockholmDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const stockholmTime = (date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

const shortCaseId = (id) => clean(id, 120).replace(/^case_/, "").slice(0, 18).toUpperCase();

const postSms = async ({ to, message }) => {
  const normalizedTo = normalizePhone(to);
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = (env("SMS_FROM") || "NordicEMob").slice(0, 11);
  if (!normalizedTo) return { status: "invalid_phone", to: "" };
  if (!username || !password) return { status: "not_configured", to: normalizedTo };
  const response = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ from, to: normalizedTo, message, dontlog: "message" }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { status: "failed", to: normalizedTo, error: clean(body.error || response.statusText, 180) };
  return { status: "sent", to: normalizedTo, id: clean(body.id, 120), sentAt: new Date().toISOString() };
};

const fetchCalls = async () => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  if (!username || !password) throw new Error("46elks API saknas.");
  const response = await fetch("https://api.46elks.com/a1/calls", {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(body.error || response.statusText, 180));
  return Array.isArray(body.data) ? body.data : [];
};

const loadCases = async () => {
  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const { blobs } = await store.list();
  const cases = [];
  for (const blob of blobs) {
    const item = await store.get(blob.key, { type: "json" }).catch(() => null);
    if (item) cases.push(item);
  }
  return cases;
};

const answeredBy = (call) => {
  const success = (Array.isArray(call.legs) ? call.legs : []).find((leg) => leg.state === "success");
  if (!success) {
    if (Array.isArray(call.recordings) && call.recordings.length) return { key: "voicemail", label: "Röstmeddelande" };
    return { key: "missed", label: "Missad/ej svar" };
  }
  if (success.to === "+46722607753") return { key: "lennart", label: "Lennart" };
  if (success.to === "+46700243319") return { key: "sebastian", label: "Sebastian" };
  return { key: "other", label: success.to || "Annan" };
};

const ivrChoice = (call) => {
  const ivr = (Array.isArray(call.actions) ? call.actions : []).find((action) => action && typeof action === "object" && "ivr" in action);
  if (ivr?.result === "1") return "1 verkstad";
  if (ivr?.result === "2") return "2 försäljning";
  if (ivr?.result) return clean(ivr.result, 40);
  if (JSON.stringify(call.actions || "").includes("outside_hours")) return "utanför tid";
  return "-";
};

const buildCallRows = async () => {
  const [calls, cases] = await Promise.all([fetchCalls(), loadCases()]);
  const caseByPhone = new Map();
  for (const item of cases) {
    const phone = normalizePhone(item.customer?.phone);
    if (!phone) continue;
    if (!caseByPhone.has(phone)) caseByPhone.set(phone, []);
    caseByPhone.get(phone).push(item);
  }
  const today = stockholmDateKey(new Date());
  const followupStore = getStore({ name: "call-followups", consistency: "strong" });
  const { blobs: followupBlobs } = await followupStore.list().catch(() => ({ blobs: [] }));
  const followups = new Map();
  for (const blob of followupBlobs || []) {
    const item = await followupStore.get(blob.key, { type: "json" }).catch(() => null);
    if (item?.callId) followups.set(item.callId, item);
  }

  const rows = calls
    .filter((call) => call.direction === "incoming" && call.to === "+46101385498")
    .map((call) => {
      const created = new Date(call.created || call.start || Date.now());
      const date = stockholmDateKey(created);
      const phone = normalizePhone(call.from);
      const matchedCases = phone ? caseByPhone.get(phone) || [] : [];
      const answer = answeredBy(call);
      const hasCase = matchedCases.length > 0;
      const eligibleLostLead = Boolean(phone) && !hasCase && (answer.key === "missed" || answer.key === "lennart");
      const followup = followups.get(call.id) || null;
      return {
        id: clean(call.id, 140),
        date,
        time: stockholmTime(created),
        timestamp: created.toISOString(),
        phone: phone || "okänt/skyddat",
        duration: Number(call.duration || 0),
        state: clean(call.state, 80),
        answeredBy: answer.key,
        answeredByLabel: answer.label,
        ivrChoice: ivrChoice(call),
        hasCase,
        cases: matchedCases.map((item) => ({
          id: item.id,
          shortId: shortCaseId(item.id),
          status: clean(item.status, 80),
          customerName: clean(item.customer?.name, 160),
          service: clean(item.service, 180),
          model: clean(item.vehicle?.model, 180),
          assignedTo: clean(item.assignedTo?.name, 80),
        })),
        eligibleLostLead,
        followup,
      };
    })
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  const todayRows = rows.filter((row) => row.date === today);
  const totals = {
    date: today,
    callsToday: todayRows.length,
    handledToday: todayRows.filter((row) => row.hasCase || ["lennart", "sebastian", "voicemail"].includes(row.answeredBy)).length,
    sebastianToday: todayRows.filter((row) => row.answeredBy === "sebastian").length,
    lennartToday: todayRows.filter((row) => row.answeredBy === "lennart").length,
    voicemailToday: todayRows.filter((row) => row.answeredBy === "voicemail").length,
    missedToday: todayRows.filter((row) => row.answeredBy === "missed").length,
    registeredToday: todayRows.filter((row) => row.hasCase).length,
    lostLeadToday: todayRows.filter((row) => row.eligibleLostLead).length,
  };

  return { rows, todayRows, totals };
};

export default async (request) => {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  if (request.method === "GET") {
    try {
      const dashboard = await buildCallRows();
      return json(dashboard);
    } catch (error) {
      return json({ error: clean(error?.message || "Kunde inte läsa samtalslogg.", 240) }, 502);
    }
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(body.phone);
    const callId = clean(body.callId, 160);
    const code = clean(body.code, 30) || "RING10";
    if (!phone || phone === "+46") return json({ error: "Telefonnummer saknas." }, 400);
    if (!callId) return json({ error: "Call ID saknas." }, 400);
    const message =
      clean(body.message, 918) ||
      `Hej! Vi såg att du ringt Nordic E-Mobility. Boka service via nordicemobility.se och ange koden ${code} så får du 10% rabatt på verkstadsarbetet. Gäller ny bokning inom 7 dagar. /Nordic E-Mobility`;
    const result = await postSms({ to: phone, message });
    const entry = {
      callId,
      phone,
      code,
      message,
      result,
      sentAt: result.sentAt || new Date().toISOString(),
      operatorName: clean(body.operatorName, 80) || "admin",
    };
    await getStore({ name: "call-followups", consistency: "strong" }).setJSON(callId, entry);
    return json({ ok: result.status === "sent", followup: entry });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: ["/api/call-dashboard"],
};
