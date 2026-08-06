# Nordic E-Mobility Strategic Implementation Plan

Status: 2026-08-06  
Källa: `Nordic_E-Mobility_Strategisk_sammanstallning.pdf` och befintlig
repo-kontext.

Det här dokumentet är arbetsplanen för hur Nordic E-Mobility ska ta strategin
från PDF till ett fungerande system i små, säkra steg. Det ska användas som
styrning för Codex, Claude Code och ChatGPT när sidan och admin uppdateras
löpande.

## Målbild

Nordic E-Mobility ska vara en operativt smart scooter- och elcykelverkstad där
varje reparation förbättrar nästa reparation.

Den centrala loopen är:

```text
Reparation
-> strukturerad ärendedata
-> intern kunskap
-> tydligare kundrapport
-> bättre reservdelsdata
-> bättre SEO/socialt innehåll
-> snabbare diagnos nästa gång
```

Det betyder att vi inte bygger fler fristående demo-paneler. Vi bygger runt
`Repair Case` som sanning: vad kunden har, vad som hänt, vad som är nästa steg,
vad verkstaden lärt sig och vad kunden ska få veta.

## Grundprinciper

- En liten PR i taget.
- Ingen stor redesign innan datagrunden är begriplig.
- Inga SMS eller mail skickas automatiskt.
- AI får föreslå, sammanfatta och prioritera, men inte lova pris, beställa delar
  eller skicka högriskmeddelanden utan godkännande.
- `/api/cases` ska vara primär operativ källa där den redan fungerar.
- Netlify Blobs ska behandlas som produktionslagring, men alla funktioner ska ha
  tydliga `not_configured`/dry-run-lägen om miljön saknas.
- Publika sidan ska uppdateras från verkliga lärdomar i verkstaden, inte från
  påhittade AI-svar.

## Nuvarande teknisk verklighet

- Sajten är statisk HTML/JavaScript på Netlify.
- Admin och publika routes är mappar/filer som `admin/`, `book-online/`,
  `workshop/`, `prices/`, `quick-price/` och `nya-elscootrar/`.
- API ligger främst i `netlify/functions/`.
- Ärendelistan i admin fungerar via `/api/cases`.
- AI Kontrolltorn och vissa exportfunktioner har historiskt försökt läsa Blob-
  källor som inte alltid är konfigurerade i production.
- `nemob-callflow/` är separat Cloudflare Worker för 46elks-telefoni.
- Ingen Next.js, ingen Supabase och ingen direktimport från Claude-prototypen i
  huvudspåret.

## Beslut Från Strategin

Följande beslut ska styra implementationen:

- Repair Case är single source of truth.
- Bokning och reparationsorder är olika saker.
- AI V1 klassificerar och routar. Den improviserar inte pris, diagnos,
  reservdelar eller leveranslöften.
- Kundkommunikation ska byggas från godkända svarblock.
- Säkerhetsflaggor går alltid före automatisering.
- Prisintervall mot kund ska hållas försiktiga tills intern estimator och mer
  data finns.
- Verkstaden behöver WIP-kontroll innan intake skalas upp.
- Öppna, kostsamma ärenden ska stängas/struktureras innan mer låg-ROI-utveckling.

## KPI-Modell För Admin

Admin ska visa operativa, tydliga mått. Undvik etiketten "aktiva ärenden" när
den egentligen betyder "ej done/archived".

Föreslagen KPI-modell:

- **Gör nu:** ärenden med hög prio eller tydlig `nextAction` idag/försenad.
- **Nya utan bekräftelse:** nya förfrågningar/bokningar där kunden ännu inte har
  fått bekräftelse.
- **Missade samtal att följa upp:** importerade eller manuellt inklistrade
  nummer som inte är avklarade.
- **Väntar kund:** ärenden där nästa steg ligger hos kund, t.ex. inväntar
  godkännande eller svar.
- **Väntar del:** ärenden blockerade av reservdel.
- **Klara att hämta:** ärenden i `KLAR FÖR UPPHÄMTNING`.
- **Klara att fakturera/betala:** ärenden där betalning ska skickas, påminnas
  eller följas upp.
- **Risk/stått stilla:** ärenden utan progression efter definierad tidsgräns,
  missnöjd kund, reklamation, batteri, garanti, högt pris eller oklart ansvar.
- **Ej arkiverade:** teknisk backstop för allt som inte är avslutat/arkiverat,
  men inte primär styr-KPI.

## Repair Case Minimum V1

Nya fält ska vara bakåtkompatibla och optional i början.

Rekommenderade fält:

- `intakeRoute`: `A`, `B`, `C` eller tomt.
- `nextAction`: kort text om nästa konkreta steg.
- `nextActionDate`: datum när nästa steg ska ske.
- `priority`: `low`, `normal`, `high`, `urgent`.
- `riskFlags`: lista, t.ex. `battery`, `complaint`, `angry_customer`,
  `price_over_995`, `warranty`, `legal`, `parts_over_500`.
- `missingFields`: lista över saknad info, t.ex. modell, felbeskrivning,
  telefon, kundgodkännande.
- `vehicleBrand`, `vehicleModel`, `symptoms`, `jobType`.
- `diagnosisSummary`, `serviceActions`, `partsNeeded`, `partsUsed`.
- `laborMinutes`, `estimatedRange`, `finalPrice`.
- `customerPromise`: vad som faktiskt sagts till kund.
- `internalLearning`: vad verkstaden lärde sig av fallet.
- `knowledgeCandidate`: om fallet kan bli guide/FAQ/social post.

Första implementation ska inte kräva migration. Befintliga cases utan dessa
fält ska fungera som idag.

## Faser

### Fas 0: Plan Och Sanning

Syfte: göra strategin till repo-minne och undvika att agenter bygger åt olika
håll.

Scope:

- Detta dokument.
- Uppdaterad sync-logg.
- Ingen UI- eller API-ändring.

Acceptans:

- Planen beskriver PR-ordning, datakällor, risker och uppdateringsloop.
- Ingen SMS/mail-funktion aktiveras.
- Inga production-writes.

### Fas 1: Admin Truth Model

Syfte: göra admin mindre missvisande och mer handlingsbar.

Scope:

- Byt bort vaga KPI:er som "aktiva" mot modellen ovan.
- Visa tydligt när en källa är saknad, t.ex. call-log/46elks.
- Låt AI Kontrolltorn bygga operativ brief från `/api/cases` som primär källa.
- Blob-/exportkällor blir sekundära och får aldrig blockera ärendelistan.

Acceptans:

- Admin visar inte demo/mock som live.
- Saknade integrationer visas som `ej kopplad` eller `källa saknas`.
- `/api/cases` fungerar som källa för prioritering även om Blobs saknas.

### Fas 2: Nästa Åtgärd På Varje Ärende

Syfte: varje kundkort ska svara på frågan "vad ska hända nu?"

Scope:

- Lägg till enkel visning/editering för `nextAction`, `nextActionDate`,
  `priority` och `riskFlags`.
- Om backendfält saknas: spara i befintlig cases-struktur med bakåtkompatibla
  optional fields.
- AI får föreslå nästa steg i dry-run, men admin måste godkänna.

Acceptans:

- Det går att sortera/fokusera på dagens arbete.
- Ärenden utan nästa steg blir synliga som arbetsrisk.
- Inga automatiska SMS/mail.

### Fas 3: Bokning Som Servicemottagning

Syfte: `/book-online/` ska samla den data verkstaden faktiskt behöver.

Scope:

- Dela intake i A/B/C:
  - **A:** enkel bokning/inlämning.
  - **B:** kräver mer information före inlämning.
  - **C:** högrisk eller specialfall som kräver manuell hantering.
- Förtydliga att bokning inte alltid är reparationsorder.
- Samla modell, symptom, körbarhet, batteri/garanti/reklamation och bilder där
  det är säkert.

Acceptans:

- Kunden får rätt förväntan.
- Verkstaden får bättre underlag innan fordon kommer in.
- Högriskfall flaggas tidigt.

### Fas 4: Godkända Svarblock

Syfte: snabbare kundkommunikation utan att AI improviserar.

Scope:

- Skapa bibliotek med godkända svenska svarblock för vanliga lägen:
  bokningsbekräftelse, saknad modell/fel, missat samtal, väntar kund,
  väntar del, klar för upphämtning, recension efter avslut.
- Högriskblock kräver alltid manuell approval.
- Svarblock dokumenteras i repo och används av AI-utkast.

Acceptans:

- AI-utkast bygger på godkända fraser.
- Högriskord stoppar autoskick.
- Inga riktiga SMS skickas från admin utan separat godkänd send-flow.

### Fas 5: AI Operatör V1

Syfte: AI hjälper Sebastian att se vad som behöver göras först.

Scope:

- AI daily brief från `/api/cases`.
- Riskidentifiering med deterministiska regler först.
- AI får sammanfatta och föreslå, inte besluta.
- Dry-run är standard för nya flöden.

Acceptans:

- Brief fungerar även när Blobs/call logs saknas.
- Svaret säger vilka källor som användes och vilka som saknas.
- Inga writes i production smoke utan `dryRun`.

### Fas 6: WIP Och Intake-Läge

Syfte: hindra att verkstaden drunknar i nya ärenden.

Scope:

- Adminstyrt intake-läge:
  - `open`
  - `limited`
  - `waitlist`
- Publik bokningssida visar rätt kapacitetsläge.
- Nya förfrågningar kan fortfarande tas emot, men löften justeras efter läge.

Acceptans:

- Sebastian kan strypa inflöde utan att stänga sajten.
- Kunden får ärlig information om återkopplingstid.

### Fas 7: Stäng Ärende -> Kunskap

Syfte: varje avslutat ärende ska bidra till verkstadens kunskapsbank.

Scope:

- Enkel avslutningsruta:
  - symptom
  - rotorsak
  - åtgärd
  - delar
  - arbetstid
  - slutpris
  - lärdom
  - om fallet kan bli guide/social post.
- AI får skapa intern sammanfattning och kundvänlig rapport, men bara som
  utkast.

Acceptans:

- Avslutade cases blir sökbar historik.
- Publiceringskandidater flaggas utan att publiceras automatiskt.

### Fas 8: Löpande Webbuppdatering

Syfte: hemsidan blir bättre varje vecka baserat på verkliga jobb.

Uppdateringsloop:

1. Samla avslutade cases.
2. Markera återkommande fel, modeller och frågor.
3. Välj 1-3 lärdomar som är säkra att publicera.
4. Uppdatera relevant sida med tydlig, kundnyttig text.
5. Kör build/test.
6. PR och granskning.

Route-plan:

- `/`: tydligare värdeerbjudande, kapacitetsläge, länk till rätt intake.
- `/book-online/`: frågor och copy justeras efter verkliga missförstånd.
- `/prices/`: standardpriser och försiktiga felsökningsintervall.
- `/nya-elscootrar/`: köpråd baserat på serviceerfarenhet.
- `/workshop/`: verkstadsflöde och tekniska fält som behövs på golvet.
- `admin/`: operativ kontrollpanel, inte demo-dashboard.
- Chat-widget: svarar med säkra FAQ/block, inte fria löften.

Acceptans:

- Inget kundidentifierande publiceras.
- Inga priser, garantiuttalanden eller diagnoser publiceras utan granskning.
- Sidan känns enkel för kund, men bygger på mer strukturerad intern data.

## PR-Roadmap

Rekommenderad ordning:

1. **Docs: strategisk plan**  
   Filer: `docs/NEMOB_STRATEGIC_IMPLEMENTATION_PLAN.md`,
   `docs/AGENT_SYNC_LOG.md`.  
   Risk: låg.

2. **Admin KPI truth model**  
   Filer: `admin/index.html`, eventuellt befintliga admin helpers.  
   Mål: sluta visa missvisande "aktiva" tal och demo/live-blandning.

3. **AI brief from cases**  
   Filer: `netlify/functions/ai-daily-brief.js`, `admin/index.html`.  
   Mål: `/api/cases` primär källa, Blobs/call logs sekundärt.

4. **Next action fields**  
   Filer: cases API/admin UI.  
   Mål: varje case kan få nästa steg, datum och riskflagga.

5. **Booking intake classification**  
   Filer: `book-online/`, `netlify/functions/bookings.js` eller aktuell
   bookings-function.  
   Mål: A/B/C och tydligare kundförväntan.

6. **Approved response block library**  
   Filer: docs + shared business rules.  
   Mål: SMS/mail-utkast byggs från godkända block.

7. **Close case knowledge capture**  
   Filer: admin/workshop/cases API.  
   Mål: avslutade jobb blir användbar verkstadskunskap.

8. **Weekly site update loop**  
   Filer: publika route-filer och docs.  
   Mål: SEO/guider/köpråd uppdateras från verkliga, anonymiserade case-lärdomar.

## Definition Of Done För Varje PR

Varje PR ska kunna besvara:

- Vilken operativ friktion minskar detta?
- Vilken datakälla används?
- Är något demo/mock, och är det tydligt märkt?
- Skickas SMS/mail? Om ja: finns explicit approval? Om nej: står det tydligt?
- Görs production-writes? Om ja: varför och var?
- Har auth kontrollerats för admin-endpoints?
- Har relevanta docs uppdaterats?
- Har `npm run build`, `npm run verify:checkout-products` och
  `nemob-callflow npm run check` körts när kod ändrats?

## Risker Att Bevaka

- Admin kan se avancerad ut men visa fel sanning om källorna blandas.
- `/api/cases` och Blob-lager kan divergera om de inte får tydlig ägarskap.
- För mycket AI för tidigt kan skapa falsk trygghet kring pris, diagnos eller
  ansvar.
- Publicerad SEO från ofullständiga case kan bli felaktig eller juridiskt
  känslig.
- Stora visuella redesigns kan skymma viktigare operativa brister.

## Vad Claude Kan Hjälpa Till Med

Claude får gärna arbeta parallellt med:

- copyförslag till publika sidor baserat på denna plan,
- FAQ-/svarblocksutkast,
- dokumentation,
- analys av vilka kundfrågor som bör bli intake-frågor,
- designskisser som inte direkt mergeas.

Claude ska inte:

- mergea Next.js/Supabase-prototypen in i huvudrepot,
- ändra datamodell utan migrationsplan,
- lägga in live-SMS/mail,
- skriva över Codex-brancher eller ocommittat arbete i samma mapp.

## Nästa Rekommenderade Steg

Nästa kod-PR bör vara **Admin KPI truth model**:

- Byt "aktiva ärenden" till "ej arkiverade".
- Lägg till "Gör nu", "Saknar nästa åtgärd" och "Risk/stått stilla".
- Visa call-log som "samtalsimport ej kopplad" när källan saknas.
- Låt AI Kontrolltorn visa vilka källor som användes och vilka som saknas.

Det är rätt första kodsteg eftersom det gör admin mer användbar direkt utan att
kräva ny databas, Supabase eller större redesign.
