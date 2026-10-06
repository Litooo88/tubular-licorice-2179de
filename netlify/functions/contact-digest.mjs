// Kundkontaktdigest: ett SMS + ett mejl per dag med de sms-utkast som väntar
// på Sebastians ja, numrerade så att han kan godkänna genom att svara "1 ok".
//
// Varför: utkastinkorgen har funnits sedan augusti men krävde ett besök i
// admin, och admin är ytan han inte öppnar (hans egna ord 2026-10-06:
// kundkontakten är det han drar sig från ända in i det sista). Numreringen
// sparas i storen "contact-queue" så att sms-inbound kan översätta "1 ok" till
// rätt utkast.
//
// Skickar INGET när kön är tom — mindre brus var ett uttryckligt krav.

import { getStore } from "@netlify/blobs";
import { postSms } from "./_shared/sms.mjs";
import { normalizeDraft } from "./sms-draft-inbox.mjs";
import { buildContactDigest } from "./_shared/customer-contact.mjs";

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const MAX_I_KON = 12;

const läsUtkast = async () => {
  const store = getStore({ name: "sms-drafts", consistency: "strong" });
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  const items = [];
  for (const blob of blobs || []) {
    const item = await store.get(blob.key, { type: "json" }).catch(() => null);
    const normalized = normalizeDraft(item, blob.key);
    if (normalized) items.push(normalized);
  }
  // Samma ordning som admin visar: högst closeProbability först, sedan äldst.
  items.sort(
    (a, b) =>
      (b.closeProbability ?? -1) - (a.closeProbability ?? -1) ||
      (b.priority ?? -1) - (a.priority ?? -1) ||
      (b.meta?.alderDagar ?? 0) - (a.meta?.alderDagar ?? 0),
  );
  return items.slice(0, MAX_I_KON);
};

const skickaMejl = async (drafts) => {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  const to = env("WORKSHOP_EMAIL") || env("EMAIL_REPLY_TO");
  if (!apiKey || !from || !to) return { status: "not_configured" };
  const rader = drafts
    .map((d, i) => {
      const namn = clean(d?.meta?.namn, 80) || "okänd";
      const tel = clean(d?.meta?.telefon, 40);
      const vad = clean(d?.meta?.tjanst, 120);
      return `<p style="margin:0 0 14px"><strong>${i + 1}. ${namn}</strong> ${tel}${vad ? ` &middot; ${vad}` : ""}<br>
      <span style="color:#555">${clean(d.message, 900).replace(/</g, "&lt;")}</span><br>
      <span style="color:#888;font-size:13px">Svara "${i + 1} ok" för att skicka, "${i + 1} nej" för att kasta, "${i + 1} ändra: ..." för att skriva om.</span></p>`;
    })
    .join("");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${drafts.length} sms-utkast väntar på ditt ja`,
        html: `<div style="max-width:640px;font:15px/1.5 system-ui,sans-serif;color:#222">
          <p>Svara på digest-SMS:et med radnumret — inget skickas förrän du gör det.</p>${rader}
          <p style="color:#888;font-size:13px">Du kan också godkänna i admin. Utkasten ligger kvar till de godkänns eller kastas.</p></div>`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return { status: response.ok ? "sent" : "failed" };
  } catch {
    return { status: "failed" };
  }
};

export default async () => {
  const till = clean(env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO"), 40);
  const state = getStore({ name: "contact-queue", consistency: "strong" });
  const drafts = await läsUtkast();

  if (!drafts.length) {
    await state.setJSON("current", { at: new Date().toISOString(), items: [] }).catch(() => {});
    return json({ ok: true, skipped: "inga_utkast" });
  }

  // Numreringen MÅSTE sparas innan SMS:et går ut, annars kan ett snabbt svar
  // ("1 ok") inte översättas till rätt utkast.
  await state.setJSON("current", {
    at: new Date().toISOString(),
    items: drafts.map((d, i) => ({ nr: i + 1, draftId: d.caseId, namn: clean(d?.meta?.namn, 80), telefon: clean(d?.meta?.telefon, 40) })),
  });

  const mejl = await skickaMejl(drafts);
  const message = buildContactDigest({ drafts });
  const sms = till && message ? await postSms({ to: till, message }) : { status: "not_configured" };
  console.log("contact_digest_sent", { count: drafts.length, sms: sms.status, mail: mejl.status });
  return json({ ok: true, count: drafts.length, sms: sms.status, mail: mejl.status });
};

// 06:20 UTC = 08:20 svensk sommartid, strax efter röstbrevlådedigesten 07:45
// så de två inte krockar i samma minut.
export const config = { schedule: "20 6 * * *" };
