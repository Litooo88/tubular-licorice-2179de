# Nordic Project Context

## Verksamheten

Nordic E-Mobility är en elscooter- och elcykelverkstad i Örebro. Verksamheten
arbetar med bokning, felsökning, reparation, batteri/BMS, däck, bromsar,
reservdelar, uppgraderingar, försäljning och efterservice.

Systemets mål är att samla hela kundresan:

- bokning och nya förfrågningar
- kundärenden och verkstadsstatus
- SMS, e-post och missade samtal
- prisförslag och godkännanden
- reservdelsbehov
- checkout, betalning och Fortnox-underlag
- AI-stöd för prioritering, utkast och riskidentifiering

## Operativa roller

- **Sebastian**: ägare/admin, tekniskt ansvarig, batteri/elsystem, slutpris,
  betalning och högriskbeslut.
- **Lennart**: verkstadsgolv, mottagning, snabba jobb, dokumentation och
  statusuppdatering. Ska eskalera slutpris och tekniska risker.
- **AI servicekoordinator**: analyserar, prioriterar och skapar utkast. AI
  verkställer inte högriskbeslut.

## Faktisk teknikstack

- Statisk HTML, CSS och JavaScript.
- Netlify hosting och Netlify Functions.
- Netlify Blobs för huvuddelen av operativ data.
- Stripe Checkout för produktköp.
- 46elks för SMS/telefoni.
- Resend för e-post.
- Google Calendar via service account.
- Separat Cloudflare Worker i `nemob-callflow/` med TypeScript, D1 och KV.

Det finns ingen React/Next-router, ingen `app/`-struktur och ingen
`storage.ts` i nuläget.

## Sju primära workflow-ytor

Det finns ingen ramverksdefinierad lista med exakt sju routes. För samordning
mellan AI-verktyg ska följande sju ytor behandlas som de primära:

1. `/` - publik startsida, service och produkter
2. `/book-online/` - publik bokning
3. `/admin/` - full admin och ärendeöversikt
4. `/workshop/` - förenklad verkstadsvy
5. `/quick-price/` - snabbpris och intern ärendeskapning
6. `/checkout/` - slutpris, betalningsinstruktion och avslut
7. `/prices/` - adminhantering av prisdatabas

Andra viktiga publika routes är bland annat `/nya-elscootrar/`, `/priser/`,
`/kontakt/` och servicesidorna.

## Nuvarande datalagring

Server-side:

- Netlify Blob `workshop-cases`: bokningar, chattar och verkstadsärenden
- Netlify Blob `case-media`: uppladdade ärendebilder
- Netlify Blob `price-catalog`: intern prisdatabas
- Netlify Blob `call-leads`: leads från samtal
- Netlify Blob `call-followups`: uppföljningar från samtal
- `data/products.json`: produktkatalog och checkout-källa
- Cloudflare D1 `call_log`: samtalsloggar i `nemob-callflow/`

Browser-side `localStorage` används idag för:

- `nordicAdminToken`
- `nordicAdminOperator`
- workshop-chat-utkast
- newsletter-popupens visningspreferenser

`localStorage` är inte en godkänd framtida lagring för kunddata eller
auktoritativa verksamhetsdata.

## Nuvarande auth

- Admin-API använder miljövariabeln `ADMIN_TOKEN`.
- Klienterna skickar token som `x-admin-token`.
- Token sparas idag i `localStorage`, vilket är en MVP-lösning och en
  säkerhetsrisk.
- Cloudflare Worker använder IP-allowlist och valfri HMAC för 46elks-webhooks,
  samt `ADMIN_KEY` för `/calls` och `/stats`.

## Viktiga affärsregler

- Kunden ska få tydligt pris eller prisintervall innan arbete.
- Slutpris och högriskärenden kräver mänskligt godkännande.
- Kundbilder är interna om inte uttryckligt content-godkännande finns.
- Kundkommunikation ska vara spårbar och undvika dubbla utskick.
- AI ska föreslå och förbereda, inte fatta bindande beslut.
