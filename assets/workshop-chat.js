(function () {
  // Hemsidans chatt = Nova, samma ElevenLabs-agent som svarar i telefon.
  //
  // Varför: den gamla formulärchatten (workshop-chat-legacy.js) skapade bara
  // ett ärende och tvingade Sebastian att svara via SMS i efterhand — "helt
  // värdelös" (2026-10-07). Nova svarar direkt, i text eller röst, med samma
  // verktyg och samma regler som i telefon: priser, status, tider, meddelande
  // till Sebastian, telefonmöte. Inget kundinnehåll sparas i localStorage.
  //
  // Widgeten laddas från ElevenLabs CDN. Agent-id är publikt per design
  // (det syns i varje sida) och ger ingen åtkomst till något; säkerheten
  // ligger i agentens tillåtna domäner i ElevenLabs och i våra verktygs
  // hemlighet på serversidan.
  if (window.NordicWorkshopChatLoaded) return;
  window.NordicWorkshopChatLoaded = true;

  var AGENT_ID = "agent_7501m4a5b9d7fnftyzxeqhx7tq5s";
  var WIDGET_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";

  // Admin och interna sidor ska inte ha kundchatten.
  var path = String(window.location.pathname || "");
  if (/^\/(admin|status|nemob-os)(\/|$)/.test(path)) return;

  function mount() {
    if (document.querySelector("elevenlabs-convai")) return;
    var widget = document.createElement("elevenlabs-convai");
    widget.setAttribute("agent-id", AGENT_ID);
    // Texten i knappen/bubblan innan samtalet startar. Övrig text och färg
    // styrs i ElevenLabs under Widget-fliken på agenten.
    widget.setAttribute("action-text", "Fråga Nova");
    widget.setAttribute("start-call-text", "Prata med Nova");
    widget.setAttribute("end-call-text", "Avsluta");
    widget.setAttribute("expand-text", "Öppna chatten");
    widget.setAttribute("listening-text", "Nova lyssnar…");
    widget.setAttribute("speaking-text", "Nova pratar…");
    document.body.appendChild(widget);

    var script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.type = "text/javascript";
    document.body.appendChild(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
