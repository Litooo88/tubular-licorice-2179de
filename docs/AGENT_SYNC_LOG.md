# Agent Sync Log — Nordic E-Mobility

Delad realtidslogg mellan AI-agenter som jobbar i detta repo (Claude Code,
Codex, m.fl.). Syftet: vi jobbar ofta **parallellt i samma mapp** och får inte
skriva över varandras arbete eller dubblera ändringar. Den här filen är vår
löpande "konversation".

> Detta är operativ koordinering. Den varaktiga arkitektur-/handoff-bilden bor
> fortfarande i [`AGENTS.md`](../AGENTS.md), [`CLAUDE.md`](../CLAUDE.md) och
> [`docs/codex-handoff.md`](codex-handoff.md). Den här filen ersätter dem inte.

## Protokoll (läs och följ)

1. **Vid start av ett pass:** `git fetch origin`, stå på `main`,
   `git pull --ff-only`, läs de senaste posterna nedan.
2. **När du börjar en uppgift:** lägg en NY post högst upp i `## Logg` med
   status `PÅGÅR` — säg vilken branch och vilka filer/områden du tar.
3. **När du är klar / lämnar över:** uppdatera posten till `KLAR` (eller lägg en
   ny) med resultat, testkörningar och ev. risker.
4. **Commit-disciplin:** committa loggändringen i en **egen liten commit**.
   `git pull --ff-only` innan du pushar. Lämna inte ändringar ocommittade länge
   — ocommittat arbete kan gå förlorat om den andra agenten byter branch i den
   delade mappen.
5. **Vid konflikt i denna fil:** behåll BÅDA posterna (det är en logg, inget ska
   skrivas över). Lös konflikten genom att lägga båda i kronologisk ordning.
6. **Rör aldrig** den andra agentens ocommittade arbete, branch eller
   git-worktree. Byt inte branch i en mapp där den andra kan jobba utan att först
   logga det här och säkra (committa) eget arbete.
7. **Format på en post:** se mallen längst ned.

## Logg

<!-- Nyaste posten överst. Lägg nya poster direkt under denna rad. -->

### 2026-07-03 — Claude Code — KLAR (SEO runda 2: elsparkcykel-landningssida + punktering-FAQ)

- **Mål:** #1 på "elsparkcykel"-sökord (var topp-10) och "punktering elscooter
  Örebro" (var #2). 5 nya försök beslutade av Sebastian efter runda 1.
- **Gjort:** 1) NY landningssida `/laga-elsparkcykel-orebro/` (unik copy,
  Service/Breadcrumb/FAQPage-schema, semantisk brygga "elsparkcykel = elscooter");
  2) punkteringssidan: FAQ-sektion + FAQPage-schema + punkteringsfria
  däck-innehåll (konkurrenten på #1 är en däcksida); 3) intern länkning:
  startsidans seo-cards + footer, relaterade tjänster på reparation- och
  punkteringssidorna; 4) sitemap: ny sida + lastmod 2026-07-03; 5) verifiering.
- **Tester:** build ✅, verify:checkout-products ✅, JSON-LD giltig (3+3 block)
  ✅, browserkontroll av båda sidorna ✅ (title/H1/FAQ/länkar/inga trasiga bilder).
- **Obs:** claude-brief-endpointen mergades till main via PR #88 (låg i samma
  branch-historik) — Netlify env `CLAUDE_BRIEF_SLUG` måste sättas av Sebastian.

### 2026-07-03 — Claude Code — KLAR (Safe timeline writes — lost update-risken täppt)

- **Branch:** `fix/safe-case-timeline-writes` → PR mot `main` (öppen, ej mergad).
- **Problemet (HIGH från audit runda 2):** `appendCaseEvent` i
  `_shared/storage.js` läste hela case-blobben (eventual consistency = kan vara
  INAKTUELL), pushade timeline och skrev tillbaka HELA blobben →
  en samtidig/nyss gjord PATCH (status/betalning) kunde tyst återställas.
- **Vald design (Sebastians preferens 1):** appendCaseEvent skriver ALDRIG mer
  case-blobben — events lever enbart i separata `case-events`-storen.
  Motivering: (a) admin läser redan case-events som primär timeline-källa
  (case.timeline är bara fallback), (b) workshop-vyn använder inte timeline
  alls, (c) @netlify/blobs 8.2.0 saknar conditional writes (`onlyIfMatch`
  finns inte) så etag-strategi är omöjlig utan lib-uppgradering, (d) embedden
  från v1-funktioner har bara fungerat sedan 2026-06-30 (connectLambda-fixen)
  — inget beror på den. `workshop-cases.mjs` (v2) fortsätter embedda i sina
  EGNA single-request-writes — orört och säkert.
- **Filer:** `netlify/functions/_shared/storage.js` (RMW-blocket + oanvända
  `timelineText` borttagna), NY `scripts/smoke-safe-timeline.mjs`.
- **Tester:** smoke 5/5 PASS (status+payment kvar efter event, case-blob
  byte-identisk, event i case-events) ✅, `node --check` storage + alla 7
  callers ✅, build/verify/callflow ✅. Inga SMS/mail/production-writes.
- **Kvarstående (acceptabel) risk:** case-events blir enda källan för
  v1-genererade händelser; admin-fallbacken visar dem inte om case-events-
  endpointen är nere (samma läge som innan 30 juni). `updatedAt` bumpas inte
  längre av events (sorteringspåverkan marginell).
- **Varning till Codex:** Rör inte `fix/safe-case-timeline-writes`. Återinför
  ALDRIG case-blob-skrivning i appendCaseEvent — se kommentaren i storage.js.

### 2026-07-03 — Claude Code — KLAR (read-only briefing-endpoint /api/claude-brief/:slug)

- **Branch:** `main`. NY fil: `netlify/functions/claude-brief.mjs` (v2, inget annat rört).
- **Beteende:** GET `/api/claude-brief/:slug`; slug timing-safe mot env
  `CLAUDE_BRIEF_SLUG` (kräver ≥48 tecken). Fel slug ELLER saknad env → 404
  (aldrig 401 — endpointen ska inte gå att skilja från icke-existerande sida).
  60 req/h rate limit (medvetet in-memory per varm instans: endpointen får inte
  göra writes, så Blobs-räknare var uteslutet). Läser endast `workshop-cases`.
- **Svar:** generated_at, todays_bookings (time/first_name/vehicle/case_type/
  status), open_jobs (id/vehicle/status/days_open), overdue_offers_count
  (contacted/waiting_customer med pris, >3 dygn utan uppdatering),
  unpaid_invoices_count (payment.status=invoiced), week_revenue_sek (paid
  senaste 7 dygn), new_bookings_since_yesterday (channel != internal, skapade
  igår/idag Stockholm-tid). INGEN PII: endast förnamn, inga telefon/mail/
  adresser/betaldetaljer.
- **Tester:** fixture-test (aggregation + PII-läckagekontroll + 404/405/429)
  ✅, `npm run build` ✅, `verify:checkout-products` ✅.
- **Kräver:** Netlify env `CLAUDE_BRIEF_SLUG` (64-teckens slug genererad och
  lämnad till Sebastian, ej i repot). Utan env svarar endpointen 404 = safe
  not_configured-läge.

### 2026-07-02 — Claude Code — KLAR (produktstruktur: hjälm bort, G4-kostnad, populärast, begagnat/NEMOB Edition)

- **Branch:** `main`, commit `570a59d`. Filer: `data/products.json`,
  `scripts/generate-products.mjs`, `index.html`, `nya-elscootrar/index.html`,
  `sitemap.xml`, `docs/codex-handoff.md`, `.claude/launch.json` (ny, preview).
- **Gjort:** 1) HJÄLM-KAMPANJEN BORTTAGEN överallt — säg aldrig att hjälm ingår
  (endast rekommendation kvar). 2) G4 inköp 683 EUR internt (`costEur`, renderas
  ALDRIG publikt) + `needsPriceReview: true` — 9 950 kr ger nära noll marginal,
  PRIS MÅSTE SES ÖVER. 3) Startsidan: "Populärast just nu" med 6 större kort +
  badges + trust-rad. 4) 6 nya modeller utan pris (`checkout: false`, CTA
  "Kontakta oss för pris"): KuKirin G2 Master/G2 Pro/A1/C1 Pro 26Ah, NAVEE
  GT3 Max/ST3 Pro — inga bilder ännu (fallback verkstadsbild), inga påhittade
  specs/priser. 5) Ny `refurbished`-array i products.json + sektion
  "Begagnat, renoverat & NEMOB Edition" (`#begagnat-renoverat`) på utbudssidan.
  6) Dualtron Eagle Pro NEMOB Edition som kommande renovering — Storm
  Limited-motor och 72V-konvertering är UNDER UTVÄRDERING, ej installerade.
  7) Juridisk notis för custombyggen på båda sidorna.
- **Tester:** `npm run build` ✅ (idempotent), `verify:checkout-products` ✅
  (31 köpbara oförändrat), `nemob-callflow npm run check` ✅, browserkontroll
  via lokal preview ✅ (badges, CTA:er, begagnat-sektion, 0 hjälm-löften).
- **Varning till Codex:** costEur i products.json är internt inköpspris —
  exponera aldrig i genererad HTML. Nya modeller får inte ges checkout: true
  utan Stripe-produkt + pris.

### 2026-07-02 — Claude Code — KLAR (Teverun-sortiment +7 modeller & prisgaranti Mini Blade Ultra)

- **Branch:** `feat/teverun-range-prisgaranti` → PR mot `main` (öppen, ej mergad).
- **Bakgrund:** Sebastian delade Teveruns grossistlista (EUR, SRP/nettopris/
  lagerstatus). Beslut: INGEN rabattkampanj på Mini Blade Ultra (skyddar kunden
  som nyss betalade ~19k) — i stället **prisgaranti på endast den modellen**.
- **Gjorde (data/products.json → generator):**
  - **Prisgaranti** på `teverun-blade-mini-ultra`: badge "Prisgaranti" + villkor
    i short (svensk auktoriserad återförsäljare, före köp, med länk). Pris
    oförändrat 17 990.
  - **+7 nya Teverun-modeller** (24→31 produkter, Teverun 6→13): Blade Mini Pro
    14 990 (pa-vag juli) · Blade Mini Pro eKFV 15 490 (i-lager) · Blade Mini
    Ultra eKFV 19 990 (pa-vag) · Blade GT+ II 28 990 (pa-vag) · Fighter Mini
    23 990 (i-lager, fåtal) · Fighter Mini Pro 26 990 (pa-vag) · Fighter Supreme
    Ultra 49 990 (beställningsvara). Priser satta enligt husets befintliga
    EUR→SEK-kurva (13–15x SRP); marginaler 4 700–12 000 kr/st mot nettopriser.
    Bilder hotlänkas från teverun-europe.com (etablerat mönster).
  - **Lagerkorrigeringar:** Space Lite slut hos Teverun → `pa-vag`;
    Fighter Eleven+ "fåtal kvar hos leverantören" i delivery-texten.
- **Tester:** `generate:products` (31 produkter) ✅, `verify:checkout-products`
  (31 verifierade) ✅, `npm run build` ✅.
- **OBS till Sebastian:** priserna på de 7 nya är mina förslag enligt er
  priskurva — justera gärna i PR:en innan merge.
- **Varning till Codex:** Rör inte `feat/teverun-range-prisgaranti` eller
  `data/products.json` förrän PR:en är mergad.

### 2026-07-02 — Claude Code — KLAR (SEO: on-page-förbättringar elscooter-sökord Örebro)

- **Branch:** `main`, commit `bc4e60f`. Endast statiska sidor + sitemap, ingen
  funktions- eller datakod.
- **Gjorde (5 försök):** 1) synonymen "elsparkcykel" i description/keywords/
  brödtext på startsida, reparation, punktering, batteri; 2) FAQ-sektion +
  FAQPage-schema på `/elscooter-reparation-orebro/`; 3) Service-schema fixat
  (svenska namn med Ö, `alternateName` elsparkcykel, svensk `serviceType`) +
  sitemap `lastmod` 2026-07-02; 4) startsidans H1 innehåller nu
  "elscooter" + "Örebro"; 5) verifiering.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅,
  alla JSON-LD-block på ändrade sidor parsar som giltig JSON ✅.
- **Kvarvarande risk/nästa:** off-page (Google Business Profile, recensioner,
  lokala länkar) styr lokal ranking mest — kan inte göras i repot. FAQ-schema
  ger sällan rich results för kommersiella sajter numera men skadar inte.

### 2026-07-01 — Claude Code — KLAR (Audit runda 2: buggfixar efter full genomgång)

- **Branch:** `fix/audit-round2-hardening` → PR mot `main` (öppen, ej mergad).
- **Bakgrund:** Full trippel-audit (backend, admin-frontend, säkerhet). Säkerhet:
  ALLA 8 tidigare fynd verifierade FIXADE (case-media IDOR, voice-secrets,
  Stripe-webhook, booking honeypot/rate-limit, env-status auth, timing-safe
  tokens, Origin-allowlist, privata nummer borta). Denna PR täpper nya fynd:
- **Fixat (admin/index.html):** (1) AI-svarsförslag skickade
  `missed_call_followup` för vanliga bokningar → ursäkts-SMS för samtal som
  aldrig fanns; nu `simple_status` för icke-chat. (2) Styrknappar ("Kortare"
  m.fl.) skickar nu nuvarande utkast som kontext så AI:n faktiskt justerar
  texten i rutan. (3) Styrknappar disablas under generering (race).
  (4) Mojibake fixad (`fÃ¶r`→`för` m.fl.) i samtalslead-dialoger/notes.
- **Fixat (service-worker.js):** cache-first gäller nu ENDAST shell-filerna;
  övriga assets (analytics.js, manifest) går direkt till nätet. Offline-fallback
  nycklas på pathname så `/admin/?case=X`-djuplänkar funkar och cachen inte
  växer per query. `CACHE_NAME` v4→v5.
- **Fixat (functions):** `ai-sms-draft`: aiPreview med försvunnet case → 404
  (inte tyst utkast utan kontext) + `aiPreview` echo:as i svaret.
  `workshop-cases.mjs`: Resend-fel i tackmail förlorar inte längre hela
  PATCH:en (try/catch + failed-status + timeline-notis); trasig JSON → 400.
  `ai-daily-brief`: timeout (10s) på intern `/api/cases`-fetch.
  `ai-quote`: OpenAI-resultatet mergas nu (konservativt — AI kan aldrig sänka
  under prisregelns golv); tidigare kastades det (död AI-kostnad).
- **Tester:** `node --check` 5 filer ✅, inline-JS 0 fel ✅, lokala smokes
  (aiPreview+missing→404, echo, dryRun, quote-merge) ✅, build/verify/callflow ✅.
- **KVARSTÅENDE (dokumenterat, ej fixat här):** (a) HIGH: `appendCaseEvent`
  read-modify-write på hela case-blobben med eventual consistency kan tappa
  parallella PATCH-uppdateringar — behöver designbeslut (ETag-conditional
  writes eller timeline-on-read). (b) admin-token i localStorage (MVP-känt).
  (c) call-dashboard POST saknar try/catch; 46elks-fetch endast första sidan.
  (d) 6 duplicerade funktionsdeklarationer i admin (döda kopior).
  (e) render() på varje tangenttryck tappar osparade formulär.
- **Varning till Codex:** Rör inte `fix/audit-round2-hardening`. Ta gärna (d)
  duplicerade deklarationer som separat städ-PR — koordinera här.

### 2026-06-30 — Claude Code — KLAR (PR 2: admin litar på riktig 46elks-samtalskälla)

- **Branch:** `fix/admin-call-source-46elks` → PR mot `main` (öppen, ej mergad).
- **Insikt:** Den riktiga samtalskällan är `/api/call-dashboard` (`call-dashboard.mjs`,
  v2) som hämtar LIVE från 46elks (`api.46elks.com/a1/calls`), matchar mot
  `/api/cases` och räknar missade/besvarade. Ingen Cloudflare D1-proxy behövdes —
  D1 i `nemob-callflow` är Workerns egen IVR-logg, inte admins källa.
- **Buggen:** Admin gatade på en separat `call-logs`-probe mot den **tomma**
  Blob-storen `call-logs` (manuell fallback) INNAN den anropade den riktiga
  46elks-dashboarden → visade alltid "Ej kopplad" även när 46elks fanns.
- **Gjorde:** Tog bort `checkCallLogsSource`-proben i `loadCallDashboard`; admin
  litar nu på `call-dashboard`s egen `sourceUnavailable` (som speglar 46elks).
  Tog bort den oanvända `checkCallLogsSource`-funktionen.
- **Filer:** `admin/index.html`. Ingen datakod, inga writes.
- **Tester:** inline-JS 0 fel ✅, build/verify ✅.
- **Beroende:** Kräver `ELKS_USERNAME`/`ELKS_PASSWORD` i Netlify (samma som SMS).
  Saknas de → call-dashboard returnerar `sourceUnavailable` → admin visar ärligt
  "Ej kopplad". Manuell call-log (`call-logs.js`) kvarstår som fallback.
- **Nästa:** PR 5 (morgonbrief — `ai-daily-brief` finns redan, ev. förbättring).
- **Varning till Codex:** Rör inte `fix/admin-call-source-46elks`.

### 2026-06-30 — Claude Code — KLAR (PR 1: operativ AI-svar i kontakt-tabben)

- **Branch:** `feat/admin-ai-reply` → PR mot `main` (öppen, ej mergad).
- **Bekräftat först:** Blobs-fundamentet är LIVE i production (storage-health v2,
  `blobsAvailable:true`; customer-export = 105 telefon + 66 e-post, 0 fel). Det
  som dolde det var SW-cachen (PR #82).
- **Gjorde (PR 1):** På befintliga `chat-reply`-formen i kundkortets kontakt-tabb:
  knapp **AI-svarsförslag** + styrknappar (Kortare / Mer ursäktande / Be kunden
  boka / Ge prisindikation) + två mallar (ny chatt / missat samtal). AI-förslag
  fyller textarean; befintlig "Kopiera svar" + "Skicka riktigt SMS-svar"
  (confirm → `send_sms` → timeline) oförändrade. Inga autosvar.
- **Backend:** La `aiPreview`-läge i `ai-sms-draft.js` — använder OpenAI men
  skriver INGET (så styrning kan itereras utan timeline-spam). Riktig sändning
  går separat via `send_sms`. Kräver `OPENAI_API_KEY` (Sebastian satte den);
  utan nyckel faller den tillbaka till deterministisk mall (graceful).
- **Filer:** `admin/index.html`, `netlify/functions/ai-sms-draft.js`.
- **Tester:** `node --check` ✅, admin inline-JS 0 fel ✅, lokal aiPreview-smoke
  (200, inga writes, references null) ✅, build/verify/callflow ✅.
- **Nästa:** PR 2 (call-log read-only proxy från Cloudflare D1), PR 5
  (morgonbrief). PR 4 i ChatGPT-planen är redan gjord i #79.
- **Varning till Codex:** Rör inte `feat/admin-ai-reply`. Om du ändrar
  `ai-sms-draft.js` eller `chat-reply`-formen i admin — koordinera här först.
### 2026-06-30 — Claude Code — KLAR (Service worker cachade function-svar)

- **Branch:** `fix/sw-no-cache-functions` → PR mot `main` (öppen, ej mergad).
- **VIKTIG INSIKT:** Deployen fungerar (Netlify visade `main@675ba35 Published`).
  Anledningen att production "körde gammal kod" var att **admin/service-worker.js
  cachade `/.netlify/functions/*`-svar cache-first** — den exkluderade `/api/`
  men inte `/.netlify/`. Därför var `/api/cases` färsk (131) men `storage-health`
  /`customer-export` infrusna på sina första (v1) svar i browsern.
- **Gjorde:** Skrev om SW:s fetch-handler: hanterar bara same-origin GET, cachar
  ALDRIG `/api/`- eller `/.netlify/`-svar, bumpade `CACHE_NAME` v3→v4 (rensar
  gamla infrusna svar vid activate).
- **Filer:** `admin/service-worker.js`. Ingen datakod, inga writes.
- **Tester:** `node --check` ✅. (Build/verify ej relevant — bara SW.)
- **Nästa / överlämning:** Efter merge+deploy måste varje admin-browser hämta nya
  SW:n: ladda om `/admin/` 1–2 ggr, eller DevTools → Application → Service
  Workers → Unregister + reload. Då rensas v3-cachen och alla function-svar blir
  live. Därefter: PR 1 (operativ chatt/SMS). Alla Blobs/v2-fixar är redan på main
  och live — det var bara SW-cachen som dolde dem.
- **Varning till Codex:** SW cachar inte längre API/function-svar — räkna inte
  med SW-cache för dynamisk data.

### 2026-06-30 — Claude Code — KLAR (PR 0 / Steg 2b: connectLambda för v1-Blobs)

- **Branch:** `fix/blobs-connect-lambda-v1` → PR mot `main` (öppen, ej mergad).
- **EXAKT ROTORSAK:** `@netlify/blobs` v8 — v1-funktioner (`exports.handler`)
  får INTE Blobs-kontexten automatiskt; de måste anropa `connectLambda(event)`
  före `getStore()`. v2 (`export default`) auto-ansluter. Därför failade alla
  10 v1-Blobs-functions med `MissingBlobsEnvironmentError` trots identiskt anrop.
  Detta är den minimala, korrekta fixen (en rad/funktion) i stället för full
  v2-omskrivning.
- **Gjorde:** La `connectBlobs(event)`-helper i `_shared/storage.js` och anrop
  högst upp i alla 10 v1-Blobs-handlers: `ai-communication-draft`,
  `ai-daily-brief`, `ai-quote`, `ai-sms-draft`, `call-logs`, `case-events`,
  `communication-events`, `customer-export`, `sms-drafts`, `stripe-webhook`.
- **Tester:** `node --check` alla 11 ✅, lokal smoke (401 utan token, dryRun 200
  utan Blobs, export 200 med token) ✅, `npm run build` ✅,
  `verify:checkout-products` ✅, `nemob-callflow check` ✅.
- **Nästa / överlämning:** När mergad+deployad: kör `storage-health` (nu v2) +
  testa `customer-export`/`ai-sms-draft` (icke-dryRun) — Blobs ska nu fungera i
  hela v1-lagret. Sedan: PR 1 (operativ chatt/SMS, återanvänd `ai-*-draft`),
  PR 2 (call-log read-only proxy från D1).
- **Varning till Codex:** Rör inte `fix/blobs-connect-lambda-v1`. Om du ändrar
  någon av de 10 functions parallellt — koordinera här först.

### 2026-06-29 — Claude Code — KLAR (Steg 2: Blobs-rotorsak + v2-probe)

- **Branch:** `fix/storage-health-v2-blobs` → PR mot `main` (öppen, ej mergad).
- **ROTORSAK BEKRÄFTAD i production:** `storage-health` (v1, `exports.handler`)
  ger `MissingBlobsEnvironmentError` på ALLA stores inkl. `workshop-cases`,
  MEN `/api/cases` (v2, `workshop-cases.mjs`) returnerar 131 ärenden. Slutsats:
  **endast v2-funktioner (`export default` + `export const config`) får Netlify
  Blobs-kontexten; v1 (`exports.handler`) får den inte.** Det förklarar varför
  identiskt `getStore({name,consistency})` funkar i `.mjs` men inte i `.js`.
- **Gjorde:** Konverterade `storage-health.js` → `storage-health.mjs` (v2) som
  bevis-probe; la till `hasBlobsContext` (= `NETLIFY_BLOBS_CONTEXT` finns) och
  `functionVersion`. La även en protokoll-guard i `admin/service-worker.js` så
  `chrome-extension://`-requests inte kraschar `cache.put` (rad 41).
- **Filer:** `netlify/functions/storage-health.mjs` (ny), `storage-health.js`
  (borttagen), `admin/service-worker.js`. Ingen datakod, inga writes.
- **Tester:** `node --check` ✅ (mjs + sw), `npm run build` ✅,
  `verify:checkout-products` ✅, `nemob-callflow check` ✅.
- **Nästa / överlämning:** När denna PR mergats + deployats: kör `storage-health`
  igen — om `blobsAvailable:true` / `hasBlobsContext:true` är teorin spikad och
  **Steg 2b** = konvertera övriga Blobs-läsande v1-functions till v2
  (`customer-export`, `call-logs`, `communication-events`, `case-events`,
  `sms-drafts` + `_shared/storage.js`-interop). Steg 3 = call-log-ingest D1.
- **Varning till Codex:** Rör inte `fix/storage-health-v2-blobs` eller
  `fix/admin-panel-cleanup` (PR #79). Konvertera inte samma v1-functions
  parallellt — koordinera här först.
### 2026-06-29 — Claude Code — KLAR (Steg 1 av admin-audit)

- **Branch:** `fix/admin-panel-cleanup` →
  [PR #79](https://github.com/Litooo88/tubular-licorice-2179de/pull/79) (öppen,
  ej mergad).
- **Gjorde:** Full audit av admin-panelen på begäran. Steg 1 = säkra städfixar:
  tog bort död kod i `loadAiControlTower`, enade admin-token-källan
  (`aiFunctionFetch` + `api()`), tog bort dubbel `call-logs`-probe, förtydligade
  att `cases.mjs` är disablad/legacy (inte live `/api/cases`).
- **Filer/områden:** `admin/index.html`, `netlify/functions/cases.mjs`. Ingen
  datakod, inga writes, inga SMS/mail.
- **Tester:** `node --check cases.mjs` ✅, inline-JS syntaxkoll 0 fel ✅,
  `npm run build` ✅, `verify:checkout-products` ✅, `nemob-callflow check` ✅.
- **Nästa / överlämning:** Steg 2 (Blobs i production) är **blockerat** tills
  Sebastian kör `storage-health` + `/api/cases`-count från admin-browsern — det
  avgör om `MissingBlobsEnvironmentError` är global (admin visar cache) eller
  bara saknade stores. Identiskt `getStore`-anrop i `workshop-cases.mjs` (funkar)
  och i nya CJS-functions (failar) ⇒ skillnaden är runtime/deploy, inte kod.
  Steg 3 = call-log-ingest från Cloudflare D1 (`call_log`)/46elks; Netlify
  `call-logs.js` läser i dag Blob-storen `call-logs` som aldrig fylls.
- **Varning till Codex:** Rör inte `fix/admin-panel-cleanup`. Om du också ändrar
  `admin/index.html`, koordinera här först — vi vill inte krocka i samma fil.

### 2026-06-28 ~15:35Z — Codex — KLAR

- **Branch:** `main` för triage; ny fix-branch skapas först när en verifierad
  bugg/issue kräver kodändring.
- **Gjorde:** Fortsatt GitHub-triage enligt målet att hitta öppna PR:ar/issues,
  fixa verifierade buggar och PR/merge:a tills funktionerna är verifierade.
  GitHub connector + rå GitHub API visade 0 öppna PR:ar och 0 öppna issues.
  Verifierade även production no-token-skydd och admin-panelmarkörer.
- **Filer/områden:** GitHub PR/issues, admin/API/Netlify functions beroende på
  vad triagen visar.
- **Tester:** `node --check` på centrala Netlify functions ✅, statisk
  admin-smoke ✅, `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `cd nemob-callflow && npm run check` ✅. Production read-only/no-token:
  `/admin/` 200 med huvudpaneler ✅, authade functions utan token 401 ✅.
- **Nästa / överlämning:** Inga öppna GitHub-items att fixa just nu. Kvarvarande
  kända blockerare är extern config: `VOICE_WEBHOOK_SECRET` och
  `STRIPE_WEBHOOK_SECRET`.
- **Varning:** Poppa inte stashen. Inga SMS/mail, inga production-writes, ingen
  Supabase och ingen Claude/Next-merge.

### 2026-06-28 ~15:18Z — Codex — KLAR

- **Branch:** `fix/admin-operational-stability-audit`
- **Gjorde:** Stabiliserade admin som operativ kontrollpanel utan att ta bort
  paneler eller ersätta live-funktioner med mock. Kundexport fick tydligare
  versions-/källstatus, Kommunikationsradar säger uttryckligen att inget
  skickas, och operativ status/SMS-flöden dokumenterades.
- **Filer/områden:** Adminpanelen, kundexport, AI Kontrolltorn, demo/test-radar,
  live samtal, missade samtal, SMS/chattflöden och dokumentation.
- **Tester:** Baseline: `npm run build`, `npm run verify:checkout-products`,
  `cd nemob-callflow && npm run check` ✅. Efter ändring: `node --check
  netlify/functions/customer-export.js`, workshop JSON-parse, `npm run build`,
  `npm run verify:checkout-products`, `cd nemob-callflow && npm run check`,
  lokal handler-smoke och statisk admin-smoke ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön. Fortsatt extern config
  kvar: `VOICE_WEBHOOK_SECRET` och `STRIPE_WEBHOOK_SECRET`.
- **Varning:** Poppa inte stashen. Inga SMS/mail, inga production-writes, ingen
  Supabase och ingen Claude/Next-merge.

### 2026-06-28 ~15:02Z — Codex — KLAR

- **Branch:** `main`
- **Gjorde:** Fortsatte verifiering/triage efter PR #76. Bekräftade rent
  worktree före loggändringen, att stashen ligger kvar och att centrala
  read-only/dry-run handlers beter sig kontrollerat lokalt.
- **Filer/områden:** Ingen produktkod ändrad; endast sync-logg.
- **Tester:** Lokal handler-smoke: `ai-quote` 401 utan/fel token och E16 dry-run
  201 med 395 / 595–1995, `ai-daily-brief` 401 utan token och 200 med dry-run,
  `call-logs`, `customer-export` och `storage-health` 401 utan token och 200 med
  token i read-only/fallback-läge.
- **Nästa / överlämning:** Externa blockerare kvar: konfigurera
  `VOICE_WEBHOOK_SECRET` i Netlify och uppdatera 46elks voice-start URL med
  secret; `STRIPE_WEBHOOK_SECRET` saknas fortfarande för Stripe webhook.
- **Varning:** Poppa inte stashen, inga SMS/mail och inga production-writes.

### 2026-06-28 ~15:00Z — Codex — KLAR

- **Branch:** `codex/update-voice-secret-handoff`
- **Gjorde:** Uppdaterar durable handoff efter PR #75 så framtida agenter ser att
  Netlify voice-webhooks kräver `VOICE_WEBHOOK_SECRET`.
- **Filer/områden:** `docs/codex-handoff.md`, sync-logg.
- **Tester:** Docs-only; production no-secret smoke för voice endpoints gav 503.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~05:12Z — Codex — KLAR

- **Branch:** `codex/require-voice-webhook-secret`
- **Gjorde:** Gör `VOICE_WEBHOOK_SECRET` obligatorisk för Netlify voice-webhooks
  så routing/SMS inte kan aktiveras publikt om secret saknas.
- **Filer/områden:** `voice-start.mjs`, `voice-notify.mjs`,
  `voice-simple.mjs`, `docs/46elks-voice-fallback.md`, sync-logg.
- **Tester:** `node --check` för berörda functions ✅, lokal voice-smoke:
  saknad secret 503 ✅, fel secret 401 ✅, rätt secret 200 ✅, notify utan
  SMS-config gav `not_configured` utan SMS ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:58Z — Codex — KLAR

- **Branch:** `codex/anonymize-missed-call-doc-numbers`
- **Gjorde:** Anonymiserar gamla exempelnummer i missade-samtal-workflow så
  kund-/privatnummer inte ligger i repo.
- **Filer/områden:** `docs/MISSED_CALL_FOLLOWUP_WORKFLOW.md`, sync-logg.
- **Tester:** Riktad `rg` efter gamla nummer ✅. Docs-only; build ej körd.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:52Z — Codex — KLAR

- **Branch:** `codex/remove-hardcoded-voice-fallbacks`
- **Gjorde:** Tar bort hårdkodade privata telefonfallbacks ur voice-flöden och
  låter Netlify env vara enda källa för staff-routing/notify.
- **Filer/områden:** `voice-simple.mjs`, `voice-notify.mjs`,
  `call-dashboard.mjs`, sync-logg.
- **Tester:** `node --check` för berörda functions ✅, lokal voice-smoke utan
  configured primary/utan secret/fel secret/rätt secret ✅, notify utan
  mottagare gav `not_configured` utan SMS ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅, `rg` hittade inga hårdkodade privata nummer ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:50Z — Codex — KLAR

- **Branch:** `codex/update-case-media-auth-docs`
- **Gjorde:** Rättar kvarvarande docs som påstår att `case-media` är publik,
  efter verifiering att production ger 401 utan token.
- **Filer/områden:** API/safety docs, sync-logg.
- **Tester:** Production no-token smoke för `/api/case-media/test-case/test-media`
  gav 401 ✅. Docs-only; build ej körd.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:46Z — Codex — KLAR

- **Branch:** `codex/protect-booking-env-status`
- **Gjorde:** Stänger kvarvarande publik config-disclosure där
  `/api/booking-env-status` svarar 200 utan admin-token.
- **Filer/områden:** `netlify/functions/booking-env-status.mjs`,
  `admin/index.html`, relevanta docs, sync-logg.
- **Tester:** `node --check netlify/functions/booking-env-status.mjs` ✅,
  lokal handler-smoke utan/fel/rätt token ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:42Z — Codex — KLAR

- **Branch:** `codex/fix-product-page-redirect`
- **Gjorde:** Fixar kvarvarande redirect-konflikt där `_redirects` pekar gamla
  `/product-page/*` mot hemhash medan `netlify.toml` pekar mot katalogen.
- **Filer/områden:** `_redirects`, sync-logg.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `cd nemob-callflow && npm run check` ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~01:45Z — Codex — KLAR

- **Branch:** `fix/optimize-root-assets`
- **Gjorde:** Stängde kvarvarande prestandafynd: optimerade root-logotyperna och
  tar bort orefererade stora root-PNG:er.
- **Filer/områden:** `logo.png`, `nordic_logo_transparent.png`,
  orefererade root-bilder, sync-logg.
- **Tester:** Loggorna verifierade 512x512 och byte-identiska ✅, oanvända
  root-PNG:er har inga referenser ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~01:25Z — Codex — KLAR

- **Branch:** `fix/prices-json-ld`
- **Gjorde:** Lade JSON-LD/structured data på publika `/priser/` för att stänga
  kvarvarande SEO-fynd från handoffen.
- **Filer/områden:** `priser/index.html`, sync-logg.
- **Tester:** JSON-LD parse-smoke ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~01:05Z — Codex — KLAR

- **Branch:** `fix/remove-nested-site-copy`
- **Gjorde:** Tog bort tracked äldre nested `nordic-emobility-site/`-kopia från
  deploy-repot och lägger ignore så den inte råkar återinföras.
- **Filer/områden:** nested kopia, `.gitignore`, recovery docs.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `cd nemob-callflow && npm run check` ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~00:45Z — Codex — KLAR

- **Branch:** `fix/voice-webhook-timing-safe`
- **Gjorde:** Hårdade 46elks voice-webhook secret-jämförelse så
  `VOICE_WEBHOOK_SECRET` inte jämförs med vanlig strängjämförelse.
- **Filer/områden:** `netlify/functions/voice-start.mjs`,
  `netlify/functions/voice-notify.mjs`, auth-helper och tester.
- **Tester:** `node --check` på berörda filer ✅, lokal voice-webhook
  auth-smoke utan/fel/rätt secret ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~00:20Z — Codex — KLAR

- **Branch:** `docs/update-admin-audit-resolution`
- **Gjorde:** Uppdaterade admin-auditens status så gamla "trasigt"/nästa-steg-fynd
  inte längre kan misstas för nuläge efter PR #50-#64.
- **Filer/områden:** `docs/ADMIN_SYSTEM_AUDIT_2026_06.md` och sync-logg.
- **Tester:** Inga buildtester körda; markdown-only.
- **Säkerhet:** Dokumentation endast. Inga SMS/mail, inga production-writes,
  stashen poppas inte.

### 2026-06-27 ~19:35Z — Codex — KLAR

- **Branch:** `docs/netlify-env-hardening-followup`
- **Gjorde:** Dokumenterade read-only Netlify-fynd efter PR #63: production
  deploy är `ready`, men `STRIPE_WEBHOOK_SECRET` saknas och vissa känsliga
  operativa env-vars behöver roteras/markeras som secret i Netlify.
- **Filer/områden:** `docs/codex-handoff.md`, `docs/AGENT_SYNC_LOG.md`.
- **Tester:** Inga buildtester körda; markdown-only.
- **Säkerhet:** Inga env-värden skrevs i docs, inga SMS/mail, inga
  production-writes, stashen poppades inte.

### 2026-06-27 ~18:55Z — Codex — KLAR

- **Branch:** `fix/timing-safe-admin-auth`
- **Gjorde:** Hårdade admin-auth i kvarvarande MJS-functions så `x-admin-token`
  jämförs timing-safe där endpoints redan kräver admin-token.
- **Filer/områden:** `netlify/functions/*.mjs` med lokal admin-auth samt
  `netlify/functions/create-checkout.js`.
- **Tester:** `node --check` på ändrade functions ✅, lokala auth-smokes för
  admin-token ✅, `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `cd nemob-callflow && npm run check` ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppades inte.

### 2026-06-27 ~18:10Z — Codex — KLAR

- **Branch:** flera fokuserade branches, mergeade via PR #52-#61 till `main`.
- **Gjorde:** Stängde kvarvarande PR/buggspår från admin/audit-rundan:
  hardening av booking/voice ingress, admin media/auth-diagnostik, AI SMS
  true dry-run, timeline fallback från `/api/cases`, workshop-chat
  rate/idempotency, Stripe checkout origin + signerad webhook, live-SMS UI/POST
  safety, booking idempotency och riktig avstängning av gamla rescue
  `cases.mjs`.
- **Filer/områden:** `admin/index.html`, `netlify/functions/booking.mjs`,
  `workshop-chat.mjs`, `call-dashboard.mjs`, `create-checkout.js`,
  `stripe-webhook.js`, `cases.mjs`, AI/timeline functions och docs.
- **Tester:** Efter varje merge kördes `npm run build` ✅,
  `npm run verify:checkout-products` ✅ och
  `cd nemob-callflow && npm run check` ✅. Relevanta `node --check` och lokala
  handler-smokes kördes per PR.
- **Nästa / överlämning:** Open PR-listan var tom efter PR #61. Kvar som
  separat arbete: Netlify env/setup för `STRIPE_WEBHOOK_SECRET` och Stripe
  Dashboard webhook, samt ev. SEO/prestanda-fynd som stor logotyp och JSON-LD
  för `/priser/`.
- **Varning:** Inga SMS/mail skickades i tester, inga production-writes gjordes,
  stashen `feature/ai-operator-mvp3-timeline` poppades inte.

### 2026-06-27 ~16:00Z — Codex — KLAR

- **Branch:** `fix/admin-operational-truth-dashboard`
- **Gjorde:** Implementerade auditens admin-fixar: operativ KPI-modell med
  `Gör nu`, AI brief via `/api/cases`, tydlig Blob/call-log källstatus och
  mindre missvisande live-samtalsläge. Gjorde `/api/call-dashboard` GET
  read-only som default och explicit för källsaknad.
- **Filer/områden:** `admin/index.html`,
  `netlify/functions/ai-daily-brief.js`, `netlify/functions/call-logs.js`,
  `netlify/functions/customer-export.js`, `netlify/functions/call-dashboard.mjs`.
- **Tester:** `node --check` på ändrade functions ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅, lokal `ai-daily-brief` dry-run smoke ✅.
- **Nästa / överlämning:** PR med titel `Fix admin operational truth dashboard`.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-27 ~00:00Z — Codex — KLAR

- **Branch:** `audit/admin-system-operational-map`
- **Gjorde:** Full systemrevision av admin, bookingflöde, KPI:er och relevanta
  Netlify Functions. Skapade operativ auditrapport.
- **Filer/områden:** `docs/ADMIN_SYSTEM_AUDIT_2026_06.md` och denna sync-logg.
- **Tester:** Ingen build/test körd eftersom endast dokumentation ändrades.
- **Nästa / överlämning:** Implementera rekommenderade fixar i små separata PR:
  KPI-modell, AI brief via `/api/cases`, tydlig call-log source status,
  `ai-sms-draft` true dry-run och timeline fallback.
- **Varning:** Ingen SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-26 ~12:40Z — Claude Code — KLAR

- **Branch:** `seo/sitemap-favicon` → mergad till `main` via
  [PR #37](https://github.com/Litooo88/tubular-licorice-2179de/pull/37)
  (merge-commit `ccdf9ad`, mergad av Sebastian).
- **Gjorde:** SEO-fix. Skapade `favicon.svg` (varumärkesgrön `#00C853`) och la
  `<link rel="icon">` på alla 19 publika sidor (efter `<meta charset>`). La till
  saknade sidor i `sitemap.xml`: `/nya-elscootrar/`, `/foretag/`, `/garanti/`.
  Commit `9fdfbd6`, 21 filer.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅.
- **Rör INTE:** ingen kod i AI Operator/MVP4, inga functions, ingen storage.
- **Notis:** Codex MVP4-commit `e716afc` (Communication radar demo) ligger också
  på `main`. Inga konflikter — SEO och MVP4 samexisterar.
- **Production:** PR mergad → Netlify deployar från `main`.

### 2026-06-26 (tidigare denna session) — Claude Code — KLAR

- **Gjorde:** Genomgång av hela sajten på begäran (read-only).
  - Hälsokoll: `npm run build` ✅, `npm run verify:checkout-products` ✅,
    `nemob-callflow` `tsc --noEmit` ✅.
  - Live-koll: startsida + `/book-online/` laddar korrekt.
  - Säkerhetsgranskning (ej åtgärdad) — viktigaste fynd att ta tag i:
    - **Kritiskt:** `netlify/functions/case-media.mjs` GET serverar kundbilder
      utan auth (före `requireAdmin`) och struntar i `publicOk` (IDOR-läcka).
    - **Högt:** inga signaturkontroller på 46elks voice-callbacks
      (`voice-notify.mjs`, `voice-start.mjs`); ingen Stripe-webhook som bekräftar
      betalning; `booking.mjs` saknar rate limiting/honeypot.
    - **Medel:** `booking-env-status.mjs` publik config-disclosure; admin-token i
      `localStorage`; icke-konstanttidsjämförelse i `requireAdmin`;
      `create-checkout.js` litar på `Origin`-header; `cases.mjs` är död
      duplicerad write-path på disabled route.
  - SEO-granskning — fynd kvar utöver det åtgärdade ovan:
    - Logotypen är 1,8 MB och laddas på varje sida (`logo.png` =
      `nordic_logo_transparent.png`, byte-identiska) — optimera.
    - ~7 MB oanvända PNG:er i repo-roten (`blade-gt2-promo.png`,
      `facebook-content-1/2.png`).
    - `/priser/` saknar JSON-LD; motsägelse i `_redirects` för `/product-page/*`.
- **Inga kodändringar** i detta steg (bara granskning).

---

## Postmall (kopiera)

```
### ÅÅÅÅ-MM-DD ~HH:MMZ — <Agent> — <PÅGÅR|KLAR>

- **Branch:** <branch / PR>
- **Gjorde:** <kort vad>
- **Filer/områden:** <vilka filer eller routes>
- **Tester:** <kommandon + resultat>
- **Nästa / överlämning:** <vad som är kvar>
- **Varning:** <vad den andra agenten bör undvika att röra just nu>
```
