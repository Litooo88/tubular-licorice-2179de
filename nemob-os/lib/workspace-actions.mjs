import { fetchAdminCases, resetCasesCache } from "./admin-cases.mjs";
import { compactCase, normalizePhoneDigits } from "./lookup.mjs";
import { resolveNordicOrigin } from "./unified.mjs";

const TASK_ID = /^t_[a-f0-9]{20}$/;
const CASE_ID = /^[a-zA-Z0-9_:-]{4,120}$/;
const CALL_KINDS = new Set(["callback", "meeting_call"]);
const OPEN_TASKS = new Set(["proposed", "selected", "in_progress"]);
const CALL_RESULTS = new Set(["called_answered", "called_no_answer", "sms_sent", "handled_other", "callback_later"]);
const REPORT_STATUSES = new Set(["checked_in", "diagnosing", "repairing", "waiting_parts", "waiting_customer"]);
const CLOSED_CASES = new Set(["done", "archived", "closed", "cancelled"]);
const CONTACT_DIRECTIONS = new Set(["inbound", "outbound"]);
const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const samePhone = (a, b) => {
  const digits = normalizePhoneDigits(a);
  return digits.length >= 7 && digits === normalizePhoneDigits(b);
};

async function adminRequest(path, { method = "GET", body, etag, env = process.env, fetchImpl = fetch } = {}) {
  const token = env.NORDIC_ADMIN_TOKEN?.trim();
  const origin = resolveNordicOrigin(env);
  if (!token || !origin) return { status: "not_configured" };
  const headers = { Accept: "application/json", "x-admin-token": token };
  if (body) headers["Content-Type"] = "application/json";
  if (etag) headers["If-Match"] = etag;
  try {
    const response = await fetchImpl(new URL(path, origin), {
      method, headers, ...(body && { body: JSON.stringify(body) }),
      redirect: "error", signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      const errors = { 400: "invalid", 401: "unauthorized", 403: "unauthorized", 404: "missing",
        409: "conflict", 412: "conflict" };
      return { status: errors[response.status] || "down" };
    }
    return { status: "ok", data: await response.json(), etag: response.headers.get("etag") || "" };
  } catch {
    return { status: "down" };
  }
}

function appointment(item) {
  if (!item) return { bookedAt: "", confirmed: "" };
  const request = item.bookingRequest;
  if (request?.status === "confirmed") return { bookedAt: request.decidedAt || "", confirmed: item.preferredDate || "" };
  if (item.bookingMode === "direct" && !["pending", "declined"].includes(request?.status)) {
    return { bookedAt: item.createdAt || "", confirmed: item.preferredDate || "" };
  }
  return { bookedAt: "", confirmed: "" };
}

const taskPath = (id) => "/api/task-inbox/" + id;
const casePath = (id) => "/api/cases/" + encodeURIComponent(id);
const matchingCase = (rows, task, phone) => rows.find((item) =>
  item.id === task.caseId && samePhone(phone, item.customer?.phone));

export async function readRingList({ sync = false, ...options } = {}) {
  const inbox = sync ? await adminRequest("/api/task-inbox?limit=1", options) : null;
  const [ring, cases] = await Promise.all([
    adminRequest("/api/task-inbox/call-list?max=100", options), fetchAdminCases(options),
  ]);
  if (ring.status !== "ok") return { status: ring.status };
  if (!Array.isArray(ring.data?.items)) return { status: "down" };
  const rows = ring.data.items.filter((row) => TASK_ID.test(row?.taskId) && row.phone).map((row) => {
    const item = matchingCase(cases.cases || [], row, row.phone);
    return {
      id: row.taskId, phone: row.phone, name: row.name || item?.customer?.name || "",
      title: row.title, caseId: item?.id || "", reference: item?.serviceNumber || row.serviceNumber,
      receivedAt: row.timing?.receivedAt || row.receivedAt, requested: row.timing?.requested,
      confirmed: row.timing?.confirmed?.local || "", needsReview: row.needsReview,
      ...Object.fromEntries(Object.entries(appointment(item)).filter(([, value]) => value)),
      work: row.work, selected: ["selected", "in_progress"].includes(row.status),
    };
  });
  return {
    status: "ok", rows, total: ring.data.totalOpen,
    partial: cases.status !== "ok" || ring.data.sources?.ringList !== "ok" ||
      Boolean(inbox && (inbox.status !== "ok" || inbox.data?.partial)),
  };
}

async function callTask(id, options) {
  if (!TASK_ID.test(id)) return { status: "invalid" };
  const result = await adminRequest(taskPath(id), options);
  if (result.status !== "ok") return result;
  const task = result.data;
  if (!task || !CALL_KINDS.has(task.kind) || !task.customer?.phone || !OPEN_TASKS.has(task.status)) {
    return { status: "missing" };
  }
  return { status: "ok", task, etag: result.etag };
}

export async function readRingContact(id, options = {}) {
  const result = await callTask(id, options);
  if (result.status !== "ok") return { status: result.status };
  const { task } = result;
  const [nova, linked] = await Promise.all([
    adminRequest("/api/nova?days=60", options),
    CASE_ID.test(task.caseId || "") ? adminRequest(casePath(task.caseId), options) : null,
  ]);
  const phone = task.customer.phone;
  const item = linked?.status === "ok" && samePhone(phone, linked.data?.customer?.phone) ? linked.data : null;
  const sourceIds = new Set((task.sources || []).filter((s) => s.source === "nova-call").map((s) => s.sourceId));
  if (task.source === "nova-call") sourceIds.add(task.sourceId);
  const calls = (Array.isArray(nova.data?.calls) ? nova.data.calls : [])
    .filter((call) => call && CONTACT_DIRECTIONS.has(call.kind) && samePhone(phone, call.phone))
    .map((call) => ({
      id: text(call.id, 200), at: call.at, direction: call.kind, transcript: text(call.transcript, 12000),
      summary: text(call.summary, 1200), outcome: text(call.result?.label, 100),
      linked: sourceIds.has(call.id),
    }))
    .sort((a, b) => Number(b.linked) - Number(a.linked) || String(b.at).localeCompare(String(a.at)));
  return {
    status: "ok", novaStatus: nova.status === "ok" && !Array.isArray(nova.data?.calls) ? "down" : nova.status,
    calls, case: item ? compactCase(item) : null, ...appointment(item),
    next: text(task.description, 400), requested: task.timing?.requested, dueAt: task.dueAt,
  };
}

export async function updateRingContact(id, input, options = {}) {
  const action = input?.action;
  if (action !== "select" && !CALL_RESULTS.has(action)) return { status: "invalid" };
  const result = await callTask(id, options);
  if (result.status !== "ok") return { status: result.status };
  if (action === "select" && result.task.status !== "proposed") return { status: "ok" };
  const payload = { by: "NEMOB OS" };
  if (action === "select" && !result.etag) return { status: "conflict" };
  const path = action === "select" ? taskPath(id) + "/select"
    : "/api/task-inbox/call-list/" + encodeURIComponent(result.task.customer.phone) + "/status";
  if (action !== "select") Object.assign(payload, {
    status: action, taskId: result.task.id, ...(action === "callback_later" && { callbackAt: text(input.callbackAt, 40) }),
  });
  const updated = await adminRequest(path, {
    ...options, method: "POST", body: payload, etag: action === "select" ? result.etag : "",
  });
  if (updated.status !== "ok") return { status: updated.status };
  if (updated.data?.task?.error) return { status: "partial" };
  return { status: updated.data?.ok === true ? "ok" : "down" };
}

const normalized = (value) => String(value || "").toLocaleLowerCase("sv-SE").normalize("NFC");
const wordMatch = (line, value) => {
  if (!value) return false;
  const term = normalized(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^\\p{L}\\p{N}])" + term + "(?=$|[^\\p{L}\\p{N}])", "u").test(line);
};
function caseCandidates(cases, entry) {
  const line = normalized(entry);
  const identified = cases.filter((item) => wordMatch(line, item.serviceNumber) || wordMatch(line, item.id));
  if (identified.length) return identified;
  const matching = cases.filter((item) => !CLOSED_CASES.has(item.status));
  const matchesName = (item) => wordMatch(line, item.customer?.name) ||
    (normalizePhoneDigits(item.customer?.phone).length >= 7 && samePhone(item.customer?.phone,
      entry.match(/(?:\+46|0046|0)(?:[\d ()-]){7,18}/)?.[0]));
  const byCustomer = matching.filter(matchesName);
  const models = matching.filter((item) => wordMatch(line, item.vehicle?.model || item.model));
  const exactModels = models.filter((item) => {
    const model = normalized(item.vehicle?.model || item.model);
    return !models.some((other) => {
      const longer = normalized(other.vehicle?.model || other.model);
      return longer.length > model.length && wordMatch(longer, model);
    });
  });
  if (byCustomer.length && exactModels.length) return exactModels.filter(matchesName);
  return byCustomer.length ? byCustomer : exactModels;
}

function suggestedStatus(entry) {
  const line = normalized(entry);
  if (/\b(klart|fixad|åtgärdad|avslut\w*|stäng\w*|arkiver\w*|radera\w*)\b/u.test(line)) return "";
  if (/(?:påbörjade|började|startade)\s+(?:ett\s+)?(?:motorbyte|reparation|bytet)/u.test(line)) return "repairing";
  if (/(?:påbörjade|började|startade)\s+(?:en\s+)?felsökning/u.test(line)) return "diagnosing";
  if (/(?:tog emot|fick in|lämnades in|registrerades som inlämnad)/u.test(line)) return "checked_in";
  return "";
}

export async function reviewWorkshopReport(report, options = {}) {
  if (typeof report !== "string" || !report.trim() || report.length > 4000) return { status: "invalid" };
  const cases = await fetchAdminCases(options);
  if (cases.status !== "ok") return { status: cases.code === "unauthorized" ? "unauthorized" : cases.status };
  const entries = report.trim().split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}])/u).map((line) => line.trim()).filter(Boolean);
  if (entries.length > 15) return { status: "invalid" };
  return {
    status: "ok",
    proposals: entries.map((entry) => ({
      entry, status: suggestedStatus(entry),
      candidates: caseCandidates(cases.cases, entry).slice(0, 20).map((item) => compactCase(item)),
    })),
  };
}

export async function readReportCase(id, options = {}) {
  if (!CASE_ID.test(id)) return { status: "invalid" };
  const result = await adminRequest(casePath(id), options);
  if (result.status !== "ok") return { status: result.status };
  if (result.data?.id !== id || !result.etag) return { status: "conflict" };
  return { status: "ok", case: compactCase(result.data), version: result.etag, closed: CLOSED_CASES.has(result.data.status) };
}

export async function saveReportCase(input, options = {}) {
  const id = text(input?.id, 120);
  const version = text(input?.version, 200);
  const note = text(input?.note, 1600);
  const status = text(input?.status, 40);
  if (!CASE_ID.test(id) || !version || version === "*" || /[\r\n]/.test(version) ||
      (status && !REPORT_STATUSES.has(status)) || (!note && !status)) return { status: "invalid" };
  const current = await readReportCase(id, options);
  if (current.status !== "ok") return { status: current.status };
  if (current.version !== version || current.closed) return { status: "conflict" };
  const saved = await adminRequest(casePath(id), {
    ...options, method: "PATCH", etag: version,
    body: { operatorName: "NEMOB OS", ...(note && { note }), ...(status && { status }) },
  });
  if (saved.status !== "ok") return { status: saved.status };
  if (saved.data?.ok !== true || saved.data?.case?.id !== id) return { status: "down" };
  resetCasesCache();
  return { status: "ok", case: compactCase(saved.data.case) };
}
