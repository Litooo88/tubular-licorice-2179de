# Admin System Audit 2026-06

Datum: 2026-06-27  
Branch: `audit/admin-system-operational-map`  
Scope: read-only systemrevision av Nordic E-Mobility admin, bookingflöde och
de viktigaste Netlify Functions.

## Regler för revisionen

- Inga SMS skickades.
- Inga mail skickades.
- Inga production-writes gjordes.
- Ingen Supabase- eller Claude-prototyp mergeades.
- Inga destruktiva ändringar gjordes.
- Detta är en dokumentationsrapport. Ingen applikationskod ändrades.

## Kort slutsats

Adminens viktigaste verkliga datakälla är `GET /api/cases`, som går via
`netlify/functions/workshop-cases.mjs` och Netlify Blob-storen
`workshop-cases`. Ärendelistan och kundkorten fungerar därför bättre än flera
nya AI/export/call-log-paneler.

De största operativa problemen är:

- KPI:n **Aktiva** betyder idag endast "inte `done` och inte `archived`". Det
  är missvisande när det visas som 123 aktiva ärenden.
- **AI Kontrolltorn** läser i normal mode från shared Blob-entiteter
  (`service_cases`, `call_logs`, `sms_drafts`, `part_needs`) i stället för från
  den fungerande `/api/cases`-källan.
- **Live samtal** är beroende av otydlig källstatus. Om 46elks/call-log eller
  Blob-helpern saknas ska UI visa "samtalsimport ej kopplad", inte nollor som
  kan tolkas som verkliga siffror.
- Flera paneler har blandat verklig data, demo, dry-run och fallback. Det gör
  systemet svårt att lita på när Sebastian behöver akutläge.
- Det finns fortfarande admin-actions som faktiskt kan skicka SMS via
  `/api/cases` och `/api/call-dashboard`. De ska hållas tydligt separerade från
  AI/dry-run/testflöden.

## Verklig datakarta

| Yta | Primär datakälla | Skriver data? | Nulägesbedömning |
| --- | --- | --- | --- |
| `/admin/` ärendelista | `GET /api/cases` -> `workshop-cases` | Ja via PATCH/DELETE/actions | Fungerar, men KPI-copy är missvisande. |
| `/admin/` AI Kontrolltorn | `/.netlify/functions/ai-daily-brief` | POST kan skriva AI-rekommendation | Fel källa för brief i normal mode. Bör läsa `/api/cases`. |
| `/admin/` kundexport | `/.netlify/functions/customer-export`, fallback från redan laddade `cases[]` | Nej | Bra riktning, men Blob-varningar måste visas tydligt som sekundära källor. |
| `/admin/` live samtal | `call-logs?readOnly=1` + `/api/call-dashboard` | Ja via `/api/call-dashboard` POST | Källa måste visas som kopplad/ej kopplad. Får inte visa falska leads. |
| `/admin/` akut missade samtal | Textarea + matchning mot `cases[]` | Nej | Operativt rätt akutläge. Kopiera/exportera, inget skick. |
| `/book-online/` | `POST /api/bookings` | Ja | Fungerar som publik intake med bekräftelseintegrationer. |
| Chat-widget | `POST /api/workshop-chat` | Ja | Skapar ärende och kan skicka intern SMS-avisering. |
| `/workshop/` | `GET/PATCH /api/cases` | Ja | Enkel verkstadsvy, men visar bara vissa "aktiva/inlämnade" statusar. |
| `/prices/` | `/api/price-catalog` | Ja | Intern prisdatabas. |
| `/priser/` | Statisk HTML | Nej | Publik prislista, risk för drift från intern prisdatabas. |

## Föreslagen KPI-modell

Ersätt nuvarande "Aktiva" som huvudsignal med ett mer operativt språk:

| KPI | Definition | Primär källa |
| --- | --- | --- |
| **Gör nu** | Ärenden som kräver handling idag: hög prio, `ready`, `waiting_customer`, `new` utan bekräftelse, eller stått stilla mer än 48 h. | `/api/cases` |
| **Nya utan bekräftelse** | `status === "new"` eller `confirmation_missing === true` och ingen lyckad kundbekräftelse. | `/api/cases` |
| **Missade samtal att följa upp** | Verkliga call logs om import är kopplad, annars manuellt inklistrade nummer i akutpanelen. | `call-logs` eller akutpanelen |
| **Väntar kund** | `status === "waiting_customer"` eller prisförslag/godkännande väntar. | `/api/cases` |
| **Väntar del** | `status === "waiting_parts"` eller öppna part-needs. | `/api/cases`, senare `part_needs` |
| **Klara att hämta** | `status === "ready"` och kund ska hämta/avsluta. | `/api/cases` |
| **Klara att fakturera/betala** | `payment.status === "invoice_ready"` eller `status === "ready"` med belopp men ej betald. | `/api/cases` |
| **Risk/stått stilla** | Batteri/reklamation/högpris/okänd modell, akut prio eller ingen uppdatering på mer än 48 h. | `/api/cases` + business rules |
| **Ej arkiverade** | Alla som inte är `archived`. Ska inte kallas aktiva. | `/api/cases` |

Rekommendation: visa "Ej arkiverade" som sekundär systemräknare längre ned, inte
som huvud-KPI.

## Sidrevision

### `/`

- **Syfte:** Publik startsida för verkstad, service, produkter, kontakt och
  bokningsvägar.
- **Datakälla:** Statisk HTML. Produktsektioner genereras från
  `data/products.json` via `scripts/generate-products.mjs`. Chat-widget laddas
  med `assets/workshop-chat.js`.
- **Vad fungerar:** Publik marknadsföring, produktkort, bokningslänkar,
  checkout-initiering via produktknappar och workshop-chat.
- **Demo/mock/fallback:** Produktbilder kan ha externa fallback-URL:er. Chatten
  är inte live-chat i realtid utan ett intake-formulär som skapar ärende.
- **Vad är trasigt:** Inget akut blockerande hittat i själva startsidan.
- **Missvisande i UI:** Texter som antyder direkt återkoppling kan uppfattas som
  starkare än vad bemanning och integrationsstatus alltid klarar.
- **Risknivå:** Låg till medel.
- **Rekommenderad fix:** Se till att CTA-copy skiljer "boka/skicka in ärende"
  från garanterad omedelbar manuell återkoppling.

### `/book-online/`

- **Syfte:** Publik bokning av inlämning/service.
- **Datakälla:** Formulär skickar `POST /api/bookings`. Det finns även Netlify
  Forms-backup mot `/`.
- **Vad fungerar:** Formuläret bygger payload, kräver vald tid, skapar
  verkstadsärende och visar status baserat på notifieringsresultat.
- **Demo/mock/fallback:** Om SMS/e-post/kalender inte är konfigurerade returnerar
  backend `not_configured`/partial-status och UI visar fallback-meddelande.
- **Vad är trasigt:** Publik intake saknar tydlig rate limiting i appkoden.
- **Missvisande i UI:** Sidan marknadsför "SMS + e-post direkt". Det är sant
  endast när provider-konfiguration och skick lyckas.
- **Risknivå:** Medel, eftersom sidan skriver produktiondata och kan trigga
  externa notifieringar.
- **Rekommenderad fix:** Behåll positiv copy men lägg till explicit "du får
  bekräftelse när integrationen lyckas, annars följer vi upp manuellt". Lägg
  till rate limiting/idempotency för bokningar.

### `/admin/` översikt

- **Syfte:** Operativ huvudvy för ärenden, KPI:er, samtal, akut uppföljning,
  kundexport, AI-stöd och kundkort.
- **Datakälla:** `GET /api/cases` är primär källa för ärenden. Sekundära paneler
  anropar `/api/call-dashboard`, `/.netlify/functions/call-logs`,
  `customer-export`, `ai-daily-brief` och demo/AI-functions.
- **Vad fungerar:** Ärendelista/kundkort laddar från `/api/cases`. Akut
  uppföljning för missade samtal kan parsa nummer, deduplicera och matcha mot
  redan laddade kundkort utan att skicka SMS.
- **Demo/mock/fallback:** Kommunikationsradar är tydligt märkt
  "demo/test". Kundexport har fallback från laddade cases. AI-testknappar
  använder dry-run för quote men inte fullständigt för alla AI-flöden.
- **Vad är trasigt:** AI Kontrolltorn bygger inte sin normalbrief från den
  fungerande `/api/cases`-källan. Det kan därför visa tomt/0 eller "Function
  error" trots att ärendelistan har data.
- **Missvisande i UI:** "Aktiva" betyder `!done && !archived`, inte faktiskt
  aktiva jobb. Det bör bytas till "Ej avslutade/ej arkiverade" eller flyttas
  ned som systemräknare.
- **Risknivå:** Hög, eftersom huvudvyn styr operativa beslut.
- **Rekommenderad fix:** Gör `/api/cases` till primär källa för KPI:er och AI
  Kontrolltorn. Visa Blob/export/call-log-källor som sekundära och explicit
  "ej kopplade" när de saknas.

### `/admin/` kundkort

- **Syfte:** Hantera ett enskilt ärende: kunddata, status, SMS, offert,
  färdigställande, betalning, bilder/content och timeline.
- **Datakälla:** Basdata kommer från `cases[]` via `/api/cases`. Timeline och
  SMS-utkast hämtas separat från `case-events` och `sms-drafts`.
- **Vad fungerar:** Kundkort visar verkliga case-fält och kan PATCH:a ärenden.
  Snabbstatus, betalningsunderlag, contentutkast och bilder är operativa.
- **Demo/mock/fallback:** Timeline/SMS-utkast är sekundära CJS-functions via
  shared storage-helpern. Om de saknar Blob-kontext kan de vara tomma/fela trots
  att case-kortet fungerar.
- **Vad är trasigt:** Timeline och SMS-drafts är inte garanterat konsistenta med
  den befintliga `item.timeline` i `workshop-cases`. Det finns två
  timeline-modeller.
- **Missvisande i UI:** Ett tomt timeline-resultat kan tolkas som "inga
  händelser" när det egentligen kan betyda "timeline-källa saknas".
- **Risknivå:** Hög vid kundkommunikation och betalning, medel för ren visning.
- **Rekommenderad fix:** Visa tydlig källstatus för timeline/SMS-utkast. På kort
  sikt: fallbacka timeline-vyn till `item.timeline` från `/api/cases` när
  `case-events` inte kan läsas.

### `/workshop/`

- **Syfte:** Förenklad verkstadsvy för praktiskt arbete, status och snabb
  dokumentation.
- **Datakälla:** `GET/PATCH /api/cases` med `x-admin-token`.
- **Vad fungerar:** Visar aktiva/inlämnade jobb, pausar auto-refresh när någon
  arbetar i kortet, kan uppdatera status/logg och ladda upp bilder.
- **Demo/mock/fallback:** Ingen tydlig demo. Den är operativ.
- **Vad är trasigt:** Inget uppenbart blockerande i revisionen.
- **Missvisande i UI:** "Aktiva/inlämnade" är snävare än adminens "Aktiva". Den
  visar inte `new`/`contacted`, vilket är rimligt för verkstad men måste vara
  tydligt.
- **Risknivå:** Medel, eftersom sidan skriver ärendestatus.
- **Rekommenderad fix:** Behåll enkelheten. Lägg till liten text: "Nya
  förfrågningar hanteras i Admin, inte här."

### `/prices/`

- **Syfte:** Intern/admin prisdatabas.
- **Datakälla:** `/api/price-catalog` via `x-admin-token`, Netlify Blob
  `price-catalog`.
- **Vad fungerar:** Ladda, söka, lägga till och spara prisrader.
- **Demo/mock/fallback:** Ingen tydlig demo.
- **Vad är trasigt:** Ingen automatisk koppling verifierad mellan intern
  prisdatabas och publik `/priser/`.
- **Missvisande i UI:** Om publik prislista inte uppdateras från samma källa kan
  "intern prisdatabas" och publik prisbild drifta isär.
- **Risknivå:** Medel.
- **Rekommenderad fix:** Etablera en enkel "source of truth"-regel: antingen
  generera `/priser/` från price-catalog eller märk `/prices/` som intern
  Fortnox/checkout-källa.

### `/priser/`

- **Syfte:** Publik prislista.
- **Datakälla:** Statisk HTML.
- **Vad fungerar:** Tydlig publik prisinformation och bokningslänkar.
- **Demo/mock/fallback:** Ingen runtime-fallback.
- **Vad är trasigt:** Statisk prislista kan avvika från business rules och
  intern prisdatabas.
- **Missvisande i UI:** Kunden kan se ett pris som inte matchar intern regel om
  bara ena stället uppdateras.
- **Risknivå:** Medel, eftersom prisinformation påverkar kundförväntningar.
- **Rekommenderad fix:** Kör periodisk diff mellan `/priser/`,
  `business-rules.js` och `price-catalog`.

### Chat-widget

- **Syfte:** Publik snabb intake från sidorna.
- **Datakälla:** `assets/workshop-chat.js` skickar `POST /api/workshop-chat`.
  Utkast sparas tillfälligt i `localStorage` på kundens browser.
- **Vad fungerar:** Skapar case i `workshop-cases` och kan skicka intern
  workshop-avisering via SMS om 46elks är konfigurerat.
- **Demo/mock/fallback:** Om SMS-credentials saknas returnerar backend
  `not_configured`/failed för intern avisering men ärendet skapas ändå.
- **Vad är trasigt:** Publik intake saknar robust rate limiting/spamskydd.
- **Missvisande i UI:** Det kallas chat, men är i praktiken ett asynkront
  kontaktformulär.
- **Risknivå:** Medel till hög, eftersom publik endpoint skriver kundärenden och
  kan trigga intern SMS-avisering.
- **Rekommenderad fix:** Byt copy till "Skicka fråga till verkstaden" eller
  tydliggör att det inte är live-chat. Lägg till rate limiting/idempotency.

## Endpointrevision

### `POST /api/bookings`

- **Syfte:** Skapa bokning/verkstadsärende från publikt bokningsformulär.
- **Datakälla:** Skriver Netlify Blob `workshop-cases`. Använder Google
  Calendar, 46elks och Resend när de är konfigurerade.
- **Vad fungerar:** Skapar case, kontrollerar kalenderfönster, försöker skapa
  kalenderhändelse och skickar kund-/verkstadsnotifieringar.
- **Demo/mock/fallback:** Provider saknas ger `not_configured`. UI kan visa
  manuell uppföljning.
- **Vad är trasigt:** Saknar tydlig rate limiting/idempotency i endpointen.
- **Missvisande i UI:** Frontend-copy kan antyda att SMS/e-post alltid skickas
  direkt.
- **Risknivå:** Hög, eftersom endpointen är publik och skriver data/skickar
  notifieringar.
- **Rekommenderad fix:** Lägg till idempotency key, rate limit och tydligare
  provider-status i kundsvaret.

### `GET|POST|PATCH|DELETE /api/cases`

- **Syfte:** Auktoritativ adminkälla för workshop-cases.
- **Datakälla:** Netlify Blob `workshop-cases` via `workshop-cases.mjs`.
- **Vad fungerar:** Listar ärenden, skapar interna case, uppdaterar status,
  betalning, workshoplogg, content och vissa kommunikationsactions.
- **Demo/mock/fallback:** Ingen demo. Detta är production-data.
- **Vad är trasigt:** Endpointen innehåller flera ansvar i samma fil: case CRUD,
  SMS, offert, betalning, content och thank-you mail.
- **Missvisande i UI:** `summary.active` och adminens "Aktiva" räknar bara ej
  `done`/`archived`.
- **Risknivå:** Hög.
- **Rekommenderad fix:** Behåll `/api/cases` som primär källa men dela upp
  sidoeffekter bakom tydliga actions, dry-run där möjligt och mer specifika
  UI-etiketter.

### `GET|POST /api/call-dashboard`

- **Syfte:** Hämta samtal från 46elks, matcha mot case och skapa/följa upp
  call-leads.
- **Datakälla:** 46elks `/a1/calls`, `workshop-cases`, `call-leads`,
  `call-followups`.
- **Vad fungerar:** Kan bygga samtalsrader, matcha telefonnummer mot case och
  skapa leads/case.
- **Demo/mock/fallback:** Om 46elks saknas returnerar GET 502 i stället för en
  tydlig "ej kopplad" status från denna endpoint.
- **Vad är trasigt:** POST har legacy/default-flöde som kan skicka rabatt-SMS om
  det anropas med credentials. Det är inte förenligt med att akutläget ska vara
  kopiera/exportera som default.
- **Missvisande i UI:** Om call source saknas får siffror aldrig visas som live.
- **Risknivå:** Hög.
- **Rekommenderad fix:** Inför `readOnly/dryRun` även här, returnera
  `sourceUnavailable` på GET när 46elks saknas och låt admin visa
  "samtalsimport ej kopplad".

### `/.netlify/functions/ai-daily-brief`

- **Syfte:** Skapa daily brief med prioriteringar, risk, delar, betalning och
  socialt förslag.
- **Datakälla:** I normal mode läser den shared storage-entiteter:
  `service_cases`, `call_logs`, `sms_drafts`, `part_needs`. POST kan skriva
  `ai_recommendations`.
- **Vad fungerar:** Dry-run ger kontrollerat tomt/deterministiskt svar. Logiken
  kan räkna prioritet/risk om rätt datasets finns.
- **Demo/mock/fallback:** `dryRun` hoppar över reads/writes och returnerar tom
  brief.
- **Vad är trasigt:** Adminens knapp anropar normal GET utan `dryRun`. Den läser
  inte `/api/cases`, vilket gör att briefen kan visa 0/fel trots att admin har
  ärenden.
- **Missvisande i UI:** "Ingen brief" eller "Function error" döljer att
  ärendedata faktiskt finns i `/api/cases`.
- **Risknivå:** Hög för operativa beslut, låg för sidoeffekter vid GET.
- **Rekommenderad fix:** Använd `/api/cases` som primär källa. Treat
  call_logs/sms_drafts/part_needs som optional enrichments. Normal GET ska vara
  read-only och returnera konkret källstatus.

### `/.netlify/functions/call-logs`

- **Syfte:** Läsa/spara call-log-poster i shared storage.
- **Datakälla:** Shared storage-entitet `call_logs`.
- **Vad fungerar:** GET kräver admin-token och returnerar `sourceUnavailable`
  med warnings i stället för 502 när storage saknas. POST har readOnly/dryRun.
- **Demo/mock/fallback:** `readOnly/dryRun/previewOnly` skippar writes.
- **Vad är trasigt:** Det är inte samma sak som live 46elks-importen i
  `/api/call-dashboard`; begreppen kan blandas ihop.
- **Missvisande i UI:** Tom lista ska inte tolkas som noll missade samtal när
  `sourceUnavailable === true`.
- **Risknivå:** Medel.
- **Rekommenderad fix:** UI-copy: "samtalsimport ej kopplad" när
  `sourceUnavailable` är true.

### `/.netlify/functions/customer-export`

- **Syfte:** Read-only export av kunders e-post/telefon.
- **Datakälla:** Primärt intern fetch mot `/api/cases`, därefter optional
  `service_cases`, `customers`, `communication_events`.
- **Vad fungerar:** Kräver admin-token, filtrerar placeholders, skickar inga
  mail/SMS och returnerar även telefonnummer.
- **Demo/mock/fallback:** Optional Blob-källor kan saknas. Admin kan komplettera
  med redan laddade `cases[]`.
- **Vad är trasigt:** Storage warnings kan fortfarande uppfattas som att hela
  kundlistan saknas om UI inte prioriterar `/api/cases`-resultatet.
- **Missvisande i UI:** "Inga e-postadresser" måste särskiljas från "inga
  kunder". Många kunder har telefon men saknar e-post.
- **Risknivå:** Medel, eftersom export är read-only men hanterar kunddata.
- **Rekommenderad fix:** Visa e-post och telefon separat. Visa
  `Customer export storage unavailable` för optional Blob-källor utan att
  blockera `/api/cases`-export.

### `/.netlify/functions/case-events`

- **Syfte:** Lista/skapa timeline-events och interna noteringar.
- **Datakälla:** Shared storage `case_events`, med lookup mot `service_cases`.
- **Vad fungerar:** Kräver admin-token, validerar `caseId`, type och direction.
- **Demo/mock/fallback:** Ingen dry-run/read-only för POST. GET är read-only.
- **Vad är trasigt:** Om shared storage saknar Blob-kontext kan timeline fela
  även när `/api/cases` har `item.timeline`.
- **Missvisande i UI:** Tom/felande timeline kan se ut som att ärendet saknar
  historik.
- **Risknivå:** Medel till hög.
- **Rekommenderad fix:** Lägg fallback till `item.timeline` från `/api/cases`
  och returnera kontrollerad source status.

### `/.netlify/functions/sms-drafts`

- **Syfte:** Lista, skapa och ändra status på SMS-utkast.
- **Datakälla:** Shared storage `sms_drafts` och `case_events`.
- **Vad fungerar:** Kräver admin-token. Skickar inte SMS; `sent` betyder
  markerad skickad, inte provider-send.
- **Demo/mock/fallback:** Status `dry_run` finns.
- **Vad är trasigt:** POST/PATCH skriver till shared storage och kan fela om
  Blob-helpern saknar kontext.
- **Missvisande i UI:** "Markera skickad" kan misstolkas som verkligt SMS om
  copy inte är tydlig.
- **Risknivå:** Medel.
- **Rekommenderad fix:** Etikett: "Markera manuellt skickad" och visa
  sourceUnavailable när draft-källan saknas.

### `/.netlify/functions/ai-sms-draft`

- **Syfte:** Skapa AI/deterministiskt SMS-utkast.
- **Datakälla:** Läser ev. `service_cases`, skriver `sms_drafts`,
  `ai_recommendations` och vid `caseId` `case_events`.
- **Vad fungerar:** Kräver admin-token, riskklassar, skapar utkast och skickar
  inte SMS.
- **Demo/mock/fallback:** `dryRun` i response betyder i praktiken
  "deterministisk AI/provider-fallback", inte nödvändigtvis write dry-run.
- **Vad är trasigt:** Funktionen har inte samma explicit `dryRun/previewOnly`
  write-skip som `ai-quote`. Adminens testknapp kan därför skapa persistent
  draft/recommendation.
- **Missvisande i UI:** "Testa missat samtal-SMS" kan låta helt ofarligt men
  kan skriva utkast.
- **Risknivå:** Hög för dataröra, låg för SMS-skick eftersom inget SMS skickas.
- **Rekommenderad fix:** Lägg till explicit `dryRun/previewOnly` som skippar
  alla Blob-writes och använd det i admin-testknappen.

### `/.netlify/functions/ai-quote`

- **Syfte:** Skapa prisförslag med business rules.
- **Datakälla:** Business rules och optional `price_rules`; normal mode kan
  skriva `ai_recommendations` och `case_events`.
- **Vad fungerar:** `dryRun` skippar reads/writes och E-Wheels E16-regeln ger
  startpris 395 kr och spann 595-1995 kr.
- **Demo/mock/fallback:** Dry-run och deterministic fallback finns.
- **Vad är trasigt:** Inget akut i revisionen.
- **Missvisande i UI:** Måste fortsätta betona att slutpris bekräftas innan
  arbete.
- **Risknivå:** Medel.
- **Rekommenderad fix:** Behåll dry-run som default för testknappar. Normal
  write bör bara användas när ärende och approval-flöde finns.

### `/.netlify/functions/storage-health`

- **Syfte:** Adminskyddad diagnostik för Netlify Blobs-konfiguration.
- **Datakälla:** Testar store-listning för flera Blob-stores.
- **Vad fungerar:** Returnerar booleans och error codes utan att exponera
  secret-värden.
- **Demo/mock/fallback:** `localFallback` visar om lokal fallback är aktiv.
- **Vad är trasigt:** Den säger om stores kan listas, men inte vilken UI-panel
  som ska ignorera optional sources.
- **Missvisande i UI:** Om resultatet bara visas tekniskt riskerar Sebastian
  att tolka "Blobs unavailable" som att alla kundkort saknas.
- **Risknivå:** Låg.
- **Rekommenderad fix:** Visa health-resultat som källstatus per panel:
  "Ärendekälla OK via /api/cases" och "Customer export storage unavailable" för
  optional/future sources.

## Rekommenderad nästa fixordning

1. Byt admin-KPI:n "Aktiva" till ny KPI-modell och döp om totalen till
   "Ej arkiverade" om den ska finnas kvar.
2. Låt AI Kontrolltorn bygga brief från redan laddade `cases[]` i admin och
   från `/api/cases` i `ai-daily-brief`.
3. Gör `call_logs`/46elks status explicit: "samtalsimport ej kopplad" när
   källan saknas, och visa inga live-siffror.
4. Lägg `dryRun/previewOnly` write-skip i `ai-sms-draft`.
5. Lägg timeline fallback från `item.timeline` när `case-events` saknar källa.
6. Separera alla riktiga SMS-actions från test/AI-paneler visuellt och i copy.
7. Lägg rate limiting/idempotency på publika intake-endpoints:
   `/api/bookings` och `/api/workshop-chat`.

## Testnotering

Ingen applikationskod ändrades i denna revision. Enligt uppgiften kördes därför
inte `npm run build`, `npm run verify:checkout-products` eller
`nemob-callflow npm run check`. Dessa ska köras när rekommenderade kodfixar
implementeras.

