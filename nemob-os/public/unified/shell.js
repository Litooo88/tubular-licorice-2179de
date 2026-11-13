import { attachWorkspace, showWorkspace, refreshRing } from "./workspace.js";

const icons = {
  home: '<path d="M3 10l9-7 9 7v10H3zM9 20v-6h6v6"/>',
  communication: '<path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3zM7 9h9M7 13h6"/>',
  cases: '<path d="M14 6l4 4 3-3a6 6 0 0 1-7 8l-6 6-4-4 6-6a6 6 0 0 1 8-7z"/>',
  bookings: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2"/>',
  finance: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  planning: '<path d="M9 5h11M9 12h11M9 19h11M3 5l1 1 2-3M3 12l1 1 2-3M3 19l1 1 2-3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 9a8 8 0 0 1 14-2m0 8a8 8 0 0 1-14 2"/>',
  next: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  nova: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
};
const icon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
document.querySelectorAll("[data-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.icon); });

const titles = {
  home: "Verkstadsöversikt", communication: "Kommunikation", cases: "Verkstad och kundärenden",
  bookings: "Bokningar", approvals: "Godkännanden", finance: "Ekonomi och checkout", planning: "Privat planering", assistant: "AI-assistent",
  ringlist: "Ringlista", report: "Verkstadsrapport",
};
const statuses = {
  new: "Ny", contacted: "Kontaktad", checked_in: "Inlämnad", diagnosing: "Diagnos",
  repairing: "Reparerar", waiting_parts: "Väntar på delar", waiting_customer: "Väntar på kund", ready: "Klar",
};
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const link = (label, href) => '<a href="' + escape(href) + '">' + escape(label) + '</a>';
const paragraph = (value) => '<p>' + escape(value) + '</p>';
const card = (title, glyph, body, links = [], feature = false) =>
  '<article class="card' + (feature ? ' feature' : '') + '"><h2><span data-icon>' + icon(glyph) + '</span>' +
  escape(title) + '</h2>' + body + (links.length ? '<div class="actions">' + links.join("") + '</div>' : '') + '</article>';
const list = (items, renderRow) => '<ul class="rows">' + items.map((row) => '<li>' + renderRow(row) + '</li>').join("") + '</ul>';
const metrics = (entries) => '<div class="metrics">' + entries.map(([value, label]) =>
  '<p><strong class="metric">' + escape(value) + '</strong>' + escape(label) + '</p>').join("") + '</div>';

let mode = "focus";
let caseQuery = "";
let business = null;
let planning = null;
let request = null;
const route = () => Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : "home";
const origin = () => business?.origin || "https://www.nordicemobility.se";
attachWorkspace(document.querySelector("#content"), origin);
const tool = (label, path) => link(label, new URL(path, origin()).href);
const caseLink = (row, tab = "overview") => tool(
  [row.reference, row.title].filter(Boolean).join(" · "), "/admin/?case=" + encodeURIComponent(row.id) + "&tab=" + tab);
const caseRows = (rows, empty, detail, tab) => rows.length
  ? list(rows, (row) => caseLink(row, tab) + '<small>' + escape(detail(row)) + '</small>')
  : paragraph(empty);

function sourceMessage(source) {
  if (!source) return "Hämtar uppgifter …";
  if (source.status === "not_configured") return "Anslutningen är inte konfigurerad på den lokala servern.";
  if (source.status === "unauthorized") return "Sessionen har löpt ut. Ladda om för att logga in.";
  return "Källan kunde inte nås. Försök igen med Uppdatera.";
}
const fromSource = (source, renderData) => source?.status === "ok" ? renderData(source) : paragraph(sourceMessage(source));
const status = (row) => statuses[row.status] || "Status saknas";
const admin = () => tool("Öppna kundärenden i Admin", "/admin/");
const comm = () => tool("Öppna meddelanden och godkännanden", "/admin/kommunikation/");
const workshop = () => tool("Öppna verkstadsportalen", "/workshop/");
const checkout = () => tool("Öppna checkout", "/checkout/");

function communicationCard(full = false) {
  return card("Viktiga kundmeddelanden", "communication", fromSource(business?.communication, (data) =>
    metrics([[data.waiting, "Kontakter väntar på svar"], [data.pending, "SMS väntar på godkännande"]]) +
    (data.contacts.length ? list(full ? data.contacts : data.contacts.slice(0, 3), (row) => '<strong>' + escape(row.name) + '</strong><small>' +
      escape(row.hours === null ? "Väntar på svar" : "Väntar på svar · " + row.hours + " h") + '</small>') : "") +
    (data.partial ? paragraph("Kommunikationsunderlaget är delvis tillgängligt.") : "")), [comm()]);
}

function automationCard() {
  return card("Automatiskt hanterat av Nova", "nova", fromSource(business?.communication, ({ nova, partial }) =>
    metrics([[nova.smsOut, "Utgående SMS idag"], [nova.callsIn, "Inkommande Nova-samtal idag"], [nova.chats, "Chattar idag"]]) +
    (partial ? paragraph("Kommunikationsunderlaget är delvis tillgängligt.") : "")),
  [tool("Öppna Novas rapport", "/admin/nova-rapport/")]);
}

const searchText = (value) => String(value ?? "").toLocaleLowerCase("sv-SE").normalize("NFC");
function caseSearchResults() {
  const terms = searchText(caseQuery).trim().split(/\s+/).filter(Boolean);
  const rows = (business?.cases?.cases || []).filter((row) => {
    const content = searchText([row.customer, row.reference, row.title, status(row)].join(" "));
    return terms.every((term) => content.includes(term));
  });
  return caseRows(rows, terms.length ? "Inga öppna ärenden matchar sökningen." : "Inga öppna ärenden.",
    (row) => [row.customer, status(row)].filter(Boolean).join(" · "));
}

function historyCard() {
  const channels = { sms: "SMS", call: "Samtal", chat: "Chatt" };
  const date = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" });
  return card("Senaste kundkommunikationen", "communication", fromSource(business?.communication, (data) =>
    data.history.length ? list(data.history, (row) => {
      const heading = [channels[row.channel], row.nova && "Nova", row.customer].filter(Boolean).join(" · ");
      const detail = [date.format(row.at), {in: "Inkommande", out: "Utgående"}[row.direction], row.outcome].filter(Boolean).join(" · ");
      return "<strong>" + escape(heading) + "</strong><small>" + escape(detail) + "</small>" +
        (row.message ? '<p class="message">' + escape(row.message) + "</p>" : "");
    }) : paragraph(data.partial ? "Ingen historik från tillgängliga källor." : "Ingen kundkommunikation under perioden.")));
}

function casesCard(full = false) {
  return card("Öppna kundärenden", "cases", fromSource(business?.cases, (data) =>
    metrics([[data.open, "Öppna ärenden"]]) + (full ? '<label for="case-query">Sök på kund, ärendenummer, fordon eller status</label>' +
      '<input id="case-query" type="search" value="' + escape(caseQuery) + '">' +
      '<div id="case-results" aria-live="polite">' + caseSearchResults() + '</div>' :
      caseRows(data.cases.slice(0, 8), "Inga öppna ärenden.", status))),
  [admin(), workshop(), link("Sök i reparationskunskapen", "/knowledge.html")]);
}

const bookingDetail = (row, timeLabel) => [row.customer, row.vehicle, status(row), bookingTime(row), timeLabel].filter(Boolean).join(" · ");
const bookingTime = (row) => row.date ? row.date.replace("T", " kl. ") : "Önskad tid saknas";

function bookingsCard() {
  return card("Bokningar", "bookings", fromSource(business?.cases, (data) =>
    metrics([[data.pending, "Obesvarade förfrågningar"], [data.upcoming, "Kommande webbokningar"]]) +
    '<div class="actions">' + link("Visa bokningskön", "#bookings") + '</div>'));
}

function bookingCards() {
  return [
    card("Väntar på besked", "bookings", fromSource(business?.cases, (data) =>
      caseRows(data.bookingQueue, "Inga obesvarade bokningsförfrågningar.", (row) => bookingDetail(row, "Väntar på besked"), "contact")), [admin()]),
    card("Kommande webbokningar", "bookings", fromSource(business?.cases, (data) =>
      caseRows(data.bookings, "Inga kommande webbokningar registrerade.", (row) =>
        bookingDetail(row, row.confirmed ? "Bekräftad tid" : "Önskad tid"), "contact")),
    [tool("Öppna webbokningen", "/book-online/")]),
  ];
}

function approvalCards() {
  const messages = (rows, empty, label) => rows.length ? list(rows, (row) =>
    '<strong>' + escape(label(row)) + '</strong><p class="message">' + escape(row.message) + '</p>') : paragraph(empty);
  const approvals = business?.approvals;
  const workshopCard = card("Verkstadsbeslut", "cases", fromSource(business?.cases, (data) =>
    caseRows(data.workshopDecisions, "Inga verkstadsärenden flaggade för beslut.", status)), [admin()]);
  if (approvals?.status === "ok") {
    const groups = [
      ["sms", "SMS som väntar på godkännande", "communication", comm()],
      ["draft", "Svarsutkast", "planning", admin()],
      ["booking_request", "Bokningsförfrågningar", "bookings", link("Visa bokningar", "#bookings")],
    ];
    return [
      ...(approvals.partial ? [card("Delvis tillgänglig godkännandekö", "planning",
        paragraph("Tillgängliga köer visas nedan. Välj Uppdatera för att försöka igen."))] : []),
      ...groups.map(([kind, title, iconName, action]) => card(title, iconName,
        fromSource(approvals.groups[kind], (group) =>
          (group.items.length ? list(group.items, (row) => {
            const name = row.name || row.source || "Godkännande";
            const caseRow = business?.cases?.cases?.find((item) => item.id === row.caseId);
            const timestamp = Date.parse(row.at);
            const history = Number.isFinite(timestamp) ? new Intl.DateTimeFormat("sv-SE", {
              dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm",
            }).format(timestamp) : "";
            const context = [row.reference || caseRow?.reference, row.service || caseRow?.title,
              caseRow && status(caseRow)].filter(Boolean).join(" · ");
            return '<details class="approval-detail"><summary>' + escape(name) + '</summary>' +
              (context ? paragraph(context) : "") +
              (row.name ? "" : paragraph("Kundnamn saknas i källan.")) +
              paragraph(history ? "Registrerat " + history : "Registreringstid saknas.") +
              (row.inFlight ? paragraph("Behandlas just nu.") : "") +
              (row.failed ? paragraph("Senaste försöket misslyckades.") : "") +
              '<p><strong>' + (kind === "booking_request" ? "Önskad bokning" : "Föreslagen text") + '</strong></p>' +
              '<p class="message">' + escape(row.message || "Underlag saknas.") + '</p>' +
              (row.caseId ? '<div class="actions">' + tool("Öppna ärendehistorik i Admin",
                "/admin/?case=" + encodeURIComponent(row.caseId) + "&tab=contact") + '</div>' :
                paragraph("Ingen ärendehistorik är kopplad till posten.")) + '</details>';
          }) : paragraph(group.count ? "Detaljer saknas för väntande poster." : "Inga väntande poster.")) +
          (group.count > group.items.length && group.items.length ?
            paragraph("Visar " + group.items.length + " av " + group.count + " poster.") : "")), [action])),
      workshopCard,
    ];
  }
  if (approvals?.status !== "unavailable") {
    return [card("Godkännandekö", "planning", paragraph(sourceMessage(approvals)), [comm(), admin()]), workshopCard];
  }
  return [
    card("Godkännanden från befintliga källor", "planning",
      paragraph("Det gemensamma API:t är inte tillgängligt här ännu.")),
    card("SMS som väntar på godkännande", "communication", fromSource(business?.communication, (data) =>
      messages(data.queuedSms, data.pending ? "Meddelandetext saknas i källan." : "Inga SMS väntar.",
        (row) => row.source || "Kund-SMS")), [comm()]),
    card("Svarsutkast", "planning", fromSource(business?.drafts, (data) =>
      messages(data.drafts, "Inga svarsutkast väntar.", (row) => row.customer || "Kundutkast")), [admin()]),
    card("Bokningsförfrågningar", "bookings", fromSource(business?.cases, (data) =>
      caseRows(data.bookingQueue, "Inga bokningsförfrågningar väntar.",
        (row) => bookingDetail(row, "Väntar på besked"), "contact")), [link("Visa bokningar", "#bookings")]),
    workshopCard,
  ];
}

function financeCard() {
  return card("Betalningsuppföljning", "finance", fromSource(business?.cases, (data) =>
    metrics([[data.readyUnpaid, "Klara ärenden markerade obetalda"]]) +
    caseRows(data.ready, "Inga klara obetalda ärenden.", status, "payment")) +
    paragraph("Saldo, fakturor och Stripe-transaktioner finns ännu inte i översikten."),
  [checkout(), tool("Öppna snabbpris", "/quick-price/"), tool("Öppna prislistan", "/prices/")]);
}

function priorities() {
  const cases = business?.cases;
  const communication = business?.communication;
  const approvals = business?.approvals;
  const useLegacy = approvals?.status === "unavailable";
  return [
    [useLegacy ? cases?.pending : approvals?.groups?.booking_request.count, "Granska bokningsförfrågningar", "#bookings"],
    [communication?.waiting, "Följ upp kunder som väntar på svar", "#communication"],
    [useLegacy ? communication?.pending : approvals?.groups?.sms.count, "Granska SMS för godkännande", "#approvals"],
    [useLegacy ? business?.drafts?.drafts?.length : approvals?.groups?.draft.count, "Granska svarsutkast", "#approvals"],
    [cases?.review, "Följ upp verkstadsbeslut", "#cases"],
    [cases?.readyUnpaid, "Följ upp betalning för klara ärenden", "#finance"],
  ].filter(([present]) => present).slice(0, 3);
}

function focusCards() {
  const items = priorities();
  const complete = business?.cases?.status === "ok" && business?.communication?.status === "ok" && !business.communication.partial &&
    (business?.approvals?.status === "ok" && !business.approvals.partial ||
      business?.approvals?.status === "unavailable" && business?.drafts?.status === "ok");
  const decisions = fromSource(business?.cases, (data) =>
    caseRows(data.decisions, "Inga boknings- eller verkstadsbeslut flaggade.", (row) => row.reason));
  return [
    card("Dagens prioriteringar", "planning", items.length ? list(items, ([, label, href]) => link(label, href)) :
      paragraph(complete ? "Inga prioriteringar i de anslutna köerna." : "Dagens prioriteringar visas när underlag finns."),
    [link("Öppna ringlistan", "#ringlist"), link("Skriv verkstadsrapport", "#report"), link("Visa privat planering", "#planning")], true),
    communicationCard(),
    card("Ärenden som kräver beslut", "cases", decisions, [admin()]),
    automationCard(),
    card("Nästa rekommenderade åtgärd", "next", items.length ?
      paragraph(items[0][1] + ".") : paragraph("Öppna planeringen för att gå igenom dina uppgifter."),
    [items.length ? link("Visa åtgärden", items[0][2]) : link("Öppna planering", "#planning")]),
  ];
}

function planningCard() {
  const renderTasks = (rows) => rows.length ? list(rows, (row) => '<strong>' + escape(row.title) + '</strong><small>' +
    escape(row.next || row.reason || row.status) + '</small>') : paragraph("Inga uppgifter att visa.");
  const body = planning?.status === "ok" ? renderTasks(planning.priorities) : paragraph(sourceMessage(planning));
  return [card("Dina tre viktigaste uppgifter", "planning", body, [link("Hantera uppgifter och dagsplan", "/")], true),
    card("Alla lokala uppgifter", "planning", planning?.status === "ok" ? renderTasks(planning.tasks) :
      paragraph(sourceMessage(planning)))];
}

function assistantCards() {
  const form = (kind, label, type) => '<form data-assistant="' + kind + '">' +
    (label ? '<label>' + label + '<input class="assistant-query" name="query" type="' + type + '"></label>' : "") +
    '<button type="submit">' + (label ? "Sök" : "Hämta tillgänglighet") + '</button>' +
    '<div class="assistant-result" aria-live="polite"></div></form>';
  return [
    card("Aktuell tillgänglighet", "nova", form("presence") +
      '<label>Förhandsval för status<select id="presence-choice" disabled><option>Hämta tillgänglighet först</option></select></label>' +
      paragraph("Förhandsvalet sparas inte. Ändring av telefonstatus är avstängd.")),
    card("Sök kundärenden", "cases", form("customers", "Namn, ärendenummer eller modell", "search")),
    card("Sök samtal", "communication", form("calls", "Telefonnummer (valfritt, senaste 30 dagarna)", "tel")),
    card("Assistentens aktivitet här", "nova", '<div id="assistant-activity">' + renderAssistantActivity() + '</div>'),
  ];
}

const assistantActivity = [];
const assistantActions = { presence: "Tillgänglighet", customers: "Kundsökning", calls: "Samtalssökning" };
function renderAssistantActivity() {
  return assistantActivity.length ? list(assistantActivity, (row) => escape(row)) :
    paragraph("Inga förfrågningar i den här webbläsarfliken.");
}

document.querySelector("#content").addEventListener("submit", async (event) => {
  const form = event.target;
  const kind = form.dataset.assistant;
  if (!Object.hasOwn(assistantActions, kind)) return;
  event.preventDefault();
  const output = form.querySelector(".assistant-result");
  const button = form.querySelector("button");
  button.disabled = true;
  output.textContent = "Hämtar …";
  let data;
  try {
    const response = await fetch("/api/unified/assistant", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, query: new FormData(form).get("query") }),
      cache: "no-store",
    });
    data = response.ok ? await response.json() : { status: response.status === 401 ? "forbidden" : "down" };
  } catch {
    data = { status: "down" };
  }
  button.disabled = false;
  const errors = { forbidden: "Åtkomst saknas.", not_configured: "Gatewayen är inte konfigurerad.",
    invalid: "Kontrollera sökfältet.", rate_limited: "För många sökningar. Försök igen om en stund.",
    down: "Gatewayen kunde inte nås." };
  assistantActivity.unshift(assistantActions[kind] + " · " +
    new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) + " · " +
    (data.status === "ok" ? data.partial ? "Delvis svar" : "Klart" : errors[data.status] || errors.down));
  assistantActivity.splice(8);
  const activity = document.querySelector("#assistant-activity");
  if (activity) activity.innerHTML = renderAssistantActivity();
  if (!form.isConnected) return;
  if (data.status !== "ok") {
    output.textContent = errors[data.status] || errors.down;
  } else if (kind === "presence") {
    output.innerHTML = paragraph([data.label, data.until, "Routing " + data.routing].filter(Boolean).join(" · ")) +
      (data.history.length ? list(data.history, (row) => escape(row.join(" · "))) : "");
    const select = document.querySelector("#presence-choice");
    select.replaceChildren(...Object.entries(data.options).map(([key, label]) => new Option(label, key, false, label === data.label)));
    select.disabled = !select.options.length;
  } else {
    output.innerHTML = (data.partial ? paragraph("Visar ett begränsat resultat.") : "") +
      (data.rows.length ? list(data.rows, (row) => escape(row.join(" · "))) : paragraph("Inga träffar."));
  }
});

function render() {
  const page = route();
  document.body.dataset.page = page;
  document.querySelector("#heading").textContent = titles[page];
  document.querySelector("#date").textContent = new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "full", timeZone: "Europe/Stockholm",
  }).format();
  document.querySelector("#refresh").hidden = page === "assistant" || page === "report";
  document.querySelector("#modes").hidden = page !== "home";
  document.querySelectorAll("[data-mode]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  document.querySelectorAll("#navigation a").forEach((anchor) => {
    if (anchor.hash === "#" + page) anchor.setAttribute("aria-current", "page");
    else anchor.removeAttribute("aria-current");
  });
  if (showWorkspace(page)) return;
  const connection = document.querySelector("#connection");
  connection.textContent = page === "planning" ? "Lokal planering · privat arbetsyta" :
    business?.cases?.status === "ok" || business?.communication?.status === "ok" ? "Anslutna verksamhetskällor" :
      business ? "Lokal version · verksamhetsdata är inte tillgänglig" : "Hämtar verksamhetsdata …";
  const views = {
    home: () => mode === "focus" ? focusCards() : [casesCard(), communicationCard(), bookingsCard(), financeCard(),
      automationCard(), card("AI-assistent", "nova", "", [link("Öppna assistenten", "#assistant")]), card("Godkännanden", "planning", "", [link("Visa godkännanden", "#approvals")]), card("Planering", "planning", paragraph("Dina uppgifter och nästa steg i den privata arbetsytan."),
        [link("Öppna planering", "#planning")])],
    communication: () => [communicationCard(true), automationCard(), historyCard()],
    cases: () => [casesCard(true), card("Ärenden som kräver beslut", "planning", fromSource(business?.cases, (data) =>
      caseRows(data.decisions, "Inga ärenden flaggade för beslut.", (row) => row.reason)))],
    bookings: bookingCards,
    approvals: approvalCards,
    finance: () => [financeCard()],
    planning: planningCard,
    assistant: assistantCards,
  };
  document.querySelector("#content").innerHTML = '<div class="grid">' + views[page]().join("") + '</div>';
}

async function load(force = false) {
  if (route() === "ringlist" || route() === "report") {
    request?.controller.abort();
    request = null;
    document.querySelector("#refresh").disabled = false;
    return;
  }
  const isPrivate = route() === "planning";
  if (!isPrivate) planning = null;
  if (route() === "assistant") {
    request?.controller.abort();
    request = null;
    document.querySelector("#refresh").disabled = false;
    return;
  }
  const endpoint = isPrivate ? "planning" : "business";
  if (request?.endpoint === endpoint) return;
  if (!force && (isPrivate ? planning : business)) {
    request?.controller.abort();
    request = null;
    document.querySelector("#refresh").disabled = false;
    return;
  }
  request?.controller.abort();
  const controller = new AbortController();
  request = { endpoint, controller };
  document.querySelector("#refresh").disabled = true;
  let data;
  try {
    const response = await fetch("/api/unified/" + endpoint, { signal: controller.signal, cache: "no-store" });
    data = response.ok ? await response.json() : { status: response.status === 401 ? "unauthorized" : "down" };
  } catch {
    data = { status: "down" };
  }
  if (controller.signal.aborted) return;
  if (isPrivate) planning = { status: "ok", ...data };
  else business = data.status ? { cases: data, communication: data } : data;
  request = null;
  document.querySelector("#refresh").disabled = false;
  render();
}

document.querySelector("#content").addEventListener("input", (event) => {
  if (event.target.id !== "case-query") return;
  caseQuery = event.target.value;
  document.querySelector("#case-results").innerHTML = caseSearchResults();
});

window.addEventListener("hashchange", () => {
  load();
  render();
  (document.querySelector("#ring-title") || document.querySelector("#heading")).focus();
});
document.querySelector("#refresh").addEventListener("click", async (event) => {
  if (route() !== "ringlist") return load(true);
  const control = event.currentTarget;
  control.disabled = true;
  try { await refreshRing(); } finally { control.disabled = false; }
});
document.querySelector("#modes").addEventListener("click", (event) => {
  const next = event.target.closest("[data-mode]")?.dataset.mode;
  if (next) {
    mode = next;
    render();
  }
});
render();
load();
