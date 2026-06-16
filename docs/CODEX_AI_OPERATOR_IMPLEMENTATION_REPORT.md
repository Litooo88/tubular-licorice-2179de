# Codex AI Operator Implementation Report

Datum: 2026-06-15

## MVP steg 1

Ett minimalt AI Kontrolltorn har lagts högst upp i `/admin`-översikten.
Ingen PWA, PDF-offert, Swish-integration, Supabase-implementation eller större
redesign har byggts.

Kontrolltornet visar:

- dagens prioritet
- missade samtal
- väntar kund
- väntar reservdel
- klara att fakturera
- riskärenden
- möjlig intäkt idag
- föreslagen social post

## Ändrade filer

- `admin/index.html`
  - Lägger till den minimala Kontrolltorn-panelen.
  - Hämtar data från den auth-skyddade daily brief-funktionen.
- `netlify.toml`
  - Mappar AI-routes till Netlify Functions.
- `netlify/functions/_shared/http.js`
  - Gemensam server-side auth och JSON-svar.
- `netlify/functions/_shared/storage.js`
  - Gemensam Netlify Blobs-helper.
- `netlify/functions/_shared/business-rules.js`
  - Case-statusar, approval-regler, default-priser och betalningsuppgifter.
- `netlify/functions/_shared/operator.js`
  - Deterministiska AI-utkast, riskbedömning och prisregelval.
- `netlify/functions/ai-sms-draft.js`
- `netlify/functions/ai-daily-brief.js`
- `netlify/functions/ai-quote.js`
- `docs/API_CONTRACTS.md`
- `docs/CODEX_AI_OPERATOR_IMPLEMENTATION_PLAN.md`
- `docs/CODEX_AI_OPERATOR_IMPLEMENTATION_REPORT.md`

## Skapade Netlify Functions

- `ai-sms-draft.js`: skapar SMS-utkast men skickar aldrig SMS.
- `ai-daily-brief.js`: bygger Kontrolltornets prioriteringar och nyckeltal.
- `ai-quote.js`: skapar prisintervall, aldrig bindande slutpris.

## Storage-helper

`netlify/functions/_shared/storage.js` isolerar `@netlify/blobs` och erbjuder
gemensam listning, läsning, skrivning och borttagning för:

`customers`, `service_cases`, `case_events`, `sms_drafts`, `call_logs`,
`part_needs`, `price_rules`, `ai_recommendations` och `payments`.

`service_cases` mappar bakåtkompatibelt till befintliga `workshop-cases`.
`price_rules` mappar till befintliga `price-catalog`.

## Auth

Alla AI-functions anropar `requireAdmin(event)` från `_shared/http.js`.
Headern `x-admin-token` jämförs server-side mot miljövariabeln `ADMIN_TOKEN`.
Saknad eller felaktig token returnerar ingen kunddata.

## Mock och dry-run

- Utan `OPENAI_API_KEY` används deterministiska regler.
- OpenAI-fel faller tillbaka till deterministisk logik.
- AI skapar endast utkast och rekommendationer.
- AI-functions skickar inte SMS och anropar inte betalningsprovider.
- Prisförslag har alltid `finalPrice: null`; slutpris bekräftas före arbete.

## Verifiering

- `npm run build`: godkänd.
  - Genererade HTML för 24 produkter och 4 tillbehör.
- `npm run verify:checkout-products`: godkänd.
  - Verifierade 24 checkout-produkter.
- `nemob-callflow: npm run check`: godkänd.
  - `tsc --noEmit` utan fel.
- Syntax-, auth- och AI-kontraktstester: godkända.

## Kvarstående risker

- `ADMIN_TOKEN` sparas fortfarande i admin-klientens `localStorage`.
- Legacy-functions använder fortfarande flera direkta Blob-anrop.
- Callflow fyller inte ännu den nya `call_logs`-samlingen.
- Kontrolltornets kvalitet beror på att normaliserade Blob-samlingar fylls.
- Produktionscredentials för Netlify Blobs och OpenAI är inte
  integrationstestade lokalt.

## Nästa rekommenderade steg

Koppla callflow och befintliga workshop-actions till normaliserade Blob-poster
en integration i taget. Behåll AI som read-only/förslagsmotor tills audit-logg
och approvalflöde har verifierats.

## MVP steg 2

AI Kontrolltornet i `/admin` är nu kopplat till de tre Netlify Functions som
skapades i steg 1. Alla AI-anrop är manuella; ingen auto-refresh har lagts
till.

### Ändrade filer

- `admin/index.html`
  - Kopplar Kontrolltornet till de direkta Netlify Function-URL:erna.
  - Visar loading, fel, saknad token, `401`/ej behörig, dry-run och senaste
    uppdateringstid.
  - Visar hela daily brief-svaret.
  - Lägger till två manuella testknappar och resultatytor.
- `netlify/functions/_shared/operator.js`
  - Tolkar `eventType` och E16-felbeskrivning i deterministiska regler.
- `netlify/functions/ai-sms-draft.js`
  - Tolkar `missed_call_followup` som låg-risk missat-samtal-utkast.
- `netlify/functions/ai-quote.js`
  - Exponerar fälten som adminens E16-test visar.
- `docs/CODEX_AI_OPERATOR_IMPLEMENTATION_REPORT.md`

### Buttons och fetch-anrop

- **Uppdatera AI-brief**
  - `GET /.netlify/functions/ai-daily-brief`
- **Testa E-Wheels E16 prisförslag**
  - `POST /.netlify/functions/ai-quote`
  - Payload: `brand`, `model` och `issueDescription: "Felkod E16"`.
- **Skapa missat samtal-SMS**
  - `POST /.netlify/functions/ai-sms-draft`
  - Payload simulerar `missed_call_followup` och en testkund.

Testknappen skapar ett sparat SMS-utkast och AI-rekommendation via
storage-helpern. Inget SMS skickas.

### Admin-token

AI-anrop läser den befintliga sparade tokenen från
`localStorage.nordicAdminToken`. Token skickas endast som headern
`x-admin-token` till Netlify Functions. Saknad token visas som
`Admin-token saknas`; HTTP `401` visas som `Ej behörig`.

### Exempel: ai-daily-brief

```json
{
  "summary": "2 aktiva ärenden, 1 riskärenden och 1 klara för betalning.",
  "topPriorities": [{ "id": "case_1", "status": "waiting_customer", "value": 1200 }],
  "cashToday": 595,
  "riskCases": [{ "id": "case_1", "risk": { "level": "high" } }],
  "missedCallsToFollowUp": [{ "id": "call_1", "status": "missed" }],
  "partsToOrder": [{ "id": "part_1", "status": "needed" }],
  "readyForPayment": [{ "id": "case_2", "status": "ready" }],
  "salesOpportunities": [],
  "socialMediaSuggestion": "Dagens verkstadsögonblick ..."
}
```

### Exempel: ai-quote

```json
{
  "startPrice": 395,
  "likelyMin": 595,
  "likelyMax": 1995,
  "requiresDiagnosis": true,
  "requiresApproval": true,
  "customerMessage": "E-Wheels E16: från 395 kr, normalt spann 595-1995 kr. Slutpris bekräftas innan arbete.",
  "internalNotes": "E-Wheels E16. Risknivå: high. Kräver godkännande."
}
```

### Exempel: ai-sms-draft

```json
{
  "smsDraft": "Hej Testkund! Vi såg att du ringde Nordic E-Mobility ...",
  "riskLevel": "low",
  "requiresApproval": false,
  "suggestedNextStatus": "NY FÖRFRÅGAN",
  "internalSummary": "SMS-utkast skapat för missed_call_reply. Risk: low. Lågriskutkast."
}
```

### Testresultat

- Admin inline JavaScript och Netlify Function-syntax: godkänd.
- Daily brief-, E16 quote- och missat-samtal-SMS-kontrakt: godkända.
- Missat-samtal-testet sparar `sms_drafts` och `ai_recommendations`.
- Lokal UI-kontroll: alla steg 2-paneler och knappar visas utan horisontell
  overflow; saknad token visas och blockerar anrop.
- `npm run build`: godkänd.
- `npm run verify:checkout-products`: godkänd.
- `nemob-callflow: npm run check`: godkänd.

### Kvarstående risker

- Admin-token ligger fortfarande i `localStorage`, enligt befintlig MVP-auth.
- Kontrolltornet blir komplett först när `call_logs` och `part_needs` fylls av
  de operativa integrationerna.
- Testknapparna skapar riktiga Blob-utkast/rekommendationer i den miljö där
  admin körs.
- AI-funktionerna är fortfarande förslagsmotorer; inga beslut verkställs.

### Rekommenderat MVP steg 3

Koppla befintliga callflow- och workshop-händelser till normaliserade
`call_logs`, `part_needs` och `case_events`, och lägg till enkel filtrering av
testdata i Kontrolltornet.

## MVP steg 3

MVP steg 3 kopplar riktiga timeline-events, interna noteringar och SMS-utkast
till befintliga kundarenden. Ingen riktig SMS-sandning, Supabase eller stor
admin-redesign har lagts till.

### &Auml;ndrade filer

- `netlify/functions/_shared/storage.js`
  - Normaliserar nya `case_events` och speglar dem bakatkompatibelt till
    befintlig `workshop-cases.timeline`.
- `netlify/functions/case-events.js`
  - Listar events per `caseId` och skapar events/interna noteringar.
- `netlify/functions/sms-drafts.js`
  - Listar och markerar SMS-utkast med audit-logg i `case_events`.
- `netlify/functions/ai-sms-draft.js`
  - Sparar `caseId`/`customerId` och skapar ett kopplat `ai_suggestion`-event.
- `admin/index.html`
  - Lagger till en minimal Timeline-flik i befintliga kundkort.
- `docs/CODEX_AI_OPERATOR_IMPLEMENTATION_REPORT.md`

### Functions

`case-events.js` accepterar endast:

- typer: `sms`, `call`, `status_change`, `quote`, `payment`, `part`, `note`,
  `ai_suggestion`, `booking`
- riktningar: `inbound`, `outbound`, `internal`

Ett event sparas med `id`, `caseId`, `customerId`, `type`, `direction`,
`content`, `metadata`, `createdBy` och `createdAt`. Listning kraver `caseId`
och returnerar senaste events forst via storage-helperns sortering.

`sms-drafts.js` kan lista alla utkast eller filtrera pa `caseId`/status.
Tillatna statusar ar `draft`, `approved`, `rejected`, `sent` och `dry_run`.
Varje statusandring loggas som ett `sms`-event om utkastet har `caseId`.
`sent` ar endast en administrativ markering i denna iteration; funktionen
skickar inget SMS och returnerar `sent: false`. Hogrisksutkast maste vara
`approved` innan de kan markeras som `sent`.

### Admin timeline

Varje befintligt kundkort har en ny, liten `Timeline`-flik. Data laddas
manuellt nar fliken oppnas eller knappen `Uppdatera timeline` anvands.
Timeline visar typ, tid, skapare, innehall och kompakt metadata. Tomt state
visas om arendet saknar events.

Fliken visar aven SMS-utkast for valt arende med meddelande, riskniva,
approval-krav, status och skapad tid. Admin kan godkanna, avvisa, markera
dry-run eller markera skickad. Ingen av knapparna skickar SMS.

### Intern notering och statusandringar

`Lagg intern notering` skapar ett `note`/`internal`-event via
`/.netlify/functions/case-events`. Noteringen kraver ett riktigt `caseId`.

Snabbstatus och status i befintligt redigeringsformular forsoker efter en
lyckad arendeuppdatering skapa ett separat `status_change`-event med
`fromStatus` och `toStatus` i metadata. Om timeline-loggningen misslyckas
visas ett fel utan att den redan sparade arendeuppdateringen doljs.

### Auth

`case-events.js`, `sms-drafts.js` och `ai-sms-draft.js` anropar
`requireAdmin(event)`. `x-admin-token` jamfors server-side mot `ADMIN_TOKEN`.
Admin skickar endast den befintliga localStorage-tokenen som
`x-admin-token`. HTTP `401` visas som ej behorig i timeline-vyn.

### Testresultat

- Function-syntax och aktuell inline-JavaScript i admin: godkand.
- Isolerat auth-/handlerprov for `case-events`: godkant.
- Isolerat handlerprov for SMS-status och case-event audit: godkant.
- Hogrisksutkast blockeras fran `sent` fore `approved`: godkant.
- `ai-sms-draft` sparar `caseId`/`customerId`, skapar `ai_suggestion` och
  anvander dry-run utan `OPENAI_API_KEY`: godkant.
- `npm run build`: godkand.
  - Genererade HTML for 24 produkter och 4 tillbehor.
- `npm run verify:checkout-products`: godkand.
  - Verifierade 24 checkout-produkter.
- `nemob-callflow: npm run check`: godkand.
  - `tsc --noEmit` utan fel.
- Visuell kontroll i den inbyggda browsern kunde inte koras eftersom lokal
  `file://`-navigering blockerades av browserns sakerhetspolicy.

### Kvarstaende risker

- `ADMIN_TOKEN` ligger fortsatt i localStorage enligt befintlig MVP-auth.
- Statusandringar fran andra ytor an `/admin` skapar inte alltid normaliserade
  `case_events`; den gamla timeline-spegeln finns kvar for bakatkompatibilitet.
- Befintliga aldre SMS-utkast kan ha legacy-statusar tills de uppdateras.
- Lokal end-to-end-test mot riktig Netlify Blobs-miljo kraver `netlify dev`
  eller deploy-preview med konfigurerade credentials.
- Storage-helpern listar hela Blob-storen innan filtrering, vilket bor
  optimeras nar datamangden blir storre.

### Rekommenderat MVP steg 4

Koppla callflow, offert-, reservdels- och betalningsactions server-side till
normaliserade `case_events`, och lagg till en kontrollerad backfill av legacy
timeline/SMS-statusar. Behall riktig SMS-sandning avstangd tills approval-
och audit-flodet har integrationstestats i deploy-preview.

## Efterkontroll 2026-06-16

Efter MVP steg 3 kordes den begarda efterkontrollen utan commit eller push.

### Kommandon

- `git status --short`
- `npm run build`
- `npm run verify:checkout-products`

### Git-status

Relevanta MVP-/AI-operatorfiler i status:

- `admin/index.html`
- `netlify.toml`
- `netlify/functions/_shared/`
- `netlify/functions/ai-daily-brief.js`
- `netlify/functions/ai-quote.js`
- `netlify/functions/ai-sms-draft.js`
- `netlify/functions/call-logs.js`
- `netlify/functions/case-events.js`
- `netlify/functions/sms-drafts.js`
- `docs/CODEX_AI_OPERATOR_IMPLEMENTATION_PLAN.md`
- `docs/CODEX_AI_OPERATOR_IMPLEMENTATION_REPORT.md`
- AI-/projektminnesdokumenten under `docs/`
- `AGENTS.md`
- `CLAUDE.md`

Ovrigt som ocksa syns i `git status --short`:

- `book-online/index.html`
- `index.html`
- `nya-elscootrar/index.html`
- `package-lock.json`
- `.netlify/`
- `tmp-drive-candidates/`
- `tmp-drive-folder.html`
- `tmp-navee-inventory.csv`
- `docs/seo-audit-2026-05.md`
- `docs/site-architecture-2026-05.md`

### Testresultat

- `npm run build`: godkand.
  - `generate-products.mjs` genererade 24 produkt-HTML och 4 tillbehor.
  - `nya-elscootrar/index.html` uppdaterades av builden.
- `npm run verify:checkout-products`: godkand.
  - 24 checkout-produkter verifierades over `index.html` och
    `nya-elscootrar/index.html`.

### Deploy-status

Inget testfel blockerar deploy.

Det finns daremot tva praktiska deploy-risker att hantera innan produktion:

- Andringarna ar fortfarande ocommitade/untracked, enligt instruktionen att
  inte committa eller pusha utan uttrycklig bekraftelse. Git-baserad Netlify-
  deploy far inte med dessa filer forran de valjs, committas och pushas.
- `netlify.toml` har `publish = "."`. Vid manuell/local deploy kan untracked
  artefakter som `.netlify/`, `tmp-drive-candidates/`, `tmp-drive-folder.html`
  och `tmp-navee-inventory.csv` riskera att folja med om de inte tas bort eller
  ignoreras fore deploy.

Ingen commit eller push har gjorts.
