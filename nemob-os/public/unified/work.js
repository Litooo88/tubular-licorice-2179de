import { demoContacts, demoSuggestions } from "./demo-work.js";

const contactState = { selected: [], handled: new Set(), expanded: new Set() };
const suggestionState = new Map();
let editing = "";
let showDeferred = false;
let notice = "";
let busy = false;
let taskReadFailed = false;

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const p = (value) => "<p>" + escape(value) + "</p>";
const button = (action, label, id = "", options = {}) =>
  '<button type="button" data-work="' + action + '" data-id="' + escape(id) + '"' +
  (options.primary ? ' class="primary"' : "") + (options.disabled ? " disabled" : "") +
  (options.label ? ' aria-label="' + escape(options.label) + '"' : "") + ">" + escape(label) + "</button>";
const feedback = () => '<p class="work-feedback" role="status">' + escape(notice) + "</p>";
const demo = (text) => '<p class="demo-label"><strong>Demo</strong> ' + escape(text) + "</p>";
const byId = (id) => demoContacts.find((row) => row.id === id);
const fields = (pairs) => '<dl class="work-facts">' + pairs.map(([label, value]) =>
  "<div><dt>" + escape(label) + "</dt><dd>" + escape(value || "Saknas") + "</dd></div>").join("") + "</dl>";

function contactCard(row) {
  const handled = contactState.handled.has(row.id);
  const selected = contactState.selected.includes(row.id);
  const status = handled ? "Hanterad" : row.status;
  return '<details class="work-item" data-contact="' + row.id + '"' +
    (contactState.expanded.has(row.id) ? " open" : "") + '><summary><span><strong>' + escape(row.name) +
    '</strong><small>' + escape([row.reference, row.received].filter(Boolean).join(" · ")) +
    '</small></span><span class="work-status">' + escape(status) + '</span></summary>' +
    '<div class="work-detail"><a data-work="demo-call" data-id="' + row.id + '" href="tel:' + row.phone + '">' + row.phone + '</a>' +
    fields([["Ärende", row.reference || "Ingen koppling"], ["Mottaget", row.received], ["Önskad återkoppling", row.requested],
      ["Bekräftad bokning", row.booked], ["Senaste dokumenterade kontakt", row.last], ["Nästa åtgärd", row.next]]) +
    '<div class="work-actions">' + button("demo-call", "Ring", row.id, { primary: true }) +
    button("open-case", "Öppna kundkort", row.id, { disabled: !row.reference }) +
    button("handle", handled ? "Återöppna" : "Markera hanterad", row.id) +
    button("select", selected ? "Ta bort från min ringlista" : "Lägg i min ringlista", row.id) + "</div></div></details>";
}

export function ringCards(card) {
  return [
    card("Min ringlista", "communication", demo("Urval, ordning och status sparas i den här fliken.") + feedback() +
      (contactState.selected.length ? '<ol class="personal-ring">' + contactState.selected.map((id, index, all) => {
        const row = byId(id);
        return '<li><span><strong>' + escape(row.name) + '</strong><small>' +
          escape(contactState.handled.has(id) ? "Hanterad" : row.next) + '</small></span><div class="work-actions">' +
          button("up", "↑", id, { disabled: index === 0, label: "Flytta upp " + row.name }) +
          button("down", "↓", id, { disabled: index === all.length - 1, label: "Flytta ner " + row.name }) +
          button("show-contact", "Visa", id, { label: "Visa " + row.name }) + "</div></li>";
      }).join("") + "</ol>" : p("Välj kontakter i listan bredvid eller nedanför."))),
    card("Inkommande kontakter", "communication", demo("Fiktiva kontakter. Ring och kundkort visar bara hur åtgärderna fungerar.") +
      demoContacts.map(contactCard).join("")),
  ];
}

async function api(path, method = "GET", data) {
  const res = await fetch(path, {
    method, cache: "no-store",
    ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Åtkomst saknas. Ladda om och logga in." : "Planeringen kunde inte uppdateras.");
  return res.json();
}

const marker = (id) => "Demoförslag · " + id;
let planData;
let tasks;
let loadError = "";
let planLoad;
const savedSuggestion = (id) => tasks?.some((task) => task.impact === marker(id));
export function loadDay(render) {
  if (planLoad) return planLoad;
  loadError = "";
  planLoad = Promise.all([api("/api/plan"), api("/api/tasks")]).then(([day, result]) => {
    planData = day;
    tasks = result.tasks;
    taskReadFailed = false;
  }).catch((error) => {
    loadError = error.message;
    taskReadFailed = true;
  }).finally(() => {
    planLoad = null;
    render();
  });
  return planLoad;
}

export function suggestionCards(card) {
  const available = demoSuggestions.filter(({ id }) => !savedSuggestion(id) &&
    (!suggestionState.has(id) || (showDeferred && suggestionState.get(id) === "deferred")));
  return [
    card("Granska förslag", "nova", demo("Fiktiva AI-förslag. Acceptera skapar en uppgift märkt Demo i din lokala dagsplan.") +
      feedback() + '<div class="work-actions">' + button("toggle-deferred", showDeferred ? "Dölj uppskjutna" : "Visa uppskjutna") + '</div>' +
      (available.length ? available.map((row) => {
        const deferred = suggestionState.get(row.id) === "deferred";
        return '<article class="suggestion work-item"><small>' + escape(row.source + " · " + row.minutes + " min" +
          (deferred ? " · Uppskjuten" : "")) + '</small><h3>' + escape(row.title) + '</h3>' + p(row.reason) +
          (editing === row.id ? '<form class="work-form" data-work-form="suggestion" data-id="' + row.id + '">' +
            '<label>Uppgift<input name="title" required maxlength="190" value="' + escape(row.title) + '"></label>' +
            '<label>Nästa steg<input name="nextStep" maxlength="500" value="' + escape(row.next) + '"></label>' +
            '<label>Minuter<input name="estimatedMinutes" type="number" min="1" max="720" required value="' + row.minutes + '"></label>' +
            '<div class="work-actions"><button class="primary"' + (busy ? " disabled" : "") + '>Spara och planera</button>' +
            button("cancel-edit", "Avbryt", row.id) + '</div></form>' :
            '<div class="work-actions">' + button("accept", "Acceptera", row.id, { primary: true, disabled: busy }) +
            button("edit", "Ändra", row.id) + button(deferred ? "restore" : "defer", deferred ? "Ta tillbaka" : "Skjut upp", row.id) +
            button("reject", "Avvisa", row.id) + "</div>") + "</article>";
      }).join("") : p("Inga förslag att granska."))),
  ];
}

const notes = {
  morning: ["Morgonbrief", "Finns det något som saknas inför dagens planering?"],
  midday: ["Mittdagskontroll", "Finns det något hinder som saknas i uppgifterna?"],
  evening: ["Kvällssammanfattning", "Vad behöver föras vidare som ännu inte finns i planeringen?"],
};
const taskLabels = { ny: "Ny", planerad: "Planerad", pagar: "Pågår", blockerad: "Blockerad", klar: "Klar", flyttad: "Flyttad" };
const taskList = (rows = []) => rows.length ? '<ul class="rows">' + rows.map((task) =>
  '<li><strong>' + escape(task.title) + '</strong><small>' + escape(taskLabels[task.status] || "") +
  (task.nextStep ? " · " + escape(task.nextStep) : "") + '</small>' +
  (task.id && task.status !== "klar" ? '<div class="work-actions">' + button("complete", "Markera klar", task.id, { disabled: busy }) + "</div>" : "") +
  '</li>').join("") + "</ul>" : p("Inga uppgifter.");

export function dayCards(card) {
  const day = planData;
  const plan = day?.plan;
  const summary = day?.summary;
  const block = (entry, label) => '<h3>' + escape(entry?.label || label) + '</h3>' +
    (entry ? p(entry.usedMinutes + " av " + entry.budgetMinutes + " min") +
      taskList(entry.taskIds.map((id) => tasks?.find((task) => task.id === id)).filter(Boolean)) : p("Ingen plan sparad."));
  const briefs = Object.entries(notes).map(([kind, [label, prompt]]) => {
    const lines = kind === "morning" ? [plan?.morningBrief?.first && "Börja med " + plan.morningBrief.first,
      ...(plan?.morningBrief?.urgent?.length ? ["Brådskande · " + plan.morningBrief.urgent.join(", ")] : [])] :
      [summary && summary.stillOpenCount + " öppna uppgifter",
        summary && summary.doneToday.length + " klara i dag",
        summary?.blocked?.length ? "Blockerat · " + summary.blocked.map((row) => row.title).join(", ") : ""];
    const prior = day?.checkins?.[kind]?.answers;
    const saved = day?.checkins?.[kind]?.savedAt;
    return '<details class="work-item" data-brief="' + kind + '"><summary>' + label + '</summary><div class="work-detail">' +
      (lines.filter(Boolean).map(p).join("") || p("Ingen beräknad sammanfattning ännu.")) +
      (prior ? Object.entries(prior).filter(([key, value]) => key !== "note" && value).map(([, value]) => p(value)).join("") : "") +
      (day ? '<form class="work-form" data-work-form="checkin" data-id="' + kind + '"><label>' + escape(prompt) +
        '<textarea name="note" rows="2" maxlength="1000">' + escape(prior?.note || "") + '</textarea></label>' +
        '<div class="work-actions"><button' + (busy ? " disabled" : "") + '>Spara komplettering</button>' +
        (saved ? '<span class="work-status">Sparad</span>' : "") + '</div></form>' : "") + '</div></details>';
  });
  return [
    card("Dagens plan", "planning", feedback() + (loadError ? p(loadError) : day ? "" : p("Hämtar dagens plan …")) +
      '<div class="work-actions">' + button("generate", "Planera dagen", "", { primary: true, disabled: busy || !day }) +
      '<a href="#suggestions">Förslag att planera</a></div><div class="day-blocks">' + block(plan?.fmBlock, "Förmiddag") +
      block(plan?.emBlock, "Eftermiddag") + (plan?.unscheduled?.length ? p(plan.unscheduled.length + " uppgifter fick inte plats i dagens block.") : "") + "</div>", [], true),
    card("Dagens avstämningar", "bookings", briefs.join("")),
    card("Alla uppgifter", "planning", tasks ? taskList(tasks) : p(loadError || "Hämtar uppgifter …")),
  ];
}

export function bindWork(content, render) {
  function update(action, id) {
    const open = [...content.querySelectorAll("details[open][data-brief]")].map((el) => el.dataset.brief);
    render();
    for (const key of open) {
      const detail = content.querySelector('[data-brief="' + key + '"]');
      if (detail) detail.open = true;
    }
    const controls = [...content.querySelectorAll("[data-work]")];
    const target = controls.find((el) => el.dataset.work === action && el.dataset.id === id && !el.disabled) ||
      controls.find((el) => el.dataset.id === id && !el.disabled && el.getClientRects().length);
    target?.focus();
  }

  async function mutation(run, success, action, id) {
    if (busy) return;
    busy = true;
    notice = "Sparar …";
    // Keep form values and disclosure state while the request is pending.
    const scope = location.hash;
    const controls = [...content.querySelectorAll("button:not(:disabled)")];
    controls.forEach((el) => { el.disabled = true; });
    const feedbackEl = content.querySelector(".work-feedback");
    if (feedbackEl) feedbackEl.textContent = notice;
    try {
      await run();
      notice = success;
    } catch (error) {
      notice = error.message;
    } finally {
      busy = false;
      controls.forEach((el) => { el.disabled = false; });
      if (location.hash === scope) {
        if (feedbackEl?.isConnected) feedbackEl.textContent = notice;
        if (notice === success) update(action, id);
      }
    }
  }

  async function accept(row, values) {
    if (planLoad) await planLoad;
    if (!tasks || taskReadFailed) {
      tasks = (await api("/api/tasks")).tasks;
      taskReadFailed = false;
    }
    if (!savedSuggestion(row.id)) {
      try {
        const result = await api("/api/tasks", "POST", {
          title: "Demo · " + values.title.trim(), nextStep: values.nextStep, area: "nordic",
          estimatedMinutes: Number(values.estimatedMinutes), impact: marker(row.id), status: "planerad",
        });
        tasks = [...tasks, result.task];
      } catch (error) {
        taskReadFailed = true;
        throw error;
      }
    }
    editing = "";
    try {
      const result = await api("/api/plan/generate", "POST");
      planData = { ...planData, plan: result.plan };
      suggestionState.set(row.id, "accepted");
      notice = "";
      location.hash = "planning";
    } catch {
      notice = "Uppgiften sparades. Öppna Planering och välj Planera dagen för att uppdatera planen.";
      render();
      throw new Error(notice);
    }
  }

  content.addEventListener("click", (event) => {
    const el = event.target.closest("[data-work]");
    if (!el) return;
    const { work: action, id } = el.dataset;
    const contact = byId(id);
    const suggestion = demoSuggestions.find((row) => row.id === id);
    notice = "";
    if (action === "demo-call") {
      event.preventDefault();
      notice = "Demokontakt. Inget samtal startades.";
    } else if (action === "open-case") {
      notice = contact.reference + " är ett fiktivt kundkort.";
    } else if (action === "handle") {
      if (contactState.handled.has(id)) contactState.handled.delete(id);
      else contactState.handled.add(id);
      notice = contact.name + (contactState.handled.has(id) ? " markerades som hanterad." : " återöppnades.");
    } else if (action === "select") {
      const index = contactState.selected.indexOf(id);
      if (index < 0) contactState.selected.push(id);
      else contactState.selected.splice(index, 1);
      notice = index < 0 ? "Kontakten lades i min ringlista." : "Kontakten togs bort.";
    } else if (action === "up" || action === "down") {
      const from = contactState.selected.indexOf(id);
      const to = from + (action === "up" ? -1 : 1);
      if (from < 0 || to < 0 || to >= contactState.selected.length) return;
      [contactState.selected[from], contactState.selected[to]] = [contactState.selected[to], contactState.selected[from]];
      notice = contact.name + " flyttades till plats " + (to + 1) + ".";
    } else if (action === "show-contact") {
      const detail = content.querySelector('[data-contact="' + id + '"]');
      detail.open = true;
      detail.querySelector("summary").focus();
      return;
    } else if (action === "accept") {
      mutation(() => accept(suggestion, { ...suggestion, estimatedMinutes: suggestion.minutes }), "Uppgiften sparades.", action, id);
      return;
    } else if (action === "generate" || action === "complete") {
      mutation(async () => {
        if (action === "complete") {
          const result = await api("/api/tasks/" + encodeURIComponent(id), "PATCH", { status: "klar" });
          tasks = tasks.map((task) => task.id === id ? result.task : task);
        }
        await api("/api/plan/generate", "POST");
        await loadDay(() => {});
        if (loadError) throw new Error(loadError);
      }, action === "complete" ? "Uppgiften markerades klar." : "Dagens plan uppdaterades.", action, id);
      return;
    } else if (action === "toggle-deferred") showDeferred = !showDeferred;
    else if (action === "edit" || action === "cancel-edit") editing = action === "edit" ? id : "";
    else if (action === "restore") suggestionState.delete(id);
    else if (action === "defer" || action === "reject") {
      suggestionState.set(id, action === "defer" ? "deferred" : "rejected");
      notice = action === "defer" ? "Förslaget är uppskjutet i den här fliken." : "Förslaget avvisades.";
    } else return;
    update(action, id);
    if (action === "edit") content.querySelector('[data-work-form="suggestion"] input')?.focus();
  });

  content.addEventListener("toggle", (event) => {
    const id = event.target.dataset.contact;
    if (!id || !event.target.isConnected) return;
    if (event.target.open) contactState.expanded.add(id);
    else contactState.expanded.delete(id);
  }, true);

  content.addEventListener("submit", (event) => {
    const form = event.target;
    const kind = form.dataset.workForm;
    if (!kind) return;
    event.preventDefault();
    const id = form.dataset.id;
    const values = Object.fromEntries(new FormData(form));
    if (kind === "suggestion") {
      if (!values.title.trim()) {
        form.elements.title.focus();
        notice = "Ange en titel.";
        content.querySelector(".work-feedback").textContent = notice;
        return;
      }
      mutation(() => accept(demoSuggestions.find((row) => row.id === id), values), "Uppgiften sparades.", "", id);
    } else {
      mutation(async () => {
        const result = await api("/api/checkins", "POST", {
          type: id, date: planData.date, answers: { ...planData.checkins?.[id]?.answers, note: values.note.trim() },
        });
        planData.checkins[id] = result.checkin;
      }, "Kompletteringen sparades.", "", id);
    }
  });
}
