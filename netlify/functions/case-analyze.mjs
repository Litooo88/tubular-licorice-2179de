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

const categoryLabels = {
  overview: "översiktsbild",
  before: "förebild",
  after: "efterbild",
  damage: "skadebild",
  battery: "batteri/eldiagno",
  parts: "delbild",
  delivery: "hämtning/leveransbild",
  workbench: "verkstadsbild",
};

const shortId = (id) => String(id || "").replace(/^case_/, "").slice(0, 18).toUpperCase();
const mediaItems = (item) => (Array.isArray(item.media) ? [...item.media].sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || ""))) : []);

const primaryAngle = (item, media) => {
  const categories = new Set(media.map((entry) => entry.category));
  const text = `${item.service || ""} ${item.message || ""} ${item.completion?.workSummary || ""}`.toLowerCase();
  if (categories.has("before") && categories.has("after")) return "före/efter-resultat";
  if (categories.has("battery") || /batteri|bms|ladd|controller|display|elsystem/.test(text)) return "teknisk lösning och trygg felsökning";
  if (categories.has("damage")) return "synlig skada och åtgärd";
  if (/punktering|däck|slang/.test(text)) return "snabb vardagsreparation";
  return "verkstadskvalitet och färdigt resultat";
};

const buildContent = (item, media, angle) => {
  const latest = media[0];
  const model = clean(item.vehicle?.model, 140) || "elscooter";
  const service = clean(item.service, 140) || "verkstadsjobb";
  const workSummary = clean(item.completion?.workSummary || item.message, 600) || "felsökning och åtgärd i verkstaden";
  const totalCost = item.completion?.totalCost ? `${Number(item.completion.totalCost)} kr inkl. moms` : "";
  const visual = latest ? `${categoryLabels[latest.category] || latest.category}${latest.note ? `: ${latest.note}` : ""}` : "verkstadsbild";
  const priceLine = totalCost ? ` Slutbelopp ${totalCost}.` : "";
  return {
    social: `Klar i verkstaden: ${model}.\n\nInkommen för ${service.toLowerCase()}, nu löst med fokus på ${angle}. Utförda åtgärder: ${workSummary}.${priceLine}\nBildval: ${visual}.\n\nBoka service hos Nordic E-Mobility i Örebro via nordicemobility.se.`,
    google: `${model} klar i verkstaden efter ${service.toLowerCase()}. Fokus: ${angle}. Utförda åtgärder: ${workSummary}.${priceLine} Nordic E-Mobility i Örebro.`,
    web: `${model} kom in för ${service.toLowerCase()}. Vi arbetade med vinkeln ${angle} och åtgärdade ${workSummary}.${priceLine} Bildmaterialet visar ${visual} och passar för ett tydligt webbcase eller social uppdatering.`,
  };
};

export default async (request, context) => {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  const id = context.params?.id;
  if (!id) return json({ error: "Missing case id" }, 400);

  const cases = getStore({ name: "workshop-cases", consistency: "strong" });
  const item = await cases.get(id, { type: "json" });
  if (!item) return json({ error: "Case not found" }, 404);

  const media = mediaItems(item);
  const byCategory = Object.fromEntries(
    media.reduce((map, entry) => {
      const key = entry.category || "overview";
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map()),
  );
  const publicMedia = media.filter((entry) => entry.publicOk);
  const angle = primaryAngle(item, publicMedia.length ? publicMedia : media);
  const content = buildContent(item, publicMedia.length ? publicMedia : media, angle);

  return json({
    ok: true,
    summary: media.length
      ? `${media.length} bild(er) hittades för ärendet ${shortId(item.id)}.`
      : `Inga bilder finns ännu för ärendet ${shortId(item.id)}.`,
    classification: {
      totalImages: media.length,
      publicReady: publicMedia.length,
      byCategory,
    },
    strategy: {
      primaryAngle: angle,
      recommendedFormat: media.length > 1 ? "carousel" : "single-post",
      callToAction: "Boka service eller upphämtning via nordicemobility.se",
    },
    content,
  });
};

export const config = {
  path: ["/api/cases/:id/analyze"],
};
