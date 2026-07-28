"use strict";

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character],
);

const state = {
  query: "",
  results: [],
  selected: new Set(),
  feedbackCount: 0,
};

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Fel (${response.status})`);
  return body;
};

const confidenceLabel = (confidence) => ({
  "bekräftad": "Bekräftat",
  "trolig": "Troligt",
  "obekräftad": "Obekräftat",
})[confidence] || "Obekräftat";

const listField = (label, items, emptyText = "Inte dokumenterat i kanon.") => {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  return `<div class="knowledge-field"><strong>${escapeHtml(label)}</strong>${
    values.length
      ? `<ul class="knowledge-list">${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<div class="knowledge-empty">${escapeHtml(emptyText)}</div>`
  }</div>`;
};

const textField = (label, value, emptyText = "Inte dokumenterat i kanon.") =>
  `<div class="knowledge-field"><strong>${escapeHtml(label)}</strong><div>${
    value ? escapeHtml(value) : `<span class="knowledge-empty">${escapeHtml(emptyText)}</span>`
  }</div></div>`;

const evidenceHtml = (references) => {
  const items = (references || []).map((reference) => {
    const parts = [];
    if (reference.file) parts.push(`fil ${escapeHtml(reference.file)}`);
    if (reference.jsonlLine !== null) parts.push(`rad ${escapeHtml(reference.jsonlLine)}`);
    if (reference.turns?.length) parts.push(`tur ${reference.turns.map(escapeHtml).join(", ")}`);
    if (reference.date) parts.push(escapeHtml(reference.date));
    if (reference.batch) parts.push(escapeHtml(reference.batch));
    if (reference.role) parts.push(`evidens ${escapeHtml(reference.role)}`);
    if (reference.rawLineSha256) {
      parts.push(`SHA-256 <code>${escapeHtml(reference.rawLineSha256)}</code>`);
    }
    return parts.join(" · ");
  });
  if (!items.length) return listField("Evidensreferenser", []);
  return `<div class="knowledge-field"><strong>Evidensreferenser</strong>
    <ul class="knowledge-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul>
  </div>`;
};

const matchReasonsHtml = (reasons) => {
  const items = (reasons || []).map((reason) => {
    const fuzzy = reason.match === "fuzzy"
      ? " (tolererad stavningsavvikelse)"
      : reason.match === "prefix"
        ? " (ordvariant)"
        : "";
    return `${reason.term}: ${reason.fields.join(", ")}${fuzzy}`;
  });
  return listField("Varför posten matchade", items, "Ingen matchförklaring.");
};

const renderSelection = () => {
  const selectedTitles = state.results
    .filter((result) => state.selected.has(result.id))
    .map((result) => result.title);
  $("#feedback-selected").innerHTML = selectedTitles.length
    ? `<strong>Valda kunskapsenheter:</strong> ${selectedTitles.map(escapeHtml).join(", ")}`
    : "Inga kunskapsenheter valda.";
};

const renderResults = (data) => {
  const container = $("#knowledge-results");
  state.results = data.results || [];
  state.selected.clear();
  renderSelection();
  if (!state.results.length) {
    container.innerHTML = '<p class="muted knowledge-no-results">Ingen relevant historisk kunskap hittades.</p>';
    return;
  }

  container.innerHTML =
    `<p class="small-text knowledge-count">${state.results.length} träff(ar)</p>` +
    state.results.map((result) => {
      const identity = [...(result.brands || []), ...(result.models || [])].join(" · ");
      const codes = (result.errorCodes || []).map((code) =>
        `<span class="chip">${escapeHtml(code)}</span>`).join("");
      const safety = result.safetyCritical
        ? `<div class="safety-notice">
            <strong>Säkerhetskritiskt</strong>
            Säkerhetskritisk åtgärd. Kräver manuell riskbedömning och dokumenterad kontroll.
          </div>`
        : "";
      return `<article class="knowledge-card">
        <div class="knowledge-heading">
          <div>
            <h3>${escapeHtml(result.title || "Kunskapsenhet")}</h3>
            <div class="knowledge-identity">${escapeHtml(identity || "Märke/modell ej dokumenterat")}</div>
          </div>
          <label class="check knowledge-select">
            <input type="checkbox" data-knowledge-id="${escapeHtml(result.id)}">
            Välj för feedback
          </label>
        </div>
        <div class="knowledge-meta">
          <span class="chip confidence-${escapeHtml(result.confidence)}">${escapeHtml(confidenceLabel(result.confidence))}</span>
          ${result.safetyCritical ? '<span class="chip safety-chip">Säkerhetskritiskt</span>' : ""}
          ${codes}
        </div>
        <div class="historical-notice">Historiskt verkstadsfall – verifiera med mätning innan åtgärd.</div>
        ${safety}
        <div class="knowledge-grid">
          ${listField("Symptom", result.symptoms)}
          ${listField("Felkod", result.errorCodes)}
          ${listField("Relevanta mätvärden", result.measurements)}
          ${listField("Komponenter", result.components)}
          ${listField("Föreslagen testordning", result.testOrder)}
          ${listField("Misstänkta orsaker", result.suspectedCauses, "Ingen misstänkt orsak separat dokumenterad.")}
          ${textField("Bekräftad orsak", result.confirmedCause, "Ingen bekräftad orsak finns.")}
          ${textField("Utförd åtgärd", result.repairPerformed, "Ingen utförd åtgärd är verifierad.")}
          ${listField("Verifierat utfall", result.verifiedOutcome, "Inget verifierat utfall finns.")}
          ${evidenceHtml(result.evidenceReferences)}
          ${matchReasonsHtml(result.matchReasons)}
        </div>
      </article>`;
    }).join("");

  container.querySelectorAll("[data-knowledge-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selected.add(checkbox.dataset.knowledgeId);
      else state.selected.delete(checkbox.dataset.knowledgeId);
      renderSelection();
    });
  });
};

const loadStatus = async () => {
  const statusElement = $("#knowledge-status");
  const badge = $("#knowledge-stats");
  try {
    const status = await api("/api/repair-intelligence/status");
    state.feedbackCount = status.feedback?.count || 0;
    if (status.status !== "ready") {
      badge.className = "badge down";
      badge.textContent = "Kanon ej tillgänglig";
      statusElement.innerHTML = `<div class="banner down">${escapeHtml(status.message || "Kanonfilen är inte tillgänglig.")}</div>`;
      return false;
    }
    badge.className = "badge ok";
    badge.textContent = `${status.unitCount} kunskapsenheter`;
    statusElement.innerHTML = `<div class="banner ready">
      Kanon ${escapeHtml(status.version || "")} inläst read-only ·
      SHA-256 <code>${escapeHtml(status.sha256)}</code> ·
      ${escapeHtml(state.feedbackCount)} lokala feedbackposter.
    </div>`;
    return true;
  } catch (error) {
    badge.className = "badge down";
    badge.textContent = "Kanon ej tillgänglig";
    statusElement.innerHTML = `<div class="banner down">${escapeHtml(error.message)}</div>`;
    return false;
  }
};

const search = async () => {
  const query = $("#knowledge-query").value.trim();
  if (query.length < 2) {
    $("#knowledge-results").innerHTML = '<p class="muted">Skriv minst två tecken.</p>';
    return;
  }
  state.query = query;
  $("#feedback-saved").textContent = "";
  $("#knowledge-results").innerHTML = '<p class="muted">Söker…</p>';
  try {
    renderResults(await api(`/api/repair-intelligence/search?q=${encodeURIComponent(query)}&limit=20`));
  } catch (error) {
    state.results = [];
    state.selected.clear();
    renderSelection();
    $("#knowledge-results").innerHTML = `<div class="banner down">${escapeHtml(error.message)}</div>`;
  }
};

$("#knowledge-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  search();
});

$("#feedback-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    query: state.query || $("#knowledge-query").value.trim(),
    selectedKnowledgeUnits: [...state.selected],
    assessment: form.elements.assessment.value,
    technicalComment: form.elements.technicalComment.value,
    proposedKnowledge: form.elements.proposedKnowledge.value,
  };
  try {
    const result = await api("/api/repair-intelligence/feedback", {
      method: "POST",
      body: payload,
    });
    state.feedbackCount = result.count;
    $("#feedback-saved").textContent = `Sparad lokalt ${new Date(result.date).toLocaleString("sv-SE")}.`;
    form.elements.technicalComment.value = "";
    form.elements.proposedKnowledge.value = "";
    await loadStatus();
  } catch (error) {
    $("#feedback-saved").textContent = error.message;
  }
});

loadStatus();
