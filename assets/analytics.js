(function () {
  var config = window.NORDIC_ANALYTICS || {};
  var measurementId = config.ga4MeasurementId || "G-WR90F2DZ4S";
  var gtmContainerId = config.gtmContainerId || "";
  var debugMode = Boolean(config.debugMode);
  var lastTrackedPath = "";

  if (!measurementId || window.__nordicAnalyticsLoaded) return;
  window.__nordicAnalyticsLoaded = true;

  // Samtyckesgrind (PTS/GDPR): GA4 laddas ALDRIG före aktivt samtycke.
  // Valet lagras i localStorage (endast själva valet — ingen kunddata).
  var CONSENT_KEY = "nordic-cookie-consent";
  var analyticsStarted = false;

  function readConsent() {
    try { return window.localStorage.getItem(CONSENT_KEY) || ""; } catch (e) { return ""; }
  }
  function saveConsent(value) {
    try { window.localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* privat läge */ }
  }

  function trackPageView(path) {
    if (!analyticsStarted) return;
    var pagePath = path || window.location.pathname + window.location.search;
    if (pagePath === lastTrackedPath) return;
    lastTrackedPath = pagePath;

    window.gtag("event", "page_view", {
      page_title: document.title,
      page_location: window.location.href,
      page_path: pagePath,
      send_to: measurementId,
      debug_mode: debugMode
    });
  }

  function loadScript(src, id) {
    if (id && document.getElementById(id)) return;
    var script = document.createElement("script");
    script.async = true;
    if (id) script.id = id;
    script.src = src;
    document.head.appendChild(script);
  }

  function startAnalytics() {
    if (analyticsStarted) return;
    analyticsStarted = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () {
      window.dataLayer.push(arguments);
    };

    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      send_page_view: false,
      debug_mode: debugMode
    });

    loadScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId), "nordic-ga4");

    if (gtmContainerId) {
      window.dataLayer.push({
        "gtm.start": new Date().getTime(),
        event: "gtm.js"
      });
      loadScript("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(gtmContainerId), "nordic-gtm");
    }

    lastTrackedPath = "";
    trackPageView();
  }

  function removeBanner() {
    var banner = document.getElementById("nordicConsentBanner");
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
  }

  function showBanner() {
    if (document.getElementById("nordicConsentBanner")) return;
    var banner = document.createElement("div");
    banner.id = "nordicConsentBanner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Cookieinställningar");
    banner.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:11000;max-width:520px;margin:0 auto;background:#0d120e;border:1px solid #2c3830;border-radius:10px;padding:16px;color:#dfe6e1;font-size:13px;line-height:1.5;box-shadow:0 18px 50px rgba(0,0,0,.5)";
    banner.innerHTML =
      '<p style="margin:0 0 10px"><strong style="color:#fff">Cookies för statistik.</strong> Vi vill använda Google Analytics för att förstå hur sajten används. Inga statistikcookies sätts förrän du godkänner. Nödvändiga funktioner påverkas inte. <a href="/integritet/" style="color:#7ee2a8">Läs mer i integritetspolicyn</a>.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" id="nordicConsentAccept" style="flex:1;min-height:42px;padding:0 14px;border-radius:8px;border:1px solid #00c853;background:#00c853;color:#031006;font:inherit;font-weight:800;cursor:pointer">Acceptera statistik</button>' +
      '<button type="button" id="nordicConsentReject" style="flex:1;min-height:42px;padding:0 14px;border-radius:8px;border:1px solid #4a564e;background:transparent;color:#dfe6e1;font:inherit;font-weight:800;cursor:pointer">Avvisa</button>' +
      "</div>";
    document.body.appendChild(banner);
    document.getElementById("nordicConsentAccept").addEventListener("click", function () {
      saveConsent("accepted");
      removeBanner();
      startAnalytics();
    });
    document.getElementById("nordicConsentReject").addEventListener("click", function () {
      saveConsent("rejected");
      removeBanner();
    });
  }

  function injectSettingsLink() {
    var footer = document.querySelector(".legal-footer");
    if (!footer || document.getElementById("nordicConsentSettings")) return;
    var link = document.createElement("a");
    link.id = "nordicConsentSettings";
    link.href = "#";
    link.textContent = "Cookieinställningar";
    link.style.cssText = "display:inline-block;margin-top:6px;color:inherit;text-decoration:underline";
    link.addEventListener("click", function (event) {
      event.preventDefault();
      showBanner();
    });
    footer.appendChild(document.createElement("br"));
    footer.appendChild(link);
  }

  function initConsent() {
    injectSettingsLink();
    var consent = readConsent();
    if (consent === "accepted") {
      startAnalytics();
    } else if (consent !== "rejected") {
      showBanner();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initConsent);
  } else {
    initConsent();
  }

  ["pushState", "replaceState"].forEach(function (method) {
    var original = history[method];
    history[method] = function () {
      var result = original.apply(this, arguments);
      window.setTimeout(function () {
        trackPageView();
      }, 0);
      return result;
    };
  });

  window.addEventListener("popstate", function () {
    trackPageView();
  });

  window.NORDIC_ANALYTICS.trackPageView = trackPageView;
  window.NORDIC_ANALYTICS.openConsentSettings = showBanner;
})();
