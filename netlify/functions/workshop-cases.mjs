import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

const requireAdmin = (request) => {
  const expected = process.env.ADMIN_TOKEN || globalThis.Netlify?.env?.get?.("ADMIN_TOKEN");
  const provided = request.headers.get("x-admin-token") || "";

  if (!expected) {
    return { ok: false, response: json({ error: "ADMIN_TOKEN saknas i Netlify miljövariabler." }, 503) };
  }

  if (provided !== expected) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  return { ok: true };
};

const loadCase = async (store, id) => store.get(id, { type: "json" });

export default async (request, context) => {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  const store = getStore("workshop-cases");
  const id = context.params?.id;

  if (request.method === "GET") {
    if (id) {
      const item = await loadCase(store, id);
      return item ? json(item) : json({ error: "Not found" }, 404);
    }

    const { blobs } = await store.list();
    const cases = [];

    for (const blob of blobs) {
      const item = await loadCase(store, blob.key);
      if (item) cases.push(item);
    }

    cases.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));

    return json({
      cases,
      totals: {
        active: cases.filter((item) => !["done", "archived"].includes(item.status)).length,
        value: cases.reduce((sum, item) => sum + Number(item.estimatedValue || 0), 0),
      },
    });
  }

  if (request.method === "PATCH") {
    if (!id) return json({ error: "Missing case id" }, 400);

    const current = await loadCase(store, id);
    if (!current) return json({ error: "Not found" }, 404);

    const body = await request.json();
    const now = new Date().toISOString();
    const next = {
      ...current,
      updatedAt: now,
      status: clean(body.status, 40) || current.status,
      intakeAt: body.intakeAt === undefined ? current.intakeAt : clean(body.intakeAt, 80) || null,
      promisedAt: body.promisedAt === undefined ? current.promisedAt : clean(body.promisedAt, 80) || null,
      estimatedValue: body.estimatedValue === undefined ? current.estimatedValue : Number(body.estimatedValue || 0),
    };

    if (body.note) {
      next.notes = [...(current.notes || []), { at: now, text: clean(body.note) }];
    }

    next.timeline = [
      ...(current.timeline || []),
      { at: now, event: body.note ? `Uppdaterad: ${clean(body.note, 160)}` : `Status ändrad till ${next.status}` },
    ];

    await store.setJSON(id, next);
    return json({ ok: true, case: next });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: ["/api/cases", "/api/cases/:id"],
};
