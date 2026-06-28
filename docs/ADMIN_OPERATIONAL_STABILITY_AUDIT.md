# Admin Operational Stability Audit

Datum: 2026-06-28

Syfte: stabilisera `/admin/` som operativ kontrollpanel utan att ta bort
dashboards, blanda mock med live-data eller bryta befintliga flöden.

## Baseline

- Branch vid start: `main`
- Senaste baseline-commit: `4a212d6 Log post PR 76 verification`
- Stash ska inte poppas. Under arbetet finns även en separat parkerad
  experimentstash för intern SMS-fallback.
- Baslinjetester innan ändring:
  - `npm run build` ✅
  - `npm run verify:checkout-products` ✅
  - `cd nemob-callflow && npm run check` ✅

## Panelkarta

| Panel | Datakälla / endpoint | Status | Vad fungerar | Demo/fallback/källa saknas | Risknivå | Stabilitetsregel |
|---|---|---:|---|---|---:|---|
| AI Kontrolltorn | `/.netlify/functions/ai-daily-brief`, fallback från redan laddade `/api/cases` | Live + fallback | Visar prioritet, risk, väntar kund/del, faktura och socialt förslag | Blob-källor som `call_logs`, `sms_drafts`, `part_needs` kan saknas utan att blockera brief | Medel | Får inte ersättas av Kommunikationsradar. Ska visa konkret källstatus, inte generiskt Function error. |
| Kundexport | `/.netlify/functions/customer-export`, redan laddade `/api/cases` i admin | Read-only | Visar och kopierar e-post och telefonnummer, filtrerar placeholders | Om separata Blob-källor saknas används laddade case-kort om de finns | Medel | Får inte försvinna. Ska visa telefonnummer även när e-post saknas. Inget mail/SMS. |
| Kommunikationsradar | `/.netlify/functions/communication-radar-demo`, `ai-communication-draft` dry-run | Demo/test | Visar tänkt klassning av inkommande kommunikation | Mockdata, inga riktiga Gmail/SMS/samtal | Låg om tydligt märkt | Måste vara tydligt demo/test och ligga separerad från operativ uppföljning. |
| Live samtalsdashboard | `/api/call-dashboard`, `/.netlify/functions/call-logs?readOnly=1` | Live när 46elks/call-log finns | Kan visa samtal och leads när källa är konfigurerad | Vid saknad källa visas 0/okänt och akutpanelen används | Medel | Får inte visa falska siffror som live när källa saknas. |
| Akut uppföljning – missade samtal | Klientparser + `/api/cases` via redan laddade case-kort | Operativ copy/export | Klistra in nummer, deduplicera, matcha mot case, skapa kopierbara SMS-utkast | Ingen automatisk sändning | Låg | Ska alltid säga att inget SMS skickas från vyn. |
| SMS till kund | `/api/cases/:id` med `action: send_sms` | Live med approval | Kopiera utkast säkert, live-knapp kräver confirm och admin-token | Sändning beror på 46elks-env | Hög | Live-sändning måste vara explicit, visa mottagare/text/varning och loggas. |
| Kundkort/ärenden | `/api/cases` | Live | Läser, visar och uppdaterar verkstadsärenden | Kräver admin-token och Netlify Blobs | Hög | Detta är primär operativ källa för admin. |
| Voice/callflow | Netlify voice functions + `nemob-callflow/` worker | Delvis kopplat | Netlify voice endpoints skyddas av `VOICE_WEBHOOK_SECRET`; worker har separat check | Production svarar 503 tills secret/46elks URL är konfigurerad | Hög | Får inte aktivera routing/SMS utan secret och separat verifiering. |

## Kundexport

Kundexport är read-only och ska aldrig skicka mail eller SMS.

Kravstatus:

- Panel `Kundexport` finns i `/admin/`.
- Knappar finns:
  - `Exportera kundlista`
  - `Kopiera e-postlista`
  - `Kopiera telefonlista`
- UI visar e-post och telefonnummer i separata textfält.
- Placeholder-adresser `email@example.com` och `test@example.com` filtreras.
- Endpointen kräver `x-admin-token`.
- Endpointen returnerar `readOnly: true`, `sendsEmail: false`,
  `sendsSms: false`.
- Endpointen läser `/api/cases` som primär källa när intern URL kan byggas.
- Endpointen returnerar versionsmarkör `customer-export-v2-api-cases`.
- Om e-post saknas men telefonnummer finns ska UI visa att telefonnummer finns.
- Om källa saknas ska UI visa `Kundkälla saknas eller kunde inte läsas`.

## AI Kontrolltorn

AI Kontrolltorn ska använda `/api/cases` som primär ärendekälla. Saknade
sekundärkällor ska redovisas som varningar, inte krascha kontrolltornet.

Nuvarande status:

- `ai-daily-brief` kräver admin-token.
- Dry-run/read-only kan verifieras utan writes.
- GET bygger brief utan att skriva `ai_recommendations`.
- POST kan försöka spara rekommendation, men fångar write-fel och returnerar
  kontrollerad JSON.
- Admin kan bygga lokal fallback från redan laddade case-data.

## Kommunikationsradar

Kommunikationsradar är demo/test tills riktiga Gmail/SMS/call-log-integrationer
är kopplade. Den får inte se ut som live-data.

Nuvarande status:

- Rubriken är `Kommunikationsradar – demo/test`.
- Panelen säger att mockdata används.
- Panelen säger nu också uttryckligen: `Inget skickas.`
- Raderna är märkta `Demo:`.
- Svarsförslag kör dry-run.

## Live Samtal

Live samtalsdashboard får finnas kvar men ska inte visa falska siffror när
call-log-källan saknas.

Nuvarande status:

- `call-logs` kräver admin-token.
- GET returnerar `storageAvailable`, `sourceUnavailable`, `sourceLabel` och
  `warnings`.
- Admin kontrollerar `call-logs?readOnly=1` före `/api/call-dashboard`.
- Vid `sourceUnavailable` visar admin:
  `Samtalsimport ej kopplad: 46elks/call-log källa saknas eller är inte konfigurerad.`
- Siffror renderas inte som live när källa saknas.

## SMS Och Chatt

Befintligt chattflöde ska bevaras. Det är ett liveflöde som kan skapa case och
skicka intern SMS-notis när 46elks-env är konfigurerad.

Separat status finns i `docs/OPERATIONAL_SMS_FLOW_STATUS.md`.

Stabilitetsregler:

- Inget SMS skickas i demo/test/dry-run-paneler.
- Kund-SMS kräver explicit knapptryck och confirm.
- Chattnotis till personal får inte försvinna utan separat beslut.
- Sändning till kund ska vara approval-baserad.

## Externa Secrets / Konfiguration

Kända saknade eller deploy-blockerande externa config:

- `VOICE_WEBHOOK_SECRET` krävs innan Netlify voice webhooks routar samtal eller
  skickar missat-samtal-SMS.
- 46elks `voice_start` måste peka på:
  `https://www.nordicemobility.se/api/voice-start?secret=<VOICE_WEBHOOK_SECRET>`
- `STRIPE_WEBHOOK_SECRET` saknas fortfarande enligt tidigare verifiering, så
  Stripe webhook är inactive/503 tills signing secret är konfigurerad.
- Authade production-anrop kräver säker lokal `ADMIN_TOKEN`; token ska aldrig
  loggas eller dokumenteras.

## Regressioner Att Bevaka

- Kundexportpanelen försvinner eller visar bara “0” trots telefonnummer i case.
- `customer-export` slutar returnera `phones`, `storageHealth` eller
  `readOnly/sendsEmail/sendsSms`.
- AI Kontrolltorn går tillbaka till `Function error` i stället för konkret
  källstatus.
- Kommunikationsradar flyttas upp eller ser ut som live-data.
- Live samtalsdashboard visar falska “missade/leads”-siffror när källa saknas.
- Akut uppföljning tappar parser, deduplicering eller kopiera-knappar.
- SMS till kund skickar utan explicit confirm.
- Chattnotis till personal bryts utan att ersättas med tydlig `not_configured`
  status.
- Handboks-/AI-regelfiler ersätter operativa paneler i admin.

## Ändringar I Denna Stabiliseringsrunda

- `customer-export` fick explicit versionsmarkör:
  `customer-export-v2-api-cases`.
- `customer-export` returnerar safetyfält även vid kontrollerad 500:
  `readOnly`, `sendsEmail`, `sendsSms`, `storageHealth`.
- Admins kundexportstatus visar version/källa och tydligare
  `Kundkälla saknas eller kunde inte läsas`.
- Kommunikationsradar-copy säger nu uttryckligen `Inget skickas.`

## Testplan

- `node --check` på ändrade JS-filer.
- Validera data JSON om workshop-data ändras.
- `npm run build`.
- `npm run verify:checkout-products`.
- `cd nemob-callflow && npm run check`.
- Lokal smoke i admin:
  - Kundexport syns med tre knappar.
  - AI Kontrolltorn syns.
  - Kommunikationsradar syns som demo/test.
  - Live samtal visar källa saknas när call-log saknas.
  - Akut uppföljning kan parsa testnummer och kopiera SMS-utkast.
  - SMS/mail skickas inte under test.
