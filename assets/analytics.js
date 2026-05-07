(function () {
  var config = window.NORDIC_ANALYTICS || {};
  var measurementId = config.ga4MeasurementId || "G-WR90FZDZ4S";
  var gtmContainerId = config.gtmContainerId || "";
  var debugMode = Boolean(config.debugMode);
  var lastTrackedPath = "";

  if (!measurementId || window.__nordicAnalyticsLoaded) return;
  window.__nordicAnalyticsLoaded = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: false,
    debug_mode: debugMode
  });

  function trackPageView(path) {
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

  loadScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId), "nordic-ga4");

  if (gtmContainerId) {
    window.dataLayer.push({
      "gtm.start": new Date().getTime(),
      event: "gtm.js"
    });
    loadScript("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(gtmContainerId), "nordic-gtm");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      trackPageView();
    });
  } else {
    trackPageView();
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
})();
