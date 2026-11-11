# NEMOB OS 2.0 — API-kontrakt för backend-integrationer

Status: 2026-11-11, branch `feat/nemob-os-2-backend`. Verifierat mot koden i
`netlify/functions/` (52 funktioner inventerade). Codex äger
`nemob-os/**` och integrerar mot kontrakten här; backend-ändringar görs av
Claude Code i `netlify/functions/**`.

Principer som gäller alla endpoints nedan:

- **Autentisering.** Alla admin-endpoints kräver headern `x-admin-token`
  som jämförs tidssäkert med Netlify-variabeln `ADMIN_TOKEN`. Saknas
  variabeln svarar servern `503 {"error": "ADMIN_TOKEN saknas …"}`, fel
  token ger `401 {"error":"Unauthorized"}`. NEMOB OS läser samma värde ur
  sin egen env `NORDIC_ADMIN_TOKEN` och skickar det **server-till-server**
  (mönstret i `nemob-os/lib/admin-cases.mjs`); token ska aldrig nå
  webbläsaren. Admin-sidorna under `/admin/` lagrar fortfarande token i
  `localStorage` — det är ett känt arv, inte något NEMOB OS 2.0 ska kopiera.
- **Bas-URL.** Produktion `https://www.nordicemobility.se`. v2-funktioner
  har egna `path`; äldre v1-funktioner nås bara på
  `/.netlify/functions/<namn>`. Inga redirects påverkar `/api/*`.
- **Felformat.** JSON `{ "error": "<svensk text>", "code"?: "<maskinläsbar>" }`.
  Statuskoder: 400 valideringsfel, 401/503 auth, 404 saknas, 405 metod,
  409 konflikt/affärsregel, 412 `If-Match` matchade inte, 429 rate limit,
  502 providerfel (46elks/Resend), 500 oväntat.
- **Datakällor.** Netlify Blobs (strong consistency). Primär store
  `workshop-cases` (ett ärende = en blob med nyckel = ärende-id). Övriga
  stores står per endpoint. Ingen SQL, ingen gemensam typmodell ännu.
- **Konfigurationssaknad = säkert läge.** Integrationer svarar
  `{ status: "not_configured" }` i stället för att kasta när env saknas.
- **Kundutskick.** Alla SMS går genom `_shared/comm-log.mjs`: loggas med
  exakt text i `sms-log`, och köas i `sms-pending` (godkännandekön) om inte
  anropet är en manuell admin-åtgärd (`approved: true`) eller går till
  personalens nummer. NEMOB OS 2.0 ska aldrig anropa 46elks direkt.

---

## 1. Systemöversikt

### Befintligt

| Endpoint | Metod | Auth | Källa | Svar |
|---|---|---|---|---|
| `/api/cases` | GET | admin | `workshop-cases` | `{ cases: Case[], totals: { active, value } }` — hela listan, sorterad på `updatedAt` fallande. Ingen paginering. |
| `/api/kommunikation?days=7` | GET | admin | se §2 | `counts.waiting`, `pending.length`, `today.nova.*`, `sources.*` räcker för fokusläget. |
| `/api/nova?days=14` | GET | admin | se §5 | `stats`, `callbacks`, `outbound.counts`. |
| `/api/booking-env-status` | GET | admin | env | `{ ok, status: { ENV_NAMN: boolean }, googleCalendar, diagnosticsAvailable }` — bara sant/falskt per variabel, aldrig värden. |
| `/.netlify/functions/storage-health` | GET / POST | admin | Blobs | se §8. |

Codex `readUnifiedBusiness()` använder i dag `/api/cases` + `/api/kommunikation?days=7`
och det är rätt par. Översiktssiffrorna beräknas i `nemob-os/lib/unified.mjs`.

### Behöver utvecklas

- **`GET /api/overview`** (förslag): ett anrop som returnerar de siffror
  fokusläget behöver utan att hämta hela ärendelistan:
  `{ generatedAt, cases: { open, pending, review, upcoming, readyUnpaid },
  communication: { waiting, pendingSms, inboundToday }, nova: { callsIn,
  callsOut, meetings, messages }, health: { blobs, elks, calendar } }`.
  Tills den finns: fortsätt summera klientsidigt som i `unified.mjs`.

---

## 2. Kommunikationsinkorg

### Befintligt

**`GET /api/kommunikation?days=30`** (1–90 dagar, admin)

Läser 46elks samtals- och SMS-historik (API), `sms-log`, `comm-handled`,
`workshop-cases`, `voice-agent-calls`, `voice-agent-meetings`,
`nova-outbound`, `sms-inbound`, `ring-list`, `call-followups`,
`sms-pending`, `comm-config`.

```jsonc
{
  "generatedAt": "ISO", "days": 30,
  "contacts": [ {               // en rad per telefonnummer/webb-id, rangordnad på score
    "key": "+46…", "phone": "+46…", "name": "Förnamn Efternamn", "tier": "active|past|new",
    "cases": { "active": [...], "newCases": [...], "past": 0, "paidTotal": 0 },
    "events": [ { "id", "at": 1731…, "atIso", "channel": "call|sms|chat", "dir": "in|out",
                  "text", "source", "sourceLabel", "nova": bool, "internal": bool,
                  "answeredBy": { "key", "label" }, "outcome": { "key", "label" } } ],
    "lastAtIso", "lastInIso", "waiting": bool, "waitingHours": 12.5, "handledAtIso",
    "channels": ["sms"], "novaInvolved": bool, "score": 0.8, "signals": [ { "key": "safety", … } ]
  } ],
  "lists": { "active": [key…], "new": [key…], "calls": [...], "chat": [...], "sms": [...] },
  "counts": { "contacts", "waiting", "activeWaiting" },
  "today": { "nova": { "callsIn", "callsOut", "chats", "smsOut", "meetings", "messages", "failed" },
             "inbound": { "calls", "missed", "sms", "chats" }, "smsBySource": [...] , "novaEvents": [...] },
  "period": { "smsBySource": [...] },
  "smsApproval": { "enabled": true, "updatedAt", "by" },
  "pending": [ { "id", "at", "to", "from", "message", "source", "sourceLabel", "status": "pending",
                 "lastError"?, "lastTriedAt"? } ],     // godkännandekön, se §6
  "novaStats": {...}, "novaOutbound": { "enabled", "queued" },
  "balanceSek": 161.23,
  "sources": { "elksCalls": "ok|<fel>", "elksSms": "ok|<fel>", "smsLogSince": "ISO|null" }
}
```

Fel i 46elks-källan gör inte anropet till ett fel: `sources.elksCalls`
bär feltexten och listorna byggs på det som finns (Codex markerar
`partial`).

**`POST /api/kommunikation/handled`** `{ phone, note? }` → `{ ok, handled: { phone, at, note, by } }`.
Markerar kontakten som genomgången; allt som kommer in efter `at` räknas som nytt.

**Inkommande SMS (webhook, ej för klienter):** `POST /api/sms-inbound?secret=…`
(46elks `sms_url`, fail-closed på `SMS_INBOUND_SECRET`). Nytt i denna PR:

- **Idempotens och beständig behandlingsstatus.** 46elks meddelande-id (`id`)
  får en post i storen `sms-inbound-seen` som skapas villkorat (`onlyIfNew`)
  INNAN något behandlas: `{ id, at, from, to, message, status: "processing|done|failed",
  attempts, leaseUntil, steps: { blocked, approval?, optout?, link: { status, caseId,
  candidates, attached, final, reason }, inboxKey, inboxCaseId, notified, autoreply: { text, via } },
  lastError, outcome? }`. Varje steg bockas av efter att det gjorts, så:
  en parallell leverans av samma id ser en giltig lease (2 min) och svarar tomt;
  en leverans efter krasch (lease ute) eller den schemalagda `comm-reconcile`
  tar över och kör klart från det steg som saknas (max 5 försök); ett id ger
  aldrig två notiser, två ärenderader eller två autosvar. Oväntat fel →
  HTTP 500 (46elks får skicka om), posten `failed`. Misslyckad ärendekoppling
  (`link.final: false`) försöks igen utan att notisen upprepas. Autosvar som
  inte kunde ges i webhook-svaret skickas av reconcile via SMS-API:t
  (RING-svaret går då genom godkännandespärren). Gallras efter 90 dagar.
- **Ärendematchning** (`_shared/case-match.mjs`): exakt ett öppet ärende
  på avsändarnumret → SMS:et kopplas; flera öppna → `ambiguous` med
  kandidater, inget kopplas; bara avslutade → `closed_only`, inget kopplas.
  Poster i `sms-inbound` har nu fälten
  `providerId`, `caseId` ("" om inte kopplat) och
  `caseMatch: { status: "matched|ambiguous|closed_only|none|skipped|error",
  attached: bool, candidates: [ { id, serviceNumber, status, service, vehicle, updatedAt } ] }`.
- På det kopplade ärendet läggs `inboundMessages: [ { at, channel: "sms",
  from, text, providerId, inboundKey } ]` (max 50), `lastInboundAt` och en
  tidslinjerad `SMS från kund mottaget: "…"`.
- Notisen till Sebastian får suffixet `(ärende NE-…)` resp.
  `(N öppna ärenden – välj i admin)`.

**Nyckelformat:** nya `sms-inbound`-nycklar är filsäkra
(`2026-11-11T20-15-03-123Z_46701234567`). Läs alltid fältet `at`, aldrig nyckeln.

### Behöver utvecklas

- **`GET /api/inbox`** (förslag): samlad inkorg över kanaler för NEMOB OS
  — `sms-inbound` (med `caseMatch`), Nova-meddelanden, röstbrevlådor,
  webbchatt — med `handled`-flagga och filter `?unhandled=1`. I dag finns
  motsvarande data utspridd i `/api/kommunikation` (events), `/api/nova`
  (`callbacks.ring/messages`) och `/api/call-dashboard` (`inboundSms`).
- **`POST /api/inbox/:key/link`** `{ caseId }`: manuell koppling av ett
  `ambiguous`-SMS till ett av kandidat-ärendena. Backend: skriv `caseId` på
  inbound-posten och `attachInboundToCase` på ärendet (båda versionerat).
- **`POST /api/kommunikation/handled`** finns; `unhandle` saknas.

---

## 3. Kundärenden

### Befintligt — `/api/cases`, `/api/cases/:id` (admin)

| Metod | Beskrivning |
|---|---|
| `GET /api/cases` | `{ cases, totals }`. |
| `GET /api/cases/:id` | Ärendeobjektet. **Nytt:** svarshuvud `ETag` (blobens version). |
| `POST /api/cases` | Skapa internt ärende. Body `{ customerName, customerPhone, customerEmail?, vehicleModel?, source?, note?, priceRows?, totalCost?, operatorName }` → `201 { ok, case }`. Med `action: "create_internal"` + `idempotencyKey` (16–120 tecken) används create-if-absent (`201` första gången, `200` vid omkörning). |
| `PATCH /api/cases/:id` | Fältuppdatering eller åtgärd (nedan). **Nytt:** valfri header `If-Match: <ETag>` → `412 { code: "precondition_failed" }` om ärendet ändrats. Svaret har alltid nytt `ETag` och, för generell PATCH, `conflictRetries` (antal omförsök på färsk data; normalt 0). |
| `DELETE /api/cases/:id` | `{ ok, deleted }`. Oåterkalleligt; NEMOB OS bör inte exponera detta i fokusläget. |

**Generell PATCH** (alla fält valfria, okända fält ignoreras):
`status`, `preferredDate`, `discountCode`, `preferredContactTime`,
`contactMethod`, `logistics`, `intakeAt`, `promisedAt`, `estimatedValue`,
`priority`, `service`, `message`, `customerName`, `customerPhone`,
`customerEmail`, `vehicleModel`, `assignedTo: "workshop|sebastian"`,
`note` (läggs till i `notes` + tidslinje), `customerUpdate` (kundsynlig,
visas i statusportalen), `workshop: {…}`, completion-fält (`totalCost`,
`workSummary`, `rootCause`, `laborMinutes`, `symptom`, `invoiceText`,
`pickupSummary`, `jobType`, `serviceActions[]`, `position`, `testRunDone`,
`safetyCheckDone`, `extraNoCost`, `customerInformed`, `readyForFortnox`,
`internalComment`, `priceRows[]`, `readyAt`, `customerNotifiedAt`,
`customerNotifiedVia`), betalfält (`paymentStatus: unpaid|invoice_ready|
invoiced|paid`, `paymentMethod: swish|card|cash|invoice|bank|other`,
`paymentAmount`, `paymentReference`, `paidAt`, `fortnoxCustomerNumber`,
`fortnoxInvoiceNumber`), content-fält (`contentSocial`, `contentGoogle`,
`contentWeb`, `contentStatus`, `contentTargets`, `contentNotes`,
`contentReviewedAt`, `contentPublishedAt`), `operatorName`,
`suppressThankYou`, `thankYouVariant`.

Övergång till `status: "done"` eller `paymentStatus: "paid"` utlöser
tackmail + recensions-SMS **en gång** (eller köas i `outbox` under tysta
timmar 21–08). `suppressThankYou: true` stänger tyst och permanent.
Tackutskicket reserveras i utskicksjournalen (`idempotencyKey = <caseId>-thank-you`)
och appliceras bara om ärendets färska version inte redan har ett
tackresultat: två samtidiga avslut ger ett utskick (förloraren svarar
`thankYouSkipped: true`).

**Åtgärder** (`body.action`), alla manuella admin-åtgärder → SMS går
direkt (`approved: true`), inte via kön:

| action | Body | Svar |
|---|---|---|
| `send_sms` | `{ message, operatorName?, idempotencyKey?, force? }` | `{ ok, result: SmsResult, case, journalKey }` |
| `send_quote_sms` | `{ amount, summary, contactOwner?, idempotencyKey?, force? }` | `{ ok, result, case, journalKey }` |
| `send_payment_instruction` | `{ amount?, priceRows?, workSummary?, invoiceText?, paymentMethod?, paymentReference?, message?, idempotencyKey?, force? }` | `{ ok, result, case, journalKey }`; status → `ready`, betalning → `invoice_ready` |
| `send_status_link` | `{ force?, idempotencyKey? }` | `{ ok, sms, email, case, journalKey }` eller `{ ok, alreadySent: true, case }` |
| `submit_workshop_log` | `{ workshop: {…} }` | `{ ok, result, case }` (SMS till Sebastian, ej journalfört) |
| `confirm_booking_request` / `reschedule_booking_request` / `decline_booking_request` | `{ preferredDate? (YYYY-MM-DDTHH:MM, krävs vid reschedule), message?, operatorName?, idempotencyKey? }` | `{ ok, sms, email, calendar, case, journalKey }`; `409` om ingen väntande förfrågan |

**Kund-SMS-åtgärderna går via utskicksjournalen** (`_shared/send-journal.mjs`,
store `send-journal`). Svarskoder utöver tabellen:

- `409 { code: "duplicate_recent", journalKey }` — identisk text till samma
  ärende inom två minuter. Skicka igen med `force: true` om det är avsiktligt.
- `409 { code: "in_flight" }` — samma `idempotencyKey` behandlas just nu.
- `503 { code: "storage_unversioned" }` — lagringen kan inte garantera
  versionskontroll; **inget skickades** (se Dataintegritet).
- `503 { code: "storage_error" }` — lagringen svarade inte (nätfel/5xx efter
  SDK:ns omförsök) **före** utskicket; inget skickades.
- `200 { ok, result|sms, case, caseLogged: false, caseError, journalKey }` —
  utskicket GICK men ärendeskrivningen föll (konflikt/lagringsfel). Skicka
  inte igen: `comm-reconcile` lägger loggraden på ärendet inom 15 min.
- `200 { …, replayed: true }` — samma `idempotencyKey` igen och raden fanns
  redan på ärendet: inget skickat, inget skrivet.
- Ett misslyckat utskick (`failed`/`not_configured`) med samma
  `idempotencyKey` får försöka igen; bara ett lyckat återspelas.
- Samma `idempotencyKey` igen (t.ex. klientens omförsök efter nätfel) ger
  det sparade resultatet tillbaka utan nytt utskick och loggar på ärendet
  med samma `journalKey`. NEMOB OS bör alltid skicka en `idempotencyKey`
  (UUID per knapptryck).
- Loggposterna i `outboundMessages[]`/`smsLog[]` har `journalKey`.

`SmsResult = { status: "sent|failed|not_configured|invalid_phone|missing_message|pending_approval", to, id?, sentAt?, error?, pendingId? }`.

**Ärendeobjektet** (fält NEMOB OS får läsa; inget här är kundsäkert utan filtrering):
`id`, `serviceNumber`, `status` (`new|contacted|checked_in|diagnosing|repairing|waiting_parts|waiting_customer|ready|done|archived`),
`source`, `channel`, `priority`, `bookingMode: "direct|request"`,
`bookingRequest: { status: pending|confirmed|declined, requestedDate, decidedAt, decidedBy }`,
`preferredDate`, `customer: { name, phone, email }`, `vehicle: { model, brand }`,
`service`, `message`, `estimatedValue`, `assignedTo: { key, name, role, phone }`,
`notes[]`, `customerUpdates[]`, `timeline[] { at, event }`,
`outboundMessages[]`, `smsLog[]`, `callLog[]`, **`inboundMessages[]` (nytt)**, `lastInboundAt` (nytt),
`notifications: { sms, customerEmail, staffSms, calendar, thankYou, manualSms, statusLink, … }`,
`completion: {…}`, `payment: { status, amount, method, reference, paidAt, … }`,
`workshop: { workDone, partsUsed, issuesFound, nextAction, needsSebastianReview, … }`,
`media[]`, `coupon`, `createdAt`, `updatedAt`, `updatedBy`.

**Sidospår på ärendet** (admin): `POST /api/cases/:id/sms` `{ message, kind: generic|ready|receipt, idempotencyKey?, force? }`
→ `{ status, sms, caseLogged, journalKey }` (samma 409/503-koder som ovan),
`POST /api/cases/:id/call` (click-to-call), `GET|POST|DELETE /api/cases/:id/media`,
`POST /api/cases/:id/analyze`. Svaren har nu `caseLogged: bool` där
loggningen på ärendet kan misslyckas efter att utskicket/samtalet gått.

**Publikt (ingen auth, rate-limit):** `GET /api/case-status/:serviceNumber`
ger bara kundsäkra fält (`firstName`, `model`, `statusLabel`, `stepIndex`,
`steps`, `note`, `updates`, `canRequestUpdate`).

### Dataintegritet (nytt, `_shared/case-store.mjs`)

Alla skrivare som läser–ändrar–skriver ett befintligt ärende använder nu
`commitCase(store, id, build, { current, etag })`: läsning med etag,
`build(fresh)` är en ren funktion, skrivning med `onlyIfMatch`, upp till
tre omförsök på färsk data. Sidoeffekter (SMS, mejl, kalender) görs en
gång före skrivningen och appliceras bara på nytt. Konverterade:
`workshop-cases` (alla PATCH-grenar), `case-sms`, `case-call`,
`case-media`, `case-status`, `sms-draft-inbox`, `outbox-flush`,
`case-auto-archive` (arkiverar inte ett ärende som fått kontakt mellan
listning och skrivning), `sms-inbound`. Nya ärenden (booking,
workshop-chat, call-dashboard) skriver unika id:n och är inte berörda.

**Fail-closed (granskning 2026-11-11).** Versionskontroll kan inte
garanteras i tre fall, och då STOPPAS skrivningen med `reason: "unversioned"`
→ HTTP `503 { code: "storage_unversioned" }` i stället för att tyst skriva
"sist vinner": (1) bloben saknar etag, (2) SDK:n svarar inte med
`{ modified }` (8.x), (3) backend ignorerar villkorshuvudena. Fall 3 syns
inte på en enskild skrivning (SDK 10.7.13 räknar ALLA svar utom 412 som
lyckad villkorad skrivning, `dist/main.js` `set`/`setJSON`), så
`ensureConditionalWrites()` kör en isolerad probe mot storen
`case-store-probe` en gång per process före den första villkorade
skrivningen: onlyIfNew skapa/dublett, etag-läsning, onlyIfMatch fel/rätt
etag. `createIfAbsent` rapporterar aldrig en verifierad dedup utan
`{ modified }`. Nödventil under incident: env
`CASE_STORE_ALLOW_UNVERSIONED=1` återställer ovillkorad skrivning
(`conditional: false`, `verified: false`) med loggrad per skrivning —
`storage-health` varnar när den är satt. Kända SDK-begränsningar: ett 5xx
från backend på en villkorad PUT rapporteras som lyckat (kan inte fångas
här); SDK:n gör själv 5 omförsök med 5 s paus vid nätfel/5xx.

**Reservation av köposter** (`claimJson`): `outbox` (per köpost i
outbox-flush), `sms-pending` (approve), `sms-drafts` (approve) reserveras
villkorat innan utskick — två överlappande körningar/klick ger ett utskick,
förloraren får `in_flight`. Övergiven reservation (krasch) får tas över
efter 10 min; misslyckat utskick släpper reservationen direkt.

**Utskicksjournal** (`send-journal`): `reserved → sent|failed|not_sent|queued_approval → committed`,
med `providerId`, fel och den avsedda loggraden (`apply`). Faller
ärendeskrivningen efter utskicket återapplicerar `comm-reconcile`
(schemalagd var 15:e minut, `7,22,37,52 * * * *`) raden idempotent på
`journalKey`; reservationer utan resultat efter 10 min blir `unknown` med
tidslinjeraden "kontrollera i 46elks-loggen". Gallras efter 30 dagar.
46elks saknar idempotensnycklar: garantin är "aldrig omsänt av oss vid
omförsök", inte exakt-en-gång mot leverantören.

Kvar (ovillkorade, låg risk/engångsflöden): `booking.mjs` retry-loop på
notiser, `stripe-webhook`/`product-order` (redan `onlyIfNew`), v1-funktioner
via `_shared/storage.js` (skriver aldrig ärendebloben, bara `case-events`),
tackmail/recensions-SMS i `sendThankYou` (Resend idempotency-key resp.
`notifications.thankYou.reviewSms`-spärr, ej journalförda), kampanj-SMS i
outbox-flush (reserveras men journalförs inte).

**Viktigt för deploy:** `netlify/functions/package.json` pekade på
`@netlify/blobs ^8.1.0` medan roten har `10.7.13`. Netlify installerar
funktionsmappens egna beroenden, så produktionen kan ha kört 8.x — där
saknas `onlyIfMatch`/`onlyIfNew` helt (det befintliga
`internal-case.js` skulle då kasta på `.modified`). Nu pinnad till
`10.7.13`. Verifiera efter deploy med `POST /.netlify/functions/storage-health`
→ `conditionalWrites.ok: true`.

---

## 4. Bokningar

### Befintligt

| Endpoint | Auth | Svar |
|---|---|---|
| `GET /api/bookings?view=slots` | publik | `{ status: "ok|unchecked|not_configured", generatedAt, days: [ { date: "YYYY-MM-DD", slots: [ { time: "HH:MM", free: bool, mode: "direct|request" } ] } ] }` — 35 dagar, 12–20 i 30-minuterssteg; tis/tors 15–20 eller "Öppet"-händelser = `direct`, övrigt = `request`. Cache 60 s. |
| `POST /api/bookings` | publik, idempotent | skapar ärende + Google Calendar-händelse + SMS/mejl. Svar `201 { ok, id, case: { status, service, preferredDate, bookingMode, customerDelivery, notifications } }`. |
| `PATCH /api/cases/:id` med `*_booking_request` | admin | se §3. |
| `POST /api/calendar-self-test` | admin | `{ ok, stage, calendar, eventInserted, eventDeleted }`. |

Bokningar **är ärenden**: filtrera `/api/cases` på
`source === "website-booking"` och `preferredDate >= idag`; väntande
förfrågningar är `bookingRequest.status === "pending"` (det Codex redan gör).

### Behöver utvecklas

- **`GET /api/bookings?view=upcoming&days=14`** (admin): sammanslagen
  lista av ärenden med tid + kalenderns "Öppet"-fönster, så att
  bokningsöversikten slipper hämta alla ärenden. Fält:
  `{ days: [ { date, open: [ { from, to } ], bookings: [ { caseId, serviceNumber, time, name, vehicle, service, bookingMode, pending } ] } ] }`.
- Kalenderläsning utöver lediga tider finns inte (ingen endpoint ger
  händelser). Service-kontot finns i `_shared/google-calendar.mjs`.

---

## 5. Nova — samtal och meddelanden

### Befintligt

**`GET /api/nova?days=14`** (admin; `voice-agent-calls`, `voice-agent-meetings`,
`voice-agent-messages`, `sms-inbound`, `nova-outbound`):

```jsonc
{ "generatedAt", "days",
  "stats": { ... },                       // buildNovaStats
  "callbacks": {
    "meetings": [ { "id", "at", "phone", "name", "topic", "preferredTime", "vehicle", "case": { "status", "id" }, "customerSms", "done": false } ],
    "messages": [ { "id", "at", "phone", "name", "message", "staffSms", "done": false } ],
    "ring":     [ { "key", "phone", "message", "at", "type": "ring", "handled": false, "caseId", "caseMatch" } ],
    "doneRecent": 3 },
  "calls": [ { "id", "at", "phone", "durationSec", "outcome", "summary", "transcript", "meetingBooked",
               "customer": { "found", "firstName", "activeCases": ["NE-…"] }, "done", "kind": "inbound|outbound|web|test",
               "outboundKey", "result": { "key", "label" }, "endReason", "tools": [] } ],
  "outbound": { "config": { "enabled", "maxPerRun", "updatedAt" }, "counts": { "queued", "calling", "done", "noanswer", "failed", "test" }, "recent": [...], "next": [...] } }
```

**Skrivningar:** `POST /api/nova/done` `{ kind: meeting|message|ring|call, id, note? }` → `{ ok }`;
`POST /api/nova/outbound-config` `{ enabled, maxPerRun ≤ 3 }`;
`POST /api/nova/outbound-queue` `{ entries: [ { phone, name, reason, priority } ] }` → `{ ok, queued, skipped }` (optout/spärrlista filtreras);
`POST /api/nova/outbound-test` `{ phone }`; `POST /api/nova/outbound-clear` `{ status? }`.

Nova själv (ElevenLabs) anropar `/api/voice-agent/*` med
`VOICE_AGENT_SECRET` och post-call-webhooken med HMAC
(`VOICE_AGENT_WEBHOOK_SECRET`). NEMOB OS anropar aldrig dessa.
**Nytt:** hemlighetsjämförelsen i `voice-agent` och `nova-outbound-hook`
är tidssäker (tidigare `!==`).

### Behöver utvecklas / kända brister

- Nova-sammanfattningsmejlet (`sendMail` i `voice-agent.mjs`) rapporterade
  0 skickade på 30 dagar i audit fas 1 — orsak ej hittad i kod; verifiera
  `RESEND_API_KEY`/`EMAIL_FROM`/`WORKSHOP_EMAIL` i Netlify.
- ElevenLabs SIP-trunk tillåter `0.0.0.0/0` utan auth (konfiguration, inte kod).
- Samtalsposter kopplas till ärende bara via `customer.activeCases`
  (servicenummer); en `caseId`-koppling som för SMS saknas — kan läggas i
  `summary`-grenen med `matchCaseByPhone` när Codex vill visa samtal på
  ärendekortet.

---

## 6. Godkännandekö (kund-SMS)

Spärren är PÅ som standard (`comm-config/sms-approval`). Allt som inte är
en manuell admin-åtgärd hamnar i `sms-pending`.

| Endpoint | Body | Svar |
|---|---|---|
| `GET /api/kommunikation` | – | `pending[]` + `smsApproval` (se §2) |
| `POST /api/kommunikation/approve` | `{ id }` | `{ ok, result: SmsResult }`; `404` om id saknas; misslyckat utskick ligger kvar med `lastError`; `result.status: "in_flight"` om samma post godkänns parallellt; `"storage_unversioned"` om lagringen inte kan reservera |
| `POST /api/kommunikation/approve-all` | `{ ids: [...] }` (max 200) | `{ ok, sent, results: [ { id, status, … } ] }` |
| `POST /api/kommunikation/reject` | `{ id }` | `{ ok, result: { status: "rejected", by } }` |
| `POST /api/kommunikation/sms-approval` | `{ enabled: bool }` | `{ ok, smsApproval }` — **högriskknapp**, visa bara i full översikt med bekräftelse |

Godkännande via SMS-svar ("1 ok", "alla ok") finns redan (`sms-inbound` ⇄ `contact-queue`),
men gäller **AI-utkasten** (`/api/sms-drafts`), inte `sms-pending`. Två köer:

- `GET /api/sms-drafts` → `{ drafts: [ { caseId, category: A|B|C, message, meta: { namn, telefon, tjanst, alderDagar, ursprung }, priority, closeProbability } ], count }`;
  `POST /api/sms-drafts/:caseId/approve` `{ message?, operatorName?, idempotencyKey? }` → `{ status: "sent|queued|not_configured", caseId, newStatus, caseLogged, journalKey }`;
  `409 { code: "in_flight" }` vid parallellt godkännande, `503 { code: "storage_unversioned" }`;
  `POST /api/sms-drafts/:caseId/skip`.

Behöver utvecklas: ett gemensamt `GET /api/approvals` som slår ihop
`sms-pending`, AI-utkast och väntande bokningsförfrågningar till en lista
`{ items: [ { kind: "sms|draft|booking_request", id, caseId, to, name, text, at, approveUrl, rejectUrl } ] }`
— det är fokuslägets "beslut just nu". Tills dess: tre anrop.

---

## 7. Uppgifter och prioriteringar (personlig planering)

Ligger **enbart** i NEMOB OS lokala server (`nemob-os/server.mjs`, JSON-fil
på disk, PIN-skyddad): `GET/POST /api/tasks`, `PATCH /api/tasks/:id`,
`POST /api/tasks/:id/advice`, `GET /api/plan?date=`, `POST /api/plan/generate`,
`POST /api/checkins`. Ingen Netlify-funktion rör dessa, och ska inte heller
göra det: personlig data och LVU-material stannar utanför företagets
Blobs-stores (separat säkerhetsdomän). Codex äger kontraktet; backendens
enda beröring är att `readUnifiedPlanning()` kan blandas med
affärsdata i presentationen, aldrig i lagringen.

---

## 8. Systemhälsa

| Endpoint | Svar |
|---|---|
| `GET /.netlify/functions/storage-health` | `{ ok, functionVersion, blobsAvailable, hasBlobsContext, hasSiteId, storesChecked: [ { store, ok, errorCode? } ], warnings[], conditionalWrites: null | <cachat probe-resultat>, conditionalWritesSource: "none|cached", unversionedWritesAllowed: bool, readOnly: true }` — skriver inget |
| `POST /.netlify/functions/storage-health` | som GET men kör den isolerade proben mot `case-store-probe` (aldrig kunddata): **`conditionalWrites: { ok, steps: { onlyIfNewCreate, onlyIfNewDuplicate, etagOnRead, onlyIfMatchStale, onlyIfMatchFresh, valueAfterFresh }, etagSource: "get|list|none", checkedAt, error? }`**, `conditionalWritesSource: "probe"`. `ok: false` = ärendeskrivningar stoppas (503) → varning i `warnings`. |
| `GET /api/voice-agent/health` (kräver `VOICE_AGENT_SECRET`) | `{ ok, tools[], sms, cases, mail }` |
| `GET /api/booking-env-status` | env-variabler satt/ej satt + Google Calendar |
| `GET /api/kommunikation` → `sources`, `balanceSek` | 46elks-nåbarhet och saldo |

Behöver utvecklas: `GET /api/health` (admin) som samlar ovanstående till
`{ blobs, conditionalWrites, elks: { ok, balanceSek }, calendar, resend, nova, lastScheduled: { outboxFlush, contactDigest, … } }`.
Schemalagda funktioner lämnar i dag inga spår utöver loggar.

---

## 9. Integrationspunkter till Codex (att göra i `nemob-os/**`)

1. **ETag/If-Match på ärendeuppdateringar.** När NEMOB OS börjar skriva
   (PATCH): spara `ETag` från `GET /api/cases/:id`, skicka `If-Match`, hantera
   `412` med omladdning. Generell PATCH utan `If-Match` fungerar som förut.
2. **Inkorg:** visa `caseMatch.status` på inkommande SMS
   (`/api/nova` → `callbacks.ring`, `/api/call-dashboard` → `inboundSms`);
   `ambiguous` ska bli ett beslut ("vilket ärende?"), inte ett fel.
3. **Ärendekortet:** rendera `inboundMessages[]` tillsammans med
   `outboundMessages[]`/`smsLog[]` som en konversation.
4. **Godkännanden i fokusläget:** tre källor tills `/api/approvals` finns
   (§6). Koden som skickar/avvisar är `approve`/`reject` ovan — inga egna utskick.
5. **Hälsa:** anropa `storage-health` med POST en gång per sessionstart
   och visa `conditionalWrites.ok` och `unversionedWritesAllowed`.
7. **Utskick:** skicka alltid `idempotencyKey` (UUID per knapptryck) på
   `send_sms`/`send_quote_sms`/`send_payment_instruction`/`send_status_link`/
   bokningsbeslut och `/api/cases/:id/sms`; visa `409 duplicate_recent` som
   "skickades nyss – skicka ändå?" (→ `force: true`) och `503 storage_unversioned`
   som ett systemfel, inte som "försök igen".
8. **Inkorg:** en `sms-inbound-seen`-post med `status: "failed"` är "under
   återhämtning", inte ett fel att visa; `steps.link.final: false` = kopplingen
   kommer att försökas igen.
6. Token: fortsätt mönstret i `admin-cases.mjs` (server-till-server, aldrig i klienten).

---

## 10. Inkommande e-post — utredning

Det finns ingen inkommande e-postintegration i dag (Resend används bara
utgående; audit fas 1). Alternativ:

| Alternativ | Hur | Bedömning |
|---|---|---|
| **Resend Receiving** | Egen mottagardomän (t.ex. `inbox.nordicemobility.se` via MX) → webhook `email.received` → hämta innehåll med Receiving API (`emails.receiving.get`) + Attachments API. Webhook-signatur (Svix) verifieras. Lagrar mejlen även om webhooken är nere. | Bäst passform: samma leverantör som utgående, webhook-mönster identiskt med `sms-inbound`. Kräver DNS-ändring. |
| Gmail/Workspace push (Pub/Sub) | Google-projektet finns redan (kalender-service-kontot) | Mer rörliga delar, OAuth-scope mot hela brevlådan. |
| Vidarebefordran till Resend-inbox | Regel i nuvarande brevlåda → Resend-adress | Snabbast att testa utan att flytta MX. |

Föreslaget kontrakt (ej byggt): `POST /api/email-inbound` (Resend-webhook,
fail-closed på `EMAIL_INBOUND_WEBHOOK_SECRET`), idempotent på `email_id`
(store `email-inbound-seen`), lagrar `{ at, from, to, subject, textPreview,
emailId, caseId, caseMatch }` i `email-inbound`, matchar med
`matchCaseByEmail` (finns redan i `case-match.mjs`) under samma regel:
bara entydigt ärende kopplas. Kroppen hämtas vid behov via Receiving API,
inte lagras i Blobs (dataskydd, retention 12 mån som `sms-log`).

Källor: Resend-dokumentationen för `email.received`
(https://resend.com/docs/webhooks/emails/received), Receiving-introduktion
(https://resend.com/docs/dashboard/receiving/) och "Inbound Emails"
(https://resend.com/blog/inbound-emails).

---

## 11. Säkerhet — läge och åtgärder

Åtgärdat i denna PR: tidssäker jämförelse i `voice-agent` och
`nova-outbound-hook`; idempotens på inkommande SMS; versionerade
skrivningar; blobs-version i funktionspaketet.

Kvar (konfiguration eller separat uppdrag, i prioritetsordning):

1. `voice-simple` och `voice-private` **släpper igenom** anrop utan
   `VOICE_WEBHOOK_SECRET` om variabeln saknas (fail-open); `voice-start`/
   `voice-notify` är fail-closed. Sätt variabeln och gör dem fail-closed.
2. Admin-token i `localStorage` på åtta `/admin/`-sidor — ersätts av
   NEMOB OS server-till-server-mönster när sidorna migreras.
3. `VOICE_AGENT_SECRET` accepteras i query-param `?s=` (hamnar i
   access-loggar); behåll header/Bearer, fasa ut `?s=` när 46elks-hooken
   kan sätta header.
4. ElevenLabs SIP-trunk utan IP-begränsning; Stripe-tvist/nyckelrotation;
   Netlify-env för telefonnummer (Sebastians lista från fas 2).
5. Loggning: inga telefonnummer i `console.log` från de nya raderna
   (`sms_inbound_case_match` loggar bara status). Befintliga loggar i
   andra funktioner är inte genomgångna.
6. Retention: `sms-log` gallras efter 12 mån; `send-journal` 30 dagar och
   `sms-inbound-seen` 90 dagar (comm-reconcile); `sms-inbound` och
   `voice-agent-calls` (med transkript) gallras inte — föreslå samma
   12-månadersregel i `comm-log-prune.mjs`.
7. Första deploy med fail-closed lagring: kör `POST storage-health` direkt
   efter deploy. Är `conditionalWrites.ok` false stoppas alla ärendeskrivningar
   (503) tills orsaken är löst; `CASE_STORE_ALLOW_UNVERSIONED=1` är
   nödventilen under tiden (ta bort den efteråt).

---

## 12. Känt testfel: `npm run test:comm` 6/7 (ej i grinden)

`tests/kommunikation.test.mjs` faller på orörd `main` på Windows:
`readSmsLog` returnerar 0 poster. Orsak (verifierad 2026-11-11 mot den
lokala Blobs-servern): nycklarna i `sms-log` börjar med ISO-tid med kolon
(`2026-11-11T22:37:54.507Z_706666666_4gn3`, `keyFor` i
`_shared/comm-log.mjs`). Den lokala servern lagrar nyckeln URL-kodad
(`%3A`) och `list()` returnerar den kodade formen; `readSmsLog` jämför
`k.slice(0, 24) >= <ISO-tid>` och `%` (0x25) sorterar före `:` (0x3A), så
alla rader filtreras bort — och `store.get(<kodad nyckel>)` skulle ändå
inte träffa. Produktionen påverkas inte (Netlifys backend listar råa
nycklar). Åtgärd, separat PR: i `_shared/comm-log.mjs` låt `listKeys`
avkoda nycklar (`decodeURIComponent`, try/catch) och låt `keyFor`
(sms-log, sms-pending) använda filsäker tid (`stampKey` i case-store:
kolon/punkt → bindestreck); behåll läsning av gamla nycklar genom att
normalisera jämförelsesträngen på samma sätt. Samma mönster finns redan i
`case-store.readWithEtag` (list-fallbacken avkodar).
