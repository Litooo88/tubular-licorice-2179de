// Delad logik för obesvarade RING-svar.
//
// Bakgrund: när en kund svarar "RING" på ett kampanj-SMS lovar autosvaret
// uppringning inom 24 timmar (se sms-inbound.mjs). Svaret hamnar i blobben
// "sms-inbound" med handled:false och syns i admins svars-inkorg — men bara
// om någon faktiskt öppnar admin. 2026-08-22 hittades ett RING-svar som legat
// obesvarat i 16 dagar: kunden hade ringt 4 ggr utan att komma fram, svarat
// "Ring" och sedan aldrig hört något.
//
// Två konsumenter delar den här modulen så tröskeln aldrig glider isär:
//   - ring-escalate.mjs  (schemalagd, skickar larm-SMS)
//   - call-dashboard.mjs (visar samma lista i admin)

import { getStore } from "@netlify/blobs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const num = (name, fallback) => {
  const parsed = Number(env(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Ett RING-svar räknas som försenat när det legat ohanterat längre än detta.
// Autosvaret lovar 24h, så default är 24h.
export const escalateAfterHours = () => num("RING_ESCALATE_HOURS", 24);
// Ligger det kvar ohanterat påminner vi igen tidigast efter detta.
export const realertAfterHours = () => num("RING_REALERT_HOURS", 24);

export const stockholmStamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "okänd tid";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

// Tysta timmar — vi väcker ingen kl 03. Larmet går vid nästa körning i fönstret.
export const isQuietHours = (date = new Date()) => {
  const hour = Number(
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(date),
  );
  const start = num("RING_ALERT_QUIET_START", 21);
  const end = num("RING_ALERT_QUIET_END", 7);
  // Fönstret spänner över midnatt (t.ex. 21 -> 7).
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
};

// Obesvarade RING-svar som passerat tröskeln, äldst först.
// `items` kan skickas in när anroparen redan läst storen (call-dashboard gör
// det) — annars läses blobben här.
export const findStaleRingReplies = async ({ items = null, now = Date.now() } = {}) => {
  let entries = items;
  if (!entries) {
    const store = getStore({ name: "sms-inbound", consistency: "strong" });
    const { blobs } = await store.list().catch(() => ({ blobs: [] }));
    const loaded = await Promise.all(
      (blobs || []).map(async (blob) => {
        const item = await store.get(blob.key, { type: "json" }).catch(() => null);
        return item ? { key: blob.key, ...item } : null;
      }),
    );
    entries = loaded.filter(Boolean);
  }
  const cutoff = now - escalateAfterHours() * 60 * 60 * 1000;
  return entries
    .filter((item) => item && item.type === "ring" && !item.handled)
    .filter((item) => {
      const at = new Date(item.at || 0).getTime();
      return Boolean(at) && at <= cutoff;
    })
    .map((item) => ({
      key: item.key,
      phone: item.phone,
      at: item.at,
      message: item.message || "",
      waitedHours: Math.floor((now - new Date(item.at).getTime()) / (60 * 60 * 1000)),
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
};

export const buildAlertMessage = (stale) => {
  const oldest = stale[0];
  const waited = oldest.waitedHours >= 48 ? `${Math.floor(oldest.waitedHours / 24)} dygn` : `${oldest.waitedHours} h`;
  const head =
    stale.length === 1
      ? `[Nordic] RING-svar obesvarat i ${waited}: ${oldest.phone} (svarade ${stockholmStamp(oldest.at)}).`
      : `[Nordic] ${stale.length} RING-svar obesvarade. Aldst: ${oldest.phone}, ${waited} (svarade ${stockholmStamp(oldest.at)}).`;
  return `${head} Kunden ar lovad uppringning inom 24h. Ring och markera som uppringd i admin > Svars-inkorgen.`;
};
