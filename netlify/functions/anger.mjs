import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import emailShared from "./_shared/email.js";

const { resendEmail, FOOTER_HTML, FOOTER_TEXT } = emailShared;

// Digital ångerfunktion (distansavtalslagen): tar emot konsumentens
// otvetydiga ångermeddelande, lagrar det tidsstämplat och skickar omedelbar
// bekräftelse i varaktig form (e-post). Saknas mejlkonfiguration lagras
// ärendet ändå och verkstaden följer upp manuellt via Netlify Forms-backupen.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

const htmlEscape = (value) =>
  clean(value, 5000).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const env = (name) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
  } catch {
    return process.env[name] || "";
  }
};

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean(value, 240));

const rateState = globalThis.__nordicAngerRateState || new Map();
globalThis.__nordicAngerRateState = rateState;

const requestIp = (request) =>
  clean(
    request.headers.get("x-nf-client-connection-ip") ||
      request.headers.get("client-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0] ||
      "unknown",
    120,
  );

const isRateLimited = (key, { limit = 5, windowMs = 10 * 60 * 1000 } = {}) => {
  const now = Date.now();
  const bucket = (rateState.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  bucket.push(now);
  rateState.set(key, bucket);
  return bucket.length > limit;
};

const stockholmTimestamp = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);

const confirmationEmail = (item) => {
  const firstName = clean(item.namn, 120).split(/\s+/)[0] || "där";
  const rows = [
    ["Ärendenummer", item.id],
    ["Mottaget", `${stockholmTimestamp(new Date(item.createdAt))} (svensk tid)`],
    ["Ordernummer/referens", item.ordernummer || "-"],
    ["Produkt", item.produkt || "-"],
  ];
  return {
    subject: `Bekräftelse: ditt ångermeddelande är mottaget (${item.id})`,
    html: `
  <div style="margin:0;background:#f4f6f2;padding:24px;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #dfe5dc;border-radius:8px;overflow:hidden">
      <div style="background:#061007;color:#fff;padding:22px 24px">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8ff5ae;font-weight:700">Nordic E-Mobility</div>
        <h1 style="font-size:24px;line-height:1.2;margin:8px 0 0">Ditt &aring;ngermeddelande &auml;r mottaget</h1>
      </div>
      <div style="padding:24px;line-height:1.6">
        <p>Hej ${htmlEscape(firstName)},</p>
        <p>Vi bekr&auml;ftar h&auml;rmed att vi tagit emot ditt meddelande om att du ut&ouml;var din &aring;ngerr&auml;tt. Din &aring;ngerfrist &auml;r d&auml;rmed bevakad fr&aring;n tidpunkten nedan.</p>
        <div style="background:#f7faf6;border:1px solid #dfe8dc;border-radius:8px;padding:16px;margin:18px 0">
          ${rows.map(([label, value]) => `<p style="margin:0 0 8px"><strong>${label}:</strong> ${htmlEscape(value)}</p>`).join("")}
        </div>
        <p><strong>N&auml;sta steg:</strong> Returnera varan till Pistolv&auml;gen 6, 702 21 &Ouml;rebro utan on&ouml;digt dr&ouml;jsm&aring;l och senast 14 dagar efter detta meddelande. Du st&aring;r f&ouml;r returfrakten. Vi &aring;terbetalar inom 14 dagar fr&aring;n ditt &aring;ngermeddelande &mdash; dock tidigast n&auml;r vi f&aring;tt tillbaka varan eller du visat att den skickats. Avdrag g&ouml;rs endast f&ouml;r varans faktiska v&auml;rdeminskning.</p>
        <p>Vi kontaktar dig om praktiska detaljer. Fr&aring;gor? Svara p&aring; det h&auml;r mejlet eller ring 010-138 54 98.</p>
        ${FOOTER_HTML}
      </div>
    </div>
  </div>`,
    text: [
      `Hej ${firstName},`,
      "",
      "Vi bekräftar att vi tagit emot ditt meddelande om att du utövar din ångerrätt.",
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      "Nästa steg: returnera varan till Pistolvägen 6, 702 21 Örebro utan onödigt",
      "dröjsmål och senast 14 dagar efter detta meddelande (du står för returfrakten).",
      "Vi återbetalar inom 14 dagar från ditt ångermeddelande — dock tidigast när vi",
      "fått tillbaka varan eller du visat att den skickats. Avdrag görs endast för",
      "varans faktiska värdeminskning.",
      "",
      "Frågor? Svara på det här mejlet eller ring 010-138 54 98.",
      FOOTER_TEXT,
    ].join("\n"),
  };
};

const workshopEmail = (item) => ({
  subject: `ÅNGERRÄTT ${item.id}: ${item.produkt || "okänd produkt"} (order ${item.ordernummer || "-"})`,
  text: [
    "En kund har utövat sin ångerrätt via /angra-kop/.",
    `Ärendenummer: ${item.id}`,
    `Mottaget: ${item.createdAt}`,
    `Namn: ${item.namn}`,
    `E-post: ${item.email}`,
    `Telefon: ${item.telefon || "-"}`,
    `Ordernummer: ${item.ordernummer || "-"}`,
    `Produkt: ${item.produkt || "-"}`,
    `Levererad: ${item.leveransdatum || "-"}`,
    `Meddelande: ${item.meddelande || "-"}`,
    "",
    `Kundbekräftelse via mejl: ${item.notifications?.customerEmail?.status || "-"}`,
    "ÅTGÄRD: skicka returinstruktioner och bevaka 14-dagarsfristen för återbetalning.",
  ].join("\n"),
});

export default async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (clean(body["bot-field"] || body.botField || body.website, 240)) {
      console.warn("anger_honeypot_blocked", { ip: requestIp(request) });
      return json({ error: "Kunde inte ta emot meddelandet." }, 400);
    }
    if (isRateLimited(`${requestIp(request)}|${clean(body.email, 120).toLowerCase()}`)) {
      return json({ error: "For manga forsok just nu. Mejla info@nordicemobility.se i stallet." }, 429);
    }

    const namn = clean(body.namn, 240);
    const email = clean(body.email, 240);
    const ordernummer = clean(body.ordernummer, 240);
    const produkt = clean(body.produkt, 240);
    if (!namn || !looksLikeEmail(email)) {
      return json({ error: "Namn och giltig e-postadress kravs." }, 400);
    }
    if (!ordernummer && !produkt) {
      return json({ error: "Ange ordernummer eller produkt sa vi kan identifiera kopet." }, 400);
    }

    const now = new Date().toISOString();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ email: email.toLowerCase(), ordernummer, produkt }))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase();
    const id = `ANGER-${fingerprint}`;

    const item = {
      id,
      createdAt: now,
      updatedAt: now,
      status: "new",
      source: "angra-kop-form",
      namn,
      email,
      telefon: clean(body.telefon, 80),
      ordernummer,
      produkt,
      leveransdatum: clean(body.leveransdatum, 120),
      meddelande: clean(body.meddelande, 3000),
      ip: requestIp(request),
      notifications: {},
    };

    const store = getStore({ name: "anger-requests", consistency: "strong" });
    // Samma kund+order igen (dubbelklick/omskick) återanvänder samma ärende-id
    // — första mottagningstidpunkten bevaras, den räknas för ångerfristen.
    const existing = await store.get(id, { type: "json" }).catch(() => null);
    if (existing) {
      item.createdAt = existing.createdAt;
      item.notifications = existing.notifications || {};
    }
    await store.setJSON(id, item);

    const alreadySent = item.notifications?.customerEmail?.status === "sent";
    if (!alreadySent) {
      const confirmation = confirmationEmail(item);
      item.notifications.customerEmail = await resendEmail({
        to: [email],
        subject: confirmation.subject,
        html: confirmation.html,
        text: confirmation.text,
        idempotencyKey: `${id}-customer-confirmation`,
      });
    }

    const workshopRecipients = (env("WORKSHOP_EMAIL") || env("NOTIFY_EMAIL") || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (workshopRecipients.length && item.notifications?.workshopEmail?.status !== "sent") {
      const notice = workshopEmail(item);
      item.notifications.workshopEmail = await resendEmail({
        to: workshopRecipients,
        subject: notice.subject,
        text: notice.text,
        html: `<pre style="font-family:monospace;white-space:pre-wrap">${htmlEscape(notice.text)}</pre>`,
        idempotencyKey: `${id}-workshop-notice`,
      });
    } else if (!workshopRecipients.length) {
      item.notifications.workshopEmail = { status: "not_configured" };
    }

    item.updatedAt = new Date().toISOString();
    await store.setJSON(id, item);

    console.log("anger_request_received", {
      id,
      customerEmail: item.notifications?.customerEmail?.status,
      workshopEmail: item.notifications?.workshopEmail?.status,
    });

    return json({
      ok: true,
      id,
      receivedAt: item.createdAt,
      emailConfirmation: item.notifications?.customerEmail?.status || "not_requested",
    }, 201);
  } catch (error) {
    console.error("anger error", error);
    return json({ error: "Kunde inte ta emot angermeddelandet just nu." }, 500);
  }
};

export const config = {
  path: "/api/angerratt",
};
