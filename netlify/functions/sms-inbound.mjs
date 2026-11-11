// Inkommande SMS-webhook för 46elks (sms_url på det SMS-kapabla numret).
// RING → callback-kö + direkt-SMS till Sebastian + autosvar till kunden.
// STOPP → optout-store (respekteras av kampanjmotorn) + bekräftelse.
// Övrigt → loggas i svars-inkorgen + notis till Sebastian, inget autosvar.
// 46elks skickar svaret i response-body som SMS-reply till kunden.
//
// Beständig behandlingsstatus (2026-11-11): varje leverans får en post i storen
// "sms-inbound-seen" (nyckel = 46elks meddelande-id) som skapas villkorat
// (onlyIfNew) INNAN något behandlas och uppdateras efter varje steg:
//   steps.optout   STOPP registrerad
//   steps.link     ärendekoppling (status matched/ambiguous/closed_only/none,
//                  attached, final=false om den måste försökas igen)
//   steps.inboxKey posten i svars-inkorgen ("sms-inbound")
//   steps.notified notisen till Sebastian
//   steps.autoreply autosvaret (text + hur det gick ut)
// Status: processing → done, eller failed (ett steg kvar). En parallell
// leverans av samma id ser en giltig "lease" och svarar tomt; en leverans
// efter krasch (lease ute) eller comm-reconcile tar över och kör klart från
// det steg som saknas. Varje steg är idempotent (ärendet deduplicerar på
// providerId, inkorgsnyckeln är deterministisk, notis/autosvar bockas av).
// Så blir ett meddelande-id aldrig två kundhändelser, och en misslyckad
// behandling försvinner inte.
import { getStore } from "@netlify/blobs";
import { readEnv } from "./_shared/env.mjs";
import { tokenMatches } from "./_shared/admin-auth.mjs";
import { parseApprovalReply } from "./_shared/customer-contact.mjs";
import { isBlockedCaller } from "./_shared/call-blocklist.mjs";
import { loggedSms, logSms, queuePendingSms, readSmsApproval } from "./_shared/comm-log.mjs";
import { caseStore, commitCase, commitJson, createIfAbsent, readWithEtag, stampKey } from "./_shared/case-store.mjs";
import { attachInboundToCase, matchCaseByPhone } from "./_shared/case-match.mjs";

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);
const env = (name) => readEnv(name);
const normalizePhone = (phone) => {
  const compact = clean(phone, 80).replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("46")) return `+${compact}`;
  if (compact.startsWith("0")) return `+46${compact.slice(1)}`;
  return compact.length >= 7 ? `+46${compact}` : "";
};

// ELKS_SMS_NUMBER = det virtuella SMS-kapabla mobilnumret (010-numret är
// Fixed/Voice-only och kan aldrig ta emot SMS). Faller tillbaka på
// ELKS_NUMBER för bakåtkompatibilitet tills env-varn är satt.
const OUR_NUMBER = () => normalizePhone(env("ELKS_SMS_NUMBER") || env("ELKS_NUMBER") || "+46101385498");

// Varje utskick loggas med exakt text (_shared/comm-log.mjs).
const postSms = (args) => loggedSms("sms-inbound", rawPostSms)(args);
const rawPostSms = async ({ to, message }) => {
  const username = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const password = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  const from = (env("SMS_FROM") || "NordicEMob").slice(0, 11);
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo || !username || !password) return { status: "not_configured" };
  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from, to: normalizedTo, message, dontlog: "message" }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok ? { status: "sent", id: clean(body.id, 120) } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
};

// Notis-spärr per avsändarnummer så ett SMS-flöde inte spammar Sebastian
// (per instans; den beständiga dedupen per meddelande-id ligger i steps).
const notifyLog = new Map();
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;
export const resetNotifyCooldown = () => notifyLog.clear(); // testkrok
const shouldNotify = (phone) => {
  const last = notifyLog.get(phone) || 0;
  if (Date.now() - last < NOTIFY_COOLDOWN_MS) return false;
  notifyLog.set(phone, Date.now());
  if (notifyLog.size > 500) notifyLog.clear();
  return true;
};

// Vara egna nummer. Ett SMS fran dem ar inte ett kundsvar utan ett
// godkannande av ett utkast ("1 ok"), och ska aldrig hamna i svars-inkorgen.
const staffNumbers = () => {
  const set = new Set();
  for (const key of ["SEBASTIAN_SMS_TO", "WORKSHOP_SMS_TO", "VOICE_PRIMARY_NUMBER", "VOICE_SEBASTIAN_PHONE"]) {
    const nummer = normalizePhone(env(key));
    if (nummer) set.add(nummer);
  }
  return set;
};

// Godkannandet gar via den BEFINTLIGA approve-rutten i sms-draft-inbox, som
// redan kontrollerar optout, skickar, loggar pa arendet och tar bort utkastet.
// Att anropa den over HTTP kostar en extra rundtur men duplicerar ingen logik -
// och det ar en manniska som vantar, inte en loop.
const kallaApprove = async (draftId, action, message) => {
  const bas = (env("SITE_URL") || "https://www.nordicemobility.se").replace(/\/$/, "");
  const token = env("ADMIN_TOKEN");
  if (!token) return { ok: false, fel: "ADMIN_TOKEN saknas" };
  try {
    const response = await fetch(`${bas}/api/sms-drafts/${encodeURIComponent(draftId)}/${action}`, {
      method: "POST",
      headers: { "x-admin-token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ operatorName: "Sebastian via SMS", ...(message ? { message } : {}) }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, fel: clean(data.error || `HTTP ${response.status}`, 120) };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, fel: clean(error?.message, 120) };
  }
};

const hanteraGodkannande = async (kommando) => {
  const state = getStore({ name: "contact-queue", consistency: "strong" });
  const kon = await state.get("current", { type: "json" }).catch(() => null);
  const items = Array.isArray(kon?.items) ? kon.items : [];
  if (!items.length) return "Ingen ko just nu - inga utkast vantar.";

  const valda = kommando.all ? items : items.filter((i) => Number(i.nr) === Number(kommando.index));
  if (!valda.length) return `Hittade inget utkast med nummer ${kommando.index}. Kon har ${items.length} rader.`;

  const resultat = [];
  for (const rad of valda) {
    if (kommando.kind === "nej") {
      const svar = await kallaApprove(rad.draftId, "skip");
      resultat.push(`${rad.nr} ${svar.ok ? "kastat" : `FEL: ${svar.fel}`}`);
      continue;
    }
    const svar = await kallaApprove(rad.draftId, "approve", kommando.kind === "andra" ? kommando.text : undefined);
    const utfall = !svar.ok ? `FEL: ${svar.fel}` : svar.data?.status === "queued" ? "koat till kl 10" : "skickat";
    resultat.push(`${rad.nr} ${rad.namn || rad.telefon || ""} ${utfall}`.trim());
  }
  // Ta bort hanterade rader ur kon sa att samma nummer inte kan skickas tva ganger.
  const kvar = items.filter((i) => !valda.some((v) => v.nr === i.nr));
  await state.setJSON("current", { ...(kon || {}), items: kvar, uppdaterad: new Date().toISOString() }).catch(() => {});
  return clean(resultat.join(", "), 300) + (kvar.length ? ` | ${kvar.length} kvar` : " | kon tom");
};

const reply = (text, status = 200) =>
  new Response(text || "", { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

// ---------------------------------------------------------------------------
// Beständig behandlingsstatus per 46elks-id.
// ---------------------------------------------------------------------------
export const SEEN_STORE = "sms-inbound-seen";
export const INBOUND_LEASE_MS = 2 * 60 * 1000;
export const INBOUND_MAX_ATTEMPTS = 5;
export const INBOUND_RETENTION_DAYS = 90;
const seenStore = () => getStore({ name: SEEN_STORE, consistency: "strong" });

const leaseValid = (record, now) => record?.status === "processing" && new Date(record.leaseUntil || 0).getTime() > now;

// { ok: true, record, resumed } | { ok: false, reason: "duplicate" | "in_flight" | "exhausted" | "unversioned" }
const claimInbound = async ({ providerId, from, to, message, direction, now }) => {
  const at = new Date(now).toISOString();
  const fresh = {
    id: providerId, at, from, to, message, direction, phoneDigits: from.replace(/\D/g, "").slice(-4),
    status: "processing", attempts: 1, leaseUntil: new Date(now + INBOUND_LEASE_MS).toISOString(), steps: {},
  };
  if (!providerId) return { ok: true, record: { ...fresh, ephemeral: true } };
  const store = seenStore();
  let created;
  try {
    created = await createIfAbsent(store, providerId, fresh);
  } catch (error) {
    if (error?.name === "UnversionedStoreError") return { ok: false, reason: "unversioned", code: error.code };
    throw error;
  }
  if (created.created) return { ok: true, record: fresh, resumed: false };
  const existing = created.item;
  if (!existing) return { ok: false, reason: "in_flight" };
  if (existing.status === "done") return { ok: false, reason: "duplicate" };
  if (leaseValid(existing, now)) return { ok: false, reason: "in_flight" };
  if ((Number(existing.attempts) || 0) >= INBOUND_MAX_ATTEMPTS) return { ok: false, reason: "exhausted" };
  const taken = await commitJson(store, providerId, (row) => {
    if (row.status === "done" || leaseValid(row, now)) return null;
    return { ...row, status: "processing", attempts: (Number(row.attempts) || 0) + 1, leaseUntil: new Date(now + INBOUND_LEASE_MS).toISOString(), lastResumedAt: at };
  }, { current: existing, etag: created.etag });
  if (!taken.ok) return { ok: false, reason: taken.reason === "aborted" ? "in_flight" : taken.reason };
  return { ok: true, record: taken.item, resumed: true };
};

// Koppla SMS:et till kundens ärende när det är entydigt (_shared/case-match).
// Läser hela ärendestoren – samma mönster som kommunikation.mjs; volymen är
// låg (enstaka SMS/dag).
const loadCases = async () => {
  const store = caseStore();
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined).catch(() => ({ blobs: [] }));
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  const items = [];
  for (let i = 0; i < keys.length; i += 40) {
    const part = await Promise.all(keys.slice(i, i + 40).map((key) => store.get(key, { type: "json" }).catch(() => null)));
    items.push(...part.filter(Boolean));
  }
  return items;
};
// { status, caseId, candidates, attached, final, reason }. final=false → försök igen senare.
const linkToCase = async ({ from, message, at, providerId, inboundKey }) => {
  try {
    const match = matchCaseByPhone(await loadCases(), from);
    if (match.status !== "matched") return { ...match, attached: false, final: true };
    const saved = await commitCase(caseStore(), match.caseId, (fresh) =>
      attachInboundToCase(fresh, { channel: "sms", from, text: message, at, providerId, inboundKey }));
    // aborted = redan kopplat (dedup på providerId) → räknas som klart.
    const attached = saved.ok || saved.reason === "aborted";
    return { ...match, attached, final: attached || saved.reason === "not_found", reason: saved.ok ? "" : saved.reason };
  } catch (error) {
    return { status: "error", caseId: "", candidates: [], attached: false, final: false, reason: clean(error?.message, 120) };
  }
};

// Kör behandlingen från det steg som saknas. Returnerar { replyText, done }.
// `webhook` = vi svarar 46elks direkt (autosvar i response-body); annars
// (reconcile) skickas autosvaret via SMS-API:t.
export const processInbound = async (record, { webhook = true, now = Date.now() } = {}) => {
  const store = record.ephemeral ? null : seenStore();
  const steps = { ...(record.steps || {}) };
  const persist = async (patch, extra = {}) => {
    Object.assign(steps, patch);
    if (!store) return;
    const saved = await commitJson(store, record.id, (row) => ({ ...row, ...extra, steps: { ...(row.steps || {}), ...patch }, lastRunAt: new Date(now).toISOString() }));
    // Ett steg räknas som gjort först när det är LAGRAT. Annars kör nästa
    // försök om det (dubbel notis/autosvar). Kastar → catch → failed/500.
    if (!saved.ok) throw new Error(`behandlingsstatus kunde inte sparas (${saved.reason})`);
  };
  const finish = async (status, extra = {}) => {
    await persist({}, { status, leaseUntil: status === "done" ? "" : null, ...extra });
  };

  const { from, message } = record;
  const at = record.at || new Date(now).toISOString();

  try {
    // Spärrade nummer: meddelandet tas inte emot, inget autosvar skickas.
    if (steps.blocked === undefined) {
      const blocked = await isBlockedCaller(from);
      if (blocked) {
        console.log("sms_inbound_blocked_sender", {});
        await finish("done", { outcome: "blocked" });
        return { replyText: "", done: true };
      }
      await persist({ blocked: false });
    }

    // Sebastians godkannanden gar fore all kundlogik: "1 ok", "alla ok",
    // "2 nej", "1 andra: ny text". Ett sadant SMS ar inget kundsvar.
    if (staffNumbers().has(from)) {
      const kommando = parseApprovalReply(message);
      if (kommando) {
        if (!steps.approval) {
          const svar = await hanteraGodkannande(kommando);
          console.log("sms_inbound_approval", { kind: kommando.kind, all: Boolean(kommando.all) });
          await persist({ approval: { reply: svar } });
        }
        await finish("done", { outcome: "approval" });
        return { replyText: steps.approval?.reply || "", done: true };
      }
    }

    const normalized = message.toLowerCase().replace(/[^a-zåäö0-9]/g, "");
    const isStop = /^(stopp|stop)$/.test(normalized);
    const isRing = /^ring/.test(normalized) || normalized === "1";
    const type = isStop ? "stopp" : isRing ? "ring" : "other";

    if (isStop && !steps.optout) {
      await getStore({ name: "sms-optout", consistency: "strong" }).setJSON(from, { phone: from, at, message });
      await persist({ optout: true });
    }

    // Ärendekoppling (bara entydig träff kopplas; se _shared/case-match.mjs).
    // STOPP kopplas inte – det är en avregistrering, inte ett ärendesvar.
    // Nyckeln är filsäker (inga kolon): läsarna sorterar på fältet `at`, inte nyckeln.
    const inboundKey = steps.inboxKey || `${stampKey(new Date(at))}_${from.replace(/\D/g, "")}`;
    if (!steps.link?.final) {
      const link = isStop
        ? { status: "skipped", caseId: "", candidates: [], attached: false, final: true }
        : await linkToCase({ from, message, at, providerId: record.id, inboundKey });
      await persist({ link });
      console.log("sms_inbound_case_match", { status: link.status, attached: Boolean(link.attached), final: link.final });
    }
    const link = steps.link;

    // Svars-inkorgen. Skrivs om när ärendekopplingen lyckats i ett senare försök
    // (caseId fylls på), nyckeln är densamma.
    if (!steps.inboxKey || (steps.inboxCaseId || "") !== (link.caseId || "")) {
      await getStore({ name: "sms-inbound", consistency: "strong" }).setJSON(inboundKey, {
        phone: from, message, at, type, handled: isStop, providerId: record.id,
        caseId: link.attached ? link.caseId || "" : "",
        caseMatch: { status: link.status, attached: Boolean(link.attached), candidates: link.candidates || [] },
      });
      await persist({ inboxKey: inboundKey, inboxCaseId: link.attached ? link.caseId || "" : "" });
    }

    const sebastianTo = env("SEBASTIAN_SMS_TO") || env("WORKSHOP_SMS_TO");
    if (steps.notified === undefined) {
      let notified = "skipped";
      if (!isStop && sebastianTo && shouldNotify(from)) {
        const label = isRing ? "RING-svar (vill bli uppringd inom 24h)" : "SMS-svar";
        const caseLine = link.status === "matched" && link.candidates?.[0]?.serviceNumber ? ` (ärende ${link.candidates[0].serviceNumber})`
          : link.status === "ambiguous" ? ` (${link.candidates.length} öppna ärenden – välj i admin)` : "";
        const result = await postSms({ to: sebastianTo, message: `${label} från ${from}${caseLine}: "${message.slice(0, 120)}"\nSvars-inkorgen i admin har hela listan.` });
        notified = clean(result?.status, 40) || "unknown";
      }
      await persist({ notified });
    }

    // Autosvar: i webhook-svaret (46elks skickar det), annars via SMS-API:t.
    if (!steps.autoreply) {
      let text = "";
      let via = "none";
      if (isStop) {
        text = "Du är nu avregistrerad från utskick från Nordic E-Mobility.";
      } else if (isRing) {
        // Omfattas av godkännandespärren: köas i stället för att svaras direkt.
        // STOPP-bekräftelsen går alltid (avregistrering).
        const ringText = "Tack! Vi ringer upp dig inom 24 timmar. /Nordic E-Mobility";
        if ((await readSmsApproval()).enabled) {
          await queuePendingSms({ source: "sms-inbound", to: from, message: ringText });
          via = "pending_approval";
        } else {
          text = ringText;
        }
      }
      if (text) {
        if (webhook) {
          await logSms({ source: "sms-inbound", to: from, message: text, result: { status: "sent" } });
          via = "webhook_reply";
        } else {
          const result = await loggedSms("sms-inbound", rawPostSms)({ to: from, message: text, approved: isStop });
          via = `sms_api:${clean(result?.status, 40)}`;
        }
      }
      await persist({ autoreply: { text, via } });
    }

    const done = Boolean(link.final);
    await finish(done ? "done" : "failed", { lastError: done ? "" : `ärendekoppling: ${clean(link.reason, 120) || link.status}` });
    return { replyText: webhook && steps.autoreply?.via === "webhook_reply" ? steps.autoreply.text : "", done };
  } catch (error) {
    const lastError = clean(error?.message, 160) || "okänt fel";
    console.error("sms_inbound_processing_failed", { id: record.id, lastError });
    await finish("failed", { lastError }).catch(() => {});
    return { replyText: "", done: false, error: lastError };
  }
};

// Schemalagd återupptagning (comm-reconcile): failed/övergivna poster körs klart.
export const reprocessInbound = async ({ now = Date.now() } = {}) => {
  const counts = { resumed: 0, done: 0, stillFailed: 0, skipped: 0, pruned: 0, errors: 0 };
  const store = seenStore();
  const cutoff = now - INBOUND_RETENTION_DAYS * 86400000;
  const keys = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : undefined).catch(() => ({ blobs: [] }));
    keys.push(...(page.blobs || []).map((b) => b.key));
    cursor = page.cursor;
  } while (cursor);
  for (const key of keys) {
    try {
      const { item } = await readWithEtag(store, key, { allowMissingEtag: true });
      if (!item) continue;
      const stamp = new Date(item.at || 0).getTime();
      if (stamp && stamp < cutoff) { await store.delete(key).catch(() => {}); counts.pruned += 1; continue; }
      if (item.status === "done") continue;
      if ((Number(item.attempts) || 0) >= INBOUND_MAX_ATTEMPTS) {
        if (!item.exhaustedLogged) {
          console.error("sms_inbound_exhausted", { id: key, lastError: clean(item.lastError, 120) });
          await commitJson(store, key, (row) => ({ ...row, exhaustedLogged: true })).catch(() => {});
        }
        counts.skipped += 1;
        continue;
      }
      if (leaseValid(item, now) || !item.from) { counts.skipped += 1; continue; }
      const claim = await claimInbound({ providerId: key, from: item.from, to: item.to, message: item.message, direction: item.direction, now });
      if (!claim.ok) { counts.skipped += 1; continue; }
      counts.resumed += 1;
      const outcome = await processInbound(claim.record, { webhook: false, now });
      counts[outcome.done ? "done" : "stillFailed"] += 1;
    } catch (error) {
      counts.errors += 1;
      console.error("sms_inbound_reprocess", { key, error: clean(error?.message, 120) });
    }
  }
  return counts;
};

export default async (request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Delad hemlighet i webhookens URL (?secret=...), fail-closed.
  //
  // Tidigare validerades hemligheten BARA om env-variabeln råkade vara satt —
  // och den var inte satt i produktion (kontrollerat 2026-09-07). Endpointen
  // tog alltså emot vad som helst från vem som helst. Avsändare, mottagare och
  // riktning i bodyn är inget äkthetsbevis: de skrivs av den som gör anropet.
  // Konsekvensen var påhittade kundsvar i inkorgen och — värre — att någon
  // kunde registrera en optout som tyst stänger av SMS till ett riktigt
  // kundnummer.
  //
  // 46elks sms_url bär hemligheten (sätts av elks-webhook-sync och av
  // nummerkonfigurationen i call-dashboard), så ett äkta inkommande SMS har
  // den alltid med sig. Saknas env-variabeln avvisar vi hellre trafiken än tar
  // emot overifierade meddelanden — samma hållning som voice-webhookarna.
  const secret = clean(env("SMS_INBOUND_SECRET"), 240);
  if (!secret) {
    console.error("sms-inbound: SMS_INBOUND_SECRET saknas - avvisar inkommande SMS i stallet for overifierad trafik.");
    return new Response("Not configured", { status: 503 });
  }
  const provided = clean(new URL(request.url).searchParams.get("secret"), 240);
  if (!tokenMatches(secret, provided)) return new Response("Forbidden", { status: 403 });

  const bodyText = await request.text();
  const params = new URLSearchParams(bodyText);
  const from = normalizePhone(params.get("from"));
  const to = normalizePhone(params.get("to"));
  const message = clean(params.get("message"), 900);
  const direction = clean(params.get("direction"), 40) || "incoming";
  const providerId = clean(params.get("id"), 120);

  if (!from || to !== OUR_NUMBER() || direction !== "incoming") return reply("");

  const now = Date.now();
  let claim;
  try {
    claim = await claimInbound({ providerId, from, to, message, direction, now });
  } catch (error) {
    console.error("sms_inbound_claim_failed", { providerId, error: clean(error?.message, 120) });
    return reply("", 500);
  }
  if (!claim.ok) {
    if (claim.reason === "unversioned") {
      // Lagringen kan inte deduplicera verifierat. Ett kund-SMS får hellre
      // behandlas en gång för mycket än försvinna: kör utan beständig status.
      console.error("sms_inbound_unversioned_store", { code: claim.code });
      const outcome = await processInbound({ id: providerId, at: new Date(now).toISOString(), from, to, message, direction, steps: {}, ephemeral: true }, { webhook: true, now });
      return reply(outcome.replyText);
    }
    console.log(`sms_inbound_${claim.reason}`, { providerId });
    return reply("");
  }
  if (claim.resumed) console.log("sms_inbound_resumed", { providerId, attempts: claim.record.attempts });

  const outcome = await processInbound(claim.record, { webhook: true, now });
  // Ett oväntat fel (inte en kvarstående ärendekoppling) → 500 så att 46elks
  // får skicka om; posten är markerad failed och comm-reconcile tar den annars.
  if (outcome.error) return reply("", 500);
  return reply(outcome.replyText);
};

export const config = {
  path: "/api/sms-inbound",
};
