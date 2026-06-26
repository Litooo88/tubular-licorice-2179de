# MVP4 Kommunikationsradar Risker

## Säkerhetsbeslut i MVP4

- All MVP4-data är mock/dry-run tills en admin explicit väljer write med `approved: true`.
- Demo-endpointen kontaktar inte Gmail, SMS, 46elks eller privata telefoner.
- AI skapar endast utkast och rekommendationer.
- High-risk kommunikation flaggas och kräver manuell granskning.
- Inga secrets ligger i kod eller dokumentation.

## Kvarstående risker

### Admin-token i localStorage

Admin-token sparas fortfarande i browserns `localStorage`. Det är en känd MVP-risk sedan tidigare och ska ersättas av server-side session/roller senare.

### Schemalös Blob-data

`communication_events` och `ai_response_drafts` är JSON-dokument utan migrationssystem. Innan live-kopplingar aktiveras behövs validering, migration och retention-regler.

### Ingen live provider-verifiering

MVP4 bevisar inte Gmail- eller SMS-providerintegration. Den bevisar endast UI, auth, riskklassning, dry-run och timeline-payload.

### Approval-kontrakt är enkelt

Persistent write kräver `approved: true`, men framtida produktionsläge bör ha explicit godkännare, tidsstämpel, roll och audit trail.

### Timeline-write är avstängt i demo

MVP4 skapar endast timeline-preview i demo/dry-run. Riktiga case-events får bara skapas med admin-token, approval och `linkToTimeline: true`.

## Riskregler

Följande ska alltid klassas som high risk:

- reklamation
- garanti
- batteri/BMS
- brandrisk
- olycka/personskada
- juridik/ansvar
- pris över 995 kr

Följande får inte automatiseras utan mänsklig kontroll:

- skicka svar till kund
- skicka mail
- skicka SMS
- läsa privat SMS
- koppla live Gmail
- lova garanti, ersättning, färdigt datum eller slutpris

## Rekommenderat MVP5 innan live

1. Inför riktig rollbaserad auth.
2. Lägg till schema/validering för communication events.
3. Bygg read-only Gmail-ingest bakom separat OAuth/service-konto.
4. Lägg till explicit approval-logg.
5. Lägg till provider-sandbox innan live-utskick.
