const mock = [{
  id: "demo_callback", kind: "meeting_call", title: "Ring upp Testkund",
  customer: "Testkund (påhittad)", reference: "DEMO-1", status: "proposed",
  received: "2026-11-13T09:15", requested: "2026-11-13T14:00",
  description: "Stäm av vilket arbete kunden vill boka.", source: "Testkälla",
}];
const demo = new URLSearchParams(location.search).get("demo") === "1";
const state = { calls: null, proposals: null };
const order = [];
const labels = { proposed: "Föreslagen", selected: "Vald", in_progress: "Pågår", snoozed: "Uppskjuten" };
const date = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" });
function time(value) {
  if (!value) return "Saknas";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value.replace("T", " kl. ");
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? date.format(parsed) : value;
}

export function taskInbox({ card, escape, paragraph, tool, render, route }) {
  let operation = false;
  let message = "";
  const action = (name, label) => '<button type="submit" name="action" value="' + name + '">' + label + '</button>';
  const fields = (pairs) => '<dl>' + pairs.map(([label,value]) =>
    '<div><dt>' + label + '</dt><dd>' + escape(value) + '</dd></div>').join("") + '</dl>';
  function row(item, calls, personal) {
    const phone = /^\+?[0-9]{6,15}$/.test(item.phone || "") ? item.phone : "";
    const selected = ["selected","in_progress"].includes(item.status);
    const index = order.indexOf(item.id);
    return '<details class="inbox-row"><summary>' + escape(item.customer || item.title) +
      '<small>' + escape([item.reference, item.work || labels[item.status] || item.status].filter(Boolean).join(" · ")) + '</small></summary>' +
      (calls ? fields([
        ["Ärende", item.reference || (item.caseId ? "Kopplat" : "Saknas")],
        ["Mottaget", time(item.received)], ["Önskad återkoppling", time(item.requested)],
        ["Bekräftad tid", time(item.confirmed)], ["Senaste dokumenterade kontakt", time(item.lastContact)],
        ["Nästa åtgärd", item.title + (item.callbackAt ? " · " + time(item.callbackAt) : "")],
      ]) : paragraph(item.description || item.title) + paragraph([item.source,item.reason].filter(Boolean).join(" · "))) +
      (item.needsReview ? paragraph("Kontrollera tiden innan du planerar.") : "") +
      '<form class="inbox-actions" data-inbox-id="' + escape(item.id) + '">' +
      (calls ? '' :
        '<label>Uppgiftens titel<input name="title" maxlength="200" value="' + escape(item.title) + '"></label>' +
        '<label>Skjut upp till<input name="until" type="datetime-local"></label>') +
      '<div class="actions">' +
      (calls && phone && !demo ? '<a href="tel:' + phone + '">Ring ' + phone + '</a>' : '') +
      (item.caseId && !demo ? tool("Öppna kundkort", "/admin/?case=" + encodeURIComponent(item.caseId) + "&tab=contact") : '') +
      (calls ? (selected ? '' : action("select","Lägg i min ringlista")) +
        (phone || demo ? action("done","Markera hanterad") : "") +
        (personal ? (index > 0 ? action("up","Flytta upp") : "") +
          (index < order.length - 1 ? action("down","Flytta ned") : "") : "")
        : action("plan","Lägg i dagsplanen") + action("snooze","Skjut upp") + action("reject","Avvisa")) +
      '</div></form></details>';
  }
  function cards(view) {
    const data = state[view];
    const notice = '<div role="status">' + escape(message) + '</div>' +
      (demo ? paragraph("Testdata. Åtgärder påverkar bara den här sidan.") : "");
    if (data?.status !== "ok") {
      const errors = { unavailable:"Uppgiftsinkorgens API är inte tillgängligt.", not_configured:"Anslutningen är inte konfigurerad.",
        down:"Källan kunde inte nås. Välj Uppdatera för att försöka igen." };
      return [card(view === "calls" ? "Ringlista" : "Förslag att planera","planning",notice + paragraph(data ? errors[data.status] || errors.down : "Hämtar …"))];
    }
    if (view === "proposals") return [card("Förslag att planera","planning",notice +
      (data.partial ? paragraph("Vissa källor kunde inte läsas.") : "") +
      (data.email === "not_configured" ? paragraph("Mejlkällan är inte ansluten.") : "") +
      (data.items.length ? data.items.map((item) => row(item,false,false)).join("") : paragraph("Inga öppna förslag.")))];
    const selected = data.items.filter((item) => ["selected","in_progress"].includes(item.status));
    const personal = order.map((id) => selected.find((item) => item.id === id)).filter(Boolean);
    const available = data.items.filter((item) => !selected.includes(item));
    return [
      card("Min ringlista","communication",notice +
        (data.partial ? paragraph("Ringlistans arbetsstatus kunde bara läsas delvis.") : "") +
        (personal.length ? personal.map((item) => row(item,true,true)).join("") : paragraph("Lägg till kontakter från listan nedan."))),
      card("Att ringa","communication",available.length ? available.map((item) => row(item,true,false)).join("") : paragraph("Inga övriga kontakter.")),
    ];
  }
  let revision = 0;
  async function load(view) {
    const request = ++revision;
    let data;
    try {
      if (demo) data = state[view] || { status:"ok", items:mock.map((item) => ({ ...item })), email:"not_configured" };
      else {
        const response = await fetch("/api/unified/inbox?view=" + view, { cache:"no-store" });
        data = response.ok ? await response.json() : { status:"down" };
      }
    } catch { data = { status:"down" }; }
    if (request !== revision) return;
    state[view] = data;
    if (view === "calls" && data.status === "ok") {
      const ids = data.items.filter((item) => ["selected","in_progress"].includes(item.status)).map((item) => item.id);
      order.splice(0,order.length,...order.filter((id) => ids.includes(id)),...ids.filter((id) => !order.includes(id)));
    }
    if (route() === view) render();
  }
  document.querySelector("#content").addEventListener("submit", async (event) => {
    const form = event.target;
    const id = form.dataset.inboxId;
    if (!id) return;
    event.preventDefault();
    if (operation) return;
    const view = route();
    const command = event.submitter?.value;
    const index = order.indexOf(id);
    if (command === "up" || command === "down") {
      const other = index + (command === "up" ? -1 : 1);
      if (index >= 0 && other >= 0 && other < order.length) [order[index],order[other]] = [order[other],order[index]];
      render();
      return;
    }
    const input = new FormData(form);
    if (command === "snooze" && !input.get("until")) {
      message = "Välj datum och tid för uppskjutningen.";
      document.querySelector("#content [role=status]").textContent = message;
      return;
    }
    operation = true;
    form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    let status = "ok";
    try {
      if (demo) {
        const item = state[view].items.find((entry) => entry.id === id);
        if (command === "select") item.status = "selected";
        else state[view].items = state[view].items.filter((entry) => entry !== item);
      } else {
        const response = await fetch("/api/unified/inbox", { method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ id, action:command, title:input.get("title"), until:input.get("until") }) });
        status = (await response.json()).status || "down";
      }
    } catch { status = "down"; }
    operation = false;
    message = status === "ok" ? demo ? "Teståtgärden är klar." : command === "plan" ?
      "Uppgiften är tillagd i dagsplanen." : "Åtgärden är sparad." :
      status === "conflict" ? "Uppgiften har ändrats. Listan hämtas på nytt." :
        status === "invalid" ? "Kontrollera uppgiftens titel och tid." : "Åtgärden kunde inte sparas.";
    if (status === "ok" || status === "conflict") await load(view);
    else if (route() === view) {
      form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      document.querySelector("#content [role=status]").textContent = message;
    }
  });
  return { cards, load };
}
