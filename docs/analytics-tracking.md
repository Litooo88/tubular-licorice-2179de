# Analytics tracking

## Current GA4 property

- GA4 Measurement ID: `G-WR90FZDZ4S`
- Live site target: `https://www.nordicemobility.se`
- Implementation type: static Netlify site with a shared browser loader

If Google Analytics shows the property name as `www.nordicemobility.com`, rename the property/data stream in GA4 so the visible name matches `nordicemobility.se`. Do not create a new property just to fix the name unless the Measurement ID is wrong.

## Where tracking is installed

The shared loader is:

- `/assets/analytics.js`

Every published `index.html` includes this config before `</head>`:

```html
<script>
window.NORDIC_ANALYTICS={ga4MeasurementId:"G-WR90FZDZ4S",gtmContainerId:"",debugMode:new URLSearchParams(window.location.search).has("ga_debug")};
</script>
<script src="/assets/analytics.js" defer></script>
```

The loader initializes GA4 once, disables the automatic config page view, and sends manual `page_view` events for:

- initial page load
- `history.pushState`
- `history.replaceState`
- browser back/forward navigation

This supports future client-side route changes without double-counting normal static page loads.

## Change Measurement ID

Change `ga4MeasurementId` in the page config from `G-WR90FZDZ4S` to the new ID.

Also update the fallback ID in `/assets/analytics.js` so pages still work if a config is missed.

## Future Google Tag Manager

When a GTM container exists, set `gtmContainerId`:

```js
window.NORDIC_ANALYTICS={ga4MeasurementId:"G-WR90FZDZ4S",gtmContainerId:"GTM-XXXXXXX",debugMode:new URLSearchParams(window.location.search).has("ga_debug")};
```

If GA4 is later managed fully inside GTM, remove or disable the direct GA4 page-view send in `/assets/analytics.js` to avoid duplicate Analytics traffic.

## Microsoft Clarity

Create a Clarity project and install the official Clarity snippet once through a shared static loader, similar to `/assets/analytics.js`.

Do not paste separate Clarity snippets manually into random pages. Keep tracking integrations centralized.

## Google Search Console

Preferred verification options:

- DNS TXT verification for the domain property
- existing uploaded verification file at the site root
- a single meta tag in the global/static page heads

Search Console does not replace GA4 and does not send page-view analytics events.

## Sebastian realtime check after deploy

1. Open GA4 with the account that has access to the property using `G-WR90FZDZ4S`.
2. Go to Reports > Realtime.
3. Open `https://www.nordicemobility.se/book-online/?ga_debug=1` in a normal browser tab.
4. Open `https://www.nordicemobility.se/kontakt/?ga_debug=1`.
5. Confirm active user and `page_view` events appear within 10-60 seconds.

For detailed event checks, go to Admin > Data display > DebugView and use the same `?ga_debug=1` URLs.

If nothing appears after deploy, check browser DevTools > Network for:

- `https://www.googletagmanager.com/gtag/js?id=G-WR90FZDZ4S`
- a GA4 collect request to `google-analytics.com/g/collect` or `region1.google-analytics.com/g/collect`
