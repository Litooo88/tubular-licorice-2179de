import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { normalizePhone, postSms } from "./_shared/sms.mjs";
import { scoreLead } from "./_shared/lead-priority.mjs";

// SMS-utkastinkorg: AI/agent genererar utkast för obesvarade ärenden,
// Sebastian granskar och godkänner i admin, systemet skickar spårbart.
//
// Flöde:
//   PUT  /api/sms-drafts              — importera utkast (+ mailnotis om granskning)
//   GET  /api/sms-drafts              — lista väntande utkast
//   POST /api/sms-drafts/:id/approve  — skicka (ev. redigerad text), uppdatera ärendet, ta bort utkastet
//   POST /api/sms-drafts/:id/skip     — ta bort utkastet utan att skicka
//
// Regler: inget skickas utan explicit godkännande per ärende; optout-listan
// respekteras; allt loggas på ärendet (smsLog + timeline); status new→contacted.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 2000) => String(value || "").trim().slice(0, max);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const notifyEmail = async (count) => {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  const to = env("WORKSHOP_EMAIL") || env("EMAIL_REPLY_TO");
  if (!apiKey || !from || !to) return { status: "not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${count} SMS-utkast väntar på ditt godkännande`,
        text: `${count} AI-genererade svarsutkast till obesvarade ärenden ligger klara för granskning.\n\nÖppna admin och gå till sektionen "SMS-utkast väntar godkännande":\nhttps://www.nordicemobility.se/admin/\n\nInget skickas förrän du godkänner varje utkast.\n\n/Nordic E-Mobility systemet`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return { status: response.ok ? "sent" : "failed" };
  } catch {
    return { status: "failed" };
  }
};

export default async (request, context) => {
  const auth = requireAdminToken(request, json, "ADMIN_TOKEN saknas i Netlify miljovariabler.");
  if (!auth.ok) return auth.response;

  const drafts = getStore({ name: "sms-drafts", consistency: "strong" });
  const id = context.params?.id;
  const action = context.params?.action;

  if (request.method === "GET" && !id) {
    const { blobs } = await drafts.list();
    const items = [];
    for (const blob of blobs) {
      const item = await drafts.get(blob.key, { type: "json" }).catch(() => null);
      if (item) items.push(item);
    }
    // Sebastians prioriteringsregel: poäng (samtal/recency/intention/kr-per-min) desc, sedan färskast först.
    items.sort((a, b) => (b.closeProbability ?? -1) - (a.closeProbability ?? -1) || (b.priority ?? -1) - (a.priority ?? -1) || (a.meta?.alderDagar ?? 0) - (b.meta?.alderDagar ?? 0));
    return json({ drafts: items, count: items.length });
  }

  if (request.method === "PUT" && !id) {
    const body = await request.json().catch(() => ({}));
    const incoming = Array.isArray(body.drafts) ? body.drafts : [];
    if (!incoming.length) return json({ error: "Inga utkast i importen." }, 400);
    let stored = 0;
    for (const draft of incoming) {
      const caseId = clean(draft.caseId, 120);
      const message = clean(draft.message, 1600);
      if (!caseId || !message) continue;
      await drafts.setJSON(caseId, {
        caseId,
        category: ["A", "B", "C"].includes(draft.category) ? draft.category : "C",
        message,
        meta: {
          namn: clean(draft.meta?.namn, 140),
          telefon: clean(draft.meta?.telefon, 40),
          tjanst: clean(draft.meta?.tjanst, 140),
          alderDagar: Number(draft.meta?.alderDagar) || 0,
          ursprung: clean(draft.meta?.ursprung, 300),
          missedCalls: Number(draft.meta?.missedCalls) || 0,
          lastCallDate: clean(draft.meta?.lastCallDate, 20),
        },
        ...scoreLead({
          missedCalls: draft.meta?.missedCalls,
          alderDagar: draft.meta?.alderDagar,
          ursprung: draft.meta?.ursprung,
          tjanst: draft.meta?.tjanst,
        }),
        importedAt: new Date().toISOString(),
      });
      stored++;
    }
    // silent=true vid om-import/berikning (ingen ny mailnotis).
    const mail = body.silent === true ? { status: "silent" } : await notifyEmail(stored);
    return json({ ok: true, stored, notification: mail.status });
  }

  if (request.method === "POST" && id && action === "skip") {
    await drafts.delete(id);
    return json({ ok: true, skipped: id });
  }

  if (request.method === "POST" && id && action === "approve") {
    const draft = await drafts.get(id, { type: "json" });
    if (!draft) return json({ error: "Utkastet finns inte (redan hanterat?)." }, 404);
    const body = await request.json().catch(() => ({}));
    const message = clean(body.message || draft.message, 1600);

    const cases = getStore({ name: "workshop-cases", consistency: "strong" });
    const item = await cases.get(id, { type: "json" });
    if (!item) return json({ error: "Ärendet finns inte längre." }, 404);
    const phone = normalizePhone(item?.customer?.phone);
    if (!phone) return json({ error: "Kundtelefon saknas på ärendet." }, 400);

    // Respektera optout-listan (nyckel = normaliserat telefonnummer).
    const optout = getStore({ name: "sms-optout", consistency: "strong" });
    const opted = await optout.get(phone, { type: "json" }).catch(() => null);
    if (opted) return json({ error: "Kunden har avböjt SMS (optout) — hantera manuellt." }, 409);

    const sms = await postSms({ to: phone, message });
    if (sms.status === "not_configured") return json({ status: "not_configured" });
    if (sms.status !== "sent") return json({ status: sms.status, error: sms.error || "SMS kunde inte skickas." }, 502);

    const now = new Date().toISOString();
    const operator = clean(body.operatorName, 80);
    const next = {
      ...item,
      status: item.status === "new" ? "contacted" : item.status,
      smsLog: [
        ...(Array.isArray(item.smsLog) ? item.smsLog : []),
        { at: now, kind: "draft-inbox", to: phone, message, status: "sent", providerId: sms.id || "", operator },
      ].slice(-50),
      timeline: [
        ...(Array.isArray(item.timeline) ? item.timeline : []),
        { at: now, event: `AI-utkast (kategori ${draft.category}) godkänt${operator ? ` av ${operator}` : ""} och skickat via SMS-API.` },
      ],
      updatedAt: now,
    };
    await cases.setJSON(id, next);
    await drafts.delete(id);
    return json({ status: "sent", caseId: id, newStatus: next.status });
  }

  return json({ error: "Not found" }, 404);
};

export const config = {
  path: ["/api/sms-drafts", "/api/sms-drafts/:id/:action"],
};
