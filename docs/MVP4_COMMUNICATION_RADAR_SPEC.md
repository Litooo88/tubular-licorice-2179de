# MVP4 Kommunikationsradar Spec

## Syfte

Kommunikationsradar är en säker demo för att samla inkommande Gmail-, SMS-, samtals- och manuella händelser i admin. Den ska visa hur AI kan klassificera, riskmarkera och föreslå svar utan att skicka något eller koppla live-integreringar.

## Avgränsning

MVP4 är endast demo/mock/dry-run:

- Ingen live Gmail-koppling.
- Ingen privat Android/iPhone-SMS-koppling.
- Ingen 46elks-sändning.
- Ingen e-postsändning.
- Ingen Supabase.
- Inga secrets i frontend eller docs.

## Admin UI

Ny panel i `/admin/`:

- Kommunikationsradar
- Kort/tabs:
  - Nya inkommande
  - Kräver svar
  - Riskärenden
  - Leverantörer
  - Utkast
  - Koppla till ärende

Panelen visar mockade Gmail/SMS/call/manual-händelser med:

- källa
- riskklassning
- föreslagen åtgärd
- föreslaget svar
- status: `read_only`, `draft`, `needs_approval`, `linked_to_case`
- case/timeline-koppling om `caseId` finns

## Datamodell

Netlify Blobs-entiteter:

- `communication_events`
- `ai_response_drafts`

Kommunikationshändelse:

```json
{
  "id": "...",
  "source": "gmail|sms|call|manual",
  "direction": "inbound|outbound",
  "from": "...",
  "to": "...",
  "subject": "...",
  "bodySummary": "...",
  "receivedAt": "...",
  "caseId": "...",
  "customerId": "...",
  "risk": {
    "level": "low|medium|high",
    "reasons": []
  },
  "classification": "customer|supplier|invoice|complaint|warranty|battery_risk|booking|other",
  "suggestedAction": "...",
  "draftId": "...",
  "status": "new|reviewed|linked|drafted|dismissed"
}
```

UI-status beräknas separat som:

- `read_only`
- `draft`
- `needs_approval`
- `linked_to_case`

## Endpoints

Alla endpoints kräver `x-admin-token` mot server-side `ADMIN_TOKEN`.

### `/.netlify/functions/communication-radar-demo`

Returnerar deterministisk mock-data för admin-demo.

- Skriver aldrig till Blobs.
- Kontaktar inte Gmail, SMS eller 46elks.
- Returnerar `dryRun: true`.

### `/.netlify/functions/communication-events`

- `GET`: listar events eller demo-events med `?dryRun=1`.
- `POST`: skapar manuellt/mock event.
- `dryRun` eller `previewOnly` skriver inte.
- Persistent write kräver `approved: true`.

### `/.netlify/functions/ai-communication-draft`

- `POST`: tar ett communication event och föreslår svar.
- Skapar endast internt utkast.
- Skickar inget.
- `dryRun` skriver inte.
- Persistent write kräver `approved: true`.

## Timeline-koppling

`netlify/functions/_shared/communication-radar.js` kan översätta en communication event och draft till ett `case_events`-kompatibelt `ai_suggestion`-payload.

MVP4 skapar inte riktiga case-events i production utan både:

- admin-token
- explicit approval
- `linkToTimeline: true`

## Affärsregler

High risk / requires approval:

- reklamation
- garanti
- batteri/BMS
- brandrisk
- olycka/personskada
- juridik/ansvar
- pris över 995 kr

Supplier priority:

- KuKirin
- Navee
- Teverun
- Dualtron
- Monorim

AI får aldrig lova:

- garanti
- ersättning
- färdigt datum
- slutpris
- ansvar

När kund ska lämna in ska AI föreslå:

`https://www.nordicemobility.se/book-online/`

AI skickar aldrig svaret automatiskt.
