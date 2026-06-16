# Codex AI Operator Implementation Plan

Datum: 2026-06-15

## Syfte

Bygg AI-operatoren som ett litet, server-side stodlager i det befintliga
Netlify/Blobs-repot. AI ska analysera, prioritera och skapa utkast. Den ska
inte skicka SMS, fatta bindande beslut eller ersatta befintliga workflows.

## Arkitekturgrans

- Statisk HTML/JavaScript och befintliga routes bevaras.
- Netlify Functions ar AI-operatorens API-yta.
- Netlify Blobs ar lagring under MVP.
- Befintlig `workshop-cases` anvands som `service_cases`.
- Befintlig `price-catalog` anvands som `price_rules`.
- Cloudflare Worker for 46elks andras inte i MVP steg 1.
- Ingen Next.js-, Supabase- eller Claude-kod importeras.

## MVP steg 1

### Gemensamt storage-lager

`netlify/functions/_shared/storage.js` isolerar `@netlify/blobs` och mappar:

- `customers`
- `service_cases`
- `case_events`
- `sms_drafts`
- `call_logs`
- `part_needs`
- `price_rules`
- `ai_recommendations`
- `payments`

Adaptern erbjuder listning, lasning, skrivning och borttagning. Nya
`case_events` kan speglas till befintlig `workshop-cases.timeline` for
bakatkompatibilitet. Befintliga functions migreras inte i detta steg.

### Gemensamma affarsregler

`netlify/functions/_shared/business-rules.js` ar den gemensamma kallan for:

- nuvarande och planerade case-statusar
- godkannandetrosklar och riskmonster
- tillatna lagrisk-intents
- default-prisregler
- SMS-signatur
- Swish och Bankgiro

Reglerna ar kodkonfiguration, inte en datamodellmigrering.

### AI-functions

Tre adminskyddade functions byggs:

1. `ai-sms-draft.js`
   - Laser minsta nodvandiga arendedata.
   - Skapar och sparar ett SMS-utkast.
   - Riskmarkerar och skapar AI-rekommendation.
   - Skickar aldrig SMS.

2. `ai-daily-brief.js`
   - Laser aktiva arenden, samtalsloggar, SMS-utkast och reservdelsbehov.
   - Returnerar deterministisk prioritering, risker och blockerare.
   - POST kan spara briefen som AI-rekommendation.

3. `ai-quote.js`
   - Valjer ett default-prisintervall fran affarsreglerna.
   - Markerar diagnos- och godkannandekrav.
   - Skapar rekommendation men skickar inget till kund.

## Auth och sekretess

- Varje AI-function anropar gemensam `requireAdmin(event)`.
- `x-admin-token` jamfors server-side mot `ADMIN_TOKEN`.
- Saknad `ADMIN_TOKEN` ger `503`; fel eller saknad token ger `401`.
- Ingen AI-function listar eller returnerar kunddata utan godkand token.
- Secrets finns endast i miljo-variabler.

## AI och dry-run

- Utan `OPENAI_API_KEY` anvands deterministisk logik.
- Vid OpenAI-fel faller funktionen tillbaka till deterministisk logik.
- AI-resultat sparas som `draft` eller `proposed`, aldrig `sent`.
- AI-functions anropar inte 46elks, betalningsprovider eller inkopsprovider.
- Prisbelopp fran OpenAI far inte skriva over default-prisreglerna.

## Verifiering for steg 1

- `node --check` pa delade moduler och de tre AI-functions.
- Auth-smoketest: saknad/fel token ska ge `401`.
- Deterministiskt smoketest for SMS-utkast, prisregel och riskbedomning.
- Bekrafta att AI-functions inte importerar eller anropar SMS-sandning.

## Inte i MVP steg 1

- Admin-UI eller storre redesign
- PWA eller PDF-offert
- Swish-integration
- Supabase eller datamodellmigrering
- Inbound-SMS, delivery reports eller 46elks-andringar
- Migrering av alla befintliga direkta Blob-anrop

## Nasta steg efter godkand MVP

Koppla admin till read-only daily brief och AI-utkast, lagg till riktade
integrationstester och migrera darefter en befintlig operation i taget till
storage-helpern.
