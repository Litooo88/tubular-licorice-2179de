import { getStore } from "@netlify/blobs";
import { requireAdminToken } from "./_shared/admin-auth.mjs";
import { normalizePhone, postSms } from "./_shared/sms.mjs";

// Ringlistan — "ingen varm kund missas två gånger".
//
// Blob-store "ring-list", nyckel = telefonnummer. Statusar:
//   watch — varmt nummer (har fått utskick/återkontakt); bevakas av
//           ring-list-scan.mjs men visas inte i admins åtgärdslista.
//   new   — behöver åtgärd: kunden har ringt (igen) utan att nås.
//   done  — klarmarkerad av operatör.
//
//   GET  /api/ring-list                 — åtgärdslistan (status=new), sorterad
//   POST /api/ring-list                 — upsert {phone, name?, caseId?, reason?,
//                                         status?, sendInfoSms?} (seed/manuellt)
//   POST /api/ring-list/:id/done        — klarmarkera (id = telefonnummer)
//   POST /api/ring-list/:id/sms         — snabb-SMS {message} till numret
//
// Info-SMS:et (Sebastians formulering): kunden informeras om att den står på
// återuppringningslistan, kan svara RING för snabb uppringning, att svar
// kostar vanlig taxa, och kan svara STOPP. Max ett info-SMS per nummer per
// 7 dagar, aldrig till optout-nummer.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 300) => String(value || "").trim().slice(0, max);

export const INFO_SMS =
  "Hej! Vi ser att du försökt nå Nordic E-Mobility utan att komma fram. Du står nu på vår återuppringningslista och vi hör av oss så snart vi kan. Vill du bli uppringd snabbare – svara RING så ringer vi inom 24 tim. Svar kostar vanlig SMS-taxa. Vill du inte bli kontaktad, svara STOPP. /Nordic E-Mobility";

export const INFO_SMS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const stores = () => ({
  list: getStore({ name: "ring-list", consistency: "strong" }),
  optout: getStore({ name: "sms-optout", consistency: "strong" }),
});

export const sendInfoSmsIfAllowed = async (entry, { list, optout }) => {
  const blocked = await optout.get(entry.phone, { type: "json" }).catch(() => null);
  if (blocked) return { status: "optout" };
  if (entry.infoSmsAt && Date.now() - new Date(entry.infoSmsAt).getTime() < INFO_SMS_COOLDOWN_MS) {
    return { status: "cooldown", infoSmsAt: entry.infoSmsAt };
  }
  const sms = await postSms({ to: entry.phone, message: INFO_SMS });
  if (sms.status !== "sent") return { status: sms.status, error: sms.error };
  entry.infoSmsAt = new Date().toISOString();
  entry.log = [...(entry.log || []), { at: entry.infoSmsAt, event: "Info-SMS om återuppringningslistan skickat." }].slice(-30);
  await list.setJSON(entry.phone, entry);
  return { status: "sent" };
};

export default async (request, context) => {
  const auth = requireAdminToken(request, json, "ADMIN_TOKEN saknas i Netlify miljovariabler.");
  if (!auth.ok) return auth.response;

  const { list, optout } = stores();
  const id = context.params?.id ? normalizePhone(decodeURIComponent(context.params.id)) : "";
  const action = clean(context.params?.action, 20);

  if (request.method === "GET" && !id) {
    const { blobs } = await list.list().catch(() => ({ blobs: [] }));
    const items = [];
    for (const blob of blobs || []) {
      const item = await list.get(blob.key, { type: "json" }).catch(() => null);
      if (item && item.status === "new") items.push(item);
    }
    items.sort(
      (a, b) => (b.attempts || 0) - (a.attempts || 0) ||
        String(b.lastCustomerCallAt || "").localeCompare(String(a.lastCustomerCallAt || "")),
    );
    return json({ items, count: items.length });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Upsert (seed eller manuell tilläggning)
  if (!id) {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(body.phone);
    if (!phone) return json({ error: "Ogiltigt telefonnummer." }, 400);
    const existing = (await list.get(phone, { type: "json" }).catch(() => null)) || {
      phone,
      addedAt: new Date().toISOString(),
      attempts: 0,
      log: [],
    };
    const entry = {
      ...existing,
      name: clean(body.name, 140) || existing.name || "",
      caseId: clean(body.caseId, 120) || existing.caseId || "",
      reason: clean(body.reason, 300) || existing.reason || "",
      status: ["watch", "new", "done"].includes(body.status) ? body.status : existing.status || "watch",
      attempts: Number.isFinite(Number(body.attempts)) ? Number(body.attempts) : existing.attempts || 0,
      lastCustomerCallAt: clean(body.lastCustomerCallAt, 40) || existing.lastCustomerCallAt || "",
      updatedAt: new Date().toISOString(),
    };
    await list.setJSON(phone, entry);
    let infoSms = null;
    if (body.sendInfoSms === true) infoSms = await sendInfoSmsIfAllowed(entry, { list, optout });
    return json({ ok: true, entry: { phone: entry.phone, status: entry.status }, infoSms });
  }

  const entry = await list.get(id, { type: "json" }).catch(() => null);
  if (!entry) return json({ error: "Numret finns inte i ringlistan." }, 404);

  if (action === "done") {
    entry.status = "watch"; // fortsätter bevakas — ringer kunden igen utan svar väcks posten
    entry.doneAt = new Date().toISOString();
    entry.log = [...(entry.log || []), { at: entry.doneAt, event: "Klarmarkerad i admin." }].slice(-30);
    await list.setJSON(id, entry);
    return json({ ok: true });
  }

  if (action === "sms") {
    const body = await request.json().catch(() => ({}));
    const message = clean(body.message, 900);
    if (!message) return json({ error: "Meddelandetext saknas." }, 400);
    const blocked = await optout.get(id, { type: "json" }).catch(() => null);
    if (blocked) return json({ error: "Numret har avregistrerat sig (STOPP)." }, 409);
    const sms = await postSms({ to: id, message });
    if (sms.status !== "sent") return json({ status: sms.status, error: sms.error || "SMS kunde inte skickas." }, 502);
    entry.log = [...(entry.log || []), { at: new Date().toISOString(), event: `SMS skickat: "${message.slice(0, 80)}"` }].slice(-30);
    await list.setJSON(id, entry);
    return json({ ok: true, status: "sent" });
  }

  return json({ error: "Okänd åtgärd." }, 400);
};

export const config = {
  path: ["/api/ring-list", "/api/ring-list/:id/:action"],
};
