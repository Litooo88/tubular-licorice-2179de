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
  bookings: "Bokningar", finance: "Ekonomi och checkout", planning: "Privat planering",
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
let business = null;
let planning = null;
let request = null;
const route = () => Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : "home";
const origin = () => business?.origin || "https://www.nordicemobility.se";
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

function communicationCard() {
  return card("Viktiga kundmeddelanden", "communication", fromSource(business?.communication, (data) =>
    metrics([[data.waiting, "Kontakter väntar på svar"], [data.pending, "SMS väntar på godkännande"]]) +
    (data.contacts.length ? list(data.contacts, (row) => '<strong>' + escape(row.name) + '</strong><small>' +
      escape(row.hours === null ? "Väntar på svar" : "Väntar på svar · " + row.hours + " h") + '</small>') : "") +
    (data.partial ? paragraph("Kommunikationsunderlaget är delvis tillgängligt.") : "")), [comm()]);
}

function automationCard() {
  return card("Automatiskt hanterat av Nova", "nova", fromSource(business?.communication, ({ nova, partial }) =>
    metrics([[nova.smsOut, "Utgående SMS idag"], [nova.callsIn, "Inkommande Nova-samtal idag"], [nova.chats, "Chattar idag"]]) +
    (partial ? paragraph("Kommunikationsunderlaget är delvis tillgängligt.") : "")),
  [tool("Öppna Novas rapport", "/admin/nova-rapport/")]);
}

function casesCard() {
  return card("Öppna kundärenden", "cases", fromSource(business?.cases, (data) =>
    metrics([[data.open, "Öppna ärenden"]]) + caseRows(data.cases, "Inga öppna ärenden.", status)),
  [admin(), workshop(), link("Sök i reparationskunskapen", "/knowledge.html")]);
}

const bookingTime = (row) => row.date ? row.date.replace("T", " kl. ") : "Önskad tid saknas";

function bookingsCard() {
  return card("Bokningar", "bookings", fromSource(business?.cases, (data) =>
    metrics([[data.pending, "Obesvarade förfrågningar"], [data.upcoming, "Kommande webbokningar"]]) +
    '<div class="actions">' + link("Visa bokningskön", "#bookings") + '</div>'));
}

function bookingCards() {
  return [
    card("Väntar på besked", "bookings", fromSource(business?.cases, (data) =>
      caseRows(data.bookingQueue, "Inga obesvarade bokningsförfrågningar.", bookingTime, "contact")), [admin()]),
    card("Kommande webbokningar", "bookings", fromSource(business?.cases, (data) =>
      caseRows(data.bookings, "Inga kommande webbokningar registrerade.", (row) =>
        bookingTime(row) + (row.confirmed ? " · Bekräftad tid" : " · Önskad tid"), "contact")),
    [tool("Öppna webbokningen", "/book-online/")]),
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
  return [
    [cases?.pending, "Granska bokningsförfrågningar", "#bookings"],
    [communication?.waiting, "Följ upp kunder som väntar på svar", "#communication"],
    [communication?.pending, "Granska SMS för godkännande", "#communication"],
    [cases?.review, "Följ upp verkstadsbeslut", "#cases"],
    [cases?.readyUnpaid, "Följ upp betalning för klara ärenden", "#finance"],
  ].filter(([present]) => present).slice(0, 3);
}

function focusCards() {
  const items = priorities();
  const complete = business?.cases?.status === "ok" && business?.communication?.status === "ok" && !business.communication.partial;
  const decisions = fromSource(business?.cases, (data) =>
    caseRows(data.decisions, "Inga boknings- eller verkstadsbeslut flaggade.", (row) => row.reason));
  return [
    card("Dagens prioriteringar", "planning", items.length ? list(items, ([, label, href]) => link(label, href)) :
      paragraph(complete ? "Inga prioriteringar i de anslutna köerna." : "Dagens prioriteringar visas när underlag finns."),
    [link("Visa privat planering", "#planning")], true),
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

function render() {
  const page = route();
  document.querySelector("#heading").textContent = titles[page];
  document.querySelector("#date").textContent = new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "full", timeZone: "Europe/Stockholm",
  }).format();
  document.querySelector("#modes").hidden = page !== "home";
  document.querySelectorAll("[data-mode]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  document.querySelectorAll("#navigation a").forEach((anchor) => {
    if (anchor.hash === "#" + page) anchor.setAttribute("aria-current", "page");
    else anchor.removeAttribute("aria-current");
  });
  const connection = document.querySelector("#connection");
  connection.textContent = page === "planning" ? "Lokal planering · privat arbetsyta" :
    business?.cases?.status === "ok" || business?.communication?.status === "ok" ? "Anslutna verksamhetskällor" :
      business ? "Lokal version · verksamhetsdata är inte tillgänglig" : "Hämtar verksamhetsdata …";
  const views = {
    home: () => mode === "focus" ? focusCards() : [casesCard(), communicationCard(), bookingsCard(), financeCard(),
      automationCard(), card("Planering", "planning", paragraph("Dina uppgifter och nästa steg i den privata arbetsytan."),
        [link("Öppna planering", "#planning")])],
    communication: () => [communicationCard(), automationCard()],
    cases: () => [casesCard(), card("Ärenden som kräver beslut", "planning", fromSource(business?.cases, (data) =>
      caseRows(data.decisions, "Inga ärenden flaggade för beslut.", (row) => row.reason)))],
    bookings: bookingCards,
    finance: () => [financeCard()],
    planning: planningCard,
  };
  document.querySelector("#content").innerHTML = '<div class="grid">' + views[page]().join("") + '</div>';
}

async function load(force = false) {
  const isPrivate = route() === "planning";
  if (!isPrivate) planning = null;
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

window.addEventListener("hashchange", () => {
  load();
  render();
  document.querySelector("#heading").focus();
});
document.querySelector("#refresh").addEventListener("click", () => load(true));
document.querySelector("#modes").addEventListener("click", (event) => {
  const next = event.target.closest("[data-mode]")?.dataset.mode;
  if (next) {
    mode = next;
    render();
  }
});
render();
load();
