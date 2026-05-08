(function () {
  if (window.NordicWorkshopChatLoaded) return;
  window.NordicWorkshopChatLoaded = true;

  var endpoint = "/api/workshop-chat";
  var storageKey = "nordic_workshop_chat_draft";
  var topics = [
    { key: "puncture", label: "Punktering / dack" },
    { key: "battery", label: "Batteri / laddar inte" },
    { key: "brakes", label: "Bromsar" },
    { key: "error", label: "Felkod / display" },
    { key: "booking", label: "Vill boka tid" },
    { key: "other", label: "Annat problem" },
  ];

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char];
    });
  }

  function saveDraft() {
    var data = {
      topic: topicInput.value,
      message: messageInput.value,
      name: nameInput.value,
      phone: phoneInput.value,
      model: modelInput.value,
    };
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch (error) {}
  }

  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch (error) { return {}; }
  }

  function clearDraft() {
    try { localStorage.removeItem(storageKey); } catch (error) {}
  }

  var style = document.createElement("style");
  style.textContent = [
    ".nem-chat-launch{position:fixed;right:18px;bottom:18px;z-index:2147483000;border:0;background:#0b5f2a;color:#fff;border-radius:999px;padding:14px 18px;font:800 15px/1.1 Inter,system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.22);cursor:pointer;display:flex;align-items:center;gap:9px}",
    ".nem-chat-launch:focus,.nem-chat-close:focus,.nem-chat-submit:focus,.nem-chat-topic:focus{outline:3px solid rgba(11,95,42,.28);outline-offset:3px}",
    ".nem-chat-launch-dot{width:9px;height:9px;border-radius:50%;background:#67e08a;box-shadow:0 0 0 4px rgba(103,224,138,.22)}",
    ".nem-chat-panel{position:fixed;right:18px;bottom:78px;z-index:2147483000;width:min(390px,calc(100vw - 24px));max-height:min(720px,calc(100vh - 100px));background:#fff;color:#111;border:1px solid #d9e2dc;border-radius:8px;box-shadow:0 22px 70px rgba(0,0,0,.28);overflow:hidden;display:none;font:14px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif}",
    ".nem-chat-panel[data-open=true]{display:block}",
    ".nem-chat-head{background:#102017;color:#fff;padding:16px 18px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
    ".nem-chat-head strong{display:block;font-size:17px;margin-bottom:3px}.nem-chat-head span{display:block;color:#d7eadf;font-size:13px}",
    ".nem-chat-close{border:0;background:rgba(255,255,255,.12);color:#fff;width:34px;height:34px;border-radius:999px;font-size:22px;line-height:1;cursor:pointer}",
    ".nem-chat-body{padding:16px 18px 18px;overflow:auto;max-height:calc(min(720px,100vh - 100px) - 72px)}",
    ".nem-chat-msg{background:#f3f7f4;border:1px solid #dce8df;border-radius:8px;padding:12px;margin:0 0 12px}.nem-chat-msg b{display:block;margin-bottom:3px}",
    ".nem-chat-topics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 12px}.nem-chat-topic{border:1px solid #cfded3;background:#fff;border-radius:8px;padding:10px 9px;text-align:left;font-weight:750;cursor:pointer;color:#17351f}.nem-chat-topic[data-active=true]{border-color:#0b5f2a;background:#e9f6ed;color:#0b5f2a}",
    ".nem-chat-form{display:grid;gap:10px}.nem-chat-form label{font-weight:800;color:#1f2c23;font-size:13px}.nem-chat-form input,.nem-chat-form textarea{width:100%;box-sizing:border-box;border:1px solid #cfd8d1;border-radius:8px;padding:11px 12px;font:15px/1.35 Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#111;background:#fff}.nem-chat-form textarea{min-height:92px;resize:vertical}",
    ".nem-chat-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.nem-chat-hint{font-size:12px;color:#5f6d63;margin:-4px 0 0}.nem-chat-submit{border:0;background:#0b5f2a;color:#fff;border-radius:8px;padding:13px 14px;font-weight:900;cursor:pointer}.nem-chat-submit[disabled]{opacity:.7;cursor:wait}.nem-chat-status{font-size:13px;min-height:20px;color:#33513c}.nem-chat-status[data-error=true]{color:#a12c20}",
    ".nem-chat-honey{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}",
    "@media (max-width:520px){.nem-chat-launch{right:12px;bottom:12px}.nem-chat-panel{right:12px;bottom:68px;width:calc(100vw - 24px)}.nem-chat-row,.nem-chat-topics{grid-template-columns:1fr}}"
  ].join("");
  document.head.appendChild(style);

  var draft = loadDraft();
  var root = document.createElement("div");
  root.innerHTML = [
    '<button class="nem-chat-launch" type="button" aria-controls="nem-chat-panel" aria-expanded="false"><span class="nem-chat-launch-dot" aria-hidden="true"></span><span>Chatta med verkstaden</span></button>',
    '<section class="nem-chat-panel" id="nem-chat-panel" aria-label="Chatta med Nordic E-Mobility" data-open="false">',
    '<div class="nem-chat-head"><div><strong>Fraga verkstaden</strong><span>Lennart svarar nar han ar ledig. Annars aterkommer vi via SMS.</span></div><button class="nem-chat-close" type="button" aria-label="Stang chatten">&times;</button></div>',
    '<div class="nem-chat-body">',
    '<div class="nem-chat-msg"><b>Hej!</b>Skriv vad som hant med din scooter eller elcykel. Lagg garna till modell och bildinfo. Vid akuta arenden: ring 010-138 54 98.</div>',
    '<div class="nem-chat-topics" role="listbox" aria-label="Valj problemtyp"></div>',
    '<form class="nem-chat-form">',
    '<input class="nem-chat-honey" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">',
    '<input type="hidden" name="topic">',
    '<label>Meddelande<textarea name="message" required maxlength="1200" placeholder="Ex: Xiaomi Pro 2, bakdack punktering. Kan jag lamna in idag?"></textarea></label>',
    '<div class="nem-chat-row"><label>Namn<input name="name" maxlength="120" autocomplete="name" placeholder="Ditt namn"></label><label>Telefon<input name="phone" required maxlength="60" inputmode="tel" autocomplete="tel" placeholder="070-123 45 67"></label></div>',
    '<label>Modell / fordon<input name="model" maxlength="160" placeholder="Ex: Xiaomi, Navee, E-Wheels, elcykel"></label>',
    '<p class="nem-chat-hint">Vi skickar detta till verkstaden direkt. Kunduppgifter anvands bara for att kunna svara pa arendet.</p>',
    '<button class="nem-chat-submit" type="submit">Skicka till verkstaden</button>',
    '<div class="nem-chat-status" role="status" aria-live="polite"></div>',
    '</form>',
    '</div></section>'
  ].join("");
  document.body.appendChild(root);

  var launch = root.querySelector(".nem-chat-launch");
  var panel = root.querySelector(".nem-chat-panel");
  var close = root.querySelector(".nem-chat-close");
  var topicWrap = root.querySelector(".nem-chat-topics");
  var form = root.querySelector(".nem-chat-form");
  var topicInput = form.elements.topic;
  var messageInput = form.elements.message;
  var nameInput = form.elements.name;
  var phoneInput = form.elements.phone;
  var modelInput = form.elements.model;
  var honeyInput = form.elements.company;
  var submit = root.querySelector(".nem-chat-submit");
  var status = root.querySelector(".nem-chat-status");

  topics.forEach(function (topic) {
    var button = document.createElement("button");
    button.className = "nem-chat-topic";
    button.type = "button";
    button.textContent = topic.label;
    button.dataset.key = topic.key;
    button.addEventListener("click", function () {
      topicInput.value = topic.key;
      Array.prototype.forEach.call(topicWrap.querySelectorAll(".nem-chat-topic"), function (item) {
        item.dataset.active = item === button ? "true" : "false";
      });
      messageInput.focus();
      saveDraft();
    });
    topicWrap.appendChild(button);
  });

  topicInput.value = draft.topic || "other";
  messageInput.value = draft.message || "";
  nameInput.value = draft.name || "";
  phoneInput.value = draft.phone || "";
  modelInput.value = draft.model || "";
  Array.prototype.forEach.call(topicWrap.querySelectorAll(".nem-chat-topic"), function (item) {
    item.dataset.active = item.dataset.key === topicInput.value ? "true" : "false";
  });

  function setOpen(open) {
    panel.dataset.open = open ? "true" : "false";
    launch.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) setTimeout(function () { messageInput.focus(); }, 50);
  }

  launch.addEventListener("click", function () { setOpen(panel.dataset.open !== "true"); });
  close.addEventListener("click", function () { setOpen(false); });
  [messageInput, nameInput, phoneInput, modelInput].forEach(function (input) {
    input.addEventListener("input", saveDraft);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    status.dataset.error = "false";
    status.textContent = "";
    if (honeyInput.value) return;
    if (!messageInput.value.trim() || !phoneInput.value.trim()) {
      status.dataset.error = "true";
      status.textContent = "Skriv meddelande och telefonnummer sa verkstaden kan svara.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Skickar...";
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topicInput.value || "other",
        message: messageInput.value,
        name: nameInput.value,
        phone: phoneInput.value,
        model: modelInput.value,
        page: location.href,
        title: document.title,
      }),
    })
      .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data && result.data.error ? result.data.error : "Kunde inte skicka chatten.");
        clearDraft();
        form.reset();
        topicInput.value = "other";
        Array.prototype.forEach.call(topicWrap.querySelectorAll(".nem-chat-topic"), function (item) {
          item.dataset.active = item.dataset.key === "other" ? "true" : "false";
        });
        status.dataset.error = "false";
        status.innerHTML = "Klart. Verkstaden har fatt din fraga. Om Lennart inte svarar direkt aterkommer vi via SMS eller telefon.";
      })
      .catch(function (error) {
        status.dataset.error = "true";
        status.textContent = error.message || "Kunde inte skicka just nu. Ring 010-138 54 98.";
      })
      .finally(function () {
        submit.disabled = false;
        submit.textContent = "Skicka till verkstaden";
      });
  });
})();
