/* NEMOB OS V1 — dashboardklient. Vanilla JS, ingen build. */
"use strict";

const state = {
  meta: null,
  tasks: [],
  plan: null,
  checkins: {},
  summary: null,
  nordic: null,
  editTaskId: null,
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Fel (${response.status})`);
  return body;
};

/* ---------- Klocka och datum ---------- */

const tickClock = () => {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm" });
  $("#today").textContent = now.toLocaleDateString("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
};

/* ---------- Modal ---------- */

let modalResolve = null;
const openModal = (title, bodyHtml) =>
  new Promise((resolve) => {
    modalResolve = resolve;
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = bodyHtml;
    $("#modal-backdrop").classList.add("open");
    const firstInput = $("#modal-body input, #modal-body textarea");
    if (firstInput) firstInput.focus();
  });
const closeModal = (result) => {
  $("#modal-backdrop").classList.remove("open");
  if (modalResolve) modalResolve(result);
  modalResolve = null;
};
$("#modal-cancel").addEventListener("click", () => closeModal(null));
$("#modal-ok").addEventListener("click", () => {
  const values = {};
  document.querySelectorAll("#modal-body [name]").forEach((el) => { values[el.name] = el.value; });
  closeModal(values);
});

const askText = async (title, label, name = "value", type = "text") => {
  const result = await openModal(title, `
    <label class="field">${escapeHtml(label)}
      ${type === "textarea"
        ? `<textarea name="${name}" rows="3"></textarea>`
        : `<input type="${type}" name="${name}">`}
    </label>`);
  return result ? (result[name] || "").trim() : null;
};

/* ---------- Datahämtning ---------- */

const loadMeta = async () => { state.meta = await api("/api/meta"); };
const loadTasks = async () => { state.tasks = (await api("/api/tasks")).tasks; };
const loadPlan = async () => {
  const data = await api("/api/plan");
  state.plan = data.plan;
  state.checkins = data.checkins || {};
  state.summary = data.summary;
};
const loadNordic = async () => {
  $("#nordic-badge").textContent = "Nordic: hämtar…";
  try {
    state.nordic = await api("/api/nordic-brief");
  } catch {
    state.nordic = { status: "down", code: "local_error", cache: null };
  }
};

const refreshAll = async ({ nordic = false } = {}) => {
  await Promise.all([loadTasks(), loadPlan(), nordic ? loadNordic() : Promise.resolve()]);
  render();
};

/* ---------- Uppgiftsåtgärder ---------- */

const patchTask = async (id, patch) => {
  try {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: patch });
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
};

const actions = {
  start: (id) => patchTask(id, { status: "pagar" }),
  done: (id) => patchTask(id, { status: "klar" }),
  reopen: (id) => patchTask(id, { status: "ny" }),
  block: async (id) => {
    const reason = await askText("Blockera uppgift", "Blockeringsorsak *", "reason", "textarea");
    if (reason === null) return;
    if (!reason) { alert("Blockeringsorsak krävs."); return; }
    await patchTask(id, { status: "blockerad", blockReason: reason });
  },
  move: async (id) => {
    const date = await askText("Flytta till senare", "Nytt datum (lämna tomt = imorgon)", "date", "date");
    if (date === null) return;
    await patchTask(id, { status: "flyttad", movedToDate: date });
  },
  deadline: async (id) => {
    const date = await askText("Ändra deadline", "Ny deadline (tomt = ta bort)", "date", "datetime-local");
    if (date === null) return;
    await patchTask(id, { deadline: date.replace("T", " ") });
  },
  pin: (id) => {
    const task = state.tasks.find((item) => item.id === id);
    return patchTask(id, { pinned: !task?.pinned });
  },
  edit: (id) => startEdit(id),
};

document.body.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const handler = actions[button.dataset.action];
  if (handler) handler(button.dataset.id);
});

/* ---------- Rendering ---------- */

const areaLabel = (key) => state.meta?.areas?.[key] || key;
const statusLabel = (key) => state.meta?.statuses?.[key] || key;
const taskById = (id) => state.tasks.find((task) => task.id === id);

const actionButtons = (task) => {
  const buttons = [];
  if (["ny", "planerad", "blockerad", "flyttad"].includes(task.status)) {
    buttons.push(`<button class="small" data-action="start" data-id="${task.id}">Starta</button>`);
  }
  if (task.status !== "klar") {
    buttons.push(`<button class="small" data-action="done" data-id="${task.id}">Klar</button>`);
    buttons.push(`<button class="small" data-action="block" data-id="${task.id}">Blockera</button>`);
    buttons.push(`<button class="small" data-action="move" data-id="${task.id}">Flytta</button>`);
    buttons.push(`<button class="small" data-action="deadline" data-id="${task.id}">Deadline</button>`);
    buttons.push(`<button class="small" data-action="pin" data-id="${task.id}">${task.pinned ? "Släpp prio" : "Prioritera"}</button>`);
  } else {
    buttons.push(`<button class="small" data-action="reopen" data-id="${task.id}">Öppna igen</button>`);
  }
  buttons.push(`<button class="small" data-action="edit" data-id="${task.id}">Redigera</button>`);
  return `<div class="row-actions">${buttons.join("")}</div>`;
};

const renderMorning = () => {
  const el = $("#morning-brief");
  if (!state.plan) {
    el.innerHTML = `<span class="muted">Ingen plan genererad ännu — tryck ”Generera om dagsplan”.</span>`;
    return;
  }
  const mb = state.plan.morningBrief || {};
  const fmTitles = (state.plan.fmBlock?.taskIds || []).map((id) => taskById(id)?.title).filter(Boolean);
  const blockedHtml = (mb.blocked || []).length
    ? `<dt>Blockerat just nu</dt><dd>${mb.blocked.map((b) => `${escapeHtml(b.title)} — <em>${escapeHtml(b.reason)}</em>`).join("<br>")}</dd>`
    : "";
  el.innerHTML = `<dl class="checkin-answers">
    <dt>Vad är akut?</dt><dd>${mb.urgent?.length ? escapeHtml(mb.urgent.join(", ")) : "Inget akut just nu."}</dd>
    <dt>Vad ger mest pengar eller framdrift?</dt><dd>${escapeHtml(mb.mostValue || "–")}</dd>
    <dt>Vad ska göras först?</dt><dd>${escapeHtml(mb.first || "–")}</dd>
    <dt>Vad ska göras före lunch?</dt><dd>${fmTitles.length ? escapeHtml(fmTitles.join(", ")) : "–"}</dd>
    ${blockedHtml}
  </dl>`;
};

const renderTop5 = () => {
  const container = $("#top5");
  $("#top5-generated").textContent = state.plan
    ? `genererad ${new Date(state.plan.generatedAt).toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" })}`
    : "";
  if (!state.plan || !state.plan.top5?.length) {
    container.innerHTML = `<span class="muted">Ingen plan ännu, eller inga aktiva uppgifter.</span>`;
    return;
  }
  container.innerHTML = state.plan.top5.map((entry, index) => {
    const task = taskById(entry.taskId);
    if (!task) return "";
    return `<div class="top5-item">
      <div class="top5-rank">${index + 1}</div>
      <div class="top5-body">
        <div class="top5-title">${escapeHtml(task.title)}
          <span class="chip">${escapeHtml(areaLabel(task.area))}</span>
          <span class="chip status-${task.status}">${escapeHtml(statusLabel(task.status))}</span>
        </div>
        <div class="top5-reason">Varför: ${escapeHtml(entry.reason)}</div>
        ${task.nextStep ? `<div class="top5-next">Nästa steg: ${escapeHtml(task.nextStep)}</div>` : ""}
        <div class="top5-meta">${task.estimatedMinutes ? `~${task.estimatedMinutes} min` : "tid ej satt"}${task.deadline ? ` · deadline ${escapeHtml(task.deadline)}` : ""}</div>
        ${actionButtons(task)}
      </div>
    </div>`;
  }).join("");
};

const renderBlocks = () => {
  const el = $("#blocks");
  if (!state.plan) { el.innerHTML = `<span class="muted">Generera dagsplanen först.</span>`; return; }
  const renderBlock = (block) => {
    const items = (block.taskIds || []).map((id) => {
      const task = taskById(id);
      return task ? `<li>${escapeHtml(task.title)} <span class="small-text">${task.estimatedMinutes ? `~${task.estimatedMinutes} min` : ""}</span></li>` : "";
    }).join("");
    return `<div class="block"><h3>${escapeHtml(block.label)} <span class="small-text">(${block.usedMinutes}/${block.budgetMinutes} min)</span></h3>
      <ul class="plain">${items || `<li class="muted">Tomt.</li>`}</ul></div>`;
  };
  const unscheduled = (state.plan.unscheduled || []).map((id) => taskById(id)?.title).filter(Boolean);
  el.innerHTML = renderBlock(state.plan.fmBlock) + renderBlock(state.plan.emBlock) +
    (unscheduled.length ? `<div class="small-text" style="margin-top:8px">Ryms inte idag: ${escapeHtml(unscheduled.join(", "))}</div>` : "");
};

const renderCheckins = () => {
  const summary = state.summary || {};
  $("#midday-computed").innerHTML = `<div class="block"><h3>Läget just nu</h3>
    <ul class="plain">
      <li>Klart idag: ${summary.doneToday?.length ? escapeHtml(summary.doneToday.join(", ")) : "inget ännu"}</li>
      <li>Tillkommit idag: ${summary.addedToday?.length ? escapeHtml(summary.addedToday.join(", ")) : "inget"}</li>
      <li>Blockerat: ${summary.blocked?.length ? summary.blocked.map((b) => `${escapeHtml(b.title)} (<em>${escapeHtml(b.reason)}</em>)`).join(", ") : "inget"}</li>
      <li>Öppna uppgifter kvar: ${summary.stillOpenCount ?? 0}</li>
    </ul></div>`;
  $("#evening-computed").innerHTML = `<div class="block"><h3>Facit för dagen</h3>
    <ul class="plain">
      <li>Blev gjort: ${summary.doneToday?.length ? escapeHtml(summary.doneToday.join(", ")) : "inget markerat klart"}</li>
      <li>Inte gjort (öppna): ${summary.stillOpenCount ?? 0} st</li>
      <li>Blockerat: ${summary.blocked?.length ? summary.blocked.map((b) => `${escapeHtml(b.title)} (<em>${escapeHtml(b.reason)}</em>)`).join(", ") : "inget"}</li>
      <li>Flyttat idag: ${summary.movedToday?.length ? summary.movedToday.map((m) => `${escapeHtml(m.title)} → ${escapeHtml(m.movedToDate || "imorgon")}`).join(", ") : "inget"}</li>
    </ul></div>`;
  for (const [type, formId, noteId] of [["midday", "#midday-form", "#midday-saved"], ["evening", "#evening-form", "#evening-saved"]]) {
    const checkin = state.checkins?.[type];
    const form = $(formId);
    if (checkin?.answers) {
      for (const [key, value] of Object.entries(checkin.answers)) {
        if (form.elements[key]) form.elements[key].value = value;
      }
      $(noteId).textContent = `Sparad ${new Date(checkin.savedAt).toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" })}`;
    }
  }
};

const metricHtml = (label, field, suffix = "") => {
  const missing = !field || !field.present;
  const value = missing ? "Data saknas" : `${field.value}${suffix}`;
  return `<div class="metric"><div class="m-label">${escapeHtml(label)}</div>
    <div class="m-value${missing ? " missing" : ""}">${escapeHtml(String(value))}</div></div>`;
};

const renderNordic = () => {
  const nordic = state.nordic;
  const badge = $("#nordic-badge");
  const banner = $("#nordic-banner");
  const metrics = $("#nordic-metrics");
  const bookingsEl = $("#nordic-bookings");
  const oldestEl = $("#nordic-oldest");
  if (!nordic) return;

  let brief = null;
  let staleNote = "";
  if (nordic.status === "ok") {
    badge.className = "badge ok";
    badge.textContent = `Nordic: OK ${new Date(nordic.fetchedAt).toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" })}`;
    banner.innerHTML = "";
    brief = nordic.brief;
  } else if (nordic.status === "not_configured") {
    badge.className = "badge not_configured";
    badge.textContent = "Nordic: ej konfigurerad";
    banner.innerHTML = `<div class="banner not_configured">Nordic-källan är inte konfigurerad. Sätt miljövariabeln <strong>NORDIC_BRIEF_URL</strong> i <code>nemob-os/.env</code> och starta om servern. Dashboarden fungerar ändå.</div>`;
  } else {
    badge.className = "badge down";
    badge.textContent = "Nordic: NERE";
    const cacheInfo = nordic.cache
      ? `Visar senast hämtade data (${new Date(nordic.cache.fetchedAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}).`
      : "Ingen tidigare data finns cachead.";
    banner.innerHTML = `<div class="banner down">Nordic-källan svarar inte (${escapeHtml(nordic.code || "okänt fel")}). ${cacheInfo} Dashboarden fungerar ändå.</div>`;
    if (nordic.cache) {
      brief = nordic.cache.brief;
      staleNote = " (cachead)";
    }
  }

  if (!brief) {
    metrics.innerHTML = metricHtml("Dagens bokningar", null) + metricHtml("Öppna jobb", null) +
      metricHtml("Försenade offerter", null) + metricHtml("Obetalda fakturor", null) +
      metricHtml("Veckans intäkt", null) + metricHtml("Nya bokningar sedan igår", null);
    bookingsEl.innerHTML = `<h3>Dagens bokningar</h3><span class="muted">Data saknas</span>`;
    oldestEl.innerHTML = `<h3>Äldsta öppna jobb</h3><span class="muted">Data saknas</span>`;
    return;
  }

  const bookingCount = brief.todaysBookings?.present
    ? { present: true, value: brief.todaysBookings.value.length }
    : { present: false };
  metrics.innerHTML =
    metricHtml(`Dagens bokningar${staleNote}`, bookingCount) +
    metricHtml(`Öppna jobb${staleNote}`, brief.openJobsCount) +
    metricHtml(`Försenade offerter${staleNote}`, brief.overdueOffersCount) +
    metricHtml(`Obetalda fakturor${staleNote}`, brief.unpaidInvoicesCount) +
    metricHtml(`Veckans intäkt${staleNote}`, brief.weekRevenueSek, " kr") +
    metricHtml(`Nya bokningar sedan igår${staleNote}`, brief.newBookingsSinceYesterday);

  if (!brief.todaysBookings?.present) {
    bookingsEl.innerHTML = `<h3>Dagens bokningar</h3><span class="muted">Data saknas</span>`;
  } else if (!brief.todaysBookings.value.length) {
    bookingsEl.innerHTML = `<h3>Dagens bokningar</h3><span class="muted">Inga bokningar idag.</span>`;
  } else {
    bookingsEl.innerHTML = `<h3>Dagens bokningar</h3><ul class="plain">` +
      brief.todaysBookings.value.map((b) =>
        `<li><strong>${escapeHtml(b.time || "–")}</strong> ${escapeHtml(b.first_name || "")} · ${escapeHtml(b.vehicle || "")} · ${escapeHtml(b.case_type || "")} <span class="small-text">${escapeHtml(b.status || "")}</span></li>`
      ).join("") + `</ul>`;
  }

  if (!brief.oldestOpenJob?.present) {
    oldestEl.innerHTML = `<h3>Äldsta öppna jobb</h3><span class="muted">Data saknas</span>`;
  } else if (!brief.oldestOpenJob.value) {
    oldestEl.innerHTML = `<h3>Äldsta öppna jobb</h3><span class="muted">Inga öppna jobb.</span>`;
  } else {
    const job = brief.oldestOpenJob.value;
    oldestEl.innerHTML = `<h3>Äldsta öppna jobb</h3>
      <div>${escapeHtml(job.vehicle || "Okänd modell")} — <strong>${job.days_open} dagar öppet</strong> <span class="small-text">(${escapeHtml(job.status || "")})</span></div>`;
  }
};

const renderTasks = () => {
  const container = $("#task-list");
  if (!state.tasks.length) {
    container.innerHTML = `<span class="muted">Inga uppgifter ännu.</span>`;
    return;
  }
  const order = { pagar: 0, ny: 1, planerad: 2, blockerad: 3, flyttad: 4, klar: 5 };
  const sorted = [...state.tasks].sort((a, b) =>
    (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  container.innerHTML = sorted.map((task) => `
    <div class="task-row${task.status === "klar" ? " done" : ""}">
      <div class="t-title">${task.pinned ? "📌 " : ""}${escapeHtml(task.title)}
        <span class="chip">${escapeHtml(areaLabel(task.area))}</span>
        <span class="chip status-${task.status}">${escapeHtml(statusLabel(task.status))}</span>
      </div>
      <div class="t-meta">
        ${task.deadline ? `Deadline: ${escapeHtml(task.deadline)} · ` : ""}
        ${task.estimatedMinutes ? `~${task.estimatedMinutes} min · ` : ""}
        ${task.revenueSek ? `${task.revenueSek} kr · ` : ""}
        ${task.customerWaiting ? "Kund väntar · " : ""}
        ${task.status === "flyttad" && task.movedToDate ? `Flyttad till ${escapeHtml(task.movedToDate)} · ` : ""}
        ${task.nextStep ? `Nästa: ${escapeHtml(task.nextStep)}` : ""}
      </div>
      ${task.blockReason && task.status === "blockerad" ? `<div class="t-block-reason">Blockerad: ${escapeHtml(task.blockReason)}</div>` : ""}
      ${actionButtons(task)}
    </div>`).join("");
};

const render = () => {
  renderMorning();
  renderTop5();
  renderBlocks();
  renderCheckins();
  renderNordic();
  renderTasks();
};

/* ---------- Formulär ---------- */

const fillSelect = (select, options, selected) => {
  select.innerHTML = Object.entries(options)
    .map(([key, label]) => `<option value="${key}"${key === selected ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
};

const initTaskForm = () => {
  const form = $("#task-form");
  fillSelect(form.elements.area, state.meta.areas, "nordic");
  fillSelect(form.elements.status, state.meta.statuses, "ny");
  fillSelect(form.elements.riskLevel, state.meta.riskLevels, "ingen");
};

const formPayload = (form) => ({
  title: form.elements.title.value,
  area: form.elements.area.value,
  status: form.elements.status.value,
  deadline: form.elements.deadline.value.replace("T", " "),
  estimatedMinutes: form.elements.estimatedMinutes.value,
  riskLevel: form.elements.riskLevel.value,
  riskNote: form.elements.riskNote.value,
  impact: form.elements.impact.value,
  revenueSek: form.elements.revenueSek.value,
  customerWaiting: form.elements.customerWaiting.checked,
  customerWaitingSince: form.elements.customerWaitingSince.value,
  blocksOthers: form.elements.blocksOthers.checked,
  nextStep: form.elements.nextStep.value,
});

const startEdit = (id) => {
  const task = taskById(id);
  if (!task) return;
  state.editTaskId = id;
  const form = $("#task-form");
  form.elements.title.value = task.title;
  form.elements.area.value = task.area;
  form.elements.status.value = task.status;
  form.elements.deadline.value = task.deadline ? task.deadline.replace(" ", "T") : "";
  form.elements.estimatedMinutes.value = task.estimatedMinutes ?? "";
  form.elements.riskLevel.value = task.riskLevel;
  form.elements.riskNote.value = task.riskNote || "";
  form.elements.impact.value = task.impact || "";
  form.elements.revenueSek.value = task.revenueSek ?? "";
  form.elements.customerWaiting.checked = task.customerWaiting === true;
  form.elements.customerWaitingSince.value = task.customerWaitingSince || "";
  form.elements.blocksOthers.checked = task.blocksOthers === true;
  form.elements.nextStep.value = task.nextStep || "";
  $("#task-form-heading").textContent = `Redigera: ${task.title}`;
  $("#task-form-submit").textContent = "Spara ändringar";
  $("#task-form-cancel").style.display = "";
  $("#sec-new-task").scrollIntoView({ behavior: "smooth" });
};

const resetTaskForm = () => {
  state.editTaskId = null;
  $("#task-form").reset();
  initTaskForm();
  $("#task-form-heading").textContent = "Ny uppgift";
  $("#task-form-submit").textContent = "Skapa uppgift";
  $("#task-form-cancel").style.display = "none";
};

$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formPayload(event.target);
  try {
    if (state.editTaskId) {
      await api(`/api/tasks/${state.editTaskId}`, { method: "PATCH", body: payload });
    } else {
      await api("/api/tasks", { method: "POST", body: payload });
    }
    resetTaskForm();
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});
$("#task-form-cancel").addEventListener("click", resetTaskForm);

for (const [formId, type] of [["#midday-form", "midday"], ["#evening-form", "evening"]]) {
  $(formId).addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = {};
    for (const el of event.target.querySelectorAll("[name]")) answers[el.name] = el.value;
    try {
      await api("/api/checkins", { method: "POST", body: { type, answers } });
      await loadPlan();
      render();
    } catch (error) {
      alert(error.message);
    }
  });
}

/* ---------- Toppknappar ---------- */

$("#btn-regenerate").addEventListener("click", async () => {
  try {
    await api("/api/plan/generate", { method: "POST" });
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

$("#btn-urgent").addEventListener("click", async () => {
  const result = await openModal("Ny akut uppgift", `
    <label class="field">Titel *<input name="title"></label>
    <label class="field">Vad händer om den missas?<textarea name="riskNote" rows="2"></textarea></label>
    <label class="field">Nästa konkreta steg<input name="nextStep"></label>`);
  if (!result || !result.title?.trim()) return;
  try {
    await api("/api/tasks", {
      method: "POST",
      body: { title: result.title, riskLevel: "akut", riskNote: result.riskNote, nextStep: result.nextStep, area: "ovrigt" },
    });
    await api("/api/plan/generate", { method: "POST" });
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

$("#btn-nordic-refresh").addEventListener("click", async () => {
  await loadNordic();
  render();
});

$("#simulate-down").addEventListener("change", async (event) => {
  await api("/api/dev/simulate-down", { method: "POST", body: { down: event.target.checked } });
  await loadNordic();
  render();
});

/* ---------- Start ---------- */

const boot = async () => {
  tickClock();
  setInterval(tickClock, 1000);
  await loadMeta();
  initTaskForm();
  await Promise.all([loadTasks(), loadPlan(), loadNordic()]);
  render();
};

boot().catch((error) => {
  document.body.insertAdjacentHTML("afterbegin",
    `<div class="banner down">Kunde inte starta dashboarden: ${escapeHtml(error.message)}</div>`);
});
