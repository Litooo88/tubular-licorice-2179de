# Nordic E-Mobility: Bokningssystem och kundflode

## Malbild

Systemet ska gora tre saker utan friktion:

1. Ta emot bokningar pa ett satt som kanns tryggt och premium for kunden.
2. Ge verkstaden full kontroll over vilka kunder som ar nya, kontaktade, inne, klara eller vantar.
3. Visa direkt om en kund inte har fatt automatisk bekraftelse, sa att manuell uppfoljning kan ske samma dag.

## Hur bokningsflodet ar tankt att fungera

### 1. Kunden bokar via hemsidan

Kunden fyller i:

- tjanst
- namn
- telefon
- e-post
- vald tid
- inlamning eller upphamtning
- modell
- felbeskrivning
- eventuella tillval
- rabattkod
- intyg om att fordonet inte ar stoldgods

### 2. Systemet validerar tiden

Innan arendet skapas kontrolleras verkstadskalendern.

- Om tiden ar ledig fortsatter bokningen.
- Om tiden ar upptagen far kunden valja en annan tid.
- Om kalendern inte svarar ska kunden inte bli lovad en tid som inte ar saker.

### 3. Arendet skapas i verkstadssystemet

Varje bokning far:

- arendenummer
- kundkort
- ansvarig startperson
- uppskattat startvarde
- kontaktpreferens
- preliminar tid
- logistiktyp

### 4. Bekraftelser skickas

Direkt efter lyckad bokning ska systemet forsoka skicka:

- kundmail
- kund-SMS
- verkstadsmail
- intern SMS-avisering

### 5. Kundstatus avgors automatiskt

Varje arende markeras med kundbekraftelse:

- `Kund bekräftad`: SMS och e-post gick ivag
- `Delvis bekräftad`: en kanal gick ivag
- `Kundbekräftelse saknas`: ingen kanal gick ivag

### 6. Verkstaden jobbar vidare i admin

Rekommenderad ordning:

1. `Ny`
2. `Kontaktad`
3. `Vantar kund`
4. `Inlamnad`
5. `Diagnos`
6. `Reparerar`
7. `Vantar delar`
8. `Klar`
9. `Avslutad`

### 7. Kunden far fortsatt tydlig handhallning

Efter den automatiska bekraftelsen kommer den manuella delen:

- bekræfta slutlig tid
- ge pris eller prisram
- meddela om delar behovs
- meddela nar fordonet ar klart

## Roller i verkstaden

### Sebastian

- tekniskt ansvarig
- tar beslut
- ansvarar for tyngre felsokning, batteri och elsystem
- har sista ordet vid bedomningar och upplagg

### Lennart

- mottagning dagtid
- golv, inlamningar, utlämningar och snabba jobb
- ska kunna se allt i admin och flytta kunder genom flodet

## Kundupplevelse som standard

Det kunden ska kanna:

- "De har tagit emot min bokning."
- "De vet nar jag planerar att komma."
- "Jag vet vem jag kan kontakta."
- "Jag kommer inte bli overkord in i ett arbete utan pris eller tydligt nasta steg."

Darfor ska varje automatisk kundbekraftelse innehalla:

- att bokningen ar mottagen
- arendenummer
- vald tjanst
- preliminar tid
- tydligt att tiden blir slutligt bekräftad av verkstaden
- direktnummer till Sebastian och Lennart

## Daglig rutin i admin

### Pa morgonen

1. Oppna adminpanelen.
2. Titta direkt pa `Bekräftelse saknas`.
3. Kontakta dessa kunder forst.
4. Ga sedan vidare till `Ny`.

### Under dagen

1. Markera `Kontaktad` sa fort kunden fatt svar.
2. Anvand `Vantar kund` om ni invantar besked.
3. Markera `Inlamnad` nar scootern ar pa plats.
4. Skriv kort intern notering vid varje viktig handelse.

### Innan stangning

1. Kontrollera att inga roda kundkort ligger kvar utan atgard.
2. Kontrollera klara jobb och planerad upphamtning.
3. Satt `Klar` dar kunden kan hamta.

## Nar ett kort blir rott

`Kundbekräftelse saknas` betyder att kunden inte fick automatisk bekraftelse.

Da ska verkstaden:

1. ringa kunden eller skicka manuell mall direkt
2. spara en intern notering
3. flytta arendet till `Kontaktad` nar kunden ar bekräftad

## Vad systemet ska kommunicera externt

Detta ar ett premiumflode, inte bara ett kontaktformular.

Det betyder:

- snabb kvittens
- tydlig handhallning
- forutsagbar process
- tydliga ansvarspunkter
- inga dunkla loven om tid eller pris

## Framfor allt

Det viktigaste ar inte bara att bokningen kommer in.
Det viktigaste ar att kunden snabbt far trygghet, och att verkstaden direkt ser om den tryggheten inte gick fram automatiskt.
