# Verkstadsworkflow i admin

Det har dokumentet ar till for Sebastian, Lennart och ovriga som jobbar i verkstaden. Malet ar att varje arende ska hanteras pa samma satt varje gang, sa att kundkontakt, betalning och content inte blir personberoende.

## 1. Oppna admin

- Ga till `https://www.nordicemobility.se/admin/`
- Klistra in `ADMIN_TOKEN`
- Tryck `Spara token`
- Tryck `Uppdatera`

Tips:
- Anvand helst vanlig Chrome eller Safari, inte inbyggd browser i sociala appar.
- Om nagot ser gammalt ut: uppdatera sidan hart.

## 2. Oversikt over arendet

Varje kundkort har fem flikar:

- `Oversikt`
- `Kontakt info`
- `Klar / hamtning`
- `Betalning`
- `Bilder / content`

Grundregeln ar:

1. Las `Oversikt`
2. Kontakta kund
3. Jobba i verkstaden
4. Nar jobbet ar klart: anvand `Klar / hamtning`
5. Nar kunden betalat: anvand `Betalning`
6. Om jobbet ar bra for marknadsforing: anvand `Bilder / content`

## 3. Statusregler i verkstaden

Anvand dessa statusar konsekvent:

- `Ny` = ny bokning som inte ar hanterad
- `Kontaktad` = kund har fatt forsta aterkopplingen
- `Vantar kund` = ni vantar svar eller godkannande
- `Inlamnad` = fordonet ar inne
- `Diagnos` = felsokning pagar
- `Reparerar` = arbetet ar i gang
- `Klar` = fordonet ar klart for hamtning
- `Avslutad` = jobbet ar klart och stangt

## 4. Kontakt med kund

I fliken `Kontakt info` finns snabbknappar for:

- `Ring kund`
- `SMS kund`
- `Maila kund`
- `Mailmall`

Nar ni tagit ett steg med kunden ska status alltid uppdateras direkt. Da ser alla i verkstaden vad som ar gjort utan att lasa igenom hela arendet.

## 5. Nar fordonet ar klart

Det har ar den viktigaste rutinen.

Ga till `Klar / hamtning` och fyll i:

- `Totalt belopp inkl. moms`
- `Utforda atgarder`
- `Kundinfo om upphamtning`

Tryck sedan:

- `Spara underlag` om du bara vill spara
- `Spara + markera klar` nar fordonet faktiskt ar fardigt

Anvand drefter:

- `Drafta SMS`
- `Drafta mail`
- `Kopiera SMS`
- `Kopiera mail`
- `Kopiera hamtlank`

Nar meddelandet verkligen ar skickat:

- tryck `Markera SMS skickat`
- eller `Markera mail skickat`

Da gar det i efterhand att se att kunden verkligen blivit aviserad.

## 6. Betalning och Fortnox-underlag

Ga till `Betalning` och fyll i:

- `Belopp att bokfora`
- `Betalstatus`
- `Betalsatt`
- `Referens / kvitto / Swish-ID`

Om kunden har betalat:

- tryck `Markera betald nu`

Om du ska skicka vidare till ekonomi eller Fortnox:

- anvand `Kopiera Fortnox-underlag`
- anvand `Kopiera betalnotering`

Regel:
- Markera aldrig ett arende som betalt utan att belopp och betalsatt ar ifyllda.

## 7. Bilder och content

Ga till `Bilder / content` for jobb som ar bra att visa upp.

### Ladda upp bilder

Fyll i:

- `Bildkategori`
- `OK for content`
- `Intern bildnotering`

Valj sedan bilder och tryck `Ladda upp bilder`.

Bra kategorier:

- `before` = fore arbetet
- `after` = efter arbetet
- `battery` = batteri, celler, BMS
- `damage` = skada, fel, slitna delar
- `workshop` = miljobilder, process, detaljbilder

### Skapa contentutkast

Nar bilderna ar uppladdade:

- tryck `Analysera material`

Det skapar eller uppdaterar tre utkast:

- socialt inlagg
- Google Business-post
- webbcase

### Granska och spara

Under `Content builder` finns:

- `Contentstatus`
- `Primara kanaler`
- `Intern contentnotering`

Och fyra viktiga knappar:

- `Spara content`
- `Markera granskning`
- `Markera redo`
- `Markera publicerat`

Rekommenderat arbetsflode:

1. Ladda upp bilder
2. Kor `Analysera material`
3. Las igenom texterna
4. Justera vid behov
5. Tryck `Markera granskning`
6. Nar inlagget ar godkant: tryck `Markera redo`
7. Nar det faktiskt ar publicerat: tryck `Markera publicerat`

Extra verktyg:

- `Kopiera socialt`
- `Kopiera Google`
- `Kopiera webbcase`
- `Kopiera allt`

## 8. Daglig rutin i verkstaden

Varje dag borja sa har:

1. Oppna admin
2. Sortera ut `Ny`, `Kontaktad`, `Vantar kund`, `Klar`
3. Se till att alla nya arenden har en ansvarig
4. Kontakta kunder som vantar pa pris eller besked
5. Nar ett jobb ar klart: fyll i slutkostnad och skicka klarmeddelande
6. Om jobbet ar bra for marknadsforing: ladda upp bilder samma dag

## 9. Enkla regler for Lennart

For att undvika misstag:

- andras aldrig slutpris utan att Sebastian ar med
- markera inte `Betald` utan kvitto eller faktisk betalning
- publicera inte content utan att det ar granskat
- om du ar osaker: spara som utkast, inte som klart

## 10. Malet med systemet

Systemet ska gora tre saker:

1. Minska manuell kundkommunikation
2. Ge full koll pa vad som ar gjort, vad som vantar och vad som ar betalt
3. Forvandla bra verkstadsjobb till content utan extra dubbelarbete
