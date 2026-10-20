// Läser 46elks-historik (samtal och SMS) bakåt till sinceMs, plus saldot.
// 46elks returnerar nyast först, max 100 per sida; "next" är en tidsstämpel
// som skickas som ?start= (samma mönster som call-dashboard.mjs).
// Kastar aldrig: vid fel returneras det som hunnit hämtas och felet.

const env = (n) => { try { return globalThis.Netlify?.env?.get?.(n) || process.env[n] || ""; } catch { return process.env[n] || ""; } };

const auth = () => {
  const user = env("ELKS_USERNAME") || env("SMS_API_USERNAME");
  const pass = env("ELKS_PASSWORD") || env("SMS_API_PASSWORD");
  return user && pass ? `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` : "";
};

const created = (row) => {
  const s = String(row?.created || row?.start || "");
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : 0;
};

export const fetchElksHistory = async (kind, sinceMs, { maxPages = 15, fetchImpl = fetch } = {}) => {
  const header = auth();
  if (!header) return { rows: [], error: "not_configured" };
  const rows = [];
  let url = `https://api.46elks.com/a1/${kind}?limit=100`;
  try {
    for (let page = 0; page < maxPages && url; page += 1) {
      const res = await fetchImpl(url, { headers: { Authorization: header }, signal: AbortSignal.timeout(8000) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { rows, error: String(body.error || res.status).slice(0, 160) };
      const batch = Array.isArray(body.data) ? body.data : [];
      rows.push(...batch);
      const oldest = batch.length ? created(batch[batch.length - 1]) : 0;
      if (!batch.length || (oldest && oldest < sinceMs)) break;
      url = body.next ? `https://api.46elks.com/a1/${kind}?limit=100&start=${encodeURIComponent(body.next)}` : "";
    }
    return { rows: rows.filter((r) => created(r) >= sinceMs), error: "" };
  } catch (e) {
    return { rows: rows.filter((r) => created(r) >= sinceMs), error: String(e?.message || e).slice(0, 160) };
  }
};

// Saldo i kronor (46elks anger 1/10000 av valutan).
export const fetchElksBalance = async ({ fetchImpl = fetch } = {}) => {
  const header = auth();
  if (!header) return null;
  try {
    const res = await fetchImpl("https://api.46elks.com/a1/me", { headers: { Authorization: header }, signal: AbortSignal.timeout(6000) });
    const body = await res.json().catch(() => ({}));
    return res.ok && Number.isFinite(Number(body.balance)) ? Math.round(Number(body.balance) / 100) / 100 : null;
  } catch {
    return null;
  }
};
