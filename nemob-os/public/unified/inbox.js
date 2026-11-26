const mock = [{
  id: "demo_callback", kind: "meeting_call", title: "Ring upp Testkund",
  customer: "Testkund (påhittad)", reference: "DEMO-1", status: "proposed",
  received: "2026-11-13T09:15", requested: "2026-11-13T14:00",
  description: "Stäm av vilket arbete kunden vill boka.", source: "Testkälla",
}];
const demo = new URLSearchParams(location.search).get("demo") === "1";
let data = null;
export function taskInbox({ card, escape, paragraph, tool, render, route }) {
  let operation = false;
  let message = "";
  const action = (name, label) => '<button type="submit" name="action" value="' + name + '">' + label + '</button>';
  function row(item) {
    if (item.syncState) {
      return '<details class="inbox-row" data-case-sync="' + escape(item.id) + '"><summary>' + escape(item.title) + '</summary>' +
        paragraph(item.description) + '<div data-sync-content></div></details>';
    }
    return '<details class="inbox-row"><summary>' + escape(item.title) + '</summary>' +
      paragraph(item.description || item.title) + paragraph([item.source, item.reason].filter(Boolean).join(" · ")) +
      (item.needsReview ? paragraph("Kontrollera tiden innan du planerar.") : "") +
      '<form class="inbox-actions" data-inbox-id="' + escape(item.id) + '">' +
      '<label>Uppgiftens titel<input name="title" maxlength="200" value="' + escape(item.title) + '"></label>' +
      '<label>Skjut upp till<input name="until" type="datetime-local"></label><div class="actions">' +
      (item.caseId && !demo ? tool("Öppna kundkort", "/admin/?case=" + encodeURIComponent(item.caseId) + "&tab=contact") : "") +
      action("plan","Lägg i dagsplanen") + action("snooze","Skjut upp") + action("reject","Avvisa") +
      '</div></form></details>';
  }
  function cards() {
    const notice = '<div role="status">' + escape(message) + '</div>' +
      (demo ? paragraph("Testdata. Åtgärder påverkar bara den här sidan.") : "");
    if (data?.status !== "ok") {
      const errors = { unavailable:"Uppgiftsinkorgens API är inte tillgängligt.", not_configured:"Anslutningen är inte konfigurerad.",
        down:"Källan kunde inte nås. Välj Uppdatera för att försöka igen." };
      return [card("Förslag att planera","planning",notice + paragraph(data ? errors[data.status] || errors.down : "Hämtar …"))];
    }
    return [card("Förslag att planera","planning",notice +
      (data.partial ? paragraph("Vissa källor kunde inte läsas.") : "") +
      (data.email === "not_configured" ? paragraph("Mejlkällan är inte ansluten.") : "") +
      (data.items.length ? data.items.map(row).join("") : paragraph("Inga öppna förslag.")))];
  }
  let revision = 0;
  async function load() {
    const request = ++revision;
    let next;
    try {
      if (demo) next = data || { status:"ok", items:mock.map((item) => ({ ...item })), email:"not_configured" };
      else {
        const response = await fetch("/api/unified/inbox", { cache:"no-store" });
        next = response.ok ? await response.json() : { status:"down" };
      }
    } catch { next = { status:"down" }; }
    if (request !== revision) return;
    data = next;
    if (route() === "proposals") render();
  }
  const content = document.querySelector("#content");
  const syncFields = { customerUpdate: "Kundtext", note: "Intern journal", status: "Verkstadsstatus",
    nextAction: "Nästa arbetsmoment", followupDeadline: "Utlovad återkoppling", workDone: "Genomfört arbete", blockers: "Blockerare" };
  content.addEventListener("toggle", async (event) => {
    const details = event.target;
    if (!details.open || !details.dataset?.caseSync) return;
    const area = details.querySelector("[data-sync-content]");
    area.textContent = "Hämtar ändringen …";
    try {
      const response = await fetch("/api/unified/case-sync/" + encodeURIComponent(details.dataset.caseSync), { cache: "no-store" });
      const { status, entry, version } = await response.json();
      if (status !== "ok" || !entry?.changes || !version) {
        area.textContent = "Ändringen kunde inte hämtas. Uppdatera listan.";
        return;
      }
      const values = Object.entries(entry.changes).map(([key, value]) => paragraph((syncFields[key] || key) + " · " + value)).join("");
      const review = entry.changes.customerUpdate && !entry.approvedBy && entry.syncState !== "conflict";
      const apply = !review && entry.syncState !== "conflict";
      area.innerHTML = values + '<form data-sync-version="' + escape(version) + '"><div class="actions">' +
        tool("Öppna kundkort", "/admin/?case=" + encodeURIComponent(entry.id) + "&tab=overview") +
        (review ? action("approve", "Godkänn ändringen") : "") +
        (apply ? action("retry", "Spara och verifiera") : "") +
        action("reject", "Avvisa ändringen") + '</div></form>';
    } catch {
      area.textContent = "Ändringen kunde inte hämtas.";
    }
  }, true);
  content.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!form.dataset.syncVersion) return;
    event.preventDefault();
    if (operation) return;
    const command = event.submitter?.value;
    const id = form.closest("[data-case-sync]").dataset.caseSync;
    if (!["approve", "retry", "reject"].includes(command)) return;
    operation = true;
    form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      const response = await fetch("/api/unified/case-sync/" + encodeURIComponent(id) + "/" + command, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: form.dataset.syncVersion }),
      });
      const result = await response.json();
      message = result.status === "conflict" ? "Kundkortet eller ändringen har ändrats. Läs om kortet." :
        result.status !== "ok" ? "Ändringen kunde inte hanteras. Kontrollera synkstatus." :
        command === "approve" ? "Godkänd. Be assistenten synkronisera igen, eller välj Spara och verifiera." :
        command === "reject" ? "Ändringen är avvisad." : "Ändringen är sparad och verifierad.";
      await load();
    } catch {
      message = "Anslutningen bröts. Uppdatera och kontrollera resultatet.";
      if (route() === "proposals") render();
    } finally {
      operation = false;
    }
  });
  content.addEventListener("submit", async (event) => {
    const form = event.target;
    const id = form.dataset.inboxId;
    if (!id) return;
    event.preventDefault();
    if (operation) return;
    const view = route();
    const command = event.submitter?.value;
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
        data.items = data.items.filter((entry) => entry.id !== id);
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
        status === "planning_failed" ? "Förslaget valdes, men dagsplanen kunde inte sparas. Försök lägga till det igen." :
        status === "invalid" ? "Kontrollera uppgiftens titel och tid." : "Åtgärden kunde inte sparas.";
    if (status === "ok" || status === "conflict") await load();
    else if (route() === view) {
      form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      document.querySelector("#content [role=status]").textContent = message;
    }
  });
  return { cards, load };
}
