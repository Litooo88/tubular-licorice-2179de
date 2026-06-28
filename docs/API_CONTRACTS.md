# API Contracts

## Kontraktsregler

- Detta dokument skiljer mellan **nuvarande** och **framtida** kontrakt.
- Kunddata och admin-actions ska hanteras server-side.
- Admin- och AI-endpoints ska vara auth-skyddade.
- Sidoeffekter ska stödja idempotency key och helst `dryRun`.
- Fel ska returnera JSON: `{ "error": "..." }` med korrekt HTTP-status.
- Inga secrets eller interna providerfel får exponeras till publik klient.

## Nuvarande API-inventering

Publika intake/webhook-endpoints:

- `POST /api/bookings`
- `POST /api/workshop-chat`
- `/api/voice-start` för 46elks-flow
- `POST /.netlify/functions/create-checkout`
- `POST /.netlify/functions/stripe-webhook`

Adminskyddade endpoints med `x-admin-token`:

- `GET|POST|PATCH|DELETE /api/cases` och `/api/cases/:id`
- `GET|POST|DELETE /api/cases/:id/media`
- `POST /api/cases/:id/analyze`
- `GET|PUT|POST /api/price-catalog`
- `GET|POST /api/call-dashboard`
- `POST /api/calendar-self-test`

Övrigt:

- `GET /api/case-media/:caseId/:mediaId` kräver `x-admin-token`; ärendebilder
  är interna och får inte serveras publikt.
- `GET /api/booking-env-status` kräver `x-admin-token` och får inte exponera
  integrationsdiagnostik eller publicConfig utan admin-auth.
- `netlify/functions/cases.mjs` använder avsiktligt disabled rescue-routes.
- Cloudflare Worker-routes dokumenteras i `nemob-callflow/README.md`.

## Framtida: POST /api/bookings

Status: **finns idag**, men ska senare anpassas till gemensam datamodell.

Syfte: skapa bokning och kundärende.

Minsta request:

```json
{
  "name": "Kundnamn",
  "phone": "+467...",
  "email": "kund@example.se",
  "service": "Punktering / däck",
  "preferredDate": "2026-06-16T10:00:00+02:00",
  "vehicle": "Xiaomi Pro 2",
  "message": "Bakdäcket är platt",
  "ownershipConfirm": "yes",
  "termsConfirm": "yes"
}
```

Response `201`: `{ "ok": true, "id": "...", "case": { ... } }`.

## Framtida: POST /api/ai/sms-draft

Auth: admin/operator. Ingen direkt SMS-sändning.

```json
{
  "caseId": "case_...",
  "intent": "status_update",
  "dryRun": true
}
```

Response innehåller `draft`, `riskLevel`, `requiresApproval`,
`approvalReasons` och `missingData`.

## Framtida: POST /api/ai/daily-brief

Auth: admin/operator.

Request kan innehålla datum, operatör och filter. Response ska prioritera
ärenden, risker, väntande godkännanden, reservdelar, klara jobb och
betalningsuppföljning. Endpointen får inte ändra data.

## Framtida: POST /api/ai/quote

Auth: admin/operator. Ska endast skapa prisförslag.

Request ska innehålla `caseId`, diagnos, föreslagna åtgärder och eventuella
reservdelar. Response ska innehålla prisintervall, källor från `price_rules`,
osäkerhet, risknivå och godkännandekrav. Får aldrig skicka förslaget direkt.

## Framtida: POST /api/elks/sms-inbound

Auth: verifierad 46elks-webhook via IP-allowlist/signatur.

Ska:

- normalisera avsändare
- matcha kund/ärende
- skapa `case_event`
- spara inbound SMS
- markera oläst svar
- aldrig automatiskt tolka `JA` som bindande godkännande utan dokumenterad
  regel och audit trail

## Framtida: POST /api/elks/call-event

Auth: verifierad 46elks-webhook.

Ska normalisera start, route, svarat, missat, voicemail och hangup till
`call_logs` och `case_events`. Event ska vara idempotenta på provider-event-ID.

## Framtida: POST /api/elks/delivery-report

Auth: verifierad 46elks-webhook.

Ska uppdatera leveransstatus för ett tidigare SMS utan att ändra meddelandets
innehåll. Tillåtna statusar bör vara `queued`, `sent`, `delivered`, `failed`
och `unknown`.

## Nuvarande: POST /.netlify/functions/stripe-webhook

Auth: verifierad Stripe-signatur via `STRIPE_WEBHOOK_SECRET`.

Status: finns idag för produkt-checkout. Endpointen returnerar `503` om
`STRIPE_WEBHOOK_SECRET` saknas, `400` vid ogiltig signatur och skriver endast
betalningspost till `payments` efter verifierad `checkout.session.completed`.
Den skickar inga SMS eller mail.

## Rekommenderad auth-migrering

Nuvarande `x-admin-token` är en enkel MVP-lösning. Framtida API bör använda
server-side session/JWT med roller, RLS och audit-logg. Behåll kompatibilitet
under migreringen men skapa inte fler klientlagrade mastertokens.

## Nuvarande AI-kontrakt

Alla AI-endpoints kräver `x-admin-token` mot `ADMIN_TOKEN` och fungerar med
deterministisk fallback utan `OPENAI_API_KEY`. Ingen av dem skickar SMS.

`POST /api/ai/sms-draft` returnerar `smsDraft`, `riskLevel`,
`requiresApproval`, `suggestedNextStatus`, `suggestedPriceRange` och
`internalSummary`.

`GET|POST /api/ai/daily-brief` returnerar `summary`, `topPriorities`,
`cashToday`, `riskCases`, `missedCallsToFollowUp`, `partsToOrder`,
`readyForPayment`, `salesOpportunities` och `socialMediaSuggestion`.

`POST /api/ai/quote` använder `price_rules` och fallback-regler från
`netlify/functions/_shared/business-rules.js`. Den returnerar alltid
prisintervall/startpris, `finalPrice: null` och besked om att slutpris
bekräftas före arbete.
