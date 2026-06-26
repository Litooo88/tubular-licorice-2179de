# Customer Export and Call Logs Status

Senast uppdaterad: 2026-06-26

## Syfte

Detta dokument beskriver den säkra, read-only kundexporten och hardening av
`/.netlify/functions/call-logs`.

## Call logs

`call-logs` är adminskyddad med `x-admin-token` / `ADMIN_TOKEN`.

Förändring:

- `GET` returnerar alltid kontrollerad JSON.
- Om Netlify Blobs saknar runtime-konfiguration eller är tom returneras `200`
  med `calls: []` och `warnings`, inte 502.
- `POST` har `dryRun`, `readOnly` och `previewOnly` som inte skriver till Blobs.
- Oväntade fel returnerar JSON med `error: "Function error"`.

Rotorsak till production-felet var att endpointen anropade Blob-storage direkt
utan try/catch. När Netlify Blobs runtime saknade rätt konfiguration bubblade
`MissingBlobsEnvironmentError` upp som 502.

## Customer export

Ny endpoint:

`/.netlify/functions/customer-export`

Egenskaper:

- Kräver `x-admin-token`.
- Read-only.
- Skickar inga mail.
- Skickar inga SMS.
- Gör inga production-writes.
- Returnerar JSON med `customers`, `emails`, `count`, `sources` och `warnings`.

## Källor

Endpointen försöker läsa:

- `service_cases` / Netlify Blob `workshop-cases`
- `customers` / Netlify Blob `customers`
- `communication_events` / Netlify Blob `communication-events`

Om en källa är tom eller saknas läggs det i `warnings` och exporten fortsätter.

## Filtrering

Exporten deduplicerar e-postadresser och filtrerar bort:

- tomma värden
- ogiltiga e-postformat
- `email@example.com`
- `test@example.com`

Om inga riktiga e-postadresser hittas returneras:

```json
{
  "customers": [],
  "emails": [],
  "count": 0
}
```

med warnings som beskriver vilka källor som var tomma eller saknade.

## Admin UI

`/admin/` har en liten panel:

- `Exportera kundlista`
- antal hittade e-postadresser
- read-only textarea med kopierbar lista

Det finns ingen massutskicksfunktion i admin.

## Framtida massutskick

Innan kundutskick aktiveras behövs:

- separat mailverktyg eller BCC-flöde med manuell kontroll
- avregistreringslänk eller tydlig avregistreringsinstruktion
- mottagargranskning innan skick
- loggning av utskick
- policy för vilka kundtyper som får kontaktas

Massutskick är inte aktiverat i denna ändring.
