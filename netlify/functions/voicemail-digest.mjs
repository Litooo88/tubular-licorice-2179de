// Morgondigest för röstbrevlådan: gårdagens transkriberade och sorterade
// meddelanden som ETT internt SMS till Sebastian, varje morgon före öppning.
//
// Bakgrund (2026-09-21): AI-analysen transkriberar och prioriterar allt, men
// bara VIKTIGT skickar direkt-SMS (spec punkt 7). ÅTGÄRD/LÅG samlades tyst i
// admin — som ingen öppnade — och växte till 39 ohanterade. Digesten gör
// admininkorgen läsbar i mobilen utan att ändra direkt-SMS-regeln.
//
// Skickar INGET när det varken finns nya meddelanden eller ohanterad kö —
// Sebastian har uttryckligen bett om mindre brus, inte fler tomma rapporter.

import { getStore } from "@netlify/blobs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);

const PRIORITY_ORDER = { urgent: 0, action: 1, low: 2 };
const PRIORITY_LABELS = { urgent: "VIKTIGT", action: "ÅTGÄRD", low: "LÅG" };

const shortCaller = (caller) => {
  const value = clean(caller, 40);
  return value.startsWith("+") ? `...${value.slice(-4)}` : value || "okänt nr";
};

const itemLine = (item, index) => {
  const label = PRIORITY_LABELS[item?.classification?.priority] || "LÅG";
  const who = item?.customerMatch?.matched && item.customerMatch.customerName
    ? ` (${clean(item.customerMatch.customerName, 30)})`
    : "";
  const summary = clean(item?.summary, 400).replace(/\s+/g, " ");
  const shortSummary = summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
  return `${index}. ${label} ${shortCaller(item?.caller)}${who}: ${shortSummary}`;
};

// Exporterad för test. Bygger hela digest-SMS:et; null = inget att skicka.
export const buildDigestMessage = ({ fresh = [], unhandledCount = 0, maxItems = 5, now = new Date() } = {}) => {
  if (!fresh.length && !unhandledCount) return null;
  const date = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "numeric" });
  const sorted = [...fresh].sort((a, b) => {
    const prio = (PRIORITY_ORDER[a?.classification?.priority] ?? 9) - (PRIORITY_ORDER[b?.classification?.priority] ?? 9);
    return prio || String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""));
  });
  const lines = [`[Nordic] Röstbrevlådan ${date}: ${fresh.length} nya senaste dygnet.`];
  sorted.slice(0, maxItems).forEach((item, index) => lines.push(itemLine(item, index + 1)));
  if (sorted.length > maxItems) lines.push(`...och ${sorted.length - maxItems} till i admin.`);
  if (unhandledCount) lines.push(`Ohanterade totalt: ${unhandledCount}. Öppna admin > Telefoni.`);
  // Kostnadstak: ~3 SMS-delar GSM-7. Klipp hellre än att skicka en roman.
  return lines.join("\n").slice(0, 450);
};

const sendInternalSms = async (message) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = clean(env("SMS_FROM") || "NordicEM", 11);
  const to = clean(env("VOICE_NOTIFY_TO") || env("VOICE_MISSED_SMS_TO"), 40);
  if (!username || !password || !to) return { status: "not_configured" };
  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from, to, message, dontlog: "message" }),
      signal: AbortSignal.timeout(7000),
    });
    return { status: response.ok ? "sent" : "failed", httpStatus: response.status };
  } catch (error) {
    console.error("voicemail_digest_sms_failed", { message: clean(error?.message, 180) });
    return { status: "failed" };
  }
};

const listAll = async (store) => {
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined);
    keys.push(...(page.blobs || []).map((item) => item.key).filter(Boolean));
    cursor = page.cursor;
  } while (cursor);
  const items = [];
  for (let index = 0; index < keys.length; index += 25) {
    const chunk = keys.slice(index, index + 25);
    const values = await Promise.all(chunk.map((key) => store.get(key, { type: "json" }).catch(() => null)));
    items.push(...values.filter(Boolean));
  }
  return items;
};

export default async () => {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

  // Idempotens: schemat kör en gång per dygn, men skydda mot omkörningar.
  const stateStore = getStore({ name: "voicemail-digest-state", consistency: "strong" });
  const state = await stateStore.get("last-run", { type: "json" }).catch(() => null);
  if (state?.at && Date.now() - new Date(state.at).getTime() < 20 * 60 * 60 * 1000) {
    return json({ ok: true, skipped: "already_ran_today" });
  }

  const items = await listAll(getStore({ name: "voicemail-analysis", consistency: "strong" }));
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const fresh = items.filter(
    (item) => ["complete", "no_speech"].includes(item?.status) && Date.parse(item?.createdAt || 0) > dayAgo,
  );
  const unhandledCount = items.filter(
    (item) => ["complete", "no_speech"].includes(item?.status) && !item?.handled,
  ).length;

  const message = buildDigestMessage({ fresh, unhandledCount });
  if (!message) {
    await stateStore.setJSON("last-run", { at: new Date().toISOString(), sent: false }).catch(() => {});
    return json({ ok: true, skipped: "nothing_to_report" });
  }

  const sms = await sendInternalSms(message);
  await stateStore.setJSON("last-run", { at: new Date().toISOString(), sent: sms.status === "sent", freshCount: fresh.length }).catch(() => {});
  console.log("voicemail_digest_sent", { freshCount: fresh.length, unhandledCount, sms: sms.status });
  return json({ ok: true, freshCount: fresh.length, unhandledCount, sms });
};

// 05:45 UTC = 07:45 svensk sommartid (06:45 vintertid) — före öppning kl 9.
export const config = { schedule: "45 5 * * *" };
