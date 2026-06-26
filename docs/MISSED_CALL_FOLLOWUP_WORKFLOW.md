# Missed Call Follow-Up Workflow

## Syfte

Admin har nu ett akutläge för missade samtal när live-källan för call logs
saknas eller inte är konfigurerad. Målet är att Sebastian snabbt ska kunna
följa upp kunder utan att systemet låtsas att demo- eller mockdata är live.

## Så används panelen

1. Öppna `/admin/`.
2. Gå till panelen **Akut uppföljning – missade samtal**.
3. Kopiera nummer från 46elks eller annan samtalsvy.
4. Klistra in numren i textfältet.
5. Klicka på **Analysera nummer**.

Parsern hittar svenska mobilnummer i format som:

- `+467...`
- `07...`
- nummer med mellanslag, bindestreck eller parenteser

Numren normaliseras till `+467...`, dedupliceras och räknas.

## Matchning mot kundärenden

Panelen matchar normaliserade nummer mot redan laddade kundkort från
`/api/cases`. Den skriver inte till backend och skapar inga case.

För varje nummer visas:

- antal samtalsförsök
- matchad kund om telefonnummer finns på ett kundkort
- modell om den finns
- case-status om den finns
- prioritet
- lokalt SMS-utkast

Prioritet sätts lokalt:

- 3+ samtalsförsök ger hög prioritet
- matchad kund ger hög prioritet
- okänt nummer med flera försök lyfts före enstaka okända nummer

## Export och säkerhet

Panelen kan kopiera:

- alla unika nummer
- högprioriterade nummer
- standardtexterna för SMS
- nummer + text för manuell hantering

Inget SMS skickas från denna vy. Inget mail skickas. Funktionen gör inga
production-writes och läser inte privata SMS eller Gmail.

## Kommunikationsradar och live dashboard

Kommunikationsradar är märkt som **demo/test** och är ihopfällbar. Den ska inte
tolkas som riktiga Gmail-, SMS- eller samtalsdata.

Live samtalsdashboard ska visa att 46elks/call-log-källan saknas eller inte är
konfigurerad när `call-logs` rapporterar `sourceUnavailable`. Då ska den inte
visa missvisande siffror som om live-data fanns.

## Nästa steg

När 46elks-flowet ska göras fullt live bör nästa PR bygga:

- riktig 46elks webhook för inkommande/missade samtal
- read-only call-log-listning i admin
- explicit approval innan SMS skickas
- audit-logg/timeline-event för varje skickat meddelande
- idempotency för webhook-events och SMS-sändning

SMS-sändning ska fortsatt vara avstängd tills approval-flöde, audit trail och
provider-konfiguration är verifierade.
