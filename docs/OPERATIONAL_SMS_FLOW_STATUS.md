# Operational SMS Flow Status

Datum: 2026-06-28

Syfte: kartlägga vilka SMS-flöden som finns så att fungerande notiser inte
försvinner när admin stabiliseras.

## Hård Säkerhetsregel

Denna dokumentation aktiverar inget SMS. Den beskriver befintliga flöden.

- Inga SMS skickades under audit/arbetet.
- Inga mail skickades under audit/arbetet.
- Inga production-writes gjordes under audit/arbetet.
- Skarpa kundmeddelanden ska kräva explicit admin-handling/approval.
- Demo, dry-run och exportpaneler får aldrig skicka SMS.

## Public Workshop Chat Till Intern SMS-Notis

Status: live när Netlify Blobs och 46elks-env är konfigurerade.

Filer:

- Frontend-widget: `assets/workshop-chat.js`
- Netlify Function: `netlify/functions/workshop-chat.mjs`
- Case-källa: Netlify Blobs store `workshop-cases`
- Idempotency store: `workshop-chat-idempotency`

Flöde:

1. Kund använder `Chatta med verkstaden` på publika sidan.
2. Widgeten postar till `POST /api/workshop-chat`.
3. `workshop-chat.mjs` validerar honeypot, rate limit, telefon och text.
4. Funktionen skapar ett `website_chat`-case i `workshop-cases`.
5. Funktionen bygger intern SMS-notis med:
   - `Ny chatt <case-short-id>`
   - `Typ`
   - `Kund`
   - `Telefon`
   - `Modell`
   - `Text`
   - `Svara: https://www.nordicemobility.se/admin/?case=<case-id>&tab=contact`
   - eventuell sidkälla
6. Funktionen försöker skicka intern SMS-notis via 46elks.
7. Resultatet sparas på `case.notifications.chatStaffSms`.
8. Timeline får händelsen `Intern chattavisering ...`.

Env-vars/API:

- `ELKS_USERNAME` eller `SMS_API_USERNAME`
- `ELKS_PASSWORD` eller `SMS_API_PASSWORD`
- `SMS_FROM`, normalt alfanumeriskt `NordicEMob`
- `WORKSHOP_CHAT_SMS_TO`
- `WORKSHOP_SMS_TO`

Nuvarande mottagarlogik:

- `workshop-chat.mjs` använder `WORKSHOP_CHAT_SMS_TO` eller `WORKSHOP_SMS_TO`
  plus interna staff-fallbacks i koden.
- Detta är ett befintligt fungerande flöde som inte ska brytas utan separat
  beslut. Om fallback ska tas bort senare måste Netlify-env först verifieras så
  Sebastian fortfarande får notiser.

Risk:

- Alfanumeriskt `SMS_FROM` innebär att kunder normalt inte kan svara direkt till
  SMS:et.
- Intern SMS-notis är ett liveflöde, inte demo.
- Funktionen skriver case-data i production när en riktig kund skickar chatt.

## Admin: SMS Till Kund

Status: live med explicit admin-handling.

Filer:

- UI: `admin/index.html`, panel `SMS till kund – live-sändning`
- Endpoint: `PATCH /api/cases/:id`
- Function: `netlify/functions/workshop-cases.mjs`
- Action: `send_sms`

Beteende:

- Admin väljer case och text.
- `Kopiera utkast` skickar inget.
- `Skicka riktigt SMS` kräver explicit knapptryck och browser-confirm.
- Backend skickar via 46elks om credentials finns.
- Resultat sparas på `case.outboundMessages`, `notifications.manualSms` och
  timeline.

Risk:

- Detta kan kontakta kund och måste fortsatt vara approval-baserat.
- Högriskärenden, batteri, reklamation, rabatt, garanti och pris över 995 kr
  kräver extra manuell kontroll enligt safety-regler.

## Admin: Prisförslag Via SMS

Status: live med explicit admin-handling.

Filer:

- UI: `admin/index.html`, kundkort/contact-tab
- Endpoint: `PATCH /api/cases/:id`
- Function: `netlify/functions/workshop-cases.mjs`
- Action: `send_quote_sms`

Beteende:

- Admin fyller belopp och åtgärd.
- UI visar varning om live-sändning.
- Backend skapar prisförslagstext och skickar SMS via 46elks om möjligt.
- Resultat sparas på `case.quote`, `outboundMessages` och timeline.

Risk:

- Prisförslag är kundbindande i praktiken och ska alltid granskas.

## Checkout / Betal-SMS

Status: live med explicit admin-handling.

Filer:

- UI: `checkout/index.html`
- Endpoint: `PATCH /api/cases/:id`
- Function: `netlify/functions/workshop-cases.mjs`
- Action: `send_payment_instruction`

Beteende:

- Admin behöver confirm innan betal-SMS skickas.
- SMS innehåller Swish företag, bankgiro, belopp och ärendereferens.
- Resultat sparas på payment/completion/outboundMessages/timeline.

Risk:

- Kan påverka betalflöde och kundkontakt. Ska inte autoskickas.

## Booking Bekräftelser

Status: live när provider-env är konfigurerade.

Filer:

- Public page: `book-online/index.html`
- Endpoint: `POST /api/bookings`
- Function: `netlify/functions/booking.mjs`

Beteende:

- Skapar case i `workshop-cases`.
- Kan skicka kund-SMS om kunden valt SMS-bekräftelse.
- Kan skicka kundmail.
- Kan skicka verkstadsmail.
- Kan skicka intern SMS-avisering.
- Har honeypot, rate-limit och idempotency guard.

Risk:

- Public endpoint skriver production-data och kan kontakta kund vid riktig
  bokning.
- Testa inte med riktiga kunduppgifter utan plan.

## Call Dashboard / Lost Lead SMS

Status: live med explicit admin-handling när 46elks/call source finns.

Filer:

- UI: `admin/index.html`, `Live samtalsdashboard`
- Endpoint: `/api/call-dashboard`
- Function: `netlify/functions/call-dashboard.mjs`

Beteende:

- GET kräver admin-token.
- När call source saknas ska dashboard visa källa saknas och inga falska siffror.
- POST `send_discount` kräver explicit action och `confirmLiveSms: true`.
- Admin UI har confirm innan live rabatt-SMS.

Risk:

- Rabatt-SMS kräver alltid manuell kontroll.
- Ska inte användas som ersättning för akutpanelen när call-log saknas.

## AI / Demo / Export Flöden Som Inte Ska Skicka SMS

Status: dry-run/demo/read-only.

Filer/endpoints:

- `/.netlify/functions/ai-sms-draft`
- `/.netlify/functions/ai-quote`
- `/.netlify/functions/ai-daily-brief`
- `/.netlify/functions/communication-radar-demo`
- `/.netlify/functions/customer-export`
- Adminpanelen `Akut uppföljning – missade samtal`
- Adminpanelen `Kommunikationsradar – demo/test`

Beteende:

- Skapar utkast, klassning, brief eller kopierbar text.
- Ska inte kontakta kund.
- Ska visa dry-run/demo/read-only tydligt.

## Regressioner Att Stoppa

- Chattnotis till Sebastian/Verkstaden försvinner utan ersättande status.
- Demo-data visas som live.
- Kundexport börjar skicka mail eller SMS.
- Akut uppföljning skickar SMS i stället för att kopiera.
- SMS till kund skickar utan confirm.
- Call dashboard skickar rabatt-SMS utan `confirmLiveSms`.
- Provider secrets eller tokens skrivs i frontend, docs eller logs.
