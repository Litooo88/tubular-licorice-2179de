# NEMOB OS V1

Personlig operativ dashboard för Sebastian: dagens plan, prioriterad topp 5,
manuella uppgifter över alla livsområden och Nordic E-Mobility som strikt
read-only datakälla.

Detta är ett **lokalt internverktyg**. Det deployas inte — mappen är blockerad
från publik servering i `netlify.toml` (404) och all data ligger lokalt i
`nemob-os/data/` (gitignorerad).

**Dagligt arbetsflöde:** se [MANUAL.md](MANUAL.md) — morgonbrief, lunchkontroll,
kvällssvar. Tre beröringar per dag.

## Starta

Kräver endast Node 18+ (inga npm-beroenden).

```powershell
# från repo-roten
npm run nemob-os
# eller: node nemob-os/server.mjs
```

Öppna sedan <http://127.0.0.1:4571>.

## Konfigurera Nordic-källan

1. Kopiera `nemob-os/.env.example` till `nemob-os/.env`.
2. Sätt `NORDIC_BRIEF_URL` till den fullständiga briefing-URL:en
   (admin-endpointen med hemlig slug).
3. Starta om servern.

Utan variabeln körs dashboarden i `not_configured`-läge och fungerar ändå.
URL:en hårdkodas aldrig, loggas aldrig, committas aldrig (gitignorerad) och
visas aldrig i UI, API-svar eller felmeddelanden — alla hämtningsfel mappas
till generiska koder (`unreachable`, `timeout`, `http_503`, …).

## Mobilläge (telefon på samma wifi)

1. I `nemob-os/.env`: sätt `NEMOB_OS_HOST=0.0.0.0` och `NEMOB_OS_PIN=<minst 6 tecken>`.
   Utan PIN vägrar servern starta utanför 127.0.0.1 (fail-safe).
2. Öppna Windows-brandväggen för porten (körs EN gång, som administratör):
   ```powershell
   netsh advfirewall firewall add rule name="NEMOB OS" dir=in action=allow protocol=TCP localport=4571 profile=private
   ```
3. Hitta datorns IP: `ipconfig` → IPv4-adressen (t.ex. `192.168.1.25`).
4. På telefonen (samma wifi): öppna `http://<datorns-ip>:4571`, ange PIN.
   Sessionen sparas 30 dagar i en HttpOnly-cookie — PIN:en lagras aldrig i webbläsaren.
5. Lägg till på hemskärmen (Dela → "Lägg till på hemskärm") — appen öppnas
   i fullskärm med egen ikon.

Skyddet: PIN krävs för allt (sidor och API), timing-safe jämförelse, max 20
felförsök/timme, sessioner dör när servern startas om på riktigt (i minnet).
Datorn måste vara på och telefonen på samma nätverk — datan lämnar aldrig huset.

## Slå upp ärende (sökrutan överst)

Sök på **namn, telefonnummer (valfritt format), modell eller ärendenummer** —
träffarna visar ägare, klickbart telefonnummer, fordon, status och dagar öppet.
Knappen **"Pågående arbeten"** ger den prioriterade verkstadslistan (äldst först).

Kräver `NORDIC_ADMIN_TOKEN` i `.env` (samma token som admin). Utan den visas
ett tydligt `not_configured`-läge. Säkerhetsmodell: token skickas endast
server-till-server, endast GET (proxyn kan inte skriva), telefonen får aldrig
hela databasen — bara whitelistade fält för max 20 träffar. Listan cachas 60 s
och senast hämtade lista visas märkt om källan är nere.

## Utanför hemnätverket: Tailscale

Installera Tailscale på dator + telefon (samma konto). Ingen konfiguration
behövs — ingen exit node, inga subnet routes. Telefonen når sedan dashboarden
var som helst via datorns Tailscale-adress: `http://<tailscale-ip>:4571`
(syns i Tailscale-appen eller `tailscale ip -4`). Trafiken går krypterat
enhet-till-enhet; ingen port öppnas mot internet. Windows räknar
Tailscale-gränssnittet som privat nätverk, så brandväggsregeln ovan täcker det.

## Vad Nordic-integrationen är — och inte är

- **Endast GET** mot briefing-endpointen. Ingen kod i `nemob-os/` kan ändra
  kundstatus, skicka SMS/mail, boka om kunder eller skriva timeline-events.
- Saknade fält visas som **"Data saknas"** — aldrig som falskt noll.
- Vid avbrott visas senast lyckade hämtning (märkt "cachead" med tidsstämpel)
  och dashboarden fortsätter fungera.

## Funktioner (V1)

- **Dashboard**: klocka/datum (Europe/Stockholm), dagens plan, fungerar utan Nordic.
- **Nordic-panel**: dagens bokningar, öppna jobb, äldsta öppna jobb, försenade
  offerter, obetalda fakturor, veckans intäkt, nya bokningar sedan igår.
- **Uppgifter**: titel, område (Nordic/LVU-Myndighet/Ekonomi/Privat/Hälsa/Övrigt),
  deadline, uppskattad tid, risk om den missas (nivå + beskrivning),
  intäkt/framdrift, nästa konkreta steg, status (Ny/Planerad/Pågår/Blockerad/
  Klar/Flyttad), blockeringsorsak.
- **Prioriteringsmotor** (tier-ordning): akut risk → LVU/myndighets-/kalender-
  deadline → kund som väntar → intäkt idag → blockerar andra → snabb med hög
  effekt → övrigt. Varje topp 5-post visar *varför* den prioriterats.
- **Dagsplan**: morgonbrief, topp 5, förmiddags-/eftermiddagsblock (180 min
  budget per block), kontroll mitt på dagen, kvällssammanfattning.
- **Aktiv användning**: starta/klar/blockera (med orsak)/flytta/ändra deadline/
  prioritera (pin)/redigera, "+ Akut uppgift" (genererar om planen), "Generera
  om dagsplan".
- **Persistens**: allt i `nemob-os/data/nemob-os.json` (atomiska skrivningar) —
  överlever omladdning och omstart.
- **Uppföljningsloop**: morgonfrågorna besvaras automatiskt i morgonbriefen;
  mittdags- och kvällsfrågorna har formulär vars svar sparas per dag.

## Test

```powershell
node --test "nemob-os/test/*.test.mjs"
```

Testerna täcker prioriteringsordningen, "Data saknas"-semantiken, planmotorn,
persistensen och att Nordic-klienten aldrig läcker URL:en i fel eller svar.

Testknappen "Simulera att källan är nere" i UI:t (endpoint
`/api/dev/simulate-down`) simulerar avbrott i minnet — den rör aldrig den
riktiga endpointen.

## Lämnat till V2 (medvetet)

- Auth/multi-user (V1 är single-user, binder endast till 127.0.0.1).
- Automatisk planering över flera dagar och kalendersynk.
- Push/notiser, mobil-PWA.
- AI-genererade dagsomdömen och förslag.
- Återkommande uppgifter och mallar.
- Koppling till fler Nordic-datafält än briefing-endpointen exponerar.
