# Safety and Approval Rules

## Grundprincip

Automatisering ska minska administration utan att skapa oavsiktliga löften,
kostnader, juridiskt ansvar eller risk för kunden. När flera regler gäller ska
den striktaste regeln vinna.

## Autoskick tillåtet

Följande får autoskickas när mall, mottagare och data har validerats:

- bokningsbekräftelse
- missat samtal-svar
- fråga om modell/fel
- enkel statusuppdatering
- recensionslänk efter avslutat ärende

Autoskick ska vara transaktionella, server-side, loggade och idempotenta.

## Kräver alltid godkännande

- batteriärenden
- reklamationer
- missnöjda kunder
- pris över 995 kr
- rabatt
- garantiuttalanden
- juridiskt ansvar
- reservdelsköp över 500 kr
- allt som kan misstolkas som skuld eller löfte

## AI-regler

- AI får skapa utkast men ska sätta `requiresApproval=true` när någon regel
  ovan träffar.
- AI får inte skicka SMS, göra inköp, markera betalning eller avsluta ärenden.
- AI ska tydligt skilja fakta, uppskattning och antagande.
- AI ska undvika diagnos- eller säkerhetspåståenden utan teknisk verifiering.

## Tekniska säkerhetskrav

- Secrets får endast finnas i miljövariabler eller godkänd secret manager.
- Kunddata, SMS, betalning och admin-actions ska hanteras server-side och vara
  auth-skyddade.
- Publika intake-endpoints får skapa ärenden men får inte läsa eller lista
  kunddata.
- Nya sidoeffekter ska stödja `dryRun` och idempotency key.
- Alla skick, statusändringar, prisbeslut och godkännanden ska loggas.
- Ingen datamodelländring utan migration och rollback-plan.
- Ingen kunddata i `localStorage`.

## Kända nulägesrisker att inte kopiera

- Admin-token sparas idag i `localStorage`.
- Auth- och storage-hjälpare är duplicerade mellan Netlify-funktioner.
- `GET /api/case-media/:caseId/:mediaId` sker före admin-auth och svarar med
  publik cache-header.
- `/api/booking-env-status` är publik och visar vilka integrationer som är
  konfigurerade.

Dessa är återhämtnings- och hardeningpunkter, inte rekommenderade mönster.
