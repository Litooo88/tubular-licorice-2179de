import { resolveNordicOrigin } from "./unified.mjs";

export async function inboxRequest(path, body, { env = process.env, fetchImpl = fetch, etag } = {}) {
  const token = env.NORDIC_ADMIN_TOKEN?.trim();
  const origin = resolveNordicOrigin(env);
  if (!token) return { status: "not_configured" };
  if (!origin) return { status: "down" };
  try {
    const response = await fetchImpl(new URL("/api/task-inbox" + path, origin), {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-admin-token": token, Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(etag ? { "If-Match": etag } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return { status: [409, 412].includes(response.status) ? "conflict" :
      response.status === 400 ? "invalid" : response.status === 404 ? "unavailable" : "down" };
    return { status: "ok", data: await response.json(), etag: response.headers.get("etag") };
  } catch {
    return { status: "down" };
  }
}

export function inboxRow(item) {
  return {
    id: item.id, title: item.title, description: item.description, status: item.status,
    kind: item.kind, caseId: item.caseId, reference: item.serviceNumber,
    customer: item.customer?.name, phone: item.customer?.phone,
    received: item.timing?.receivedLocal || item.receivedAt,
    requested: item.timing?.requested?.local || item.timing?.requested?.raw,
    confirmed: item.timing?.confirmed?.local, due: item.dueAt,
    work: item.work?.label, lastContact: item.work?.at,
    callbackAt: item.work?.callbackAt, needsReview: item.needsReview,
    source: item.sourceLabel, reason: item.priority?.reason,
  };
}
