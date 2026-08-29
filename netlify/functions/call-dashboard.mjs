import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { findStaleRingReplies } from "./_shared/ring-escalation.mjs";

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
  return requireAdminToken(request, json);
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

const isCallSourceUnavailable = (error) =>
  /46elks API saknas|MissingBlobsEnvironmentError|BlobsEnvironment|not been configured to use Netlify Blobs/i
    .test(`${error?.code || ""} ${error?.name || ""} ${error?.message || ""}`);

const emptyCallDashboard = (error) => {
  const warning = {
    source: "call-dashboard",
    code: clean(error?.code || error?.name || "CALL_SOURCE_UNAVAILABLE", 100),
    message: clean(error?.message || "46elks/call-log kalla saknas eller ar inte konfigurerad.", 240),
  };
  return {
    ok: true,
    sourceUnavailable: true,
    sourceLabel: "Samtalsimport ej kopplad",
    warnings: [warning],
    rows: [],
    todayRows: [],
    activeLeadRows: [],
    totals: {
      date: stockholmDateKey(new Date()),
      callsToday: 0,
      handledToday: 0,
      workshopToday: 0,
      sebastianToday: 0,
      voicemailToday: 0,
      missedToday: 0,
      registeredToday: 0,
      lostLeadToday: 0,
      activeLeads: 0,
      newLeadsToday: 0,
    },
    stats: null,
  };
};

const shortCaseId = (id) => clean(id, 120).replace(/^case_/, "").slice(0, 18).toUpperCase();
const STAFF = {
  workshop: { key: "workshop", name: "Verkstaden", role: "Golv, mottagning och snabba jobb", phone: "010-138 54 98" },
  sebastian: { key: "sebastian", name: "Sebastian", role: "Tung felsokning, batteri och elsystem", phone: "010-138 54 98" },
};

const postSms = async ({ to, message, from: fromOverride }) => {
  const normalizedTo = normalizePhone(to);
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = clean(fromOverride, 20) || (env("SMS_FROM") || "NordicEMob").slice(0, 11);
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

// Paginerar 46elks (max 100 samtal/sida) tills fönstret (60 dagar) är täckt.
// Tidigare hämtades bara första sidan → "senaste 100 samtalen" oavsett datum.
const CALL_WINDOW_DAYS = 60;
const fetchCalls = async () => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  if (!username || !password) throw new Error("46elks API saknas.");
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const cutoff = Date.now() - CALL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const calls = [];
  let url = "https://api.46elks.com/a1/calls?limit=100";
  for (let page = 0; page < 24 && url; page += 1) {
    const response = await fetch(url, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(clean(body.error || response.statusText, 180));
    const batch = Array.isArray(body.data) ? body.data : [];
    calls.push(...batch);
    const oldest = batch.length ? new Date(batch[batch.length - 1].created || batch[batch.length - 1].start || 0).getTime() : 0;
    if (!batch.length || (Number.isFinite(oldest) && oldest > 0 && oldest < cutoff)) break;
    // 46elks "next" är en tidsstämpel-cursor (t.ex. "2026-07-07T09:26:14.291000")
    // som skickas som ?start= — INTE en URL-path.
    url = body.next ? `https://api.46elks.com/a1/calls?limit=100&start=${encodeURIComponent(body.next)}` : "";
  }
  return calls.filter((call) => {
    const created = new Date(call.created || call.start || 0).getTime();
    return Number.isFinite(created) && created >= cutoff;
  });
};

// Blob-läsningar parallelliseras i chunkar — sekventiell läsning av 150+
// case-blobbar tog 17–21 s per dashboard-anrop (nära funktions-timeout).
const readBlobsParallel = async (store, keys, concurrency = 25) => {
  const results = [];
  for (let i = 0; i < keys.length; i += concurrency) {
    const chunk = keys.slice(i, i + concurrency);
    const items = await Promise.all(chunk.map((key) => store.get(key, { type: "json" }).catch(() => null)));
    chunk.forEach((key, index) => results.push({ key, item: items[index] }));
  }
  return results;
};

const loadCases = async () => {
  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const { blobs } = await store.list();
  const results = await readBlobsParallel(store, (blobs || []).map((blob) => blob.key));
  return results.map(({ item }) => item).filter(Boolean);
};

const loadBlobMap = async (storeName) => {
  const store = getStore({ name: storeName, consistency: "strong" });
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  const results = await readBlobsParallel(store, (blobs || []).map((blob) => blob.key));
  const items = new Map();
  for (const { key, item } of results) {
    if (item) items.set(key, item);
  }
  return { store, items };
};

// Företagets egna nummer får aldrig ta emot kampanj-SMS. De kan dyka upp som
// inringare (testsamtal, vidarekoppling) och hamnade tidigare i utskickslistan
// om man byggde den i admin — undantaget fanns bara i agentens skript, alltså
// inte alls för UI-vägen. Läses ur env så inget nummer hårdkodas.
const OWN_NUMBER_ENV_KEYS = [
  "VOICE_PRIMARY_NUMBER",
  "VOICE_NOTIFY_TO",
  "VOICE_WORKSHOP_PHONE",
  "VOICE_SEBASTIAN_PHONE",
  "SEBASTIAN_SMS_TO",
  "WORKSHOP_SMS_TO",
  "ELKS_SMS_NUMBER",
  "VOICE_FALLBACK_NUMBER",
];
// Sebastians mobil ligger som fallback eftersom VOICE_PRIMARY_NUMBER /
// VOICE_NOTIFY_TO visade sig saknas i Netlify-miljön 2026-08-22 — då fångade
// env-listan bara 2 av 3 egna nummer. Samma nummer finns redan hårdkodat som
// EMERGENCY_PRIMARY_NUMBER i voice-simple.mjs. En spärr som tystnar när en
// env-variabel glöms bort är ingen spärr.
const OWN_NUMBER_FALLBACKS = ["+46700243319"];
const ownNumbers = () => {
  const set = new Set(OWN_NUMBER_FALLBACKS);
  for (const key of OWN_NUMBER_ENV_KEYS) {
    for (const part of String(env(key) || "").split(/[,;\s]+/)) {
      const normalized = normalizePhone(part);
      if (normalized) set.add(normalized);
    }
  }
  return set;
};

const staffVoiceNumbers = () => ({
  workshop: normalizePhone(env("VOICE_WORKSHOP_PHONE")),
  sebastian: normalizePhone(env("VOICE_SEBASTIAN_PHONE") || env("VOICE_PRIMARY_NUMBER")),
});

const answeredBy = (call) => {
  const success = (Array.isArray(call.legs) ? call.legs : []).find((leg) => leg.state === "success");
  if (!success) {
    if (Array.isArray(call.recordings) && call.recordings.length) return { key: "voicemail", label: "Röstmeddelande" };
    return { key: "missed", label: "Missad/ej svar" };
  }
  const successTo = normalizePhone(success.to);
  const staff = staffVoiceNumbers();
  if (staff.workshop && successTo === staff.workshop) return { key: "workshop", label: "Verkstaden" };
  if (staff.sebastian && successTo === staff.sebastian) return { key: "sebastian", label: "Sebastian" };
  return { key: "other", label: successTo || "Annan" };
};

const ivrChoice = (call) => {
  const ivr = (Array.isArray(call.actions) ? call.actions : []).find((action) => action && typeof action === "object" && "ivr" in action);
  if (ivr?.result === "1") return "1 verkstad";
  if (ivr?.result === "2") return "2 försäljning";
  if (ivr?.result) return clean(ivr.result, 40);
  if (JSON.stringify(call.actions || "").includes("outside_hours")) return "utanför tid";
  return "-";
};

const shouldCreateLead = (row) =>
  Boolean(row.phone && String(row.phone).startsWith("+") && !row.hasCase) &&
  (["missed", "voicemail", "workshop"].includes(row.answeredBy) || Number(row.duration || 0) >= 60);

const leadReason = (row) => {
  if (row.answeredBy === "missed") return "Missat samtal utan kundkort";
  if (row.answeredBy === "voicemail") return "Rostmeddelande utan kundkort";
  if (row.answeredBy === "workshop") return "Verkstaden tog samtal utan kundkort";
  if (Number(row.duration || 0) >= 60) return "Langt samtal utan kundkort";
  return "Samtal utan kundkort";
};

const syncCallLeads = async (rows, existingLeads) => {
  const store = getStore({ name: "call-leads", consistency: "strong" });
  const now = new Date().toISOString();
  const leads = new Map(existingLeads);
  const writes = [];
  for (const row of rows) {
    const current = leads.get(row.id);
    if (current?.status === "converted" || current?.status === "ignored") continue;
    if (row.hasCase && current) {
      const next = {
        ...current,
        status: "converted",
        caseId: row.cases?.[0]?.id || current.caseId || "",
        convertedAt: current.convertedAt || now,
        updatedAt: now,
      };
      leads.set(row.id, next);
      writes.push(store.setJSON(row.id, next));
      continue;
    }
    if (!shouldCreateLead(row)) continue;
    const next = {
      ...(current || {}),
      id: row.id,
      callId: row.id,
      phone: row.phone,
      timestamp: row.timestamp,
      date: row.date,
      time: row.time,
      duration: row.duration,
      answeredBy: row.answeredBy,
      answeredByLabel: row.answeredByLabel,
      ivrChoice: row.ivrChoice,
      reason: current?.reason || leadReason(row),
      status: current?.status || "new",
      createdAt: current?.createdAt || now,
      updatedAt: current ? now : current?.updatedAt || now,
      notes: Array.isArray(current?.notes) ? current.notes : [],
    };
    leads.set(row.id, next);
    if (!current) writes.push(store.setJSON(row.id, next));
  }
  await Promise.all(writes);
  return leads;
};

const createCaseFromLead = async ({ lead, operatorName, note }) => {
  const now = new Date().toISOString();
  const caseId = `case_${now.replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
  const assignedTo = lead.answeredBy === "sebastian" ? STAFF.sebastian : STAFF.workshop;
  const next = {
    id: caseId,
    createdAt: now,
    updatedAt: now,
    createdBy: { name: operatorName, source: "call-dashboard" },
    updatedBy: { name: operatorName, source: "call-dashboard", at: now },
    status: "contacted",
    source: "call-lead",
    channel: "phone",
    priority: "normal",
    preferredContactTime: null,
    preferredDate: null,
    discountCode: null,
    contactMethod: "phone",
    logistics: "dropoff",
    assignedTo,
    customer: {
      name: "Telefonlead",
      phone: lead.phone,
      email: "",
    },
    vehicle: {
      model: "",
    },
    service: "Telefonlead / uppfoljning",
    addons: [],
    estimatedValue: 0,
    message: [
      `Skapat fran samtalslead ${lead.callId}.`,
      `Tid: ${lead.date} ${lead.time}.`,
      `Hanterad av: ${lead.answeredByLabel || lead.answeredBy}.`,
      lead.duration ? `Langd: ${lead.duration}s.` : "",
      lead.ivrChoice ? `IVR: ${lead.ivrChoice}.` : "",
      lead.reason ? `Orsak: ${lead.reason}.` : "",
      note ? `Notering: ${clean(note, 500)}.` : "",
    ].filter(Boolean).join("\n"),
    intakeAt: null,
    promisedAt: null,
    notes: note ? [{ at: now, text: clean(note, 1200) }] : [],
    notifications: {},
    confirmation_sent: false,
    confirmation_missing: false,
    completion: {
      totalCost: 0,
      workSummary: "",
      invoiceText: "",
      priceRows: [],
      readyForFortnox: false,
      updatedAt: now,
    },
    payment: {
      status: "unpaid",
      amount: 0,
      method: "",
      reference: "",
      updatedAt: now,
    },
    callLead: {
      callId: lead.callId,
      phone: lead.phone,
      timestamp: lead.timestamp,
      answeredBy: lead.answeredBy,
      duration: lead.duration,
    },
    timeline: [
      { at: now, event: `Kundkort skapat fran samtalslead av ${operatorName}.` },
    ],
  };
  await getStore({ name: "workshop-cases", consistency: "strong" }).setJSON(caseId, next);
  return next;
};

const buildCallRows = async ({ syncLeads = false } = {}) => {
  const [calls, cases] = await Promise.all([fetchCalls(), loadCases()]);
  const caseByPhone = new Map();
  for (const item of cases) {
    const phone = normalizePhone(item.customer?.phone);
    if (!phone) continue;
    if (!caseByPhone.has(phone)) caseByPhone.set(phone, []);
    caseByPhone.get(phone).push(item);
  }
  const today = stockholmDateKey(new Date());
  const [{ items: followups }, { items: leadMap }] = await Promise.all([
    loadBlobMap("call-followups"),
    loadBlobMap("call-leads"),
  ]);

  const rows = calls
    .filter((call) => call.direction === "incoming" && call.to === "+46101385498")
    .map((call) => {
      const created = new Date(call.created || call.start || Date.now());
      const date = stockholmDateKey(created);
      const phone = normalizePhone(call.from);
      const matchedCases = phone ? caseByPhone.get(phone) || [] : [];
      const answer = answeredBy(call);
      const hasCase = matchedCases.length > 0;
      const eligibleLostLead = Boolean(phone) && !hasCase && (answer.key === "missed" || answer.key === "workshop");
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
          assignedTo: item.assignedTo?.key === "sebastian" ? STAFF.sebastian.name : STAFF.workshop.name,
        })),
        eligibleLostLead,
        followup,
      };
    })
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  const syncedLeads = syncLeads ? await syncCallLeads(rows, leadMap) : leadMap;
  rows.forEach((row) => {
    const lead = syncedLeads.get(row.id) || null;
    row.lead = lead;
    row.leadStatus = lead?.status || "";
    row.leadReason = lead?.reason || "";
    row.eligibleLostLead = shouldCreateLead(row) && !["ignored", "converted"].includes(row.leadStatus);
  });

  // Ringstatistik över hela 30-dagarsfönstret. "answered" = en människa
  // svarade; voicemail räknas separat eftersom kunden inte nådde fram.
  // "other" räknas som besvarat: success-benet gick till ett nummer som inte
  // matchar VOICE_*-env (t.ex. ej konfigurerad) — men någon svarade bevisligen.
  const isAnswered = (row) => ["workshop", "sebastian", "other"].includes(row.answeredBy);
  const byDayMap = new Map();
  const phoneAgg = new Map();
  for (const row of rows) {
    if (!byDayMap.has(row.date)) byDayMap.set(row.date, { date: row.date, total: 0, answered: 0, voicemail: 0, missed: 0 });
    const day = byDayMap.get(row.date);
    day.total += 1;
    if (isAnswered(row)) day.answered += 1;
    else if (row.answeredBy === "voicemail") day.voicemail += 1;
    else day.missed += 1;
    if (row.phone && row.phone !== "okänt/skyddat") {
      if (!phoneAgg.has(row.phone)) phoneAgg.set(row.phone, { calls: 0, reached: false, hasCase: false });
      const agg = phoneAgg.get(row.phone);
      agg.calls += 1;
      if (isAnswered(row)) agg.reached = true;
      if (row.hasCase) agg.hasCase = true;
    }
  }
  const answeredTotal = rows.filter(isAnswered).length;
  const voicemailTotal = rows.filter((row) => row.answeredBy === "voicemail").length;
  const neverReached = [...phoneAgg.values()].filter((agg) => !agg.reached);
  const stats = {
    windowDays: CALL_WINDOW_DAYS,
    total: rows.length,
    answered: answeredTotal,
    voicemail: voicemailTotal,
    missed: rows.length - answeredTotal - voicemailTotal,
    answerRate: rows.length ? answeredTotal / rows.length : 0,
    uniqueCallers: phoneAgg.size,
    uniqueNeverReached: neverReached.length,
    uniqueNeverReachedNoCase: neverReached.filter((agg) => !agg.hasCase).length,
    byDay: [...byDayMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };

  const todayRows = rows.filter((row) => row.date === today);
  const activeLeadRows = rows.filter((row) => row.lead && !["ignored", "converted"].includes(row.lead.status));
  const totals = {
    date: today,
    callsToday: todayRows.length,
    handledToday: todayRows.filter((row) => row.hasCase || ["workshop", "sebastian", "voicemail"].includes(row.answeredBy)).length,
    sebastianToday: todayRows.filter((row) => row.answeredBy === "sebastian").length,
    workshopToday: todayRows.filter((row) => row.answeredBy === "workshop").length,
    voicemailToday: todayRows.filter((row) => row.answeredBy === "voicemail").length,
    missedToday: todayRows.filter((row) => row.answeredBy === "missed").length,
    registeredToday: todayRows.filter((row) => row.hasCase).length,
    lostLeadToday: todayRows.filter((row) => row.eligibleLostLead).length,
    activeLeads: activeLeadRows.length,
    newLeadsToday: todayRows.filter((row) => row.lead?.status === "new").length,
  };

  // Saldovakt: hämtar 46elks-saldot (10000 = 1 SEK). Under tröskeln skickas
  // varnings-SMS till Sebastian max 1 gång per dygn (blob-throttle) — tomt
  // saldo var grundorsaken till telefonhaveriet 13-17 juli och får aldrig
  // hända tyst igen.
  let account = null;
  try {
    const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
    const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
    const meResponse = await fetch("https://api.46elks.com/a1/me", {
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
      signal: AbortSignal.timeout(8000),
    });
    const me = await meResponse.json().catch(() => ({}));
    if (meResponse.ok && Number.isFinite(Number(me.balance))) {
      const balanceSek = Math.round(Number(me.balance) / 10000);
      const warnBelowSek = Number(env("ELKS_BALANCE_WARN_SEK")) || 100;
      account = { balanceSek, warnBelowSek, low: balanceSek < warnBelowSek };
      if (account.low) {
        const warnStore = getStore({ name: "ops-warnings", consistency: "strong" });
        const lastWarn = await warnStore.get("elks-balance", { type: "json" }).catch(() => null);
        if (!lastWarn?.at || Date.now() - new Date(lastWarn.at).getTime() > 24 * 60 * 60 * 1000) {
          const warnTo = env("VOICE_NOTIFY_TO") || env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO");
          const warnResult = await postSms({
            to: warnTo,
            message: `[Nordic] VARNING: 46elks-saldot är nere på ${account.balanceSek} kr (gräns ${warnBelowSek} kr). Fyll på nu - vid 0 kr slutar telefon och SMS att fungera, som 13-17 juli.`,
          });
          await warnStore.setJSON("elks-balance", { at: new Date().toISOString(), balanceSek, result: warnResult.status }).catch(() => {});
        }
      }
    }
  } catch {
    account = null;
  }

  // Svars-inkorg: inkommande SMS (RING-svar m.m.) + optouts. Fönstret följer
  // CALL_WINDOW_DAYS så inkorgen täcker samma period som samtalsdatan — med
  // det gamla 7-dagarsfönstret blev svar på kampanj-SMS osynliga så fort
  // utskicket var drygt en vecka gammalt (kampanjvågorna går var 14:e dag).
  const inboundCutoff = Date.now() - CALL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const [{ items: inboundMap }, { items: optoutMap }] = await Promise.all([
    loadBlobMap("sms-inbound"),
    loadBlobMap("sms-optout"),
  ]);
  const inboundSms = [...inboundMap.entries()]
    .map(([key, item]) => ({ key, ...item }))
    .filter((item) => new Date(item.at || 0).getTime() >= inboundCutoff)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const optoutPhones = [...optoutMap.keys()];

  // Obesvarade RING-svar som passerat tröskeln. Samma detektion som det
  // schemalagda larmet (ring-escalate.mjs) — admin och SMS-larm får aldrig
  // visa olika sanning. Läser inboundMap som redan hämtats ovan.
  const ringUnhandled = await findStaleRingReplies({
    items: [...inboundMap.entries()].map(([key, item]) => ({ key, ...item })),
  }).catch(() => []);

  // Auktoritativ kampanjhistorik per telefonnummer (store "campaign-sent") —
  // detta, inte callId-followups, är sanningen om vem som fått kampanj-SMS.
  const { items: campaignMap } = await loadBlobMap("campaign-sent");
  const campaignSent = [...campaignMap.values()]
    .filter((item) => item?.phone && item?.lastSentAt)
    .map((item) => ({ phone: item.phone, lastSentAt: item.lastSentAt, count: Number(item.count) || 1 }));

  // AI-telesvarsinkorgen (store "voicemail-analysis", retention sköts av
  // analysmodulen). En gemensam inkorg för båda linjerna, nyaste först.
  const { items: voicemailMap } = await loadBlobMap("voicemail-analysis");
  const voicemailAnalyses = [...voicemailMap.values()]
    .filter((item) => item?.id)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 50);

  return { rows, todayRows, activeLeadRows, totals, stats, account, inboundSms, ringUnhandled, optoutPhones, ownNumbers: [...ownNumbers()], campaignSent, voicemailAnalyses, readOnly: !syncLeads };
};

export default async (request) => {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  if (request.method === "GET") {
    try {
      const syncLeads = new URL(request.url).searchParams.get("syncLeads") === "1";
      const dashboard = await buildCallRows({ syncLeads });
      return json(dashboard);
    } catch (error) {
      if (isCallSourceUnavailable(error)) return json(emptyCallDashboard(error));
      return json({ error: clean(error?.message || "Kunde inte läsa samtalslogg.", 240) }, 502);
    }
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 40);
    const phone = normalizePhone(body.phone);
    const callId = clean(body.callId, 160);
    const operatorName = clean(body.operatorName, 80) || "admin";

    if (!action) return json({ error: "Explicit action kravs." }, 400);

    if (action === "ignore") {
      if (!callId) return json({ error: "Call ID saknas." }, 400);
      const leadStore = getStore({ name: "call-leads", consistency: "strong" });
      const currentLead = await leadStore.get(callId, { type: "json" }).catch(() => null);
      const now = new Date().toISOString();
      const lead = {
        ...(currentLead || { id: callId, callId, phone }),
        status: "ignored",
        ignoredAt: now,
        updatedAt: now,
        ignoredBy: operatorName,
        notes: [
          ...(Array.isArray(currentLead?.notes) ? currentLead.notes : []),
          ...(body.note ? [{ at: now, text: clean(body.note, 500), by: operatorName }] : []),
        ],
      };
      await leadStore.setJSON(callId, lead);
      return json({ ok: true, lead });
    }

    if (action === "create_case") {
      const leadStore = getStore({ name: "call-leads", consistency: "strong" });
      const currentLead = callId ? await leadStore.get(callId, { type: "json" }).catch(() => null) : null;
      if (!currentLead) return json({ error: "Samtalslead saknas. Uppdatera samtal och prova igen." }, 404);
      if (currentLead.status === "converted" && currentLead.caseId) return json({ ok: true, lead: currentLead, caseId: currentLead.caseId });
      const caseItem = await createCaseFromLead({ lead: currentLead, operatorName, note: body.note });
      const now = new Date().toISOString();
      const lead = {
        ...currentLead,
        status: "converted",
        caseId: caseItem.id,
        convertedAt: now,
        convertedBy: operatorName,
        updatedAt: now,
      };
      await leadStore.setJSON(callId, lead);
      return json({ ok: true, lead, case: caseItem });
    }

    if (action === "configure_sms_webhook") {
      // Engångskonfiguration: pekar 010-numrets sms_url på vår inbound-webhook
      // via 46elks API. Credentials lämnar aldrig servern.
      const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
      const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
      if (!username || !password) return json({ error: "46elks API saknas i Netlify env." }, 503);
      const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      const ourNumber = normalizePhone(env("ELKS_NUMBER") || "+46101385498");
      // 46elks svarar ofta med ren text vid fel (t.ex. "Forbidden") — läs som
      // text och försök JSON-tolka, så felorsaken inte tappas bort.
      const readBody = async (response) => {
        const text = clean(await response.text().catch(() => ""), 400);
        try { return { text, json: JSON.parse(text) }; } catch { return { text, json: null }; }
      };
      const listResponse = await fetch("https://api.46elks.com/a1/numbers", {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(10000),
      });
      const listBody = await readBody(listResponse);
      if (!listResponse.ok) {
        return json({
          error: `Steg 1 (lista nummer) nekades av 46elks: HTTP ${listResponse.status} ${clean(listBody.json?.error || listBody.text || listResponse.statusText, 200)}. API-nyckeln i Netlify kan sakna rättigheter för nummerhantering — sätt då SMS-URL manuellt i 46elks dashboard: Numbers → ${ourNumber} → SMS URL.`,
          step: "list_numbers",
          httpStatus: listResponse.status,
        }, 502);
      }
      const numberEntry = (Array.isArray(listBody.json?.data) ? listBody.json.data : []).find(
        (item) => normalizePhone(item.number) === ourNumber && item.active !== "no",
      );
      if (!numberEntry) return json({ error: `Numret ${ourNumber} hittades inte på 46elks-kontot.` }, 404);
      const siteUrl = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
      const secret = clean(env("SMS_INBOUND_SECRET"), 240);
      const smsUrl = `${siteUrl}/api/sms-inbound${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`;
      const updateResponse = await fetch(`https://api.46elks.com/a1/numbers/${encodeURIComponent(numberEntry.id)}`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ sms_url: smsUrl }),
        signal: AbortSignal.timeout(10000),
      });
      const updateBody = await readBody(updateResponse);
      if (!updateResponse.ok) {
        return json({
          error: `Steg 2 (uppdatera sms_url) nekades av 46elks: HTTP ${updateResponse.status} ${clean(updateBody.json?.error || updateBody.text || updateResponse.statusText, 200)}. Sätt då SMS-URL manuellt i 46elks dashboard: Numbers → ${ourNumber} → SMS URL → ${smsUrl.replace(/secret=[^&]+/, "secret=<SMS_INBOUND_SECRET>")}`,
          step: "update_sms_url",
          httpStatus: updateResponse.status,
        }, 502);
      }
      return json({ ok: true, number: ourNumber, smsUrl: smsUrl.replace(/secret=[^&]+/, "secret=***"), voiceStartUnchanged: true });
    }

    if (action === "configure_voice_webhook") {
      // Sätter voice_start på 010-numret till voice-simple MED ?secret= så att
      // VOICE_WEBHOOK_SECRET kan aktiveras utan avbrott: 46elks skickar
      // secreten redan innan env-varn är live (voice-simple ignorerar den då).
      const secret = clean(body.secret, 240);
      if (secret.length < 32) return json({ error: "Secret måste vara minst 32 tecken." }, 400);
      const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
      const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
      if (!username || !password) return json({ error: "46elks API saknas i Netlify env." }, 503);
      const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      const ourNumber = normalizePhone(env("ELKS_NUMBER") || "+46101385498");
      const readBody = async (response) => {
        const text = clean(await response.text().catch(() => ""), 400);
        try { return { text, json: JSON.parse(text) }; } catch { return { text, json: null }; }
      };
      const listResponse = await fetch("https://api.46elks.com/a1/numbers", {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(10000),
      });
      const listBody = await readBody(listResponse);
      if (!listResponse.ok) {
        return json({ error: `Lista nummer nekades: HTTP ${listResponse.status} ${clean(listBody.json?.error || listBody.text, 200)}`, step: "list_numbers" }, 502);
      }
      const numberEntry = (Array.isArray(listBody.json?.data) ? listBody.json.data : []).find(
        (item) => normalizePhone(item.number) === ourNumber && item.active !== "no",
      );
      if (!numberEntry) return json({ error: `Numret ${ourNumber} hittades inte på 46elks-kontot.` }, 404);
      const siteUrl = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
      const voiceStartUrl = `${siteUrl}/.netlify/functions/voice-simple?secret=${encodeURIComponent(secret)}`;
      const updateResponse = await fetch(`https://api.46elks.com/a1/numbers/${encodeURIComponent(numberEntry.id)}`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ voice_start: voiceStartUrl }),
        signal: AbortSignal.timeout(10000),
      });
      const updateBody = await readBody(updateResponse);
      if (!updateResponse.ok) {
        return json({ error: `Uppdatera voice_start nekades: HTTP ${updateResponse.status} ${clean(updateBody.json?.error || updateBody.text, 200)}`, step: "update_voice_start" }, 502);
      }
      return json({ ok: true, number: ourNumber, voiceStart: voiceStartUrl.replace(/secret=[^&]+/, "secret=***") });
    }

    if (action === "allocate_sms_number") {
      // Skaffar ett virtuellt SMS-kapabelt svenskt mobilnummer via 46elks och
      // kopplar dess sms_url till sms-inbound. Godkänt av Sebastian 2026-08-02
      // ("Behöver vi skaffa ett virtuellt mobilnummer så har du min tillåtelse").
      // Idempotent: finns redan ett aktivt SMS-kapabelt nummer på kontot
      // återanvänds det i stället för att köpa ett nytt.
      const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
      const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
      if (!username || !password) return json({ error: "46elks API saknas i Netlify env." }, 503);
      const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      const readBody = async (response) => {
        const text = clean(await response.text().catch(() => ""), 500);
        try { return { text, json: JSON.parse(text) }; } catch { return { text, json: null }; }
      };
      const listResponse = await fetch("https://api.46elks.com/a1/numbers", {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(10000),
      });
      const listBody = await readBody(listResponse);
      if (!listResponse.ok) {
        return json({ error: `Lista nummer nekades: HTTP ${listResponse.status} ${clean(listBody.json?.error || listBody.text, 200)}` }, 502);
      }
      let entry = (Array.isArray(listBody.json?.data) ? listBody.json.data : []).find(
        (item) =>
          item.active !== "no" &&
          Array.isArray(item.capabilities) &&
          (item.capabilities.includes("sms") || item.capabilities.includes("mms")),
      );
      let allocated = false;
      if (!entry) {
        const createResponse = await fetch("https://api.46elks.com/a1/numbers", {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ country: "se", category: "mobile" }),
          signal: AbortSignal.timeout(15000),
        });
        const createBody = await readBody(createResponse);
        if (!createResponse.ok) {
          return json({ error: `Nummerköp nekades av 46elks: HTTP ${createResponse.status} ${clean(createBody.json?.error || createBody.text, 300)}`, step: "allocate" }, 502);
        }
        entry = createBody.json;
        allocated = true;
      }
      const siteUrl = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
      const smsSecret = clean(env("SMS_INBOUND_SECRET"), 240);
      const smsUrl = `${siteUrl}/api/sms-inbound${smsSecret ? `?secret=${encodeURIComponent(smsSecret)}` : ""}`;
      const updateResponse = await fetch(`https://api.46elks.com/a1/numbers/${encodeURIComponent(entry.id)}`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ sms_url: smsUrl }),
        signal: AbortSignal.timeout(10000),
      });
      const updateBody = await readBody(updateResponse);
      return json({
        ok: true,
        number: entry.number,
        allocated,
        smsUrlConfigured: updateResponse.ok,
        smsUrlError: updateResponse.ok ? null : clean(updateBody.json?.error || updateBody.text, 200),
        nextStep: `Sätt ELKS_SMS_NUMBER=${entry.number} i Netlify env och deploya om.`,
      });
    }

    if (action === "mark_inbound_handled") {
      const key = clean(body.key, 200);
      if (!key) return json({ error: "Nyckel saknas." }, 400);
      const inboundStore = getStore({ name: "sms-inbound", consistency: "strong" });
      const entry = await inboundStore.get(key, { type: "json" }).catch(() => null);
      if (!entry) return json({ error: "Posten hittades inte." }, 404);
      await inboundStore.setJSON(key, { ...entry, handled: true, handledAt: new Date().toISOString(), handledBy: operatorName });
      return json({ ok: true });
    }

    if (action === "click_to_call") {
      // Klick-att-ringa (godkänt av Sebastian 2026-08-29 "kör"): 46elks ringer
      // först upp Sebastians mobil; när han svarar kopplas kunden. Utgående
      // nummer mot kunden är det virtuella 076-numret — aldrig privata.
      const target = normalizePhone(clean(body.phone, 40));
      if (!target || !target.startsWith("+")) return json({ error: "Ogiltigt nummer." }, 400);
      const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
      const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
      const myMobile = normalizePhone(env("VOICE_PRIMARY_NUMBER"));
      const outboundFrom = normalizePhone(env("ELKS_SMS_NUMBER") || env("ELKS_NUMBER") || "+46101385498");
      if (!username || !password || !myMobile) return json({ error: "Telefonuppgifter saknas i env." }, 503);
      const response = await fetch("https://api.46elks.com/a1/calls", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          from: outboundFrom,
          to: myMobile,
          voice_start: JSON.stringify({ connect: target }),
        }),
        signal: AbortSignal.timeout(12000),
      });
      const bodyText = clean(await response.text().catch(() => ""), 300);
      if (!response.ok) return json({ error: `46elks nekade samtalet: HTTP ${response.status} ${bodyText}` }, 502);
      return json({ ok: true, to: target });
    }

    if (action === "list_recordings") {
      // Felsökning: lista senaste inspelningarna direkt från 46elks så att
      // verkliga wav-URL:er och fältvärden kan inspekteras utan telefonsamtal.
      const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
      const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
      if (!username || !password) return json({ error: "46elks API saknas." }, 503);
      const response = await fetch("https://api.46elks.com/a1/recordings", {
        headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
        signal: AbortSignal.timeout(10000),
      });
      const bodyJson = await response.json().catch(() => ({}));
      if (!response.ok) return json({ error: `46elks HTTP ${response.status}` }, 502);
      const items = (Array.isArray(bodyJson?.data) ? bodyJson.data : []).slice(0, 8);
      return json({ ok: true, recordings: items });
    }

    if (action === "test_voicemail_analysis") {
      // Syntetiskt test av analyskedjan utan telefonsamtal (admin-authat,
      // skickar aldrig SMS). Med transcriptOverride testas klassificering +
      // lagring + inkorg utan OpenAI; utan override försöker den ladda ner
      // wav-URL:en (får vara påhittad — då blir status "failed", vilket
      // också bevisar fallback-vägen).
      const { processVoicemailAnalysis, voicemailAiEnabledForCaller, voicemailInternalSmsEnabled } = await import("./_shared/voicemail-analysis.mjs");
      // Flagg-introspektion (inga hemligheter): visar produktionens env-läge
      // och om en given uppringare skulle passera allowlisten.
      const flags = {
        aiEnabledRaw: clean(env("VOICEMAIL_AI_ENABLED"), 20),
        internalSms: voicemailInternalSmsEnabled(),
        testCallerSet: Boolean(clean(env("VOICEMAIL_AI_TEST_CALLER"), 200)),
        aiEnabledForProvidedFrom: voicemailAiEnabledForCaller(clean(body.from, 40) || ""),
        openaiKeySet: Boolean(clean(env("OPENAI_API_KEY"), 10)),
      };
      if (body.flagsOnly === true) return json({ ok: true, flags });
      const payload = {
        id: clean(body.testId, 60) || `test_${Date.now()}`,
        from: clean(body.from, 40) || "+46700000000",
        wav: clean(body.wav, 400) || "https://api.46elks.com/a1/recordings/test-nonexistent.wav",
        created: new Date().toISOString(),
        duration: 5,
      };
      const result = await processVoicemailAnalysis({
        payload,
        source: "synthetic-test",
        lineLabel: "TEST",
        notify: null,
      });
      return json({ ok: true, result: { status: result.status, prio: result.item?.classification?.label || null, id: result.item?.id || payload.id } });
    }

    if (action === "mark_voicemail_handled") {
      const key = clean(body.key, 200);
      if (!key) return json({ error: "Nyckel saknas." }, 400);
      const voicemailStore = getStore({ name: "voicemail-analysis", consistency: "strong" });
      const entry = await voicemailStore.get(key, { type: "json" }).catch(() => null);
      if (!entry) return json({ error: "Posten hittades inte." }, 404);
      await voicemailStore.setJSON(key, { ...entry, handled: true, handledAt: new Date().toISOString(), handledBy: operatorName });
      return json({ ok: true });
    }

    if (!["send_discount", "discount"].includes(action)) return json({ error: "Okand action." }, 400);
    if (body.confirmLiveSms !== true) {
      return json({ error: "Live-SMS kraver explicit confirmLiveSms=true." }, 409);
    }
    const code = clean(body.code, 30) || "RING10";
    if (!phone || phone === "+46") return json({ error: "Telefonnummer saknas." }, 400);
    if (!callId) return json({ error: "Call ID saknas." }, 400);
    // Egna nummer spärras alltid, även med force=true — ett kampanj-SMS till
    // verkstadstelefonen är alltid ett misstag.
    if (ownNumbers().has(phone)) {
      return json({ ok: false, skipped: "own_number", followup: { callId, phone, result: { status: "own_number" } } });
    }
    // Optout gäller alltid — även om numret råkat komma med i en lista.
    const optout = await getStore({ name: "sms-optout", consistency: "strong" })
      .get(phone, { type: "json" }).catch(() => null);
    if (optout) return json({ ok: false, skipped: "optout", followup: { callId, phone, result: { status: "optout" } } });
    // HÅRD per-nummer-spärr: ett kampanj-SMS per nummer per 30 dagar, oavsett
    // callId, klientlogik eller schemaläggning. Infördes efter dubbelskicket
    // 2026-07-24, där callId-baserade followups inte räckte som dubblettskydd
    // (rotorsak oklar — den här spärren gör frågan irrelevant). Överstyrs
    // endast med explicit force=true.
    const campaignStore = getStore({ name: "campaign-sent", consistency: "strong" });
    const prior = await campaignStore.get(phone, { type: "json" }).catch(() => null);
    const CAMPAIGN_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
    if (
      body.force !== true &&
      prior?.lastSentAt &&
      Date.now() - new Date(prior.lastSentAt).getTime() < CAMPAIGN_COOLDOWN_MS
    ) {
      return json({
        ok: false,
        skipped: "already_sent",
        lastSentAt: prior.lastSentAt,
        followup: { callId, phone, result: { status: "already_sent" } },
      });
    }
    const message =
      clean(body.message, 918) ||
      `Hej! Vi såg att du ringt Nordic E-Mobility. Boka service via nordicemobility.se och ange koden ${code} så får du 10% rabatt på verkstadsarbetet. Gäller ny bokning inom 7 dagar. /Nordic E-Mobility`;
    if (body.dryRun === true || body.previewOnly === true) {
      return json({
        ok: true,
        dryRun: true,
        sent: false,
        followup: { callId, phone, code, message, result: { status: "dry_run", sent: false } },
        writesSkipped: ["call-followups", "call-leads"],
      });
    }
    const leadStore = getStore({ name: "call-leads", consistency: "strong" });
    const currentLead = callId ? await leadStore.get(callId, { type: "json" }).catch(() => null) : null;
    // replyable=true skickar från det SMS-kapabla numret så kunden kan svara
    // (RING/STOPP landar i sms-inbound-webhooken). ELKS_SMS_NUMBER = virtuellt
    // mobilnummer; 010-numret är Fixed och kan inte ta emot svar.
    const replyFrom = body.replyable === true
      ? normalizePhone(env("ELKS_SMS_NUMBER") || env("ELKS_NUMBER") || "+46101385498")
      : "";
    const result = await postSms({ to: phone, message, from: replyFrom || undefined });
    const entry = {
      callId,
      phone,
      code,
      message,
      result,
      sentAt: result.sentAt || new Date().toISOString(),
      operatorName,
    };
    await getStore({ name: "call-followups", consistency: "strong" }).setJSON(callId, entry);
    if (result.status === "sent") {
      // Append-säker per-nummer-historik — nyckeln är telefonnumret och
      // historiken skrivs aldrig över, bara utökas.
      await campaignStore.setJSON(phone, {
        phone,
        lastSentAt: entry.sentAt,
        lastCode: code,
        count: (Number(prior?.count) || 0) + 1,
        history: [...(Array.isArray(prior?.history) ? prior.history : []).slice(-19), { at: entry.sentAt, code, callId }],
      }).catch(() => {});
    }
    if (currentLead) {
      await leadStore.setJSON(callId, {
        ...currentLead,
        status: currentLead.status === "new" ? "followed_up" : currentLead.status,
        followup: entry,
        updatedAt: entry.sentAt,
      });
    }
    return json({ ok: result.status === "sent", followup: entry });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: ["/api/call-dashboard"],
};
