# Nordic E-Mobility: 30-dagars projektplan

## Syfte

Detta dokument ar en gemensam arbetsplan for hemsida, bokningssystem, admin, content och premiumforsaljning.

Malet ar att Nordic E-Mobility ska bli:

1. det sjalvklara valet i Mellansverige for service, batteri och elscootrar
2. det mest fortroendeingivande alternativet for premium-elscootrar i Sverige
3. en verksamhet som arbetar med system och kontinuitet, inte ad hoc

---

## Malbild

Om 30 dagar ska vi ha ett system dar:

- kunder bokar enkelt och far tydlig bekraftelse
- verkstaden kan jobba snabbt fran mobil utan onodigt manuellt arbete
- status, pris, betalning och hamtning ar tydliga i admin
- bilder fran jobb kan bli content med lag handpaleggning
- premiumsortimentet saljs med trygg checkout, showroom-kansla och tydligt eftermarknadsstod
- Google Business och sociala medier uppdateras lopande

---

## Statuslegend

- `Klart` = live eller fullt anvandbart
- `Pa gang` = delvis byggt, fungerar men ar inte komplett
- `Ej startat` = planerat men inte byggt
- `Blockerat` = kraver beslut, konto eller extern koppling

---

## Nulage i projektet

### Det som ar klart

- Ny huvudsite pa `.se`
- `.com` redirect till `.se`
- Prislista uppdaterad och live
- Bokningssystem med adminflode
- Kundkort med kontaktflikar
- Betalstatus i admin
- Fortnox-forberett underlag i admin
- Bilduppladdning per kundcase
- Grund for content builder
- Mail/SMS/kalender-grund
- Battre lokal SEO-struktur

### Det som ar pa gang

- Bild-AI/content workflow
- Admin-forbattringar for verkstadsdrift
- Premium produktlyft for fler marken
- Kundutskick nar arbete ar klart

### Det som inte ar fardigt

- Klarna i Stripe-checkout
- Riktig Fortnox-integration
- Publiceringsko for sociala medier och Google Business
- Full analytics-installation
- Showroom/provkorning-flode

---

## Arbetsstrommar

| Omrade | Status | Mal | Ansvar |
|---|---|---|---|
| Bokning och kundbekraftelser | Pa gang | Trygg bokning, tydliga kundutskick, mindre manuellt arbete | Codex + Sebastian |
| Admin och verkstadspipeline | Pa gang | Latt att se vem som vantar pa kontakt, pris, hamtning eller betalning | Codex + Sebastian |
| Betalning och faktura | Pa gang | Betald-status, Fortnox-underlag, senare fakturautkast | Codex + Sebastian |
| Bild/content builder | Pa gang | 1 jobb -> flera contentbitar | Codex |
| Premium retail/showroom | Pa gang | Starkare forsaljning av premiumfordon med test- och trygghetskansla | Sebastian + Codex |
| Analytics och SEO | Pa gang | Mata trafik, sokord, konvertering och lokalt genomslag | Codex |
| Google Business och social cadence | Ej startat i systemform | Kontinuerliga poster, bilder, recensioner och lokala signaler | Sebastian + Lennart + Codex |

---

## 30-dagars roadmap

## Vecka 1: Drift, checkout och mattning

### Fokus

Fa grunden skottsaker sa att vi vet vad som fungerar, vad som saljer och var kunder fastnar.

### Leverabler

- Stripe-checkout genomgang och hardening
- Klarna-plan och implementation om konto och Stripe-installning ar redo
- GA4 pa sajten
- Google Search Console fullt verifierad och uppfoljd
- Microsoft Clarity installerad
- Admin mindre "buggig" pa mobil och vardagsanvandning

### Resultat efter veckan

- vi kan se trafik och beteende
- vi vet om premiumprodukterna faktiskt klickas pa
- vi vet var kunder hoppar av

### Status

- Stripe finns: `Klart`
- Klarna i checkout: `Ej startat / Blockerat av setup`
- Analytics: `Ej startat`
- Admin-stabilitet: `Pa gang`

---

## Vecka 2: Kundflode och "klar att hamta"

### Fokus

Minska tiden som idag laggs pa manuell kundkontakt om pris, status och hamtning.

### Leverabler

- Falt for total kostnad i klarflode
- "Drafta SMS" nar scootern ar klar
- "Drafta mail" nar scootern ar klar
- Utskicken ska sammanfatta:
  - kundens namn
  - modell
  - utfort arbete
  - totalt belopp
  - lank till bokning av upphamtning eller hamtning
  - tydligt nasta steg
- Tydligare arendestatus:
  - Ny
  - Ej kontaktad
  - Kontaktad
  - Pris skickat
  - Vantar godkannande
  - Pagar
  - Klar att hamta
  - Betald
  - Fakturerad
  - Avslutad

### Resultat efter veckan

- mindre manuellt SMS-arbete
- mindre risk att kunder missas
- tydligare drift for Sebastian och Lennart

### Status

- Betalstatus: `Klart`
- Klar/hamta-utskick: `Ej startat`
- Tydlig verkstadspipeline: `Pa gang`

---

## Vecka 3: Bild-AI och content motor

### Fokus

Gora content till en naturlig del av verkstadsflodet i stallet for ett separat projekt.

### Leverabler

- bilduppladdning per kundcase finslipas
- kategorier for:
  - fore
  - efter
  - skada
  - batteri
  - verkstad
  - hamtning
- smartare `/api/analyze` med battre forslag till:
  - Instagram/Facebook-post
  - Google Business-post
  - webbcase
  - kort caption
  - CTA
- review-steg dar material godkanns innan anvandning
- samtyckesflagga for publicering

### Resultat efter veckan

- ett jobb ska kunna ge flera marknadsforingsbitar
- kontinuitet i sociala medier och Google Business

### Status

- Media-upload: `Klart`
- Content builder grund: `Klart`
- Riktig bildforstaelse: `Ej startat`
- Publish/queue: `Ej startat`

---

## Vecka 4: Showroom, premium retail och Fortnox

### Fokus

Forvandla sajten fran stark verkstadssajt till starkt premiumvarumarke med showroom-logik.

### Leverabler

- showroom/provkorning-flode
- premium produktpresentation for Teverun och andra high-end-modeller
- tydligare trygghetscopy for dyrare kop:
  - testa innan kop
  - service lokalt
  - eftermarknad
  - garanti och support
- Fortnox OAuth-plan eller stegvis integration
- "skapa fakturautkast" som malbild

### Resultat efter veckan

- starkare premiumposition
- battre conversion pa dyrare produkter
- tydligare bro mellan verkstad och forsaljning

### Status

- Produktsektion finns: `Klart`
- Premium retail flow: `Pa gang`
- Fortnox-utkast med ett klick: `Ej startat`

---

## Egna bedomningen av marknadsposition

### Dar vi redan ar starka

- tydlig batteri- och elsystemposition
- starkare lokal verkstadsidentitet an manga konkurrenter
- battre intern struktur an normal verkstadssajt
- tydligare koppling mellan service och premiumforsaljning

### Dar vi inte ar overlagsna annu

- checkout och finansieringsalternativ
- contentmaskin och Google Business-rutin
- showroom/provkorning som konverteringsmotor
- riktigt matt, inte magkansla
- riktig Fortnox-koppling

### Slutsats

Vi ar starkare an tidigare och battre an manga lokala alternativ.
Vi ar dock inte annu overlagsna premiumaktorer nationellt.
For att bli storst och bast i Mellansverige maste vi nu vinna pa:

- fortroende
- system
- kontinuitet

---

## Viktigaste beslut som Sebastian maste ta

| Beslut | Rekommendation | Varfor |
|---|---|---|
| Ska Klarna prioriteras fore Fortnox? | Ja | Hojer konvertering snabbare pa premiumkop |
| Ska showroom/testride vara eget fokus? | Ja | Minskar kopmotstand pa dyrare fordon |
| Ska content publiceras automatiskt? | Nej, utkast forst | Behall kontroll och kvalitet |
| Ska Google-login eller SMS-login bli adminstandard? | Google + fallback | Mest hallbart over tid |

---

## Roller

### Sebastian

- ager beslut, prisstrategi och batteri/elsystem
- prioriterar verksamhetslogik
- ager relation till varumarken och premiumsortiment

### Lennart

- mottagning och vardagsflode pa golvet
- ska kunna anvanda admin enkelt
- ska inte behova fatta tekniska systembeslut

### Codex

- bygger och forvaltar webb, admin och floden
- driver SEO, innehallssystem och struktur
- minskar manuella steg och friktion

### Externa konton/tjanster

- Stripe/Klarna
- Fortnox
- Google Business
- Meta/Instagram
- Google Analytics/Search Console

---

## KPI:er att folja varje vecka

- antal bokningar
- antal premiumprodukt-forfragningar
- andel bokningar som far korrekt bekraftelse
- tid till forsta kontakt
- antal jobb som blir content
- antal poster pa Google Business
- antal sociala poster
- antal recensioner
- showroom/provkorning leads
- betalade jobb
- fakturerade jobb

---

## Inputs fran kollegor

Foljande ar bra att kommentera direkt i genomgang:

1. Vilka delar i admin skapar mest strul i vardagen?
2. Vilka kundmeddelanden skrivs fortfarande manuellt for ofta?
3. Vilka jobb blir bast content i verkligheten?
4. Vad far kunder oftast att tveka innan de koper dyrare scooter?
5. Vilka betalalternativ maste vara pa plats for att premiumkop ska kannas trygga?
6. Hur ska showroom bokas och bemannas utan att verkstaden tappar fart?

---

## Rekommenderad nasta ordning

1. Klarna + checkout-hardening
2. Klar-att-hamta SMS/mail
3. Smartare adminstatus
4. Bild-AI och content review
5. Google Business-rutin
6. Fortnox-integration
7. Showroom/provkorning-flode

---

## Sammanfattning

Projektet ar inte bara en hemsida langre.
Det ar pa vag att bli ett operativt system for:

- bokning
- kundkontakt
- betalning
- content
- premiumforsaljning

Om vi bygger klart i ratt ordning kan Nordic E-Mobility bli det sjalvklara valet i Mellansverige for service, batteri och premium elscootrar.
