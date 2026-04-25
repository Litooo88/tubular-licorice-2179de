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
    return { ok: false, response: json({ error: "ADMIN_TOKEN saknas i Netlify miljo variabler." }, 503) };
  }

  if (provided !== expected) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  return { ok: true };
};

const MEDIA_STORE = () => getStore({ name: "case-media", consistency: "strong" });
const CASE_STORE = () => getStore({ name: "workshop-cases", consistency: "strong" });

const safeFilename = (value) => clean(value, 120).replace(/[^\w.-]+/g, "-") || "image";
const extFromName = (name) => {
  const match = String(name || "").match(/(\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
};

const extFromType = (type) => {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/gif": ".gif",
  };
  return map[type] || "";
};

const createMediaEntry = ({ caseId, mediaId, name, contentType, size, category, note, publicOk, uploadedAt }) => ({
  id: mediaId,
  name,
  contentType,
  size,
  category,
  note,
  publicOk,
  uploadedAt,
  url: `/api/case-media/${encodeURIComponent(caseId)}/${encodeURIComponent(mediaId)}`,
});

export default async (request, context) => {
  const caseId = context.params?.id || context.params?.caseId;
  const mediaId = context.params?.mediaId;

  if (request.method === "GET" && caseId && mediaId) {
    const key = `${caseId}/${mediaId}`;
    const store = MEDIA_STORE();
    const file = await store.get(key, { type: "arrayBuffer" });
    if (!file) return new Response("Not found", { status: 404 });
    const meta = await store.getMetadata(key);
    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": meta?.metadata?.contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  if (!caseId) return json({ error: "Missing case id" }, 400);

  const cases = CASE_STORE();
  const item = await cases.get(caseId, { type: "json" });
  if (!item) return json({ error: "Case not found" }, 404);

  if (request.method === "GET") {
    return json({ media: Array.isArray(item.media) ? item.media : [] });
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const files = form.getAll("files").filter(Boolean);
    if (!files.length) return json({ error: "No files uploaded" }, 400);

    const category = clean(form.get("category"), 60) || "overview";
    const note = clean(form.get("note"), 300);
    const publicOk = String(form.get("publicOk") || "").trim() === "true";
    const uploadedAt = new Date().toISOString();
    const mediaStore = MEDIA_STORE();
    const created = [];

    for (const file of files) {
      const contentType = clean(file.type, 80) || "application/octet-stream";
      if (!contentType.startsWith("image/")) continue;
      const ext = extFromName(file.name) || extFromType(contentType) || ".jpg";
      const baseName = safeFilename(file.name).replace(/\.[a-z0-9]+$/i, "");
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const key = `${caseId}/${id}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await mediaStore.set(key, bytes, {
        metadata: {
          contentType,
          originalName: baseName + ext,
          category,
          note,
          publicOk,
          uploadedAt,
        },
      });
      created.push(
        createMediaEntry({
          caseId,
          mediaId: id,
          name: baseName + ext,
          contentType,
          size: Number(file.size || bytes.byteLength || 0),
          category,
          note,
          publicOk,
          uploadedAt,
        }),
      );
    }

    if (!created.length) return json({ error: "Inga giltiga bildfiler hittades." }, 400);

    const next = {
      ...item,
      updatedAt: uploadedAt,
      media: [...created, ...(Array.isArray(item.media) ? item.media : [])],
      notes: [...(item.notes || []), { at: uploadedAt, text: `Laddade upp ${created.length} bild(er) (${category}).` }],
      timeline: [...(item.timeline || []), { at: uploadedAt, event: `Bilder uppladdade: ${created.length} st (${category})` }],
    };

    await cases.setJSON(caseId, next);
    return json({ ok: true, media: created, case: next });
  }

  if (request.method === "DELETE" && mediaId) {
    const currentMedia = Array.isArray(item.media) ? item.media : [];
    const target = currentMedia.find((entry) => entry.id === mediaId);
    if (!target) return json({ error: "Media not found" }, 404);

    await MEDIA_STORE().delete(`${caseId}/${mediaId}`);
    const updatedAt = new Date().toISOString();
    const next = {
      ...item,
      updatedAt,
      media: currentMedia.filter((entry) => entry.id !== mediaId),
      notes: [...(item.notes || []), { at: updatedAt, text: `Tog bort bild ${target.name || mediaId}.` }],
      timeline: [...(item.timeline || []), { at: updatedAt, event: `Bild borttagen: ${target.name || mediaId}` }],
    };
    await cases.setJSON(caseId, next);
    return json({ ok: true, case: next });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: ["/api/cases/:id/media", "/api/case-media/:caseId/:mediaId"],
};
