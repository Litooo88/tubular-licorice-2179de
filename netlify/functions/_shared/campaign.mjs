// Kampanjutskick i batch: rena hjälpfunktioner (testade) för
// personalisering, SMS-kostnad och mottagarfilter. Själva köandet sker i
// call-dashboard (action queue_campaign) och utskicket i outbox-flush.
//
// Varför en kö och inte direkt utskick: utskick ska gå dagtid (tysta timmar
// 21–08 gäller alla kundutskick), en schemalagd funktion får inte stå och
// skicka hundra SMS i en körning, och Sebastian ska kunna ångra en kö innan
// den gått ("cancel_campaign").

import { normalizePhone } from "./sms.mjs";

export const CAMPAIGN_COOLDOWN_DAYS = 30;
export const CAMPAIGN_BATCH_PER_RUN = 25;
export const SMS_PART_COST_SEK = 0.52; // uppmätt 46elks-pris per del

// GSM-7 grundalfabet + svenska tecken. Allt utanför tvingar UCS-2 (70 tecken
// per del i stället för 160) — tankstreck och typografiska citattecken är de
// vanliga bovarna. Byggs utan bokstavliga radbrytningar i källan.
const GSM7 =
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
  String.fromCharCode(10, 13);
const GSM7_EXT = "^{}\\[~]|€";

export const isGsm7 = (text) => [...String(text || "")].every((ch) => GSM7.includes(ch) || GSM7_EXT.includes(ch));

export const smsParts = (text) => {
  const s = String(text || "");
  if (!s) return 0;
  if (isGsm7(s)) {
    const units = [...s].reduce((n, ch) => n + (GSM7_EXT.includes(ch) ? 2 : 1), 0);
    return units <= 160 ? 1 : Math.ceil(units / 153);
  }
  const units = s.length;
  return units <= 70 ? 1 : Math.ceil(units / 67);
};

export const smsCost = (text, recipients = 1) => Math.round(smsParts(text) * recipients * SMS_PART_COST_SEK * 100) / 100;

// {namn} och {modell} ersätts per mottagare. Saknas värdet används reserv:
// "{namn}" → "" (och "Hej !" städas till "Hej!"), "din {modell}" → "ditt
// fordon", ensamt "{modell}" → "fordonet".
export const personalize = (template, { namn, modell } = {}) => {
  let text = String(template || "");
  const n = String(namn || "").trim().split(/\s+/)[0] || "";
  const m = String(modell || "").trim();
  text = text.replace(/\bdin \{modell\}/gi, m ? `din ${m}` : "ditt fordon");
  text = text.replace(/\{modell\}/g, m || "fordonet");
  text = text.replace(/\{namn\}/g, n);
  text = text.replace(/Hej\s+!/g, "Hej!").replace(/\s+,/g, ",").replace(/[ \t]{2,}/g, " ").trim();
  return text;
};

export const campaignKey = (tag, phone) => `campaign-${String(tag || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40)}-${String(phone || "").replace(/\D/g, "")}`;

// Filtrerar en mottagarlista mot allt som får stoppa ett kampanj-SMS.
// Ordningen är medveten: egna nummer och optout först (absoluta), sedan
// spärrlista, sedan 30-dagarsspärren per nummer (samma regel som
// send_discount), sedan dubbletter i listan själv.
export const filterRecipients = ({ recipients, ownNumbers, optoutPhones, blockedPhones, campaignSent, now = Date.now(), cooldownDays = CAMPAIGN_COOLDOWN_DAYS }) => {
  const own = new Set([...(ownNumbers || [])].map(normalizePhone));
  const optout = new Set([...(optoutPhones || [])].map(normalizePhone));
  const blocked = new Set([...(blockedPhones || [])].map(normalizePhone));
  const sent = new Map();
  for (const item of campaignSent || []) {
    const p = normalizePhone(item?.phone);
    if (p && item?.lastSentAt) sent.set(p, new Date(item.lastSentAt).getTime());
  }
  const cutoff = now - cooldownDays * 24 * 60 * 60 * 1000;
  const seen = new Set();
  const ok = [];
  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  for (const raw of Array.isArray(recipients) ? recipients : []) {
    const phone = normalizePhone(typeof raw === "string" ? raw : raw?.phone);
    if (!/^\+467\d{8}$/.test(phone)) { skip("ej_svensk_mobil"); continue; }
    if (own.has(phone)) { skip("eget_nummer"); continue; }
    if (optout.has(phone)) { skip("optout"); continue; }
    if (blocked.has(phone)) { skip("sparrad"); continue; }
    if (sent.has(phone) && sent.get(phone) > cutoff) { skip("kampanj_senaste_30d"); continue; }
    if (seen.has(phone)) { skip("dubblett"); continue; }
    seen.add(phone);
    ok.push({ phone, namn: String(raw?.namn || raw?.name || "").trim().slice(0, 80), modell: String(raw?.modell || raw?.model || "").trim().slice(0, 60) });
  }
  return { ok, skipped };
};
