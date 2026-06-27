# Codex handoff - Nordic E-Mobility

This file is the first stop for any new Codex session on this project.

Keep it current. When a larger feature, rescue operation, deploy-sensitive fix, admin workflow change, payment change, or data-model change is made, update this file in the same PR before handing work back to Sebastian.

## Hard rules

- Work in the real repo only: `E:\nordic-emobility-github-push` or its future renamed path `E:\nordic-emobility-site`.
- Never work in `C:\Users\Sebas\Downloads\nordic-emobility-site\working\`.
- Never create new production edits under a nested `working\` folder.
- Before changing code: `git fetch origin`, switch to `main`, pull fast-forward, then create a new branch.
- Use focused branches, commit intentionally, push to GitHub, and open a PR against `main`.
- Do not revert unrelated local files or old temp files unless Sebastian explicitly asks.
- If a change affects admin, bookings, payments, notifications, Netlify Functions, or data shape, run syntax/build checks and update this handoff.

## Current project state

- The May 1 booking confirmation work was rescued from Downloads and merged.
- Booking confirmation now has structured send status for SMS/email/workshop alert and confirmation flags.
- Admin route collision was fixed by disabling the rescued duplicate `cases.mjs` route; live admin cases API is `netlify/functions/workshop-cases.mjs` at `/api/cases`.
- Public customer scooter/showroom image section was removed from the public website. Customer images/content support must stay internal to admin.
- Stripe product Checkout does not use `automatic_payment_methods`; live Stripe returned `parameter_unknown`. The function uses explicit `payment_method_types` attempts and falls back from Klarna/card/rabattkod/policy text to lean card-only params if Stripe rejects optional fields.
- The public price list and booking service prices were aligned with Sebastian's provided workshop pricing.
- Admin has a first version of a price database and touch-friendly POS/pricing workflow.
- Admin can be installed as a browser app on the workshop Windows touch computer through `/admin/`.
- Admin has an overview tab with an active case list, operator tracking for future edits, and a protected live call dashboard backed by `/api/call-dashboard`.
- Call dashboard now creates persistent `call-leads` for missed calls, voicemail calls, Verkstaden calls without a customer card, and long calls without a customer card. Admin can create a customer card from a lead and ignore it. Live discount/follow-up SMS requires explicit `action: "send_discount"` plus `confirmLiveSms: true`; missing action no longer defaults to SMS send.
- AI/admin safety hardening from June 27 is merged: protected media requires `x-admin-token`, public booking diagnostics no longer expose provider detail, shared admin token comparison is timing-safe, AI SMS dry-run skips writes, timeline falls back to `/api/cases`, and old rescue cases route returns `410`.
- Product Stripe Checkout now uses a server-controlled origin for return URLs and includes product metadata. `/.netlify/functions/stripe-webhook` verifies `STRIPE_WEBHOOK_SECRET` and stores verified `checkout.session.completed` events in `payments`. It is inactive with `503` until the secret is configured.
- Public booking and workshop chat intake now have honeypot/rate-limit guards and idempotency mappings to avoid duplicate case/calendar/notification side effects on retries or double submits.
- Netlify read-only check on 2026-06-27 found the production site `nordicemobility` deployed and `ready`, but `STRIPE_WEBHOOK_SECRET` was not configured. Stripe payment confirmation is therefore still webhook-inactive until Sebastian adds the real Stripe signing secret and connects the Stripe Dashboard webhook to `/.netlify/functions/stripe-webhook`.
- The same Netlify check showed some sensitive operational variables were not marked as secret in Netlify metadata. Do not print or copy values into docs or commits. Recommended follow-up is to rotate sensitive values, mark them secret in Netlify, and then run an authenticated production smoke test.

## Important files

- `admin/index.html` - main workshop admin, cases board, price database, POS/pricing workflow, content tooling.
- `admin/manifest.webmanifest` - makes admin installable as a browser app.
- `admin/service-worker.js` - caches the admin shell, but API data remains live.
- `book-online/index.html` - customer booking flow and service choices.
- `index.html` - public homepage and public price list.
- `netlify/functions/booking.mjs` - booking creation, notifications, calendar handling, case creation.
- `netlify/functions/workshop-cases.mjs` - live `/api/cases` admin endpoint.
- `netlify/functions/call-dashboard.mjs` - protected `/api/call-dashboard` endpoint; reads 46elks calls, matches cases, creates call leads, can create customer cards from call leads, ignore leads, and send lost-lead discount SMS.
- `netlify/functions/price-catalog.mjs` - live `/api/price-catalog` endpoint backed by Netlify Blobs.
- `netlify/functions/create-checkout.js` - Stripe Checkout for scooter purchases.
- `netlify/functions/stripe-webhook.js` - signed Stripe webhook for verified checkout payment records.
- `netlify/functions/cases.mjs` - disabled rescue endpoint; should return `410` and not be used for live admin.
- `netlify.toml` and `_redirects` - Netlify routing/config.

## Architecture notes

- Admin auth uses `ADMIN_TOKEN` sent as `x-admin-token`.
- Workshop cases are stored in Netlify Blobs store `workshop-cases`.
- Call leads are stored in Netlify Blobs store `call-leads`; discount follow-ups are stored in `call-followups`.
- Booking idempotency keys are stored in `booking-idempotency`; workshop chat idempotency keys are stored in `workshop-chat-idempotency`.
- Stripe webhook payment records are stored in `payments`.
- Price catalog is stored in Netlify Blobs store `price-catalog`.
- `/api/cases` supports listing, patching, deleting cases, and stores completion/payment/content fields.
- `/api/price-catalog` supports GET and PUT/POST of price rows.
- Booking flow creates cases and should send customer SMS, customer email, workshop SMS, workshop email, and calendar event when configured.
- POS/pricing workflow currently writes selected price rows into case fields:
  - `completion.totalCost`
  - `completion.workSummary`
  - `completion.invoiceText`
  - `completion.readyForFortnox`
  - `payment.amount`
  - `payment.status`
  - `payment.method`
  - `payment.reference`
- Fortnox is not live-integrated yet. Current Fortnox support is article-number fields and copyable invoice/faktura text.

## Business rules

- Customer images are internal content support only and must not become a public gallery/showroom without explicit approval.
- Customers must see clear start prices before booking.
- Workshop must confirm final price before work when the final cost may differ.
- Price rows should include Fortnox article numbers when known, to prepare for future sync.
- Klarna/payment methods should be enabled in Stripe Dashboard, not hardcoded one by one unless there is a specific reason.
- The workshop touch computer is expected to stay logged into admin, so avoid risky one-click destructive actions.
- Admin flows should minimize duplicate sends and accidental customer notifications.

## Operational roles

Sebastian = admin/owner.
- Can edit price database.
- Can close cases.
- Can send payment instructions.
- Can change final prices.
- Can manage Fortnox/export/payment preparation.

Verkstaden = workshop operator.
- Should primarily use /workshop.
- Should see only what is needed to perform work.
- Should not edit the price database.
- Should not send final payment messages unless explicitly allowed.
- Should document work with photos and short notes.
- Should mark cases as “Ready for Sebastian review” before final customer communication.

## Core UI routes

/admin
- Full case overview and admin control.

/workshop
- Simplified touch-friendly workshop mode for Verkstaden.
- Shows active/inlämnade jobs.
- Focus: what to do, photos, short notes, next status.

/checkout
- Final payment/receipt flow.
- Used when job is done or customer pays.

/prices
- Admin-only price database.
- Not part of normal workshop flow.

/quick-price
- Simple price calculator for drop-in customers.
- Used to give correct estimated price without modifying the full price database.

## Recent merged work

### Admin view split - Task 1 in progress

- Started splitting the previous "everything on one page" admin into purpose-specific routes.
- `/admin/` is now intended to be full case overview/admin control only.
- `/prices/` owns price database editing.
- `/checkout/` owns final payment/receipt flow and reads price rows without editing the catalog.
- `/workshop/` and `/quick-price/` have route shells for the next focused implementation tasks.
- Continue incrementally: build `/quick-price` next, then `/workshop`, then harden `/checkout`.

### Quick price - Task 2

- `/quick-price/` is the drop-in estimate tool.
- It reads active rows from `/api/price-catalog`; do not hardcode service prices here.
- It can build a temporary estimate, copy estimate text, generate copyable SMS text when phone is present, and create an internal case from the estimate.
- Creating a quick-price case uses `POST /api/cases` and stores selected price rows on `completion.priceRows`.
- It must not send SMS automatically.
- It must not edit the price catalog.

### Workshop mode - Task 3

- `/workshop/` is Verkstaden's simplified daily work mode.
- It shows active/inlamnade cases only and excludes price database, final checkout controls, and customer message buttons.
- Each collapsed job card shows customer contact info first and a clear `Starta` button.
- Opening a job pauses auto-refresh so Verkstaden is not bounced back to the top while typing or scrolling.
- Expanded jobs use a step-by-step workflow: start work, check approved boundaries, quick documentation buttons, photos, and final status actions.
- Each job shows customer, model, problem, approved work, "do not do without approval", and next action.
- Photo workflow uses existing `/api/cases/:id/media` with internal categories `before`, `during`, and `after`.
- Short workshop log is stored on `case.workshop`:
  - `workDone`
  - `partsUsed`
  - `issuesFound`
  - `nextAction`
  - `needsSebastianReview`
  - `reviewRequestedAt`
- "Needs Sebastian review" sets `workshop.needsSebastianReview=true`, stores an internal note, and adds a timeline event.

### Booking confirmation rescue

- Rescued `booking.mjs`.
- Added/kept structured booking notification status.
- Added confirmation sent/missing flags.
- Added customer SMS/email templates and workshop notifications.
- Added pickup flow parameters.

### Admin and public cleanup

- Fixed `/api/cases` collision by keeping `workshop-cases.mjs` as the active route.
- Removed public customer scooter image/showroom section.

### Payments and booking prices

- Switched Stripe Checkout to dynamic/automatic payment methods.
- Business payment details for workshop/customer-card checkout are Swish foretag `123 240 6775` (recipient shown as `Nordic E-Mobility`) and bankgiro `5290-5494`.
- `/checkout/` has a `Skicka betal-SMS` action. It sends amount, Swish foretag, bankgiro, and case reference through `/api/cases` action `send_payment_instruction`.
- Stripe product Checkout explicitly tries `card` + `klarna` first and `card` as fallback. Apple Pay, Google Pay, card wallets, Klarna, and similar methods still depend on Stripe Dashboard/payment-method eligibility, domain verification, device/browser support, and order eligibility.
- Do not reintroduce `automatic_payment_methods` in `netlify/functions/create-checkout.js`; it caused live `parameter_unknown` errors and customer-facing fallback alerts.
- Product image/media clicks must open product info/gallery, not start Checkout. Only explicit product buy/order buttons should carry `data-product`.
- Checkout regression guard: run `npm run verify:checkout-products` before shipping product/payment changes. It verifies every rendered `data-product` exists in the Netlify checkout loader, every checkout product renders on the site, no image/media starts checkout, and no one-off Stripe fallback link bypasses the shared checkout flow.
- `netlify/functions/create-checkout.js` must import `../../data/products.json` with `require(...)`; do not read it via runtime filesystem paths, because Netlify bundling can otherwise deploy the function without the JSON file and cause ENOENT for all products.
- Updated booking service cards and backend estimates:
  - Punktering/dack: from 349 kr
  - Service/genomgang: from 395 kr
  - Felsokning: from 395 kr
  - Batteri/BMS/controller: from 745 kr
  - Osaker/bedom pa verkstad: estimate 0
  - Hamta fardig scooter: estimate 0
- Updated addon `tire-sealant` to 99 kr.

### Price database and POS

- Added `netlify/functions/price-catalog.mjs`.
- Seeded initial workshop catalog from the approved pricing.
- Added admin price database panel.
- Added POS/pricing panel for attaching price rows to a case.
- Added save-as-quote and register-paid-and-close flows.
- Added installable admin browser app support.

### Sprint 1 public fixes

- Corrected legal wording from `Nordic E-Mobility AB` to `Nordic E-Mobility`.
- Footers include org.nr, VAT, F-skatt, and address.
- Removed Wix logo hotlinks and use local logo assets.
- Product/order buttons route to `/book-online?service=bestallning&modell=...`.
- `/book-online/` prefills order/service/model fields from URL parameters.
- Added `AutomotiveBusiness` JSON-LD on main public pages.
- Repaired public text encoding after mojibake appeared on live pages.

### Admin SMS and quote flow

- `/admin/` has a top-level `SMS till kund` panel with customer/case dropdown, templates, free text, copy draft, and send.
- Manual SMS sends use `PATCH /api/cases/:id` with `action: "send_sms"`.
- Customer cards have `Prisförslag via SMS` in the contact tab for diagnosis/quote flows.
- Quote SMS sends use `PATCH /api/cases/:id` with `action: "send_quote_sms"`.
- Quote data is stored on `case.quote`.
- Outbound SMS logs are stored on `case.outboundMessages`.
- Timeline records manual SMS and quote SMS attempts.
- Important: if `SMS_FROM` is `NordicEMob` or another alphanumeric sender, customers generally cannot reply to the SMS. Two-way replies require a 46elks virtual number and an inbound webhook/inbox flow.

### GA4 tracking install

- GA4 is installed through the shared static loader `/assets/analytics.js`.
- Current Measurement ID is `G-WR90F2DZ4S`.
- Every published `index.html` includes `window.NORDIC_ANALYTICS` config and the shared loader before `</head>`.
- The loader sends manual `page_view` events for initial page load and future history route changes.
- GTM support is prepared through `gtmContainerId` in the same config, but no GTM container is active yet.
- Operational notes and Sebastian verification steps live in `docs/analytics-tracking.md`.

### 46elks voice fallback

- Added `/api/voice-start` in `netlify/functions/voice-start.mjs` for incoming 46elks calls.
- Current public 46elks fixed voice number is `+46101385498`.
- Flow is Sebastian first, then Verkstaden fallback, then optional missed-call SMS if both miss the call.
- Sebastian/Verkstaden routing numbers must be configured through Netlify env vars; private mobile fallbacks are not stored in the repo. Default timeout is 18 seconds per person.
- Override with Netlify env vars `VOICE_CALLER_ID`, `VOICE_SEBASTIAN_PHONE`, `VOICE_WORKSHOP_PHONE`, `VOICE_TIMEOUT_SECONDS`, and `VOICE_MISSED_SMS_TO`.
- Setup/test notes live in `docs/46elks-voice-fallback.md`.

### Cloudflare 46elks callflow worker

- `nemob-callflow/` contains a standalone Cloudflare Workers TypeScript implementation for the richer 46elks IVR flow.
- It uses D1 for `call_log`, KV binding for future transient state, 46elks SMS notifications, office-hours routing, voicemail recording callbacks, `/stats`, and a daily cron purge for call logs older than 90 days.
- Current route intent: option 1/default = Verkstaden/workshop first, then Sebastian fallback, then voicemail. Option 2 = Sebastian/sales, then voicemail.
- AI voice prompt generation helper lives in `nemob-callflow/scripts/generate-voice-prompts.mjs` and uses OpenAI TTS when `OPENAI_API_KEY` is available.
- The implementation follows current 46elks docs for IVR/record action syntax and documents that 46elks officially recommends IP firewalling for callback-origin verification. The optional HMAC check is custom and off by default via `REQUIRE_ELKS_SIGNATURE=false`.
- Deploy steps, required `wrangler secret put` commands, MP3 prompt text, and test scenarios live in `nemob-callflow/README.md`.

### Public workshop phone number

- Public website contact CTAs now present one workshop number: `010-138 54 98` (`+46101385498`).
- Public Sebastian/Verkstaden direct phone CTAs were removed from customer-facing pages.
- Booking customer confirmations and public email footer point to the workshop number.
- Internal booking/workshop SMS routing still uses staff mobiles where needed; do not replace those with the public number unless the notification flow is changed.

### Public workshop chat

- Public pages load `/assets/workshop-chat.js`, which adds the `Chatta med verkstaden` widget.
- The widget posts to `/api/workshop-chat` in `netlify/functions/workshop-chat.mjs`.
- Chat submissions create `website_chat` cases in the existing `workshop-cases` store and send 46elks SMS alerts to Verkstaden + Sebastian.
- Battery/electrical/error-code chats are assigned to Sebastian; simpler workshop chats default to Verkstaden.
- Chat SMS alerts should link to `/admin/?case=<case-id>&tab=contact`, where the card opens with a `Svara på chatt / SMS` reply box.
- Operational notes and next-step livechat limitations live in `docs/workshop-chat.md`.

### Public product details

- Product cards on the homepage must be clickable for information, not only order buttons.
- Homepage `index.html` has a product detail modal that reads the clicked `.prod` card and shows image, specs, price/status, rule-guide link, call link, and order/question CTA.
- Product data now lives in `data/products.json`. Update model price/status/images there first, then run `npm run generate:products`.
- `scripts/generate-products.mjs` generates the homepage six-product grid, `/nya-elscootrar/` full static catalog, product gallery data, accessory cards, and the quick order list.
- `netlify/functions/create-checkout.js` reads `data/products.json`; do not reintroduce a hardcoded product map in the function.
- NAVEE ST3/ST3 Pro are intentionally excluded from the sellable catalog and checkout.
- Homepage hero intentionally presents two immediate paths: `Verkstaden` and `Nya elscootrar`.
- `/nya-elscootrar/` is the SEO-friendly catalog/sales page for the full NAVEE, Teverun and KuKirin range plus KuKirin/Monorim accessories and upgrades.
- KuKirin G4 Special must not be described as dual motor. Current public copy uses 2000W, 60V 20Ah, 1200Wh, up to 75 km.
- Product detail modals support image galleries/carousels. Add exported customer/project images as local assets or stable public URLs before wiring them into the gallery arrays; Google Photos album links are not directly usable by the static site.
- KuKirin product cards should state free home delivery from KuKirin or free delivery to the Nordic E-Mobility workshop, with delivery 5 business days after payment is received. Stripe Checkout offers these two free shipping options for KuKirin products.
- Teverun product cards should state that Teverun shipping is 60 EUR and delivery is 5-7 business days. Stripe Checkout charges this as a separate shipping option: `Teverun-frakt 60 EUR` at 699 SEK.
- KuKirin G4 Special Edition campaign copy currently says a black cross helmet is included for the first 5 G4 Special Edition orders.

## Next priorities

1. Test `/admin/` after Netlify deploy on the workshop touch computer.
2. Verify `/api/price-catalog` can read/write with `ADMIN_TOKEN` in production.
3. Test POS flow on a real or test case:
   - add price rows
   - save quote
   - register paid
   - inspect timeline and case fields
4. Improve touch mode:
   - larger buttons
   - quicker case search
   - fewer scroll-heavy panels
   - better receipt/paid state feedback
5. Strengthen Fortnox preparation:
   - add required article number warnings
   - export/copy CSV-like rows
   - later build real Fortnox API integration
6. Finish thanks/review/coupon flow:
   - trigger after paid/done
   - unique `SCOOTER-XXXXXX` coupons
   - expiry and redemption tracking
7. Review admin notification buttons and reduce accidental duplicate sends.
8. Build two-way SMS inbox when a 46elks virtual number is available:
   - set `SMS_FROM` to the virtual number
   - add `/api/sms-inbound` webhook
   - match inbound messages to cases by phone number
   - show conversations and unread replies in `/admin/`
   - auto-detect quote approval when customer replies `JA`

## If Codex Starts In Downloads

If the current workspace is `C:\Users\Sebas\Downloads\nordic-emobility-site` or any `working\` folder, stop immediately. That is not the deploy repo. Switch to:

```powershell
Set-Location E:\nordic-emobility-github-push
git fetch origin
git switch main
git pull --ff-only
```

The live Netlify/GitHub-backed site is tied to `https://github.com/Litooo88/tubular-licorice-2179de.git`.

## Start procedure for a new Codex session

Run from the real repo:

```powershell
git fetch origin
git switch main
git pull --ff-only
git status --short
```

Then read this file, inspect the files relevant to the task, and create a branch:

```powershell
git switch -c short-task-name
```

Before final handoff:

```powershell
git diff --check
npm run build
```

Also run `node --check` on any changed Netlify Function or extracted inline admin script when applicable.

## Remote/continuity note

Codex does not automatically carry this chat history into a new computer/session. The durable handoff is:

- GitHub commits and branches.
- PR descriptions.
- This file.
- Docs under `docs/`.

If Sebastian starts Codex on the workshop computer, tell the new session to read `docs/codex-handoff.md` first.
