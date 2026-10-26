# Publika budskap och förtroende

## Genomfört lokalt

- Startsida: grunddiagnos 495 kr och avancerad diagnos 695 kr i FAQ och
  strukturerad FAQ-data, i linje med befintlig /priser/. Inga nya priser.
- Startsida och bokning: bort med motsägande drop-in-prioritet. Bokade besök
  tisdag/torsdag 15–20 kvarstår; andra tider kräver separat överenskommelse.
- Bokning: kontaktlänk för alternativa tider. Bort med fyratimmarslöfte och
  löften om omedelbart SMS. Resultat på skärmen skiljs från senare SMS.
- Startsida: befintliga tre kundomdömen flyttade före batteri- och produktdelar.
  Citat bevarade; enskild snabb leverans framställs inte som generell garanti.
- Startsida: obelagt 50–70-procentspåstående i batterisektionen ersatt med
  individuell bedömning och prisförslag. Ingen ny garanti om reparerbarhet.
- Om oss: Sebastian namnges som ägare/tekniskt ansvarig enligt projektkontext.
  Ingen ny person, bild eller merit uppfinns. Löfte om svar inom ett dygn borttaget.

## Ändrade filer

- index.html
- book-online/index.html (enbart text och metadata; inga fält eller handlers)
- om-oss/index.html
- tests/public-copy.test.mjs
- denna rapport samt docs/AGENT_SYNC_LOG.md

## Verifiering 2026-10-26

- node --test tests/public-copy.test.mjs: 6/6 godkända. Kontrollerar prisbudskap,
  drop-in/svarslöften, omdömens placering, inline-JavaScript och JSON-LD.
- npm run build: godkänd; produktgeneratorn rapporterade inga HTML-ändringar.
- npm run verify:checkout-products: godkänd, 44 produkter.
- nemob-callflow: npm run check: godkänd.
- git diff --check: godkänd före avslut.
- Ingen live-bokning eller production smoke-test utförd. Lokal rendering i
  Edge vid 390 och 1280 px godkänd för alla tre sidor, utan horisontell overflow.
  Skärmbilder stickprovsgranskade. Externa anrop blockerades; inget formulär skickades.

## Kvarvarande beslut och begränsningar

- Detta är en avgränsad rättning, inte en garanti att hela sajten är fri från
  gamla budskap. Kontrollera övriga landningssidor och aktuella Google-betyg
  separat innan ytterligare påståenden återanvänds.
- Ett autentiskt porträtt och godkända verkstadsbilder vore bättre än generiska
  teamroller. Bildval kräver verkligt material och godkännande.
- Strategidokumentens expansion, finansiering, nya paket, garantier och
  lönsamhetsprognoser är förslag, inte verifierade beslut. Inför inte dem som
  publika löften utan kapacitets-, kostnads- och villkorsunderlag.
- Nästa prioritet: slutför och mät bokningsflödet tillsammans med Claude;
  återanvänd befintliga bokningshändelser innan ny spårning införs. Därefter
  stärker strukturerade reparationsfall och dokumenterade lärdomar verkstaden
  mer direkt än en större kosmetisk redesign.

## Handoff till Claude

Branch: codex/site-clarity-trust, separat worktree. Claudes bokningswizard har
inte importerats eller ändrats. Behåll dessa korrigerade texter när wizardens
separata branch integreras; granska överlapp i book-online/index.html manuellt.
PR och merge godkända av Sebastian efter lokal verifiering. Inga SMS/mail skickade,
inga kunddata eller produktionsdata ändrade och stashen inte poppad.
