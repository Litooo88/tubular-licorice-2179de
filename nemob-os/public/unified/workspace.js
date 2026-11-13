const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const endpoint = "/api/unified/";
const dateTime = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm",
});
const time = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm",
});
function formatDate(value, date = true) {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(value)) return date ? value.replace("T", " kl. ") : value.slice(11);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? (date ? dateTime : time).format(timestamp) : "—";
}

const errors = {
  unauthorized: "Åtkomst saknas. Kontrollera sessionen eller adminanslutningen.",
  not_configured: "Anslutningen till Nordic-admin saknas på den lokala servern.",
  missing: "Posten finns inte längre i den öppna listan. Uppdatera vyn.",
  conflict: "Posten har ändrats eller saknar versionsinformation. Läs in den på nytt.",
  partial: "Ringstatus sparades. Uppgiften kunde inte uppdateras samtidigt. Läs in listan igen.",
  invalid: "Kontrollera uppgifterna och försök igen.",
  down: "Kunde inte få ett bekräftat svar. Läs in uppgifterna igen före ett nytt försök.",
};
async function request(path, body) {
  try {
    const response = await fetch(endpoint + path, {
      cache: "no-store",
      ...(body !== undefined && {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    });
    return response.ok ? await response.json() : { status: response.status === 401 ? "unauthorized" : "down" };
  } catch {
    return { status: "down" };
  }
}

const statusText = (result) => errors[result?.status] || errors.down;
const button = (label, action, extra = "") => '<button type="button" class="work-button ' + extra +
  '" data-work="' + action + '">' + label + '</button>';
const primary = (label, action) => button(label, action, "work-primary");
const callLabels = {
  waiting: "Att ringa", called_answered: "Uppringd · svar", called_no_answer: "Uppringd · inget svar",
  sms_sent: "SMS skickat", handled_other: "Hanterad", callback_later: "Återkom senare",
};
const reportStatuses = {
  checked_in: "Inlämnad", diagnosing: "Felsökning pågår", repairing: "Reparation pågår",
  waiting_parts: "Väntar på delar", waiting_customer: "Väntar på kund",
};
const caseStatuses = { new: "Ny", contacted: "Kontaktad", ready: "Klar", done: "Avslutad", archived: "Arkiverad", ...reportStatuses };

let root;
let active;
let getOrigin;
const ring = { list: null, tab: "all", selected: "", checked: new Set(), order: [], detail: null, loading: false, working: false, message: "" };
const report = { text: "", proposals: [], message: "", busy: false, recognizer: null };
function ringRows() {
  const rows = ring.list?.rows || [];
  if (ring.tab === "all") return rows;
  const ranked = new Map(ring.order.map((id, index) => [id, index]));
  return rows.filter((row) => row.selected).sort((a, b) =>
    (ranked.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranked.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
const ringRow = () => ringRows().find((row) => row.id === ring.selected);
const adminUrl = (id) => esc(new URL("/admin/?case=" + encodeURIComponent(id) + "&tab=contact", getOrigin()).href);
const phoneUrl = (value) => esc("tel:" + String(value || "").replace(/[^+\d]/g, ""));
const errorText = (message) => '<p class="work-message" role="status">' + esc(message) + '</p>';

function renderRing() {
  const rows = ringRows();
  const tab = (id, label) => '<button type="button" data-work="tab" data-tab="' + id +
    '" aria-pressed="' + (ring.tab === id) + '">' + label + '</button>';
  const empty = ring.list?.status === "ok" ? ring.tab === "all" ? "Inga öppna samtal att följa upp." :
    "Välj kontakter under Inkomna och lägg dem i din ringlista." : ring.list ? statusText(ring.list) : "Hämtar ringlistan …";
  const table = rows.length ? '<table class="ring-table"><thead><tr><th scope="col"><span class="visually-hidden">Välj</span></th>' +
    '<th scope="col">Kund</th><th scope="col">Samtal mottaget</th><th scope="col">Bokning skapad</th><th scope="col">Status</th>' +
    (ring.tab === "mine" ? '<th scope="col">Ordning</th>' : "") + '</tr></thead><tbody>' +
    rows.map((row, index) => {
      const label = callLabels[row.work?.status] || "Att ringa";
      const booked = label === "Att ringa" && row.confirmed;
      const id = esc(row.id);
      const name = esc(row.name || "Kundnamn saknas");
      const rowTime = formatDate(row.receivedAt);
      return '<tr' + (ring.selected === row.id ? ' class="ring-selected"' : "") + '>' +
        '<td><input type="checkbox" aria-label="Välj ' + esc(row.name || row.phone) + '" data-ring-check="' + id + '"' +
        (ring.checked.has(row.id) ? ' checked' : "") + (row.selected ? ' disabled' : "") + '></td>' +
        '<td class="ring-customer"><strong>' + name + '</strong><button type="button" class="work-text" data-work="contact" data-id="' +
        id + '" aria-controls="ring-contact" aria-expanded="' + (ring.selected === row.id) + '">' + esc(row.phone) + '</button></td>' +
        '<td><span class="ring-mobile-label">Mottaget</span><time datetime="' + esc(row.receivedAt) + '" title="' + esc(rowTime) + '">' +
        esc(formatDate(row.receivedAt, false)) + '</time></td>' +
        '<td><span class="ring-mobile-label">Bokning skapad</span><time title="' + esc(formatDate(row.bookedAt)) + '">' +
        esc(formatDate(row.bookedAt, false)) + '</time></td>' +
        '<td><span class="ring-status' + (booked ? ' ring-booked' : label === "Att ringa" ? ' ring-waiting' : "") + '">' +
        esc(booked ? "Bokad" : label) + '</span></td>' +
        (ring.tab === "mine" ? '<td class="ring-order">' + [["up", "Upp", index === 0], ["down", "Ner", index === rows.length - 1]]
          .map(([direction, label, disabled]) => '<button type="button" class="work-text" data-work="move" data-dir="' + direction +
            '" data-id="' + id + '" aria-label="Flytta ' + name + ' ' + label.toLowerCase() + '"' + (disabled ? " disabled" : "") + '>' + label + '</button>').join("") + '</td>' : "") + '</tr>';
    }).join("") + '</tbody></table>' : errorText(empty);
  root.innerHTML = '<div class="ring-layout"><section aria-label="Samtal"><h1 id="ring-title" tabindex="-1">Ringlista</h1>' +
    '<div class="ring-toolbar"><div class="ring-tabs" role="group" aria-label="Visa ringlista">' + tab("all", "Inkomna") + tab("mine", "Min ringlista") +
    '</div>' + (ring.tab === "all" ? '<button type="button" class="work-button work-primary" data-work="add"' +
      (!ring.checked.size || ring.working ? ' disabled' : "") + '>Lägg till i min ringlista</button>' : "") + '</div>' +
    table + (ring.list?.total > ring.list?.rows?.length ? errorText("Visar " + ring.list.rows.length + " av " + ring.list.total + " öppna uppgifter.") : "") +
    (ring.list?.partial ? errorText("Delvis underlag. Vissa källor kunde inte hämtas.") : "") +
    (ring.tab === "mine" && rows.length > 1 ? '<p class="work-hint">Ordningen sparas i NEMOB OS.</p>' : "") +
    (ring.message ? errorText(ring.message) : "") + '</section><section id="ring-contact" class="ring-contact" aria-label="Kundkort">' +
    renderContact() + '</section></div>';
}

function renderContact() {
  const row = ringRow();
  const detail = ring.detail;
  if (!row) return '<h2>Kundkort</h2><p class="work-hint">Välj ett telefonnummer för att öppna kundkortet.</p>';
  const item = detail?.case;
  const latest = [row.work?.at, ...(detail?.calls || []).map((call) => call.at)].filter(Boolean).sort().at(-1);
  const requested = detail?.requested || row.requested;
  const bookedAt = detail?.bookedAt || row.bookedAt;
  const confirmed = detail?.confirmed || row.confirmed;
  return '<h2>Kundkort</h2><h3 tabindex="-1" id="ring-person">' + esc(item?.name || row.name || row.phone) + '</h3>' +
    '<p class="ring-reference">' + esc([item?.serviceNumber || row.reference, item?.vehicle || item?.service].filter(Boolean).join(" · ") || row.title) + '</p>' +
    '<dl class="ring-timeline"><div><dt>Samtal mottaget</dt><dd>' + esc(formatDate(row.receivedAt)) + '</dd></div>' +
    '<div><dt>Bokning skapad</dt><dd>' + esc(formatDate(bookedAt)) + '</dd></div></dl>' +
    (requested?.raw ? '<p class="work-hint"><strong>Önskad återkoppling</strong> ' + esc(requested.raw) +
      (requested.needsReview ? ' · Kontrollera tiden' : "") + '</p>' : "") +
    '<div class="ring-booking"><h4>Bokad tid</h4><p>' + (confirmed ? esc(formatDate(confirmed)) : "Ingen bekräftad tid") + '</p></div>' +
    renderCalls(detail) + '<div class="ring-actions"><a class="work-button" href="' + phoneUrl(row.phone) + '">Ring</a>' +
    primary("Markera som hanterad", "handled_other") +
    ((item?.id || row.caseId) ? '<a class="work-button" href="' + adminUrl(item?.id || row.caseId) + '">Öppna kundkort i admin</a>' : "") +
    (!row.selected ? button("Lägg i min ringlista", "add-current") : "") + '</div>' +
    '<details class="ring-followup"><summary>Återkoppling och hantering</summary><dl>' +
    '<dt>Status</dt><dd>' + esc(callLabels[row.work?.status] || "Att ringa") + '</dd>' +
    '<dt>Senaste dokumenterade kontakt</dt><dd>' + esc(formatDate(latest)) + '</dd>' +
    '<dt>Nästa åtgärd</dt><dd>' + esc(detail?.next || row.title || "Återkoppla till kunden") +
    (detail?.dueAt ? ' · ' + esc(formatDate(detail.dueAt)) : "") + '</dd></dl>' +
    '<div class="ring-actions">' + button("Uppringd med svar", "called_answered") + button("Uppringd utan svar", "called_no_answer") +
    button("SMS redan skickat", "sms_sent") + '</div><form data-work-form="callback"><label>Återkom senare' +
    '<input name="callbackAt" type="datetime-local" required></label><button class="work-button" type="submit">Spara återkopplingstid</button></form></details>';
}

function renderCalls(detail) {
  const heading = '<div class="ring-transcript"><h4>Samtal med Nova</h4>';
  if (!detail || detail.status !== "ok") return heading + '<p class="work-hint">' +
    esc(detail ? statusText(detail) : "Hämtar samtal …") + '</p></div>';
  if (detail.novaStatus !== "ok") return heading + '<p class="work-hint">' + esc(statusText({ status: detail.novaStatus })) + '</p></div>';
  const [first] = detail.calls;
  if (!first) return heading + '<p class="work-hint">Inga Nova-samtal för numret de senaste 60 dagarna.</p></div>';
  const meta = (call) => [call.direction === "outbound" ? "Utgående" : "Inkommande", formatDate(call.at), call.outcome].filter(Boolean).join(" · ");
  const preview = (first.transcript || first.summary).split("\n").slice(0, 2).map((line) => {
    const turn = line.match(/^(Kund|Nova):\s*(.*)$/);
    return '<p>' + (turn ? '<strong>' + turn[1] + '</strong><br>' + esc(turn[2].slice(0, 240)) : esc(line.slice(0, 240))) + '</p>';
  }).join("");
  const details = (call, index) => '<details><summary>' +
    esc(index ? meta(call) : "Visa hela konversationen") + '</summary><p class="ring-full-text">' +
    esc(call.transcript || (call.summary ? "Sammanfattning: " + call.summary : "Transkript saknas.")) + '</p></details>';
  return heading + '<p class="work-hint">ElevenLabs · ' + esc(meta(first)) + '</p>' +
    (first.transcript ? preview : '<p>Transkript saknas.</p>' + (first.summary ? '<p>' + esc(first.summary) + '</p>' : "")) +
    (first.transcript ? details(first, 0) : "") + detail.calls.slice(1).map((call, index) => details(call, index + 1)).join("") + '</div>';
}

async function loadRing(sync = false) {
  if (ring.loading) return;
  ring.loading = true;
  const list = await request("ringlist" + (sync ? "/refresh" : ""), sync ? {} : undefined);
  ring.loading = false;
  ring.list = list;
  if (Array.isArray(list.order)) ring.order = list.order;
  ring.checked = new Set([...ring.checked].filter((id) => list.rows?.some((row) => row.id === id && !row.selected)));
  if (active !== "ringlist") return;
  const selected = ringRow();
  if (selected && ring.detail && !sync) renderRing();
  else if (selected || innerWidth > 1000) await openContact(selected?.id || ringRows()[0]?.id || "");
  else {
    ring.selected = "";
    renderRing();
  }
}

async function openContact(id, focus = false) {
  const selection = Symbol();
  ring.selection = selection;
  ring.selected = id;
  ring.detail = null;
  renderRing();
  if (!id) return;
  if (focus) document.getElementById("ring-person")?.focus();
  const detail = await request("ringlist/" + id);
  if (ring.selection !== selection || active !== "ringlist") return;
  ring.detail = detail;
  const region = document.getElementById("ring-contact");
  const restore = document.activeElement?.id === "ring-person";
  region.innerHTML = renderContact();
  if (restore) document.getElementById("ring-person")?.focus({ preventScroll: true });
}

async function changeRing(ids, action, fields = {}) {
  if (!ids.length || ring.working) return;
  ring.working = true;
  ring.message = "Sparar …";
  renderRing();
  const results = await Promise.all(ids.map((id) => request("ringlist/" + id, { action, ...fields })));
  ring.working = false;
  const saved = results.filter((item) => item.status === "ok").length;
  const failed = results.find((item) => item.status !== "ok");
  ring.message = [
    saved ? action === "select" ? saved + " tillagd(a) i Min ringlista." : "Ringstatus sparad." : "",
    failed ? statusText(failed) : "",
  ].filter(Boolean).join(" ");
  await loadRing();
}

function canSaveProposal(row) {
  return row.include && row.selection?.status === "ok" && !row.selection.closed && !row.saved &&
    (row.status || row.note.trim());
}

function renderReport() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canDictate = window.isSecureContext && SpeechRecognition && "processLocally" in SpeechRecognition.prototype;
  const proposals = report.proposals.map((row, index) => {
    const item = row.selection?.case;
    const candidate = row.candidates.length ? '<label>Kundärende<select data-proposal-case="' + index + '"' + (report.busy || row.saved ? ' disabled' : '') + '>' +
      '<option value="">Välj kundkort</option>' + row.candidates.map((c) =>
        '<option value="' + esc(c.id) + '"' + (row.caseId === c.id ? " selected" : "") + '>' +
        esc([c.serviceNumber, c.name, c.vehicle].filter(Boolean).join(" · ")) + '</option>').join("") +
      '</select></label>' : '<p class="work-hint">Ange kundens namn, modell eller ärendenummer på raden och granska igen.</p>';
    return '<section class="report-row"><h3>' + esc(item ? [item.vehicle || item.service, item.serviceNumber].filter(Boolean).join(" · ") : row.entry) +
      '</h3>' + candidate + (row.message ? errorText(row.message) : "") +
      (item && !row.selection.closed ? '<p class="report-transition">' + esc(caseStatuses[item.status] || item.status || "Status saknas") +
        (row.status ? ' → ' + esc(reportStatuses[row.status]) : "") + '</p>' +
        '<label class="report-include"><input type="checkbox" data-proposal-include="' + index + '"' +
        (row.include ? ' checked' : '') + (report.busy || row.saved ? ' disabled' : '') + '> Ta med ändringen</label>' +
        '<label>Ny verkstadsstatus<select data-proposal-status="' + index + '"' + (report.busy || row.saved ? ' disabled' : '') + '><option value="">Behåll nuvarande status</option>' +
        Object.entries(reportStatuses).map(([key, label]) => '<option value="' + key + '"' +
          (row.status === key ? ' selected' : "") + '>' + label + '</option>').join("") + '</select></label>' +
        '<label>Intern anteckning<textarea maxlength="1600" rows="2" data-proposal-note="' + index + '"' + (report.busy || row.saved ? ' readonly' : '') + '>' + esc(row.note) + '</textarea></label>'
        : "") + '</section>';
  }).join("");
  const canSave = !report.busy && report.proposals.some(canSaveProposal);
  root.innerHTML = '<div class="report-layout"><form data-work-form="review"><label class="work-heading" for="work-report-text">Berätta vad du gjort</label>' +
    '<textarea id="work-report-text" name="report" required maxlength="4000" rows="8"' + (report.busy ? ' readonly' : "") + ' placeholder="Tog emot en G2 Pro. Påbörjade motorbyte på en E2S V2 Pro LR.">' +
    esc(report.text) + '</textarea><div class="ring-actions">' +
    (canDictate && !report.busy ? button(report.recognizer ? "Avsluta diktering" : "Diktera", "dictate") : "") +
    '<button class="work-button" type="submit"' + (report.busy ? ' disabled' : "") + '>Granska rapport</button></div>' +
    '<p class="work-hint">Skriv eller använd enhetens diktering. Ange gärna ärendenummer där flera fordon kan matcha.</p>' +
    (report.message ? errorText(report.message) : "") + '</form><section class="report-review" aria-label="Ändringar i Nordic-admin">' +
    '<h2>Ändringar i Nordic-admin</h2>' + (proposals || '<p class="work-hint">Granska rapporten för att se föreslagna kundärenden och ändringar.</p>') +
    (report.proposals.length ? '<button type="button" class="work-button work-primary" data-work="save-report"' +
      (canSave ? "" : " disabled") + '>Spara valda ändringar</button>' : "") + '</section></div>';
}

async function pickReportCase(row, id) {
  row.caseId = id;
  row.selection = null;
  row.saved = false;
  row.message = id ? "Kontrollerar kundärendet …" : "";
  if (active === "report") renderReport();
  if (!id) return;
  const result = await request("workshop-report/case/" + encodeURIComponent(id));
  if (row.caseId !== id) return;
  row.selection = result;
  row.message = result.status !== "ok" ? statusText(result) : result.closed ? "Ärendet är avslutat. Öppna det i Nordic-admin för att ändra." : "";
  if (active === "report") renderReport();
}

async function reviewReport() {
  if (report.busy) return;
  report.recognizer?.abort();
  report.busy = true;
  report.message = "Granskar rapporten …";
  report.proposals = [];
  renderReport();
  const original = report.text;
  const result = await request("workshop-report/review", { report: original });
  report.busy = false;
  if (report.text !== original) {
    if (active === "report") renderReport();
    return;
  }
  report.message = result.status === "ok" ? "" : statusText(result);
  report.proposals = (result.proposals || []).map((row) => ({ ...row, note: row.entry, caseId: "", selection: null, include: true }));
  if (active === "report") renderReport();
  await Promise.all(report.proposals.filter((row) => row.candidates.length === 1).map((row) => pickReportCase(row, row.candidates[0].id)));
}

async function saveReport() {
  if (report.busy) return;
  report.busy = true;
  const rows = report.proposals.filter(canSaveProposal);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.caseId)) groups.set(row.caseId, []);
    groups.get(row.caseId).push(row);
  }
  let saved = 0;
  if (active === "report") renderReport();
  await Promise.all([...groups.values()].map(async (group) => {
    const statuses = new Set(group.map((row) => row.status).filter(Boolean));
    if (statuses.size > 1) {
      for (const row of group) row.message = "Flera föreslagna statusar för samma ärende. Välj en slutstatus.";
      return;
    }
    const note = group.map((row) => row.note.trim()).filter(Boolean).join("\n");
    if (note.length > 1600) {
      for (const row of group) row.message = "Korta anteckningarna för det här ärendet till sammanlagt 1 600 tecken.";
      return;
    }
    const [first] = group;
    const result = await request("workshop-report/save", {
      id: first.caseId, version: first.selection.version, note, status: [...statuses][0] || "",
    });
    if (result.status === "ok") saved++;
    for (const row of group) {
      row.saved = result.status === "ok";
      row.message = row.saved ? "Sparat i Nordic-admin · " + (result.case.serviceNumber || result.case.id) : statusText(result);
      if (result.status === "conflict" || result.status === "down") {
        row.selection = null;
        row.caseId = "";
      }
    }
  }));
  report.message = saved ? saved + " av " + groups.size + " kundärenden uppdaterade." : "Inga ändringar bekräftades.";
  report.busy = false;
  if (active === "report") renderReport();
}

function dictate() {
  if (report.recognizer) return report.recognizer.stop();
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  const recognition = new SpeechRecognition();
  if (!("processLocally" in recognition)) {
    report.message = "Lokal diktering i appen stöds inte här. Använd enhetens diktering i textfältet.";
    renderReport();
    return;
  }
  recognition.processLocally = true;
  recognition.lang = "sv-SE";
  recognition.continuous = true;
  recognition.onresult = (event) => {
    const additions = Array.from(event.results).slice(event.resultIndex)
      .filter((part) => part.isFinal).map((part) => part[0].transcript.trim()).join(" ");
    if (!additions) return;
    report.text = (report.text.trimEnd() + (report.text.trim() ? "\n" : "") + additions).slice(0, 4000);
    report.proposals = [];
    if (active === "report") renderReport();
  };
  recognition.onerror = () => {
    report.message = "Lokal svensk diktering kunde inte startas. Använd enhetens diktering i textfältet.";
  };
  recognition.onend = () => {
    report.recognizer = null;
    if (active === "report") renderReport();
  };
  try {
    recognition.start();
    report.recognizer = recognition;
    report.message = "";
  } catch {
    report.message = "Dikteringen kunde inte startas.";
  }
  renderReport();
}

export function attachWorkspace(content, origin) {
  root = content;
  getOrigin = origin;
  root.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-work]");
    if (!target) return;
    const action = target.dataset.work;
    if (active === "report") {
      if (action === "save-report") saveReport();
      if (action === "dictate") dictate();
      return;
    }
    if (action === "tab") {
      ring.tab = target.dataset.tab;
      if (ringRow()) renderRing();
      else openContact(innerWidth > 1000 ? ringRows()[0]?.id || "" : "");
    }
    if (action === "contact") {
      if (innerWidth <= 1000 && ring.selected === target.dataset.id) {
        openContact("");
        root.querySelector('[data-work="contact"][data-id="' + target.dataset.id + '"]')?.focus();
      } else openContact(target.dataset.id, true);
    }
    if (action === "add") changeRing([...ring.checked], "select");
    if (action === "add-current") changeRing([ring.selected], "select");
    if (Object.hasOwn(callLabels, action)) changeRing([ring.selected], action);
    if (action === "move") {
      if (ring.working) return;
      const ids = ringRows().map((row) => row.id);
      const from = ids.indexOf(target.dataset.id);
      const to = from + (target.dataset.dir === "up" ? -1 : 1);
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      ring.working = true;
      const saved = await request("ringlist/order", { ids });
      ring.working = false;
      if (saved.status === "ok") ring.order = ids;
      ring.message = saved.status === "ok" ? "Ordningen är sparad." : statusText(saved);
      if (active !== "ringlist") return;
      renderRing();
      root.querySelector('[data-work="move"][data-id="' + target.dataset.id + '"]:not(:disabled)')?.focus();
    }
  });
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.ringCheck) {
      if (target.checked) ring.checked.add(target.dataset.ringCheck);
      else ring.checked.delete(target.dataset.ringCheck);
      root.querySelector('[data-work="add"]').disabled = !ring.checked.size || ring.working;
    }
    if (target.dataset.proposalCase !== undefined && !report.busy) pickReportCase(report.proposals[target.dataset.proposalCase], target.value);
    if (target.dataset.proposalInclude !== undefined && !report.busy) {
      report.proposals[target.dataset.proposalInclude].include = target.checked;
      root.querySelector('[data-work="save-report"]').disabled = !report.proposals.some(canSaveProposal);
    }
    if (target.dataset.proposalStatus !== undefined && !report.busy) {
      const row = report.proposals[target.dataset.proposalStatus];
      row.status = target.value;
      renderReport();
      root.querySelector('[data-proposal-status="' + target.dataset.proposalStatus + '"]')?.focus();
    }
  });
  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "work-report-text" && !report.busy) {
      report.text = target.value;
      if (report.proposals.length) {
        report.proposals = [];
        report.message = "";
        const panel = root.querySelector(".report-review");
        panel.innerHTML = '<h2>Ändringar i Nordic-admin</h2><p class="work-hint">Granska den uppdaterade rapporten.</p>';
      }
    }
    if (target.dataset.proposalNote !== undefined && !report.busy) {
      const row = report.proposals[target.dataset.proposalNote];
      row.note = target.value;
      root.querySelector('[data-work="save-report"]').disabled = !report.proposals.some(canSaveProposal);
    }
  });
  root.addEventListener("submit", (event) => {
    const kind = event.target.dataset.workForm;
    if (!kind) return;
    event.preventDefault();
    if (kind === "review") reviewReport();
    if (kind === "callback") changeRing([ring.selected], "callback_later", {
      callbackAt: new FormData(event.target).get("callbackAt"),
    });
  });
}

export function showWorkspace(page) {
  if (active === "report" && page !== "report") report.recognizer?.abort();
  const changed = active !== page;
  active = page;
  if (page === "ringlist") {
    if (changed) renderRing();
    if (!ring.list || changed) loadRing();
    return true;
  }
  if (page === "report") {
    if (changed) renderReport();
    return true;
  }
  return false;
}

export function refreshRing() {
  ring.message = "Synkar ringlistan …";
  renderRing();
  return loadRing(true).then(() => {
    ring.message = ring.list?.status === "ok" ? "" : statusText(ring.list);
    if (active === "ringlist") renderRing();
  });
}
