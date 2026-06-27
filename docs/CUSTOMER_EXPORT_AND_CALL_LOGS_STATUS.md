# Customer Export and Call Logs Status

Senast uppdaterad: 2026-06-26

## Faktisk admin-kundkälla

`/admin/` bygger kundkorten från `GET /api/cases`.

Den routen hanteras av `netlify/functions/workshop-cases.mjs` och läser
Netlify Blob-storen `workshop-cases`.

Kodspårning:

- `admin/index.html` anropar `api('/api/cases')` i `loadCases()`.
- `netlify/functions/workshop-cases.mjs` exponerar `/api/cases`.
- `workshop-cases.mjs` läser `getStore({ name: "workshop-cases" })`.
- Namn som syntes i production-admin hittades inte i repot, vilket betyder att
  de inte är hårdkodade i HTML/JS eller statisk JSON.

Admin-token sparas fortfarande i browserns `localStorage` som befintlig MVP-auth,
men kundkorten lagras inte auktoritativt i `localStorage`.

## Kundexport

Endpoint:

`/.netlify/functions/customer-export`

Egenskaper:

- Kräver `x-admin-token`.
- Read-only.
- Skickar inga mail.
- Skickar inga SMS.
- Gör inga production-writes.
- Filtrerar bort `email@example.com`, `test@example.com`, tomma värden och
  ogiltiga e-postformat.

Primär källa är nu samma som admin använder:

- `admin_cases_api` -> `GET /api/cases` -> `workshop-cases`

Som kompletterande källor försöker endpointen läsa:

- `service_cases` / Netlify Blob `workshop-cases`
- `customers` / Netlify Blob `customers`
- `communication_events` / Netlify Blob `communication-events`

Response inkluderar både e-post och telefonnummer:

```json
{
  "customers": [],
  "emails": [],
  "phones": [],
  "emailCount": 0,
  "phoneCount": 0,
  "sources": [],
  "warnings": []
}
```

Om inga riktiga e-postadresser finns men telefonnummer finns ska admin visa:

`Inga e-postadresser hittades, men X telefonnummer finns.`

Det här är viktigt eftersom många production-kundkort saknar e-post men har
telefonnummer.

## Admin-export efter klickproblem 2026-06-27

Sebastian observerade att knappen `Exportera kundlista` kunde visa tom export
och tekniska `MissingBlobsEnvironmentError`-varningar trots att admin hade
kundkort med telefonnummer.

Orsaken var att exportpanelen litade for mycket pa separata/future
Blob-kallor (`customers`, `communication_events`) och inte anvande den
kundlista som redan var laddad i admin via `/api/cases`.

Nu galler:

- `customer-export` behandlar future-kallor som valfria.
- `workshop-cases` / `/api/cases` ar fortsatt primar kundkortskalla.
- Admin-knappen kompletterar endpoint-svaret med redan laddade kundkort fran
  `cases[]`.
- Om e-post saknas men telefonnummer finns visas telefonantalet tydligt.
- Om export-function saknas lokalt eller Blob-kallor saknas kan admin anda
  visa/kopiera telefonnummer fran de kundkort som redan laddats in.
- Inga mail skickas och inga SMS skickas av exportpanelen.

## Call logs

Endpoint:

`/.netlify/functions/call-logs`

Egenskaper:

- Kräver `x-admin-token`.
- `GET` är read-only.
- `POST` har `dryRun`, `readOnly` och `previewOnly` som inte skriver till Blobs.
- Skickar inga SMS.
- Oväntade fel returnerar kontrollerad JSON.

När storage saknas returnerar endpointen nu tydlig källstatus:

```json
{
  "ok": true,
  "calls": [],
  "storageAvailable": false,
  "sourceUnavailable": true,
  "warnings": []
}
```

Admin ska visa `Call logs källa saknas / ej konfigurerad` så att saknad källa
inte misstolkas som noll missade samtal.

## Storage health

Endpoint:

`/.netlify/functions/storage-health`

Den kräver `x-admin-token` och returnerar endast booleans/felkoder, aldrig
secret-värden:

```json
{
  "ok": true,
  "blobsAvailable": false,
  "hasSiteId": false,
  "hasToken": false,
  "storesChecked": [],
  "warnings": []
}
```

Syftet är att se om Netlify Blobs är åtkomligt för de skyddade legacy
functions som använder shared storage-helpern. Production-observationen med
`MissingBlobsEnvironmentError` betyder att den aktuella function-runtimen saknar
den Blob-kontext eller de manuella properties (`siteID`, `token`) som
`@netlify/blobs` kräver när den inte kan auto-konfigureras.

Det påverkar framför allt de nya legacy/CJS-functions som använder shared
storage-helpern. Den befintliga admin-källan `/api/cases` går via
`workshop-cases.mjs` och är fortfarande den auktoritativa production-källan för
kundkort.

## Vad som saknas

- En riktig, enhetlig kunddatamodell med migrationsplan.
- En production-konfigurerad storage-helper som fungerar lika i alla functions.
- Riktig call-log-ingest från 46elks/Cloudflare Worker in i samma datakälla.
- E-postsamtycke, avregistrering och mottagargranskning innan utskick.

## Massutskick

Massutskick är inte aktiverat.

Innan kundutskick aktiveras behövs:

- separat mailverktyg eller BCC-flöde med manuell kontroll
- avregistreringslänk eller tydlig avregistreringsinstruktion
- mottagargranskning innan skick
- loggning av utskick
- policy för vilka kundtyper som får kontaktas

Den här ändringen skickar inga mail och inga SMS.
