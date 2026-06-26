# MVP4 Kommunikationsradar Testplan

## Kodkontroller

Kör:

```powershell
node --check netlify/functions/_shared/communication-radar.js
node --check netlify/functions/communication-radar-demo.js
node --check netlify/functions/communication-events.js
node --check netlify/functions/ai-communication-draft.js
npm run build
npm run verify:checkout-products
cd nemob-callflow
npm run check
cd ..
```

## Lokal Netlify dev

Starta:

```powershell
$env:NORDIC_LOCAL_STORAGE_FALLBACK="1"
$env:ADMIN_TOKEN="test-token"
npx netlify dev
```

Verifiera:

- utan token returnerar alla MVP4-endpoints 401
- fel token returnerar 401
- rätt token returnerar demo-data
- `communication-events` med `dryRun: true` skriver inte
- `ai-communication-draft` med `dryRun: true` skriver inte
- inget SMS skickas
- ingen Gmail kopplas live
- inga privata SMS läses

## Endpoints

### Demo

`GET /.netlify/functions/communication-radar-demo`

Förväntat:

- `200`
- `dryRun: true`
- `mode: deterministic_mock`
- `externalCallsSkipped` innehåller `gmail`, `sms`, `46elks`

### Communication events

`GET /.netlify/functions/communication-events?dryRun=1`

Förväntat:

- `200`
- demo-events
- `writesSkipped` innehåller `communication_events`

`POST /.netlify/functions/communication-events` med:

```json
{
  "source": "gmail",
  "from": "kund@example.test",
  "subject": "Batteri luktar bränt",
  "bodySummary": "Kunden frågar om garanti",
  "dryRun": true
}
```

Förväntat:

- `200`
- `risk.level: high`
- `writesSkipped` innehåller `communication_events` och `case_events`

### AI communication draft

`POST /.netlify/functions/ai-communication-draft` med dry-run-event.

Förväntat:

- `200`
- `dryRun: true`
- draft-status `draft` eller `needs_approval`
- `sendsMessage: false`
- `writesSkipped` innehåller `ai_response_drafts`

## Admin UI

Öppna `/admin/` i lokal Netlify dev.

Verifiera:

- panelen `Kommunikationsradar` syns i overview
- utan sparad token visas `Admin-token saknas`
- med token kan mock-data hämtas
- korten `Nya inkommande`, `Kräver svar`, `Riskärenden`, `Leverantörer`, `Utkast`, `Koppla till ärende` fylls
- high-risk batteri/garanti/reklamation visas som kräver godkännande
- testknappen för svarsförslag kör dry-run och visar att inget skickas
- event med `caseId` visar timeline-preview

## Production sanity efter eventuell merge

Kör endast säkra anrop:

- utan token: 401 på MVP4-endpoints
- med säker lokal token: endast demo/dry-run
- inga writes
- inget SMS
- ingen Gmail
