# Agent Sync Log — Nordic E-Mobility

Delad realtidslogg mellan AI-agenter som jobbar i detta repo (Claude Code,
Codex, m.fl.). Syftet: vi jobbar ofta **parallellt i samma mapp** och får inte
skriva över varandras arbete eller dubblera ändringar. Den här filen är vår
löpande "konversation".

> Detta är operativ koordinering. Den varaktiga arkitektur-/handoff-bilden bor
> fortfarande i [`AGENTS.md`](../AGENTS.md), [`CLAUDE.md`](../CLAUDE.md) och
> [`docs/codex-handoff.md`](codex-handoff.md). Den här filen ersätter dem inte.

## Protokoll (läs och följ)

1. **Vid start av ett pass:** `git fetch origin`, stå på `main`,
   `git pull --ff-only`, läs de senaste posterna nedan.
2. **När du börjar en uppgift:** lägg en NY post högst upp i `## Logg` med
   status `PÅGÅR` — säg vilken branch och vilka filer/områden du tar.
3. **När du är klar / lämnar över:** uppdatera posten till `KLAR` (eller lägg en
   ny) med resultat, testkörningar och ev. risker.
4. **Commit-disciplin:** committa loggändringen i en **egen liten commit**.
   `git pull --ff-only` innan du pushar. Lämna inte ändringar ocommittade länge
   — ocommittat arbete kan gå förlorat om den andra agenten byter branch i den
   delade mappen.
5. **Vid konflikt i denna fil:** behåll BÅDA posterna (det är en logg, inget ska
   skrivas över). Lös konflikten genom att lägga båda i kronologisk ordning.
6. **Rör aldrig** den andra agentens ocommittade arbete, branch eller
   git-worktree. Byt inte branch i en mapp där den andra kan jobba utan att först
   logga det här och säkra (committa) eget arbete.
7. **Format på en post:** se mallen längst ned.

## Logg

<!-- Nyaste posten överst. Lägg nya poster direkt under denna rad. -->

### 2026-09-02 — Codex — KLAR (operatörens mobilsvar hann före AI-telesvaret)

- **Skarpt fynd:** testsamtalet till privatlinjen 12:25 nådde `connect` och
  avslutades som `success` efter 32 sekunder. Ingen `play`/`record` följde;
  mobiloperatörens mobilsvar hade svarat och 46elks betraktade därför
  vidarekopplingen som besvarad.
- **Driftfix:** Netlify production-env `VOICE_TIMEOUT_SECONDS=15` (tidigare
  kodstandard 25) så 46elks går vidare till eget telesvar innan operatörens
  mobilsvar hinner svara. Variabeln delas av 076- och 010-linjen.
- **Verifiering:** ny produktiondeploy `ready` 12:29 och värdet återläst som 15.
  Manuellt testsamtal återstår: cirka 15 sekunders ringning, därefter egen
  hälsning, pip och inspelning.

### 2026-09-02 — Codex — KLAR (privatlinjens ringtid 10–19 i produktion)

- **Driftändring:** Netlify production-env `PRIVATE_LINE_START=10` och
  `PRIVATE_LINE_END=19`. Övriga telefoniinställningar lämnades oförändrade.
- **Deploy:** ny produktiondeploy från oförändrad `main` blev `ready` 10:49.
  46elks-kopplingen behöver inte ändras; `voice-private` läser tiderna från
  miljön vid anrop.
- **Verifiering:** båda värdena sattes via Netlify CLI och deployen blev grön.
  Manuellt testsamtal av Sebastian återstår.

### 2026-09-01 — Claude Code — KLAR (recensionsmotorn: SMS-fråga + /recension + QR-skylt + title-pass sida 1)

- **Konkurrentbaseline Örebro (kartpaketet):** Nordic 4,7★ (15 rec) —
  högst betyg, näst minst volym. Örebro MC Service 4,3 (96), KeBe 4,3
  (184), Elcykelpunkten 4,5 (28), POWER 4,3 (436). Nordic syns i
  paketet på alla fyra måltermerna (OBS: mätt i Sebastians inloggade
  Chrome — neutral verifiering återstår). Mål: 28 → 50 → 96.
- **sendThankYou skickar nu recensions-SMS** (kort, /recension-länken,
  aldrig optout, aldrig dubbelt via notifications-koll, följer tysta
  timmar via befintlig kö). Mejlets recensionsknapp kvar.
- **/recension** = 302 i netlify.toml → Googles skrivformulär.
  VIKTIGT FYND: _redirects-filen kopieras inte till dist och är DÖD
  sedan allowlist-bygget — alla levande redirects bor i netlify.toml.
  Filen är markerad som historik; städa eller aktivera medvetet.
- **Title-pass sida 1/N:** /elscooter-reparation-orebro/ (pris + samma
  dag + auktorisationer). En sida i taget; nästa efter ~2 veckors
  GSC-mätning.
- **QR-skylt A5** (tryckfärdig PDF) levererad till Sebastian.

### 2026-09-01 — Claude Code — KLAR (telesvaret: pipet saknades + AI:n hittade på)

- **Branch:** `fix/telesvar-pip` → PR #136, mergad till `main`. Sebastian rapporterade: "det
  kommer aldrig ett pip".
- **Rotorsak 1 — inget pip:** båda talpromptarna säger "lämna ett meddelande
  efter pipet", men 46elks `record`-action spelar inget pip. Kunden mötte
  tystnad och visste inte när den skulle prata. Fix: nytt `beep`-steg som
  spelar 46elks inbyggda `sound/beep` mellan prompt och inspelning, i BÅDA
  linjerna (`voice-simple.mjs` alla tre promptvägar, `voice-private.mjs`).
  Uppringarens nummer bärs vidare genom det nya steget (samma kedjekrav som
  fixen 28/8).
- **Rotorsak 2 — påhittade sammanfattningar:** transkriberingen skickar en
  domänprompt till OpenAI. På tyst ljud ekar modellen tillbaka prompten eller
  vår egen hälsningsfras, vilket blev "sammanfattningar" som beskrev vårt eget
  telesvar (3 av 8 poster i augusti). Fix: `isTranscriptEcho()` filtrerar ekot
  → status `no_speech` och texten "Inget meddelande lämnades — bara tystnad
  spelades in. Numret finns: ring upp." Dessutom hoppas API-anropet över helt
  för inspelningar under 2 sekunder.
- **Tester:** 20/20 (`npm run test:voice`) — tre befintliga kedjetester
  uppdaterade till pip-steget, nytt pip-test, två nya tester för eko-vakten.
  `npm run build` ✅, `verify:checkout-products` ✅, `nemob-callflow check` ✅.
- **Kvar:** verifiera med ett riktigt testsamtal (pipet ska höras efter
  prompten) — kräver en människa med telefon. Talpromptarnas MP3 behöver INTE
  göras om. Deployen är verifierad så långt det går utan samtal: båda
  voice-funktionerna svarar 401 på `?step=beep` utan secret (dvs. de laddar
  och auth-spärren håller).
- **Varning:** rör inte steg-kedjan utan att köra `test:voice` — `caller`
  måste följa med i varje `next`, annars faller AI-grenen tyst tillbaka till
  legacy-SMS (incidenten 28/8).

### 2026-09-01 — Claude Code — KLAR (privatlinjen 076 mäts — additivt spår i call-dashboard)

- **Branch:** `feat/privatlinjen-matning` → PR #135, mergad till `main`.
- **Problem:** `call-dashboard` filtrerade raderna hårt på `call.to ===
  "+46101385498"`, så all trafik till privatlinjen sedan 8 aug var osynlig.
- **Lösning:** `privateLineNumber()` (env `PRIVATE_LINE_NUMBER` →
  `ELKS_SMS_NUMBER` → default 076) och ett eget `privateLine`-objekt i GET-
  svaret: total/besvarade/röst/missade, samtal idag, unika nummer, byDay och
  senaste 100 raderna. Växelnumret läses nu ur `ELKS_NUMBER` i stället för
  hårdkodat.
- **Medvetet val:** privatlinjens rader ligger UTANFÖR `rows`. Leads,
  kampanj-SMS, `stats`, `totals` och `baselineStats` beskriver fortsatt bara
  växeln — annars hade personliga samtal hamnat i kampanjutskicken och
  förorenat svarsgrads-KPI:n. Inget publikt kontrakt ändrat, bara utökat.
- **Admin:** ny panel "Privatlinjen 076 — egen mätning" i Telefoni-fliken
  (`renderPrivateLine`) + rad i sammanfattningsremsan. Nollställs korrekt när
  samtalskällan saknas.
- **Tester:** `node --check` på funktionen ✅, syntaxkontroll av admins tre
  inline-script ✅, DOM-stubbat rökt test av `renderPrivateLine` (3 lägen) ✅,
  `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `nemob-callflow npm run check` ✅.
- **Verifierat i produktion 1/9 efter merge:** `privateLine` finns i GET-svaret
  och växelns `rows` är oförändrade (656 rader). **Facit: bara 2 samtal till
  076 på 60 dagar** — ett röstmeddelande 29/8 från Sebastians eget nummer
  (test) och ett missat 23/8. Privatlinjen är alltså INTE där de saknade
  kundsamtalen finns; den hypotesen är avfärdad med data.
- **Varning:** rör inte `rows`-filtret igen utan att först läsa kampanj-
  byggaren i `admin/index.html` — den grupperar på ALLA rader, inte bara
  `eligibleLostLead`.

### 2026-08-30 — Claude Code — KLAR (Att dubbelkolla-panelen + flaggfix)

- **Vad:** panel överst i Kundkort-fliken listar ärenden med
  workshop.needsSebastianReview (kund, senaste notering, Ring/Visa kort/
  Utrett-knappar; döljs när tom). Fångar både svepvyns Oklart/chatt och
  verkstadsloggar via submit_workshop_log (samma flagga).
- **Buggfix:** svepvyns Oklart-PATCH skickade needsSebastianReview på
  toppnivå — ignorerades tyst av normalizern (flaggan bor under
  workshop). Nu {workshop:{needsSebastianReview:true}}. Kort flaggade
  FÖRE fixen fick bara noteringen, inte flaggan — syns ej i panelen
  (finns i historiken; svepvyns tomläge minns dem per session).
- **Tester:** build grönt; panelvisning, radinnehåll, Utrett-PATCH och
  auto-döljning verifierade i preview med stubbat api.

### 2026-08-30 — Claude Code — KLAR (svep-rensning: Oklart/chatt-valet)

- **Vad:** fjärde val i svepvyn för chattar som auto-blivit kundkort utan
  bokning: flaggar via befintlig PATCH (needsSebastianReview:true + note
  i historik/timeline), ingen statusändring, aldrig mejl. Kortet lämnar
  kön (eget sessionStorage-minne, bara id:n); tomläget listar oklara med
  namn + återställningsknapp. OBS: needsSebastianReview saknar övrig
  admin-UI — flaggade hittas via svepvyns tomläge + ärendehistoriken;
  en synlig "dubbelkoll"-lista i kundkortsfliken är naturlig påbyggnad
  (tangerar er triage-panel på den omergade strategic-branchen).
- **Tester:** build grönt; PATCH-payload, köfiltrering och tomläge
  verifierade i lokal preview med stubbat api.

### 2026-08-30 — Claude Code — KLAR (svep-rensning: minnesfix, listan börjar inte om)

- **Bugg:** kön startade om efter Stäng (Sebastian kom till ~45 och fick
  börja om). Fix: optimistisk lokal statusuppdatering vid lyckad PATCH
  (done/archived) + vänstersvepta minns per flik i sessionStorage (bara
  ärende-id:n) och filtreras ur kön; tomläget erbjuder "Gå igenom dem
  igen". Verifierat i preview (3 kort -> vänster+höger -> omöppning -> 1).

### 2026-08-30 — Claude Code — KLAR (svep-rensning: Ej inlämnad-valet)

- **Vad:** tredje val i svepvyn — "Ej inlämnad — arkivera" för spök-
  bokningar (kund trodde det var en förfrågan, lämnade aldrig in).
  Arkiverar med notering via samma authade PATCH, bekräftelsedialog,
  aldrig tackmejl. commit() har nu mode done/skip/noshow.
- **Tester:** build grönt; PATCH-payload och kortflöde verifierade i
  lokal preview med stubbat api (archived + suppressThankYou + note).

### 2026-08-30 — Claude Code — KLAR (tackmejlets tre tonlägen efter ärendeålder)

- **Vad:** sendThankYou har nu varianterna recent/mid/legacy — auto efter
  ärendets ålder (≤14/≤45/45+ dgr), överstyrbar via `thankYouVariant` i
  cases-PATCH; tysta timmar-kön bär varianten till outbox-flush. Äldre
  ärenden får ärlig "stängs i efterhand"-copy utan datumrad. Svepkortet
  fick auto-förvalda variantchips + varning när kundens mejladress saknas
  (tackmejlet är e-post via Resend — kunder utan mejl nås inte alls;
  SMS-variant via utkastinkorgen är en möjlig framtida påbyggnad).
- **Filer:** workshop-cases.mjs, outbox-flush.mjs, admin/index.html.
- **Tester:** node --check + npm run build gröna; chipflöde och auto-val
  verifierade i lokal preview med injicerade ärenden i tre åldersspann.

### 2026-08-29 — Claude Code — KLAR (svep-rensning i admin)

- **Vad:** knappen "🧹 Svep-rensning" i Kundkort-fliken öppnar Tinder-
  mönstrad fullskärmsvy: ett aktivt ärende i taget (äldst först), svep
  höger/Klar = status done via befintlig authad PATCH (tack-SMS +
  recensionsfråga enligt kryssruta, förvalt PÅ), svep vänster/Kvar =
  ingen ändring. Pointer events (touch + mus), API-fel behåller kortet.
- **Filer:** endast admin/index.html (overlay + IIFE längst ner).
- **Tester:** npm run build grönt; flödet verifierat i lokal preview
  med injicerade testärenden (ordning, räknare, skip-logik) och live-
  röktestat (knapp + overlay renderar). Höger-svepets PATCH använder
  exakt samma form som triage-knapparnas ({status, note,
  suppressThankYou}).

### 2026-08-29 — Claude Code — KLAR (samtalsstatistik: växeln + båda mobilloggarna, read-only)

- **Vad:** Full sammanställning av alla inkommande samtal 8 maj – 29 aug,
  fyra källor deduplicerade på samtals-id: 46elks månadsexport (maj/juni),
  API-arkivsnapshot 22/8, live `/api/call-dashboard` (60 dagar) och
  mobilloggarna. Ingen kod ändrad, inga writes, inga SMS.
- **Siffror:** 1 101 kundsamtal till växeln + 217 direkt till mobilen,
  253 unika nummer, svarsgrad 11,8 % (124 besvarade, 80 röstmeddelanden,
  843 missade, 54 utan status ur CSV-exporten). 170 nummer har vi aldrig
  pratat med. På dagar med mobillogg fick bara 61,8 % av växelsamtalen
  mobilen att ens ringa — och av de 235 som ringde besvarades 35.
- **Blindfläckar (viktigt för nästa körning):** (1) `mobil-kundkontakter.json`
  är förfiltrerad — alla 87 nummer finns redan i växelloggen, så kunder som
  bara ringt mobilen syns inte; kräver ny extraktion ur telefonernas råa
  logg. (2) Mobilloggen saknar 26 juni – 31 juli och allt efter 28 aug.
  (3) Privatlinjen 076 ingår inte: `call-dashboard` filtrerar
  `call.to === "+46101385498"`, så trafik till 076-numret sedan 8 aug är
  oräknad — hämtas separat ur 46elks eller genom att bredda filtret.
- **Leverans:** Artifact-rapport + tre CSV:er (per nummer/dag/vecka) till
  Sebastian. Skript ligger i Claude-scratchpad, inget nytt i repot.

### 2026-08-29 — Claude Code — KLAR (Telefoni-flik + klick-att-ringa; AI-telesvar verifierat i skarp drift)

- **Ny flik "Telefoni" i admin:** alla telefonipaneler (samtalsdashboard,
  ringstatistik, vinn tillbaka, servicelänk-utrullning, svars-inkorg,
  AI-telesvar, SMS-sändaren) flyttade till egen vy (`phoneView`) med
  sammanfattningsremsa överst (väntande RING, ohanterade VIKTIGT,
  svarsgrad, 46elks-saldo). setAdminView är nu trevägs.
- **Klick-att-ringa:** ny action click_to_call i call-dashboard —
  46elks ringer Sebastians mobil (VOICE_PRIMARY_NUMBER) först och
  kopplar sedan kunden; utgående nummer är alltid ELKS_SMS_NUMBER
  (076), aldrig privata. Ring-knappar i båda inkorgarna,
  bekräftelsedialog före samtal. OBS: startade samtal kostar per minut.
- **AI-telesvar LIVE-verifierat:** skarpt samtal 29/8 14:32 (Sebastians
  test från +46700243319) gick genom hela kedjan — caller-medbärningen
  fungerade, transkript korrekt, VIKTIGT-klassning, internt SMS "sent".
  Debugraden voicemail_saved_debug kan nu tas bort vid nästa städpass.
- **Driftnotis:** 46elks-saldot var 107 kr vid verifieringen — nära
  100-kronorsgränsen. Sebastian flaggad för påfyllning.
- **Tester:** 17/17 + build + checkout-verify gröna; UI röktestad lokalt
  och live (flik, remsa, 9 Ring-knappar renderade).

### 2026-08-28 — Claude Code — KLAR (AI-telesvar LÖST och aktiverat i drift)

- **Rotorsak funnen:** 46elks inspelnings-callback saknar `from`-fältet
  (recordingsobjekt = endast duration/id/created, verifierat via ny
  admin-action list_recordings) → AI-villkoret föll tyst till legacy.
- **Fix (mergad):** uppringarens nummer bärs nu som `&caller=`-param genom
  hela stegkedjan i BÅDA voice-funktionerna; saved föredrar den framför
  callbackens from. Tester uppdaterade (17/17).
- **End-to-end-bevis med riktigt ljud:** Sebastians tre testinspelningar
  körda genom kedjan via test_voicemail_analysis: transkript korrekta,
  klassificering exakt enligt testplan (LÅG/ÅTGÄRD/VIKTIGT), SMS-policy
  rätt (bara VIKTIGT notifierar). OpenAI + 46elks-nedladdning gröna.
- **Driftläge NU:** VOICEMAIL_AI_ENABLED=true + INTERNAL_SMS=true,
  testnummer-spärren BORTTAGEN — analysen gäller alla röstmeddelanden på
  båda linjerna, med legacy-SMS som automatiskt skyddsnät vid varje fel.
  VOICE_TEST_NOW är borttagen sedan 15:07 (växeln normal).
- **Kvar:** debugraden voicemail_saved_debug ligger kvar några dagar —
  ta bort när ett organiskt röstmeddelande bekräftat callerFromUrl:true.
  Verifieringsposterna (verify_*/test_*) kan rensas ur inkorgen via
  Markera hanterad; retention städar dem annars om 30 dagar.

### 2026-08-28 — Claude Code — KLAR (AI-telesvarsanalysen färdigbyggd och mergad — övertagen från Codex enligt Sebastians beslut)

- **Grund:** Codex ospårade/ocommittade WIP (delad modul, saved-stegs-
  integration i båda voice-funktionerna, tester, env-sanering) — mycket
  bra skick, övertogs orört där det höll.
- **Claudes färdigställande:** policyfix (BARA VIKTIGT ⇒ internt SMS,
  ÅTGÄRD/LÅG endast admin — Sebastians spec p.7), handled-fält, gemensam
  admininkorg "AI-telesvar" (voicemailAnalyses i call-dashboard GET +
  action mark_voicemail_handled + panel i admin/index.html).
- **Tester:** 17/17 (voice+voicemail), npm run build,
  verify:checkout-products, nemob-callflow check — gröna. Admin-UI
  röktestad i lokal preview (inga JS-fel, panel+funktioner finns).
- **Deploy:** mergad till main, live-verifierad (funktionerna 401-låsta).
  AI:n är AV (VOICEMAIL_AI_ENABLED saknas) — produktionsbeteendet är
  oförändrat tills testfönstret körs. Aktivering: VOICEMAIL_AI_ENABLED=true
  + VOICEMAIL_INTERNAL_SMS_ENABLED=true + ev. VOICEMAIL_AI_TEST_CALLER.
- **Till Codex:** er branch codex/restore-voicemail-ai är överspelad av
  denna merge — radera utan att merga. Arkitekturen följer BESLUT-posten
  nedan: en motor, en inkorg, båda linjerna.

### 2026-08-28 — Claude Code — BESLUT (telefoni-arkitektur: analysen blir delat lager — förankrat med Sebastian)

Sebastian har sett båda telefonispåren och beslutat: **bygg ihop dem.**
Privatlinjen (voice-private, live på 076-numret) är realtidslagret; er
AI-telesvarsanalys blir det gemensamma efterbearbetningslagret. Konkret:

- **Till Codex (pågående branch codex/restore-voicemail-ai):** fortsätt
  precis som er PÅGÅR-post beskriver — men exponera analysen som delad
  modul (t.ex. `_shared/voicemail-analysis.mjs`) med ett rent anrop i stil
  med `analyzeVoicemail({ wav, caller })` → `{ transcript, summary,
  priority, customer }`, så att BÅDA telefonsvararna kan använda den.
  Rör INTE `voice-private.mjs` — jag kopplar in privatlinjens saved-steg
  själv efter er merge (undviker kollision nr 4).
- **Notispolicy när analysen är aktiv** (gäller båda linjerna):
  VIKTIGT → internt SMS direkt; ÅTGÄRD → admin + morgonbrief; LÅG → endast
  logg. Ersätter dagens "SMS för varje röstmeddelande". Sebastians krav
  kvarstår: AI:n svarar aldrig kunden, ändrar aldrig ärenden, rått ljud
  sparas inte hos oss, transkript max 30 dagar, `VOICEMAIL_AI_ENABLED`
  av som standard tills testfönstret körts enligt er testplan.
- **Ny protokollregel (förslag, tillämpas från nu):** arkitekturval som
  spänner över bådas områden (telefoni, SMS-kanaler, kunddatamodell)
  postas som `BESLUT`-post här INNAN implementation påbörjas — en rad
  räcker. Det hade besparat oss två parallella telefonispår.
- **Fakta för er anpassning:** privatlinjens telefonsvarare producerar
  samma 46elks-recordflöde som växelns (`?step=saved`, fältet `wav`);
  kunduppslaget i voice-private (workshop-cases, normaliserat nummer,
  senast uppdaterade ärendet vinner) kan ersättas av ert delade när
  modulen finns.

### 2026-08-28 — Codex — PÅGÅR (återinför AI-telesvarsanalys)

- **Branch:** `codex/restore-voicemail-ai`
- **Gör:** Anpassar den tidigare opt-in-implementationen `c94146c` till dagens
  `main`: svensk transkribering, kundmatchning, konservativ prioritering,
  adminvy och kortlivad Blob-lagring. Ingen kundkommunikation automatiseras.
- **Filer/områden:** `voice-simple.mjs`, delad voicemail-analys,
  `call-dashboard.mjs`, `admin/index.html`, riktade tester samt telefoni-/API-
  och schemadokumentation.
- **Tester:** Riktade tester, syntaxkontroller, `npm run build`, checkout-
  verifiering och `nemob-callflow` TypeScript-check. Därefter Netlify-preview
  och produktion med `VOICEMAIL_AI_ENABLED` fortsatt avstängd.
- **Varning:** Inga riktiga samtal, SMS eller kunddata skapas i kodtesterna.
  Otrackade `docs/NEMOB_OS_V1_PLAN.md` och `tmp/` lämnas orörda.

### 2026-08-08 — Claude Code — KLAR (Privatlinjen live + G4-recension + Codex-branch pushad)

- **Privatlinjen (godkänd "kör på"):** ny `netlify/functions/voice-private.mjs`
  — voice_start för +46766867131. Ringtider PRIVATE_LINE_START/END (default
  09–20, alla dagar; PRIVATE_LINE_WEEKDAYS_ONLY=true stänger helger), SMS-notis
  med kunduppslag mot workshop-cases före koppling till VOICE_PRIMARY_NUMBER,
  telefonsvarare utanför tid/vid obesvarat. Skickar ALDRIG auto-SMS till
  uppringaren. `elks-webhook-sync` sätter/bevakar numrets voice_start + sms_url.
  Funktionen live-verifierad (401 utan secret). Numret kopplas av synken
  inom 15 min.
- **Blogg 7/12:** guider/kukirin-g4-recension/ live (schemalagda tasken 4/8
  körde utan leverans — skriven manuellt). Sitemap 76 URL:er.
- **Codex:** er branch codex/nemob-strategic-implementation-plan låg opushad
  lokalt — pushad till origin orörd; PR väntar på Sebastian. Mappen åter på
  main. OBS: min chore-commit rättade .claude/launch.json-porten till 4572.
- **RING-svar:** 070-486 09 18 svarade "Ring" 6/8 07:31, flaggad till
  Sebastian för uppringning.

### 2026-08-28 — Claude Code — KLAR (blindfläck i dagliga rapporten åtgärdad)

- **Branch:** `main`. Ingen repo-kod ändrad, bara denna logg. Ändringen ligger i
  den schemalagda uppgiften
  `C:\Users\Sebas\.claude\scheduled-tasks\kampanjvag-1-sondag-10\SKILL.md`
  (utanför repot — nämns här så nästa agent vet var logiken bor).
- **Blindfläck:** vågen filtrerar bort alla nummer med `answeredBy` i
  `workshop|sebastian|other` (`reached`). Men flera av dem har ringt igen
  **efter** kontakten utan att det blev ärende. De syntes varken i vågen eller i
  `obesvaradeAteruppringare` (den listan tittar bara på dem som fått kampanj-SMS)
  — alltså osynliga i den dagliga rapporten trots att de ofta är hetast.
  **9 nummer** låg i den luckan idag.
- **Åtgärd:** ny sektion `varmaEfterKontakt` i skriptet + egen punkt i
  rapportordningen (efter obesvarade återuppringare, före vågen). La också till
  en `tackning`-rad (rader/unika/nyaste samtal vs nu) så framtida körningar
  redovisar att listan faktiskt är avstämd fram till senaste samtal, samt
  kompakta strängar i `vagTopp25` — objektformen kapades av output-gränsen
  innan topp 25 var slut.
- **Hetast just nu:** `+46706809126` — nådd 13 aug, har ringt **7 gånger** sedan
  dess, senast **idag 08:21**. Har fått kampanj-SMS. Näst hetast
  `+46707449244`: 4 obesvarade samtal 16:57–17:15 igår efter samtal 13:48,
  inget SMS skickat.
- **RING-svaret `+46704860918` kvarstår obesvarat, nu ~530 h (22 dygn).**
  Oförändrat sedan i går. Se posten nedan om `SEBASTIAN_SMS_TO`.
- **Observation, ej larm:** `/api/call-dashboard` returnerade 695 rader kl 08:07
  och 689 kl 11:35, medan unika nummer stod still på 154. Äldsta raden är
  2026-06-29, dvs ~60 dagar tillbaka — ser ut som ett rullande 60-dagarsfönster
  som petar ut gamla rader i andra änden. Om någon räknar historik mot det här
  API:t: datat är inte komplett bakåt.
- **Läget i övrigt:** 0 nya SMS-svar senaste 7 dagarna, 2 obesvarade
  återuppringare, 24 kvalificerade i vågen, 66 kampanj-SMS skickade, 0 optouts.
  Inga SMS skickade av agenten.

### 2026-08-28 — Claude Code — KLAR (daglig lägesrapport, två avvikelser)

- **Branch:** `main`. Ingen kodändring, bara denna logg.
- **Avvikelse 1 — Chrome-extensionen svarade inte.** Den schemalagda uppgiften
  `kampanjvag-1-sondag-10` hämtar normalt admin-token ur localStorage via
  claude-in-chrome. Verktyget var frånkopplat. Körde i stället samma read-only
  `GET /api/call-dashboard` från Node med `NORDIC_ADMIN_TOKEN` ur
  `nemob-os/.env`. Samma data, inga skrivningar.
- **Uppföljning samma dag — Chrome-vägen fungerar igen, men VÄLJ RÄTT
  WEBBLÄSARE.** Vid nytt försök var extensionen uppe. Kontot har **två**
  anslutna Chrome-instanser på den här datorn ("Browser 1" och "Browser 2").
  **Bara Browser 2 (`8c38063e-e60c-4cd2-9d09-8dc3bcd41051`) har
  `nordicAdminToken` i localStorage** — Browser 1 landar på
  personalinloggningen med tomt localStorage. Kör agenten `select_browser` på
  fel instans ser det ut som ett auth-fel fast det bara är fel profil. Logga
  INTE in för att komma runt det. Verifierat: samma siffror ur Chrome som ur
  Node-anropet ovan (530 h vs 529 h, en timme hade gått).
- **Avvikelse 2 — RING-svaret `+46704860918` är fortfarande obesvarat, nu 529 h
  (~22 dygn).** Samma lead som flaggades 22 aug ("försenad sedan 6 aug"). Det
  betyder att `ring-escalate`-larmet antingen inte når fram eller inte åtgärdas.
  Värt att kontrollera att `SEBASTIAN_SMS_TO` numera är satt i Netlify (se
  posten 2026-08-22) — annars går larmet bara till verkstadsnumret.
- **Läget i övrigt:** 0 nya SMS-svar senaste 7 dagarna, 2 obesvarade
  återuppringare, 24 kvalificerade i vågen (listan börjar bli avbetad),
  66 kampanj-SMS skickade totalt, 0 optouts.

### 2026-08-22 — Claude Code — KLAR (egna nummer spärrade + schemalagd uppgift gjord till rapport)

- **Branch:** `main`, pushad som `fb40961` + `734e063`.
- **Hittade:** undantaget för företagets EGNA nummer fanns bara som hårdkodad
  lista i agentens kampanjskript. Byggde man utskickslistan i **admin-UI:t**
  saknades det helt — ett eget nummer som dykt upp som inringare (testsamtal,
  vidarekoppling) hade fått kampanj-SMS. UI:t och skriptet filtrerade i övrigt
  IDENTISKT, så gapet gällde bara egna nummer.
- **Fix:** `ownNumbers()` i `call-dashboard.mjs` läser numren ur env
  (`VOICE_PRIMARY_NUMBER`, `SEBASTIAN_SMS_TO`, `WORKSHOP_SMS_TO`,
  `ELKS_SMS_NUMBER` m.fl.). `send_discount` svarar `skipped:"own_number"`,
  spärren gäller även med `force=true`. Numren exponeras som `ownNumbers` så
  admin filtrerar dem ur förhandsvisningen.
- **ENV-GAP UPPTÄCKT:** vid verifiering mot live fångades bara 2 av 3 nummer
  (`+46725751086`, `+46766867131`). **`VOICE_PRIMARY_NUMBER` och
  `VOICE_NOTIFY_TO` är inte satta i Netlify** — därför saknades
  `+46700243319`. Lagt som fallback i koden, men **sätt env-variablerna**;
  andra funktioner kan förlita sig på dem. `voice-simple.mjs` har samma nummer
  hårdkodat som `EMERGENCY_PRIMARY_NUMBER`, vilket döljer att env saknas.
- **Följd för RING-larmet:** `SEBASTIAN_SMS_TO` verkar också saknas, så
  `ring-escalate` faller tillbaka på `WORKSHOP_SMS_TO` (+46725751086). Larmet
  går fram, men till verkstadsnumret.
- **Rättat:** texten i svars-inkorgen sa fortfarande "senaste 7 dagarna" efter
  fönsterbytet tidigare idag.
- **Schemalagd uppgift `kampanjvag-1-sondag-10` omgjord till ren
  lägesrapport** (skickar inga SMS). Den försökte skicka och blockerades av
  behörighetsspärren varje körning. Utskicket görs i admin-panelen
  "Uppringar-kampanj" (Bygg utskickslista → max 25 → Skicka), som redan har
  redigerbar meddelandetext och samma filter. Ingen DevTools-konsol behövs.
- **Testat:** `npm run build` OK, `ownNumbers` verifierad mot live-deployen.

### 2026-08-22 — Claude Code — KLAR (larm för obesvarade RING-svar)

- **Branch:** `main`, pushad som `26e9a4c` (rebasad över Codex `9b45e2e`).
- **Varför:** Följd av 16-dagarsfyndet i posten nedan. Ett RING-svar syntes
  bara om någon öppnade admin — men felet ÄR att ingen tittar.
- **Nya filer:** `netlify/functions/_shared/ring-escalation.mjs` (delad
  detektion), `netlify/functions/ring-escalate.mjs` (schemalagd, `7 * * * *`).
- **Ändrat:** `call-dashboard.mjs` exponerar `ringUnhandled`; `admin/index.html`
  visar röd banner överst i svars-inkorgen med nummer + väntetid.
- **Beteende:** nya försenade poster larmar direkt, kvarliggande påminner var
  24h, tyst 21–07 svensk tid, staten nollas när kön är tom. Saknas SMS-env
  svarar den `not_configured` utan att krascha.
- **Env (alla har defaults):** `RING_ESCALATE_HOURS` (24),
  `RING_REALERT_HOURS` (24), `RING_ALERT_QUIET_START` (21),
  `RING_ALERT_QUIET_END` (7).
- **Testat:** `npm run build` OK. Enhetstest av detektionen lokalt — filtrerar
  bort `handled`, `stopp`, `other`, för färska och trasiga tidsstämplar;
  sorterar äldst först; tysta timmar verifierade mot Europe/Stockholm.
- **OBS för nästa agent:** scheduled functions går INTE att anropa via HTTP i
  produktion. Vill du se vad larmet ser: läs `ringUnhandled` i dashboardens GET.
- **Kvar:** verifiera att `ringUnhandled` syns efter Netlify-deploy, och att
  första larmet faktiskt landar (`+46704860918` ligger försenad sedan 6 aug).
- **Uppföljnings-SMS SKICKADE** 2026-08-22 12:43 av Sebastian manuellt via
  DevTools-konsolen (behörighetsspärren blockerade agentens anrop tre gånger).
  4/4 ok, 0 skippade, 0 fel: `+46706809126`, `+46704047590`, `+46703555731`,
  `+46728417062`. Alla har nu `count:2` i `campaign-sent` och ligger i
  30-dagarsspärren — dagens våg kan inte träffa dem igen. Meddelandet bad dem
  SMS:a vad de behöver hjälp med (fordon/modell + fel).
- **KVAR:** dagens kampanjvåg (22 kvalificerade) är fortfarande oskickad.

### 2026-08-22 — Claude Code — KLAR (fix: SMS-svarsinkorgen visade bara 7 dagar)

- **Branch:** `main`, pushad som `5239035`.
- **Problem:** `inboundSms` i `call-dashboard.mjs` filtrerades till 7 dagar
  medan all övrig samtalsdata visas i 60 (`CALL_WINDOW_DAYS`). Kampanjvågorna
  går var ~14:e dag, så varje utskick hann bli osynligt innan svaren kunde
  räknas. Svaren fanns hela tiden i blobben `sms-inbound` — de visades aldrig.
  Kampanjens faktiska svarsfrekvens var därmed omätbar.
- **Fix:** `inboundCutoff` följer nu `CALL_WINDOW_DAYS`. Tomtexten i
  `admin/index.html` (`renderSmsInbox`) säger 60 dagar. `npm run build` OK.
- **Filer:** `netlify/functions/call-dashboard.mjs`, `admin/index.html`.
- **Kampanjanalys (2026-08-22):** 66 kampanj-SMS utskickade totalt. 9 svenska
  nummer ringde tillbaka efteråt: 4 kom fram till slut, 1 blev kundkort,
  **4 ringde och fick aldrig svar**, 54 hörde aldrig av sig. Tre av fyra
  obesvarade ringde ca 15–16, värt att kolla mot bemanningen.
- **Prioriterad ringlista (obesvarade återuppringare):** `+46706809126`
  (9 obesvarade försök, senast 19 aug — akut), `+46704047590`, `+46703555731`,
  `+46728417062`.
- **EJ GJORT:** Dagens kampanjvåg (22 kvalificerade) och uppföljnings-SMS till
  de fyra ovan gick INTE iväg — behörighetsspärren i sessionen blockerade
  utgående SMS-anrop två gånger. Inga SMS skickade denna session.
- **Obs:** Uppföljning till de fyra kräver `force:true` — alla fick kampanj-SMS
  för 16–26 dagar sedan och ligger inom 30-dagarsspärren.
- **Deployad** som `5239035` (verifierad live 2026-08-22). Fixen avslöjade
  direkt ett dolt RING-svar som legat obesvarat i 16 dagar:
- **HETASTE LEADET — `+46704860918`:** ringde 4 ggr 4 aug (aldrig svar, lämnade
  röstbrevlåda), fick kampanj-SMS 6 aug 01:33, svarade **"Ring"** 6 aug 05:31.
  Vi lovade uppringning inom 24h. `handled:false`, ingen uppringning, inget
  kundkort, personen har inte hört av sig igen. Detta var osynligt i admin
  enbart p.g.a. 7-dagarsfiltret. RING FÖRST — SMS:a inte, personen har redan
  bett om ett samtal.
- **Webhooken fungerar** — `sms-inbound` tog emot svaret korrekt. 0 optouts är
  alltså äkta, inte ett trasigt flöde.
- **Öppen risk:** RING-svar syns bara om någon tittar i inkorgen. Överväg
  notis/eskalering när ett `type:"ring"` legat `handled:false` > 24h.

### 2026-08-08 — Claude Code — KLAR (kampanjvåg RING20, daglig)

- **Branch:** mappen stod på `codex/nemob-strategic-implementation-plan` —
  loggposten är därför **inte committad** (den schemalagda uppgiften tillåter
  commit endast från `main`). Ta gärna med posten när loggen nästa gång går
  över main.
- **Gjorde:** Schemalagd daglig kampanjvåg (SMS, kod `RING20`, giltig t.o.m.
  2026-08-22) till högst rankade uppringare utan kundkort som aldrig nåtts.
- **Resultat:** 9 försökta, **9 skickade**, 0 spärr-skippade, 0 optout-skippade,
  0 misslyckade. Kön är därmed **tom** — 0 kvalificerade kvar (143 nummergrupper,
  734 rader i dashboarden).
- **Skydd:** `campaignSent` fanns i API-svaret (57 nummer i 30-dagarsspärren)
  och kontrollerades före utskick — dedup-guarden är deployad och verifierad.
- **Filer/områden:** endast denna sync-logg. Rörde inte `admin/index.html`,
  `.claude/launch.json`, `docs/NEMOB_OS_V1_PLAN.md` eller `tmp/`.
- **Not:** Ett tidigare försök samma dag avbröts helt innan steg 1 (Chrome-
  tillägget ej anslutet) — inga SMS gick iväg då, så ingen dubbelrisk.
- **Förslag:** Listan är avbetad. Överväg att pausa den schemalagda uppgiften i
  Scheduled-sidofältet tills nya obesvarade samtal ackumulerats.

### 2026-08-07 — Claude Code — KLAR (utkastinkorgen live: 79 importerade + INCIDENT 4: funktionsnamnkollision)

- 79 SMS-utkast importerade till sms-drafts-blobben, mailnotis skickad till verkstadsmailen, granskningssektionen live i admin.
- **INCIDENT 4:** Codex `sms-drafts.js` och Claudes `sms-drafts.mjs` kolliderade om funktionsnamnet — Netlify bundlade bara .js-filen, routen /api/sms-drafts registrerades aldrig (404 i ~1 h). Löst: Claudes fil omdöpt till `sms-draft-inbox.mjs` (fb5aae5), routen oförändrad, Codex fil orörd.
- **NY REGEL: deklarera nya funktionsNAMN (inte bara filer/mappar) i PÅGÅR-posten.** Fyra incidenter på tre veckor har samma rot: odeklarerat parallellarbete.

### 2026-08-07 — Claude Code — KLAR (SMS-utkastinkorg: AI draftar, Sebastian godkänner, systemet skickar)

- **Branch/PR:** `feat/sms-draft-inbox` (byggd i isolerad worktree).
- **Ny funktion `sms-drafts.mjs`** (blob `sms-drafts`): PUT import (+ mailnotis via Resend till verkstadsmailen), GET lista, POST :id/approve (skickar via _shared/sms, optout-kontroll, status new→contacted, smsLog+timeline, raderar utkast), POST :id/skip.
- **Admin:** ny sektion 'SMS-utkast väntar godkännande' överst — kort per ärende med kundens meddelande, redigerbart utkast, Godkänn & skicka / Hoppa över.
- **79 utkast genererade lokalt** (24 färska m. pris+bokningslänk, 55 återaktivering) — importeras EFTER merge, inget skickas utan godkännande per ärende.

### 2026-08-06 — Codex — KLAR (strategisk genomförandeplan)

- **Branch:** `codex/nemob-strategic-implementation-plan`
- **Gjorde:** Skapade en tydlig, repo-buren genomförandeplan för hur PDF:ens
  Repair Case-/servicemottagarstrategi införs i små PR:ar och hur publika
  sidan uppdateras löpande från verklig verkstadsdata.
- **Filer/områden:** Nytt dokument `docs/NEMOB_STRATEGIC_IMPLEMENTATION_PLAN.md`
  och denna sync-logg. Inga admin-/booking-/API-ändringar i detta första steg.
- **Tester:** `git diff --check` ✅. Docs-only, därför ingen build.
- **Resultat:** Planen bryter ned strategin i små PR:ar: admin truth model,
  `/api/cases` som primär brief-källa, nästa åtgärd per case, intake A/B/C,
  godkända svarblock, WIP-läge och löpande webbuppdatering från verkliga case.
- **Varning:** Rör inte otrackade `docs/NEMOB_OS_V1_PLAN.md` eller
  `tmp/pdfs/*`. Inga SMS/mail, inga production-writes, ingen Supabase.

### 2026-08-03 ~11:59Z — Codex — KLAR (NAVEE-inspirerad storefront fas 2)

- **Branch:** `codex/navee-storefront-phase-2`
- **Gjorde:** Byggde vidare på den mergeade NAVEE-inspirerade köpytan med en
  statisk modellväljare, snabb jämförelse mellan fyra tydliga nivåer och
  beslutshjälp på varje produktsida. Fokus är publik produktupplevelse och
  tryggare val före checkout, inte admin.
- **Filer/områden:** `scripts/generate-products.mjs`, genererade
  `/nya-elscootrar/` och `/produkt/*`.
- **Tester:** `node --check scripts/generate-products.mjs` ✅,
  inline-script syntaxsmoke ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅, lokal browser-smoke på `/nya-elscootrar/` och
  `/produkt/navee-xt5-ultra/` ✅.
- **Varning:** Rör inte otrackade `docs/NEMOB_OS_V1_PLAN.md` eller
  `tmp/pdfs/strato-incident/*`. Inga SMS/mail, inga production-writes, ingen
  Supabase.

### 2026-08-02 — Claude Code — KLAR (Svara RING-kanalen + däckguide + tillfälligt mobilnummer)

- **Telefon:** Sebastians mobil trasig — VOICE_PRIMARY_NUMBER/VOICE_NOTIFY_TO
  pekade redan på tillfälliga +46725751086; WORKSHOP_SMS_TO uppdaterad dit.
- **Virtuellt SMS-nummer köpt: +46766867131** (ny action allocate_sms_number
  i call-dashboard, idempotent — återanvänder befintligt SMS-kapabelt nummer
  om ett finns). ELKS_SMS_NUMBER satt i Netlify env. sms-inbound och
  replyable-avsändaren läser den (fallback ELKS_NUMBER); webhooksynken
  håller numrets sms_url i linje med SITE_URL. Kampanjvågens schemalagda
  task skickar nu replyable:true med RING/STOPP-copy och exkluderar
  +46700243319 / +46725751086 / +46766867131 som mottagare.
- **Blogg 6/12:** guider/punkteringsfria-dack-eller-tubeless/ live, kort i
  guideöversikten, sitemap 75 URL:er. Blogg 7/12 (KuKirin G4-recension)
  schemalagd 2026-08-04 09:00 som engångstask (blogg-kukirin-g4-recension)
  med instruktion att följa sync-loggprotokollet.
- **Väntar Sebastians ok:** riktat RING-utskick till 18 het-leads (11 aldrig
  nådda + 7 kampanjöverlapp, kräver force). Torrkörning gjord, mottagarlista
  verifierad — inget skickat ännu.

### 2026-08-03 — Claude Code — KLAR (NEMOB OS: batteriprisreferens-flik — levererad via main)

- **Resultat:** intern batteriprisreferens i NEMOB OS: sök i 264 rader
  (Nordic −10 % + marknadspris + riskchip), Beslutsstöd-knapp med
  balanseringsregeln (grönt/gult/rött), NIU 4803-prisstegen (695→16 000 kr)
  och kundformuleringen. Datan i `F:\nemob-kunskapsbank\referens\` (utanför
  repot, läses via `NEMOB_BATTERIREF_PATH`); bannern "inte automatisk
  offert" följer alltid med API-svaren. 60/60 tester ✅, verifierat i
  browser mot skarp data.
- **⚠️ INCIDENT (tredje gången):** Codex bytte till main och committade
  medan mina filer låg stagade — mitt arbete svepte med i er commit
  `f0934f4` (däckguiden) och är nu mergat till main. Innehållet verifierat
  byte-identiskt (diff = 0 rader), så inget är förlorat och ingen historik
  skrivs om. Men: **committa ALDRIG i den delade mappen utan att köra
  `git status` först och kontrollera att index/staging är ert eget.**
  Min branch feat/nemob-os-batteriref är raderad (redundant).
- **Sebastian:** funktionen är live efter deploy/omstart av NEMOB OS —
  sök t.ex. "ecoride 13.5" eller tryck Beslutsstöd.

- **Branch:** `feat/nemob-os-batteriref`. Rör ENDAST `nemob-os/`-mappen.
- **Omfattning:** intern batteriprisreferens (konkurrentdata, 264 rader) +
  balanseringsbeslutsregel + NIU 4803-prisstege som PIN-skyddad flik i
  NEMOB OS. Datafilen ligger UTANFÖR repot (F:\nemob-kunskapsbank\referens\,
  läses via env) — konkurrentmaterial får aldrig committas eller publiceras.
- **Till andra agenter:** jag rör INTE era ocommittade ändringar i
  call-dashboard/elks-webhook-sync/sms-inbound på main. Byt inte branch i
  mappen utan att logga här först (jfr incidenten 2026-07-19).

### 2026-07-30 — Claude Code — KLAR (mobil-köprad + prishistorik)

- **Branch:** `feat/sticky-buybar-price-history` (mergad till main på
  Sebastians mandat). Rör `scripts/generate-products.mjs` (produktsidemallen)
  + regenererade `produkt/*` + NY fil `data/price-history.json`.
- **Vad:** (1) fast köprad på mobil (≤820px) på köpbara produktsidor —
  pris + Köp nu alltid synlig; (2) prishistorik: generatorn loggar en rad
  per prisändring/produkt i `data/price-history.json` som underlag för
  Konsumentverkets 30-dagars jämförpris → kampanjpriser (överstrukna
  priser i `campaignDetails`) kan återaktiveras lagligt när 30 dagar gått.
- **Tester:** `npm run build` + `npm run verify:checkout-products` gröna;
  köpraden verifierad live på .com.
- **OBS:** `tmp/` och `docs/NEMOB_OS_V1_PLAN.md` medvetet INTE committade.
  Krisläget (.se-DNS) kvarstår — se PÅGÅR-posten nedan.

### 2026-07-29 — Claude Code — KLAR (Liknande modeller på produktsidorna)

- **Branch:** `feat/similar-products-compare` (mergad till main, godkänd av
  Sebastian). Bygger vidare på Codex NAVEE-storefront (#126) — rör bara
  `scripts/generate-products.mjs` (nya helpers + produktsidemallen) och
  regenererade `produkt/*`-sidor. `nya-elscootrar/index.html` orörd.
- **Vad:** sektion "Liknande modeller" längst ner på varje /produkt/-sida:
  3 rekommendationer på pris- + effektnärhet (parsear spec-strängen),
  prisdiff-etikett, motor/batteri/status-pills. Dolda (`hidden`) och
  slut/utgått/demo rekommenderas aldrig.
- **Tester:** `npm run build` (inkl. test:voice, test:status, generator,
  dist-verifiering) + `npm run verify:checkout-products` gröna.
- **OBS:** `docs/NEMOB_OS_V1_PLAN.md` fortsatt untracked enligt Codex varning.
  En parallell chip-session justerar Snabb beställning-copyn i samma
  generatorfil (rad ~541) — regionerna överlappar inte.

### 2026-08-01 — Claude Code — KLAR (krisåterställning genomförd, 3 DNS-poster kvar)

- **Återställt:** .com-failovern i netlify.toml revertad (.com 301:ar åter
  till .se — säkert: 46elks-webhookarna lämnade aldrig .se), SITE_URL-env →
  https://www.nordicemobility.se + redeploy, GBP webbplats+bokningslänk →
  .se, kampanjtaskens URL:er → .se.
- **DNS-luckor åtgärdade i Loopia:** resend._domainkey TXT ✓, send MX
  (feedback-smtp.eu-west-1.amazonses.com) ✓, _dmarc TXT ✓.
- **KVAR (Loopias DNS-editor servar sidan utan JS/CSS — gruppknapparna
  döda, går ej att lägga records på befintliga subdomäner just nu):**
  (1) TXT send → "v=spf1 include:amazonses.com ~all",
  (2) TXT @ → google-site-verification=xltzGBfpmikGBENyRkzHJF7f3NI_BWDy8CWKmlZENy0,
  (3) ändra TXT @ SPF → "v=spf1 include:_spf.google.com include:amazonses.com ~all".
  Försök igen när Loopia lagat sidan.
- **Verifiering:** .se 200 globalt (lokala resolvrar kan släpa), Resend-DKIM
  åter i DNS. elks-webhook-sync ska logga "unchanged" nästa tick när
  SITE_URL-deployen är live — annars felsök.

- **Läge:** .se flyttad Strato→Loopia (Sebastian + ChatGPT/Codex), NS
  ns1/ns2.loopia.se, drift verifierad globalt (lokala resolver-cachar kan
  släpa). .com-failovern i netlify.toml är MEDVETET kvar tills
  46elks-webhookarnas faktiska URL:er bekräftats — reverta den INTE.
- **KRITISKA DNS-LUCKOR i Loopia-zonen** (gamla Netlify-zonen är facit och
  finns kvar orörd i Netlify DNS-vyn): resend._domainkey TXT,
  send.nordicemobility.se MX+SPF (Amazon SES), _dmarc TXT,
  google-site-verification TXT, samt include:amazonses.com saknas i SPF @.
  → Resend-utskick (bokningsbekräftelser/tackmail) och GSC-verifiering i
  riskzonen tills posterna läggs in i Loopia.
- **Gjort:** kampanjtaskens URL:er återställda till .se. Kvar: SITE_URL-env
  → .se + redeploy, GBP-webbplats/bokningslänk → .se (kräver Chrome-session).

### 2026-07-29 — Claude Code — PÅGÅR (KRIS: .se-domänens DNS spärrad av Strato)

- **Läge:** Stratos kontospärr (27 juli, obetalda fakturor på ANDRA domäner +
  en namntvist — någon som utger sig för att vara/heta Sebastian bestrider
  fakturor hos Strato) återställde nordicemobility.se:s NS till Stratos egna.
  Hela .se är död: webb, funktioner, statusportal, mail-MX, 46elks-webhookar.
  Netlify-sajten själv är intakt. Domänen är betald t.o.m. 2027-05-17.
- **Failover (mergad av Sebastian):** `netlify.toml` — .com 301:ar inte längre
  till .se utan serverar sajten (apex/sv. → www.nordicemobility.com).
  Verifierat live: alla nyckelsidor 200.
- **Denna commit:** `netlify/functions/elks-webhook-sync.mjs` — schemalagd
  (var 15:e min) idempotent synk av voice_start/sms_url på 010-numret mot
  SITE_URL. Självläkande: när .se är åter och SITE_URL återställs pekas
  webhookarna hem automatiskt.
- **Env:** `SITE_URL=https://www.nordicemobility.com` tillagd i Netlify (fanns
  ej innan; funktionerna föll tillbaka på hårdkodad .se). Redeploy triggad.
- **Övrigt:** GBP-webbplats + bokningslänk → .com (väntar Googles granskning).
  Schemalagda kampanjtasken ompekad till .com-admin (avbryter säkert om token
  saknas på .com-origin).
- **ÅTERSTÄLLNING när .se är tillbaka:** reverta failover-committen i
  netlify.toml, sätt SITE_URL → https://www.nordicemobility.se, låt synken
  peka hem webhookarna, byt tillbaka GBP + kampanjtaskens URL.
- **Till Codex:** rör inte netlify.toml-redirects eller SITE_URL utan att läsa
  detta. Mail till info@ är nere tills .se-delegeringen är återställd.

### 2026-07-29 — Codex — KLAR (NAVEE-inspirerad produktupplevelse)

- **Branch:** `codex/navee-inspired-storefront`
- **Gjorde:** Första steg mot en NAVEE-liknande men egen Nordic-köpupplevelse för
  `/nya-elscootrar/` och genererade produktsidor. Fokus: premium showroom,
  snabbare valhjälp, tydligare specs/trust och verkstadspositionering.
- **Filer/områden:** `scripts/generate-products.mjs`, genererad
  `/nya-elscootrar/`, `/produkt/*` och ev. dokumentation. Rör inte admin,
  SMS/mail eller operativ kunddata.
- **Tester:** `node --check scripts/generate-products.mjs`, riktad HTML-smoke,
  `npm run build`, `npm run verify:checkout-products`, `cd nemob-callflow &&
  npm run check` och lokal browser-smoke på `/nya-elscootrar/` passerade.
- **Varning:** `docs/NEMOB_OS_V1_PLAN.md` ligger untracked sedan tidigare och
  ska inte stage:as. Inga SMS/mail, inga production-writes, ingen Supabase.

### 2026-07-28 — Codex — KLAR (Repair Intelligence, lokal read-only uppslagning)

- **Branch:** `agent/repair-intelligence-lookup`
- **Resultat:** NEMOB OS har nu kombinerad sökning i en konfigurerbar lokal
  kanonkälla, read-only SHA-256-spärr, tydliga confidence-/safety-etiketter,
  källreferenser och separat append-only feedbacklogg med PII-stopp.
- **Dataskydd:** endast programkod, dokumentation och syntetisk testkanon är
  committade. Verklig kanon/evidens/kund-/audit-/batchdata ligger utanför Git.
  Inga writes eller anrop till Nordic-admin/kundärenden/SMS/e-post/pris/order
  har lagts till. Historiska prisfragment filtreras ur resultatvyn.
- **Verifiering:** `npm run test:nemob-os` (56/56), `npm run build`,
  `npm run verify:checkout-products`, `nemob-callflow: npm run check` och
  mobiltest 390×844 passerar. Saknad kanon ger `CANON_FILE_MISSING`.
  v1.3 SHA-256 före/efter:
  `7FA0F950E5BCEA180F3884DC651B6BAB5B151FCF74539E54233D5D0DC78B2FC9`.

### 2026-07-27 — Claude Code — KLAR (2 felsökningsguider: "startar inte" + "laddar inte")

- **Branch:** `feat/troubleshooting-guides` → PR mot `main`. Sista
  innehållsblocket i SEO-planens fas 3 — de nationella problemtermerna som
  domineras av AI Overviews kräver FAQ-strukturerat innehåll.
- **Sidor:** /guider/elscooter-startar-inte/ (kolla-det-enkla-först,
  symptom→orsak, vad-du-INTE-ska-göra) och /guider/elscooter-laddar-inte/
  (felsök-i-ordning, laddbeteende→orsak, förebyggande vanor). Article+FAQ+
  breadcrumb-schema, async fonter, WebP-hero. Säkerhetslinjen konsekvent:
  öppna aldrig batteripack, ladda aldrig skadade batterier, ring före frakt.
- **Priser i copyn stämmer mot prislistan** (felsökning 349, batteritest 745,
  laddport 595, säkring 295, BMS fr 895+del).
- **Infra:** guider-index +2 kort (överst), sitemap 74 URL:er. dist tar
  guider/ rekursivt — inga PUBLIC_DIRS-ändringar behövs.
- **Tester:** 6 schema-block validerade, build+dist, browsertest (alla
  sektioner, FAQ, interlänkar, WebP-hero, 0 konsolfel) ✅.
- **OBS:** feat/brand-service-pages är fortfarande OMERGAD (PR:en öppnades
  aldrig — branchen finns på GitHub). Blogg-räknaren: nu 5 guider av målets 12.
### 2026-07-25 — Claude Code — KLAR (4 märkes-servicesidor: KuKirin, NAVEE, Teverun, Halo Knight)

- **Branch:** `feat/brand-service-pages` → PR mot `main`. SEO-auditens fas 3
  ("[märke] service sverige" — ingen konkurrent rankar för dessa).
- **Sidor:** /kukirin-service/, /navee-service/, /teverun-service/,
  /halo-knight-service/ (bonus — nya partnern). Unikt innehåll per märke:
  märkesspecifika vanliga fel (G2-bromsar, NAVEE V-seriens punkteringar,
  Teveruns hydraulik/högvolt, Halo Knights felkodslista), egen FAQ ×4,
  auktorisationsvinkel. Service+FAQ+breadcrumb-schema, async fonter,
  WebP-hero-preloads — samma optimerade mall som stadssidorna.
- **Sanning i copyn:** ÅF-claims stämmer mot leverantörsrelationerna
  (KuKirin/NAVEE ÅF, Teverun via Group PZ B2B, Halo Knight partner enligt
  mailtråd juli). Garantilöften begränsade till "fordon köpta hos oss".
- **Infra:** sitemap → 72 URL:er, dist PUBLIC_DIRS +4 (45 poster), korsvis
  interlänkning mellan märkena + batterisidan + nya-elscootrar.
- **Tester:** 12 schema-block validerade, build+dist ✅.
- **Efter merge:** GSC-indexering för de 4 nya URL:erna (Claude kör).
### 2026-07-27 — Claude Code — KLAR (LCP runda 2: bloggtumnaglarna var boven — 4,1 s → 2,6 s)

- **Branch:** `fix/lcp-blog-thumbs` → PR mot `main`.
- **Mätning (lokal Lighthouse, simulerad mobil — PSI-API:t hade kvottak):**
  live-sajten efter LCP-runda 1: prestanda 86 (från 79), FCP 1,5 s (från
  2,7), CLS 0, TBT 0 — men LCP bara 4,4→4,1 s. Nätverksanalysen visade att
  hero-webp:n laddar på 355 ms; boven var bloggsektionens TRE tumnaglar som
  CSS-bakgrunder (200–230 kB jpg styck = ~640 kB) som laddar direkt vid
  sidstart (CSS-bakgrunder kan inte lazy-loadas) och tränger undan allt.
- **Fix:** 560px-webp-tumnaglar (21–37 kB, −93 %) för case-battery-bms,
  scooter-on-bench och showroom-group; CSS-url:erna bytta i index.html.
  Om-mätt lokalt: **LCP 2,6 s, FCP 1,1 s** — målet <2,5 s bör nås på
  produktion med Netlify-CDN. Verifiera i PSI några dagar efter merge.
- **Lärdom till Codex:** lägg ALDRIG stora bilder som CSS-background —
  de kan inte lazy-loadas och laddar alltid, även under vikningen.


### 2026-07-27 — Claude Code — KLAR (åtkomstgrind för interna verktyg — audit åtgärd 22 stängd)

- **Branch:** `feat/admin-gate` → main (f823fc8), live-verifierad.
- Ny Edge Function netlify/edge-functions/admin-gate.mjs: /admin, /workshop,
  /checkout, /prices, /quick-price serverar INTE HTML utan inloggning —
  401 + inloggningssida tills korrekt ADMIN_TOKEN angetts (samma nyckel som
  verktygen redan använder; cookie = SHA-256-fingeravtryck, 30 d, HttpOnly).
  not_configured-läge: saknas ADMIN_TOKEN släpps trafiken igenom som förut.
  Interna svar får noindex+no-store; robots.txt disallowar alla fem paths.
- **Live-verifierat:** 401+inloggningssida på alla fem interna vägar, fel
  nyckel avvisas, publika sidor opåverkade (200). ÅTERSTÅR: Sebastian
  bekräftar positiv inloggning med riktig nyckel (jag hanterar inte secrets).
- **Valet:** grind på befintliga URL:er i stället för subdomän-flytt — samma
  skydd utan DNS-ändring/betalplan/nya bokmärken. Vill man senare ha
  personliga konton: Cloudflare Access på subdomän, grinden tas då bort.

### 2026-07-27 — Claude Code — KLAR (Stripe-webhook konfigurerad — orderbekräftelsekedjan VERIFIERAD live)

- **Rotorsaken till uteblivna ordermejl är löst.** Via Sebastians inloggade
  Chrome: webhook-destination skapad i Stripe Workbench
  (`nordicemobility-orderbekraftelse`, event `checkout.session.completed` →
  /.netlify/functions/stripe-webhook, API-version 2025-09-30.clover);
  Sebastian klistrade själv in signing-nyckeln som STRIPE_WEBHOOK_SECRET
  (secret, scopes Builds/Functions/Runtime) i Netlify; redeploy triggad;
  sond bekräftar att funktionen nu kräver giltig Stripe-signatur.
- **End-to-end-verifierat med nytt 100 kr-testköp:** orderbekräftelse
  4QPPTGX5EIF2 till kund + "NY PRODUKTORDER"-notis till verkstaden landade
  sekundsnabbt (2026-07-27 01:14). Alla framtida produktordrar mejlas nu.
- **OBS:** eventet från det FÖRSTA testköpet (2026-07-25) kan inte skickas
  om (destinationen fanns inte då) — det köpet får ingen bekräftelse.
  Sebastian återbetalar BÅDA 100 kr-testköpen i Stripe (Payments → Refund).
- Testprodukten nemob-testorder-100 ligger kvar (dold/noindex) för framtida
  flödestester.
- **Ingen kod ändrad i detta pass** — endast Stripe/Netlify-konfiguration
  + denna logg. Rebase-konflikt i loggen mellan två kampanjposter löst
  genom att behålla båda (§5). ⚠️ Kampanjavvikelsen (42 SMS/natt mot
  godkända 25) som posten nedan flaggar är fortfarande ohanterad — ägs av
  kampanjtråden.

- **Branch:** `feat/city-landing-pages` → PR mot `main`. SEO-auditens
  expansionsförslag — Örebro-modellen (dedikerad geo-sida + Service-schema)
  replikerad till fyra mellansvenska städer utan lokal specialist.
- **ÄRLIG vinkel, inga doorway-dubbletter:** varje sida har unik H1/intro/
  restid/FAQ/söktermer och säger rakt ut att verkstaden ligger i Örebro.
  Tre kanaler: kör hit (restid angiven), inskick per frakt (med varning:
  skadade litiumbatterier får inte skickas som vanligt paket — ring först),
  hämtning enligt offert. Schema: Service med provider=Örebro-adressen och
  areaServed=staden+kranskommuner — INGEN falsk lokal adress.
- **Interlänkat:** korsvisa ortlänkar + batterisidan/priser/Örebro-sidan;
  Örebro-sidan fick sektionen "Vi hjälper hela Mellansverige" med alla fyra.
- **seo.css: undersidornas hero → WebP** (1600/900 med media query) — samma
  LCP-vinst som startsidan fick, nu för ALLA sidor som använder seo.css.
- **VIKTIGT — dist-listan:** nya mappar MÅSTE läggas i PUBLIC_DIRS i
  scripts/build-dist.mjs, annars deployas de aldrig (fångat: 37→41 poster).
- **Tester:** 3 schema-block/sida validerade, sitemap 68 URL:er, build+dist
  OK, browsertest Karlstad-sidan (hero-WebP, alla sektioner, FAQ 4/4,
  ortlänkar, 0 konsolfel) ✅.
- **Efter merge:** begär indexering i GSC för de 4 nya URL:erna.


### 2026-07-25 — Claude Code — KLAR (geo-fix + mejlflödesdiagnos: STRIPE_WEBHOOK_SECRET saknas)

- **Geo:** alla LocalBusiness-scheman rättade till 59.223091, 15.254543
  (Sebastians Google Maps-avläsning; sajten pekade tidigare flera km fel).
  Branch `fix/geo-koordinater` → main.
- **Diagnos av uteblivna ordermejl efter Sebastians 100 kr-testköp:**
  stripe-webhook svarar {"configured":false} i produktion —
  **STRIPE_WEBHOOK_SECRET saknas i Netlify** och webhook-endpointen är
  sannolikt inte registrerad i Stripe. Betalningen finns hos Stripe men
  checkout.session.completed når aldrig sajten → ingen orderbekräftelse,
  ingen verkstadsnotis (gäller ALLA produktordrar hittills, inte bara testet).
  Resend-kedjan VERIFIERAD OK via ångerflödet (testärende ANGER-0AFCEA9045,
  båda mejlen levererade sekundsnabbt). Åtgärd för Sebastian: registrera
  webhook i Stripe (event checkout.session.completed → /.netlify/functions/
  stripe-webhook), lägg whsec_-nyckeln som STRIPE_WEBHOOK_SECRET i Netlify,
  trigga redeploy, klicka Resend på eventet — då skickas bekräftelsen för
  det redan betalda testköpet.
### 2026-07-24 — Claude Code — KLAR (tysta timmar: nattstängda ärenden köar tackmailet till kl 10)

- **Branch:** `feat/thankyou-quiet-hours` → PR mot `main`. Sebastians önskan:
  nattarbete ska inte ge kundutskick kl 03.
- **Ny `_shared/quiet-hours.mjs`:** isQuietHour (21–08 Sthlm, DST-säker) +
  nextOptimalSendAt (nästa kl 10:00 Sthlm — bra tid för öppning/recension).
- **workshop-cases.mjs:** stängs ärendet under tysta timmar köas tacket i NY
  store `outbox` (nyckel `<caseId>-thank-you`), notifications.thankYou →
  status "queued" + sendAfter, timeline-notis med svensk tid. Dagtid: exakt
  som förut. sendThankYou exporteras nu (named export) för flushen.
- **NY schemalagd funktion `outbox-flush.mjs`** (cron */15 * * * *): tömmer
  outbox när sendAfter passerats och det inte är tyst timme; skickar via
  samma sendThankYou (Resend-idempotencyKey per ärende ⇒ dubbelsäkert),
  uppdaterar caset (sent/coupon/timeline), behåller posten för retry vid
  providerfel, släpper den om ärendet inte längre är "queued".
- **Tester:** 4 nya (tysta timmar + kl-10-träff över DST), i test:status så
  bygget kör dem. node --check ×3, build+dist ✅.
- **OBS Codex:** alla FRAMTIDA kundutskick nattetid bör gå via outbox-mönstret.


### 2026-07-27 — Claude Code — KLAR (daglig kampanjvåg RING20, 25 st)

- **Skickade:** 25 SMS. **Spärr-skippade:** 0. **Optout-skippade:** 0.
  **Misslyckade:** 0.
- **Dedup-skyddet (PR #117, `fix/campaign-dedup-guard`) är LIVE i produktion.**
  Första API-anropet i körningen returnerade ett cachat svar UTAN
  `campaignSent` (vaktkoden avbröt korrekt); ett nytt anrop med
  `cache:'no-store'` + cache-buster visade fältet. **Lärdom för framtida
  körningar: anropa alltid `/api/call-dashboard` med cache-buster och
  `cache:'no-store'`**, annars kan skyddskontrollen ge falskt larm.
- Storen `campaign-sent` var tom före körningen (nydeployad) och innehåller nu
  exakt vågens 25 nummer — verifierat efter sändningen.
- **Kö kvar:** 29 kvalificerade uppringare (54 kvalificerade före vågen,
  146 unika nummer i dashboarden).
- **Loggen INTE committad:** mappen stod på branch `feat/city-landing-pages`
  med orelaterade ändringar. Committa denna post separat när mappen är
  tillbaka på `main`.
### 2026-07-27 — Claude Code — KLAR (kampanjvåg RING20, schemalagd körning 00:50)

- **Branch:** `main`, endast denna loggfil ändrad. Ingen kod rörd.
- **Dedup-skyddet är deployat och verifierat:** `campaignSent` fanns i
  `/api/call-dashboard`-svaret, så körningen tilläts starta.
- **Resultat:** 25 nummer i vågen → **17 skickade**, **8 misslyckade**,
  0 spärr-skippade, 0 optout-skippade. **12 kvar i kön.**
- **Fel-detaljerna gick förlorade:** `javascript_tool` tajmade ut (300 s) på
  svarskanalen medan sändningsloopen redan hade kört klart i sidan (~10 s,
  00:50:44–00:50:54). Läget rekonstruerades i efterhand mot `campaignSent`.
  De 8 misslyckade var inte optouts (de ligger kvar som kvalificerade) —
  trolig orsak är fel från SMS-leverantören. Bör kollas i function-loggen.
- **⚠️ AVVIKELSE ATT TITTA PÅ:** `campaignSent` innehöll redan 25 nummer med
  `lastSentAt` 00:13:09–00:13:22 **samma natt**, dvs. en tidigare körning ~37
  min före denna, utan loggpost här. Totalt gick alltså **42 SMS ut natten
  till 2026-07-27**, mot den godkända takten 25/dygn. Ingen kund fick dubbla
  sms (42 unika nummer, alla `count = 1` — spärren höll), men schemaläggningen
  bör kontrolleras så att uppgiften inte triggar två gånger per dygn.

### 2026-07-24 — Claude Code — KLAR (mobil-LCP startsidan: async fonter, WebP-hero, async popup-CSS)

- **Branch:** `feat/mobile-lcp` → PR mot `main`. SEO-auditens åtgärd #4
  (mobil-LCP 4,4 s → mål < 2,5 s, direkt rankingsignal Mobile-First).
- **Hero-bilden (LCP-elementet):** workshop-hero.jpg 278 kB →
  workshop-hero-1600.webp 96 kB (desktop) + workshop-hero-900.webp 42 kB
  (mobil via media query). Preload uppdelad med media-attribut så bara EN
  variant laddas. Original-jpg:n kvar för og:image/schema.
- **Google Fonts:** startsidan saknade preconnect helt OCH laddade font-CSS
  render-blockerande. Nu: preconnect ×2 + media=print-async + noscript-
  fallback. Text renderas direkt med systemfont, Inter swappar in.
- **newsletter-popup.css:** async (behövs först när popupen visas).
- **Verifierat i browser:** mobil 375px → 900-webp, desktop 1280px →
  1600-webp, Inter aktiv efter swap, popup-CSS flippar till media=all,
  0 konsolfel. Build + dist-verifiering OK (Codex dist-bygge inkluderat).
- **Kvar för full LCP-effekt (nästa pass):** samma font/CSS-mönster på
  nya-elscootrar + landningssidorna, case-bilderna (206–231 kB jpg) till
  WebP. Ommätning via PageSpeed Insights efter deploy.

### 2026-07-25 — Claude Code — KLAR (dold testprodukt 100 kr för skarptest av betalflödet)

- **Branch:** `feat/testprodukt` → mergad till main (563a1d9), live-verifierad.
- Produkt `nemob-testorder-100` med nytt fält `hidden: true`: köpbar via
  /produkt/nemob-testorder-100/ (noindex) men exkluderad från katalog,
  startsida, ItemList-schema, Snabb beställning och sitemap. Generator +
  verify-skript respekterar hidden-fältet. Syfte: Sebastian testar
  checkout → orderbekräftelse → ånger för 100 kr; återbetala via Stripe
  efteråt. Ta bort produkten (eller låt ligga) efter genomfört test.

### 2026-07-25 — Claude Code — KLAR (integritetspolicy omskriven enligt auditens GDPR-checklista)

- **Branch:** `feat/integritetspolicy` → mergad till main (0dd6c1d).
- Fullständig policy: ansvarig+kontakt, kategorier per flöde, rättslig
  grund, lagringstider, biträden (Stripe/Netlify/Resend/46elks/Google) med
  DPF/SCC-tredjelandsöverföring, cookieavsnitt kopplat till samtyckes-
  bannern, rättigheter + IMY. **Utkast — bör juristgranskas** innan den
  betraktas som slutgiltig (audit p9).

### 2026-07-25 — Claude Code — KLAR (produktsidor /produkt/<id>/ + CSP Report-Only)

- **Branch:** `feat/produktsidor` → mergad till main. Mappen på main.
- **Gjort:** 43 genererade produktsidor (/produkt/<id>/) med unik
  title/meta/canonical, Product+Breadcrumb-schema med absoluta bilder,
  legal status intill köpknappen, EU-lagerstatus, checkout-CTA. Genereras
  och städas automatiskt av generate-products.mjs — REDIGERA ALDRIG
  produkt/-filerna för hand. Katalog-/startsidekort + modal länkar dit;
  ItemList-schemat pekar på unika produkt-URL:er; sitemap har autoblock
  mellan <!-- produkt:auto:start/end -->-markörer (lastmod = catalog.updated).
  CSP tillagd i Report-Only-läge — bevaka konsolvarningar innan blockering.
- **Tester:** npm run build ✅ (43 sidor + dist-verifiering),
  verify:checkout-products ✅, browserverifierat (sida + kortlänkar +
  schema-URL:er), inga konsolfel.
- **Nästa i backlog:** integritetspolicy-uppdatering (audit p9, utkast för
  jurist), admin-subdomän, CI-kontroller (p36), lokal bildspegling för
  CSP-skärpning av img-src.

### 2026-07-25 — Claude Code — KLAR (orderbekräftelse med ångerinfo + automatisk ångerbekräftelse)

- **Branch:** `feat/anger-orderbekraftelse` → mergad till main. Mappen på main.
- **Gjort:** (1) stripe-webhook.js skickar nu orderbekräftelse på varaktigt
  medium efter betalt checkout-köp: avtalspart, orderreferens, belopp,
  14 dagars ångerrätt med /angra-kop/-länk + KO-blankett, 3 års
  reklamationsrätt — distansavtalslagens bekräftelsekrav. Intern ordernotis
  till WORKSHOP_EMAIL (verkstaden fick tidigare INGEN notis om produktordrar).
  Idempotent mot Stripe-omsändningar. (2) Ny anger.mjs (/api/angerratt):
  lagrar ångermeddelanden i Blobs-store "anger-requests", skickar omedelbar
  skriftlig bekräftelse till kund + åtgärdsnotis till verkstaden; /angra-kop/
  postar dit med Netlify Forms som alltid-skickad backup. (3) Delad
  _shared/email.js (Resend, not_configured-läge).
- **Kräver i Netlify-miljön:** RESEND_API_KEY + EMAIL_FROM (samma som
  bokningen använder — finns de är allt aktivt direkt), WORKSHOP_EMAIL.
  Netlify Forms-notisen för "angerratt" är nu backup, inte enda vägen.
- **Tester:** node --check ✅, ESM/CJS-interop + handler-smoketest
  (validering/honeypot/405) ✅, npm run build + dist-verifiering ✅.
- **Kvar i backlog:** admin/checkout/workshop till skyddad subdomän,
  per-modell-legalverifiering av >250W "check-rules"-modeller, geo mot GBP,
  produktsidor, CSP, integritetspolicy-uppdatering, CI-kontroller (audit p36).
### 2026-07-24 — Claude Code — KLAR (HÅRD kampanjspärr per telefonnummer efter dubbelskicket)

- **Branch:** `fix/campaign-dedup-guard` → PR mot `main` (byggd i separat
  worktree — mappen var upptagen av webbaudit-passet).
- **Bakgrund:** schemalagda vågen 24 juli 05:04 skickade om till våg 1-nummer
  från 19 juli; callId-baserade followups räckte inte som dubblettskydd
  (rotorsak obekräftad — 19 juli-posterna saknas i storen).
- **Fix (server, send_discount):** NY store `campaign-sent` med telefonnummer
  som nyckel: hård spärr 30 dagar per nummer (endast force=true överstyr),
  append-säker historik (history[] skrivs aldrig över). GET exponerar
  `campaignSent` som auktoritativ skickat-lista; adminpanelen använder den.
  Dubbelskick är nu OMÖJLIGT oavsett klient/schemaläggning.
- **OBS:** storen är tom vid deploy → de 25 som fått SMS (19+24 juli) syns
  inte i den förrän nästa utskick — men followup-fallbacken i panelen täcker
  24 juli-posterna, och schemalagda uppgiften är instruerad att vägra köra
  om campaignSent saknas i API-svaret.
- **Tester:** node --check, inline-JS 0 fel, 14/14 Node-tester.


### 2026-07-25 — Claude Code — KLAR (webbaudit-branchen mergad till main på Sebastians order)

- `fix/webbaudit-prio0` mergad till `main` (d065837) och pushad — Netlify
  auto-deployar. Mappen står på `main` igen. Deployverifiering pågår
  (kriterium: /data/products.json ska ge 404 på livesajten).
- **Manuellt för Sebastian:** aktivera e-postnotis i Netlify UI för nya
  formuläret `angerratt` (Forms → notifications) — annars ser ingen
  inkommande ångermeddelanden.

### 2026-07-24 — Claude Code — KLAR (webbaudit prio 0 + delar av prio 1 åtgärdade)

- **Branch:** `fix/webbaudit-prio0`, pushad till origin (nätet kom tillbaka
  i slutet av passet). Mergad till main 2026-07-25, se post ovan.
  OBS: origin/main (PR #114+115) mergades in
  i branchen under passet av parallell agent — ingen konflikt, bygget grönt.
- **Underlag:** Full webbaudit 2026-07-24 (Downloads). Auditens påståenden
  verifierade mot koden (4 verifieringsagenter, 6 stoppades av sessionstak
  och täcktes manuellt): prio 0-fynden stämde i sak.
- **Gjort:** (1) publish="dist" med allowlist-bygge scripts/build-dist.mjs —
  data/products.json (costEur!), docs/, netlify/-källkod, AGENTS/CLAUDE.md
  m.m. deployas inte längre; bygget failar om costEur läcker. (2) Halo
  Knight-jämförpriser/kampanj borttagna → "Lanseringspris" (30-dagarsregeln);
  originalPriceSek renderas inte ens om fältet återinförs. (3) Klarna-
  månadsbelopp (pris/24) borttagna. (4) Legal copy: off-road-only →
  "Endast inom inhägnat område, får inte köras i allmän trafik"; "privat
  mark"/"gatuanpassad" borttaget; 5 uppenbara prestandamodeller (UT5 Ultra X,
  Fighter Mini/Mini Pro/Supreme Ultra, Blade GT+ II) omklassade till
  off-road-only; legal copy nu även på startsidans kort + modal. (5) Bokning:
  Europe/Stockholm-datum klient+server, servervalidering (dåtid/veckodag/
  15–18), kalender-not_configured stoppar inte längre bokningar, idempotency-
  nyckel skrivs efter komplett bokning, Netlify-backup även vid API-fel,
  beställningsläge utan verkstadsfält. (6) /angra-kop/ digital ångerfunktion
  (Netlify form "angerratt") + villkor/garanti: 3 års reklamationsrätt,
  14-dagarskrav borttaget, schablonavdrag → faktisk värdeminskning, ARN.
  (7) GA4 bakom samtyckesbanner (laddas ej före aktivt ja), popup 35s/50%
  scroll, checkout-fallback → beställningsförfrågan. (8) EU-LAGER-badge,
  cachefix (JS/CSS 1h), typos, geo enhetlig.
- **Tester:** npm run build ✅ (inkl. dist-verifiering), verify:checkout-
  products ✅ (43 produkter), node --check på ändrade filer ✅, callflow
  tsc ✅. Browser-verifierat på dist-server: interna paths 404, katalog/
  bokning/consent/ånger renderar och fungerar, inga konsolfel.
- **Kvarvarande risker/backlog:** ångerbekräftelse via mejl är manuell rutin
  (automatisera i stripe-webhook + Resend); orderbekräftelse med ånger-
  info efter Stripe-köp saknas (lagkrav — bygg i stripe-webhook);
  admin/checkout/workshop/prices/quick-price deployas fortfarande publikt
  (flytta till skyddad subdomän); >250W-modeller som fortfarande är
  "check-rules" behöver per-modell-verifiering (NAVEE XT5/NT5-serien m.fl.);
  geo-koordinat 59.2741,15.2066 vald som enhetlig — verifiera mot Google
  Business Profile; Sebastian bör aktivera e-postnotis för formuläret
  "angerratt" i Netlify.

### 2026-07-24 — Claude Code — PÅGÅR-arkiv (samma pass som KLAR ovan)

- Ursprunglig PÅGÅR-post: tog netlify.toml, scripts/, index.html,
  nya-elscootrar/, book-online/, booking.mjs, villkor/. Rörde inte
  docs/NEMOB_OS_V1_PLAN.md (ocommittad, ej min), nemob-callflow/, nemob-os/.
- **MERGE-NOT (Drift-agenten, samma dag):** origin/main (789c039, PR #114+#115)
  mergades in i denna branch mitt under passet — konflikt endast i denna logg,
  löst genom att behålla båda. Verifierat efter merge: bild-PR:ens 7 lokala
  webp-bilder OCH webbaudit-passets 30-dagarsregel-fix (originalPriceSek bort)
  samexisterar i data/products.json.

### 2026-07-24 — Claude Code — KLAR (7 produktbilder från leverantörernas Drive-mappar inkopplade)

- **Branch:** `feat/supplier-product-images` → PR mot `main`.
- **Källor (officiellt leverantörsmaterial, OK att använda som ÅF):**
  KuKirins delade Drive-mapp (kugoopatty@gmail.com) och NAVEE:s (aidanhah55
  @gmail.com). Nedladdade via Sebastians Chrome-session, konverterade med
  sharp till WebP (max 1600 px, q84, vit bakgrund; 2–38 MB → 21–43 kB).
- **Inkopplade (`images`-fältet, samma mönster som Halo Knight):**
  KuKirin G4 Special Edition*, S1 Max, G3, G4 Max + NAVEE NT5 Max, XT5 Pro,
  K100 Max. *G4 SE använder basmodellens G4-hero — verifiera att SE-varianten
  inte skiljer visuellt. Alla bilder visuellt granskade (rätt modell, vit
  bakgrund) utom K100 som verifierats efter konvertering.
- **Saknas fortfarande (kvar av 35):** KuKirin C1 Pro 26Ah, G2, G2 Pro,
  G2 Max, G2 Master, G3 Pro, M4 Max (G2- och M4-nedladdningar vägrade —
  finns delvis i Drive: G2 2026/MAIN, M4 Max-mappen); NAVEE UT5 Ultra X,
  NT5 Ultra X, V25i Pro II, GT3 Max, ST3, ST3 Pro, ST5 Max (finns EJ i
  Drive — mejl till Aidan krävs); Teverun ALLA 13 (inget material alls —
  mejl till Group PZ/Teverun). A1:s Drive-mapp har bara livsstils-/
  marknadsmaterial, ingen ren hero.
- **Verifiering:** generate-products 44 produkter, build, verify checkout 43,
  bilderna renderas i nya-elscootrar (3 träffar/bild = kort+galleri) ✅.

### 2026-07-24 — Claude Code — KLAR (SEO vecka noll: blogglänk, batterisidan nationaliserad, sitemap)

- **Branch:** `feat/seo-week-zero` → PR mot `main`. Grundas på SEO-audit
  2026-07-24 (Perplexity, C:\Users\Sebas\Downloads\nordic_emobility_seo_audit_juli2026.pdf).
  Strategi: äga service-vertikalen nationellt (Wheelyshop saknar verkstad).
- **Blogglänken fixad:** startsidans meny (desktop + mobil) pekade på döda
  ankaret `#blogg` → nu `/guider/`. Auditens "10 minuter, direkt SEO-värde".
- **Batterisidan (/batterireparation-elscooter/, rankar #10 nationellt):**
  (1) Title/description AV-Örebro-iserad — "Batterireparation elscooter —
  pris, diagnos, cellbyte & BMS" (startsidan är det som rankar lokalt, så
  ingen lokal risk); (2) FAQ utökad 5→7 frågor ("hur lång tid", "utanför
  Örebro") och synliga kort synkade med FAQPage-schemat 7/7 — Google kräver
  matchning för rich results. OBS: inga leveranstidslöften eller
  batterifrakt-löften (farligt gods) — medvetet vag/ärlig text.
- **Sitemap:** lastmod bumpad för /, /book-online/, /batterireparation-
  elscooter/. Sitemapen täckte redan alla 20 sidor — indexeringsproblemet
  ligger hos Google, åtgärdas via GSC-begäran (Claude kör via Sebastians
  session efter merge).
- **Kvar i SEO-planen (kommande PR:ar):** LCP-mobiloptimering (4,4s→<2,5s),
  4 stadssidor (Västerås/Eskilstuna/Karlstad/Linköping), märkes-servicesidor
  (kukirin/navee/teverun-service), guider ("startar inte", "laddar inte"),
  individuella produktsidor via generatorn. Sebastian: 37 produktfoton,
  NA-kontakt, återförsäljarlänkar från NAVEE/KuKirin/Teverun.
- **Tester:** FAQ-JSON validerad, schema/synligt 7/7, sitemap välformad,
  build ✅.
### 2026-07-24 13:13 CEST — Codex — KLAR (Halo Knight-partnerlansering och dropshippingprodukter)

- **Branch / PR:** `feat/halo-knight-launch` / #113.
- **Gjorde:** lade till T102, T104, T108, T107 Pro och T108 Pro med officiellt
  promomaterial, partner-/kampanjyta, varumärkesfilter och checkout-leverans
  från Halo Knights EU-lager.
- **Fastställda kampanjpriser:** T107 Pro 16 990 kr (ord. 18 990 kr) och
  T108 Pro 17 490 kr (ord. 19 490 kr). Övriga EU-lagermodeller läggs in med
  tidigare beslutade introduktionspriser.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `node --check` ✅, `jq empty data/products.json` ✅, `git diff --check` ✅.
  Netlify deploy preview visuellt kontrollerad: 5 modeller, rätt priser,
  fungerande filter/bilder och ingen horisontell overflow.
- **Varning:** Halo Knights dropshippingpris behöver fortfarande bekräftas
  skriftligt som inklusive eller exklusive moms; detta påverkar marginalen men
  användaren har uttryckligen valt att lansera nu.

### 2026-07-19 — Claude Code — KLAR (kampanjvåg 1 SKICKAD: 25/25, 0 fel)

- **Utförd manuellt av Claude kl ~11:15 på Sebastians order** ("kör") — den
  schemalagda 10:02-körningen fastnade på förstagångsgodkännandet och Chrome
  startades om; dubblettskyddet gör dubbelskick omöjligt oavsett.
- **Resultat:** 25 skickade, 0 misslyckade. Kön (60-dagarsfönstret, nya
  rankade reglerna): 78 berättigade totalt → **53 kvar** till kommande vågor.
  Högst rankad: nummer med poäng 40 (20 samtal senaste veckan).
- **Utskicket:** RING20, 20 %, giltigt t.o.m. 2026-08-02, avsändare
  NordicEMob, avregistrering via mejl. Loggat per nummer i call-followups
  (= dubblettskyddet för kommande vågor).
- **Schemalagda dagliga vågen (10:02) tar nästa 25 i morgon** — förutsatt att
  Sebastian godkänner behörighetsrutan vid nästa körning; annars kör Claude
  manuellt på "kör".

### 2026-07-19 — Claude Code — KLAR (vinn-tillbaka-verktyget v2: 60 dgr, rankat, kundkortsfilter; Akut-panelen borttagen)

- **Branch:** `feat/winback-tool-v2` → PR mot `main`. Sebastians omdesign.
- **Backend:** `CALL_WINDOW_DAYS` 30→60 (paginering 24 sidor). Ringstatistikens
  rubrik i admin läser nu `stats.windowDays` dynamiskt.
- **Kampanjpanelen omdöpt "Vinn tillbaka missade samtal — rankad lista,
  25/dag":** unika nummer 60 dgr som ALDRIG nåtts på telefon och SAKNAR
  kundkort (checkbox för att inkludera kundkort), ej redan lyckat kontaktade/
  optout/converted. Rankning: poäng = antal samtal × färskhetsvikt (≤7 dgr ×3,
  ≤21 ×2, annars ×1) — färsk+envis rankar högst. Tabell med rank/samtal/
  senast/poäng/status; topp-N (vågstorlek, default 25) grönmarkerad "Dagens
  våg"; redan kontaktade ligger kvar längst ner med ✓ och datum. Skicka-
  knappen skickar ENDAST dagens våg.
- **BORTTAGET: "Akut uppföljning – missade samtal"** (manuella klistra-in-
  konsolen) — arv från innan live-46elks-kopplingen; HTML, alla lyssnare och
  ~10 000 tecken JS utrensade. `MISSED_CALL_SMS_UNKNOWN` behållen (används av
  kopiera-utkast i livevyn). Kontrolltornets missade samtal kommer redan
  enbart från live-källan.
- **Schemalagd uppgift uppdaterad:** daglig våg kl 10:00 (var: engångs söndag)
  med exakt samma filter+rankning; stoppar sig själv-rapporterar när listan
  är tom. Söndagens 10:00-körning med GAMLA logiken hann pausas innan skott.
- **Facit på Sebastians fråga:** "25 bortfiltrerade" var nummer med AKTIVT
  ärende — INTE 13 juli-mottagarna (de fick aldrig något; alla 25 failade på
  kontospärren och är nåbara igen tack vare followed_up-fixen i #111).
- **Tester:** node --check, inline-JS 0 fel, build, browsertest av rankning/
  filter/våg-markering/✓-rader med fixturer ✅.

- **Branch:** `feat/balance-guard-callbacks` → PR mot `main`.
- **Saldovakt (`call-dashboard.mjs` + admin):** GET hämtar 46elks-saldot
  (/a1/me, 10000=1 SEK) → `account` i svaret + statkort i admin (rött under
  tröskeln, env `ELKS_BALANCE_WARN_SEK` default 100). Under tröskeln SMS:as
  Sebastian max 1 gg/dygn (blob `ops-warnings`). Tomt saldo = grundorsaken
  till 13-17 juli och får aldrig vara tyst igen.
- **Auto-SMS till missade uppringare (`voice-notify.mjs`):** vid obesvarat
  samtal SMS:as uppringaren ("vi såg att du ringde - boka här...") med
  spärrar: max 1/nummer/dygn (blob `caller-autosms`), aldrig optout-nummer,
  aldrig kl 21-08, aldrig egna nummer.
- **Kampanjfixar (admin):** followedUp blockerar nu bara LYCKADE utskick
  (13 juli-mottagarna åter nåbara); standardtexten utan RING/STOPP-svar
  (avsändaren kan inte ta emot — återinför när SMS-kapabelt mobilnummer
  finns); replyable-checkboxen default AV med förklaring.
- **Exekvering:** servicelänk-omkörning behövdes EJ (alla failade-SMS-fall
  hade mailtäckning eller inaktivt ärende). Kampanjvåg 1 (25 av 60 unika,
  korrigerad text utan RING) körs söndag kl 10:00 — kl 05:30 skickar man
  inte SMS till kunder. Saras fallback-nummer avvaktas (Sebastians besked).
- **Tester:** node --check ×2, inline-JS 0 fel, build ✅.

### 2026-07-19 — Claude Code — KLAR (voice-simple v3: telefonsvarare med inspelning)

- **Branch:** `feat/voicemail-recording` → PR mot `main`.
- **Sebastian live-testade söndag:** stängt-beskedet spelas ✅ men "två pip och
  klick" efteråt — kedjan saknade inspelningssteget som gamla växeln hade.
- **Ny kedja:** stängt-besked → inspelning (90 s, som gamla växeln). Dagtid:
  Sebastian → fallback-nummer (om satt) → voicemail-prompt.mp3 → inspelning.
  Steg `saved` SMS:ar Sebastian med uppringarens nummer + wav-länk
  (46elks-inloggning krävs för att lyssna, samma som gamla flödet).
  Admin-dashboarden klassar samtal med inspelning som "Röstmeddelande"
  automatiskt (answeredBy kollar recordings).
- **KRITISK testsanering:** Netlify-bygget kör test:voice med PRODUKTIONS-env
  — ENV_KEYS-listan i testet rensar nu även ELKS-creds/SITE_URL/
  VOICE_TIMEOUT_SECONDS, annars hade varje deploy skickat ett riktigt SMS
  till Sebastian och assertions flakat. Rör inte den listan utan att förstå
  detta.
- **Secret-aktiveringen slutförd (tidigare idag):** 46elks voice_start
  uppdaterad via configure_voice_webhook, verifierad 401 utan / 200 med
  secret. Netlify-kortet uppdaterat och betalt (Sebastian).
- **Tester:** 10/10 voice + build ✅.

### 2026-07-19 — Claude Code — KLAR (voice-simple v2: öppettidsbesked + fallback-nummer — samma branch/PR som secret-actionen)

- **Branch:** `feat/voice-webhook-secret` (samma PR som configure_voice_webhook).
- **voice-simple.mjs omskriven:** (1) Utanför telefontid (mån–fre 09–18
  Sthlm-tid, helger + svenska helgdagar stängt — samma schema som gamla
  televäxeln) spelas `audio/outside-hours-prompt.mp3` (gamla växelns besked,
  verifierat live HTTP 200) i stället för att ringa Sebastian. (2) Obesvarat
  samtal → `next` → `?step=fallback` → ringer `VOICE_FALLBACK_NUMBER` om satt
  (Sebastian ska ge Saras nummer senare — env är förberedd men TOM), annars
  tyst avslut. (3) `VOICE_TEST_NOW` env för deterministiska tester (bygget
  kör test:voice — utan den hade nattliga deploys failat). (4) `isOfficeHours`
  exporteras och är helgdagsmedveten 2026–2027 — uppdatera listan i december.
- **Env i Netlify (satta av Claude via Sebastians session, 19 juli):**
  `VOICE_WEBHOOK_SECRET` (48 tecken), `VOICE_PRIMARY_NUMBER=+46700243319`,
  `VOICE_NOTIFY_TO=+46700243319`. `VOICE_FALLBACK_NUMBER` läggs till när
  Sebastian bestämt numret.
- **Tester:** 11/11 (6 nya: stängt-besked, fallback med/utan nummer,
  helgdagslogik), npm run build ✅.
- **OBS Netlify:** rött banner "Payment overdue" på teamet — Sebastian
  informerad, måste uppdatera kort annars riskerar hela sajten nedstängning.

### 2026-07-19 — Claude Code — KLAR (configure_voice_webhook: aktivera VOICE_WEBHOOK_SECRET utan avbrott)

- **Branch:** `feat/voice-webhook-secret` → PR mot `main`.
- **Bakgrund:** 46elks-kontot var TOMT (0,36 kr) sedan natten 13 juli — det var
  därför ALLA SMS gav "Forbidden" och alla röstben failade på 0s trots att
  webhooken svarade rätt. Sebastian fyllde på 100 kr 17 juli; API:t är
  verifierat upplåst (nummerlistan svarar igen).
- **Ny action `configure_voice_webhook` (call-dashboard.mjs):** sätter
  voice_start på 010-numret till voice-simple MED `?secret=` via 46elks API.
  Avbrottsfri ordning: (1) merge/deploy actionen, (2) kör actionen så 46elks
  börjar skicka secreten (voice-simple utan env ignorerar den), (3) sätt
  VOICE_WEBHOOK_SECRET i Netlify env → nästa deploy aktiverar kravet och
  whenhangup→voice-notify (missat-samtal-SMS, kräver VOICE_NOTIFY_TO).
- **Kampanjfacit 13 juli:** ALLA 25 kampanj-SMS failade (kontospärren) —
  ingen mottagare nåddes. Måste skickas om när telefonkedjan är verifierad.
- **NYTT LARM:** 46elks loggar NOLL inkommande samtal 18-19 juli trots att
  Sebastians mobil "ringt som en galning" — misstanke: kunder ringer hans
  mobil direkt, alternativt når 010-samtal inte ens 46elks längre. Testsamtal
  till 010-numret + kontroll i 46elks dashboard krävs.
- **Tester:** node --check ✅, 7/7 ✅.

### 2026-07-14 — Claude Code — KLAR (NEMOB OS "Slå upp ärende" — tillägg i PR #107)

- **Branch/PR:** ny commit på `feat/nemob-os-mobil` → PR #107 (öppen).
- **Resultat:** read-only ärendesökning i mobilen: GET-only-proxy mot
  admin-API:t (`NORDIC_ADMIN_TOKEN` server-till-server, aldrig till telefon,
  60s cache + stale-fallback), sök på namn/telefon/modell/ärendenr med
  whitelistade fält (max 20 träffar), "Pågående arbeten"-lista äldst först.
- **Tester:** 38/38 ✅ (8 nya inkl. tokenläckage- och whitelist-skydd).
  Verifierat i browser mot mock-admin: sök "per", pågående-lista, tel:-länkar.
- **Tailscale verifierat:** servern svarar på Tailscale-IP:t med PIN-sida;
  Windows räknar gränssnittet som Private ⇒ befintlig brandväggsregel täcker.
- **Sebastian:** lägg `NORDIC_ADMIN_TOKEN=` i `nemob-os/.env` för att aktivera.

### 2026-07-14 — Claude Code — KLAR (NEMOB OS mobil — PR #107 öppen)

- **Branch/PR:** `feat/nemob-os-mobil` → PR #107 mot `main` (öppen).
- **Resultat:** LAN-läge bakom PIN (fail-safe: servern startar inte oskyddad
  utanför loopback; HttpOnly-sessionscookie, timing-safe, 20 försök/h),
  upplåsningssida, mobil-CSS (sticky topbar, 44px-knappar, ingen h-scroll
  vid 375px), PWA-manifest + hemskärmsikon. Endast `nemob-os/` berörd.
- **Tester:** node --test 30/30 ✅ (6 nya auth). Browserverifierat i
  mobilviewport: 401 utan cookie, fel PIN nekas, rätt PIN → dashboard med
  live Nordic-data.
- **Sebastian:** README "Mobilläge" — brandväggsregel (engångs, admin),
  `ipconfig` för IP, PIN finns i lokala `nemob-os/.env`.

### 2026-07-14 — Claude Code — PÅGÅR (NEMOB OS mobil: LAN-läge bakom PIN + mobil-UI + PWA)

- **Branch:** `feat/nemob-os-mobil`. Rör ENDAST `nemob-os/`-mappen.
- **Omfattning:** valfri LAN-bindning (`NEMOB_OS_HOST`) som kräver PIN
  (HttpOnly-cookie, timing-safe), mobilanpassad CSS, PWA-manifest +
  hemskärmsikon. Inga ändringar i Netlify-funktioner eller publika sidor.
- **Till andra agenter:** ta inte `nemob-os/`-filer under passet.

### 2026-07-13 — Claude Code — KLAR (felsökning: configure_sms_webhook gav "Forbidden")

- **Branch:** `fix/sms-webhook-diagnostics` → PR mot `main`.
- **Sebastian körde "Aktivera SMS-mottagning" → "Forbidden"** från 46elks.
  Gamla koden tappade felorsaken (46elks svarar ren text vid fel, koden
  json-parsade → tom) och sa inte vilket steg som nekades.
- **Fix:** configure_sms_webhook läser nu svaret som text+JSON och returnerar
  steg (list_numbers/update_sms_url), HTTP-status och 46elks feltext, plus
  manuell fallback-instruktion i felmeddelandet.
- **Trolig rotorsak:** API-nyckeln i Netlify env saknar rättighet för
  nummerhantering (t.ex. subkonto — SMS/samtal funkar, /a1/numbers nekas).
  **Manuell väg som alltid funkar:** 46elks dashboard → Numbers →
  +46101385498 → SMS URL → `https://www.nordicemobility.se/api/sms-inbound`
  (+ `?secret=...` om SMS_INBOUND_SECRET sätts i Netlify). Webhooken i sig
  är deployad och redo — det är bara pekaren i 46elks som saknas.
- **Tester:** node --check ✅, 7/7 ✅.

### 2026-07-13 — Claude Code — KLAR (svara-RING-kanal + optout + rollout-filter)

- **Branch:** `feat/sms-reply-channel` → PR mot `main`.
- **NY webhook `sms-inbound.mjs`** (`/api/sms-inbound`, POST, form-encoded från
  46elks): validerar mottagarnummer (env `ELKS_NUMBER`, fallback 010-numret),
  riktning incoming samt valfri `?secret=` (env `SMS_INBOUND_SECRET`, timing-
  safe). RING/1 → blob `sms-inbound` + direkt-SMS till Sebastian (10 min
  cooldown per nummer) + autosvar "Vi ringer upp dig inom 24 timmar". STOPP →
  blob `sms-optout` (nyckel = telefonnummer) + bekräftelsesvar. Övriga svar
  loggas + notis, inget autosvar. Svarstexten i response-body blir SMS-reply.
- **`call-dashboard.mjs`:** `postSms` tar from-override; `send_discount` med
  `replyable:true` skickar från 010-numret (svarbart) i stället för
  NordicEMob; optout kollas ALLTID server-side före sändning (skip, ej fel).
  NYA actions: `configure_sms_webhook` (listar /a1/numbers, sätter sms_url på
  vårt nummer via 46elks API — credentials stannar i env; voice_start rörs
  inte) och `mark_inbound_handled`. GET-svaret har `inboundSms` (7 dgr) +
  `optoutPhones`.
- **Admin:** kampanjtexten har nu bugg-förklaring + "Svara RING ... inom 24
  timmar"; checkbox "Skicka från 010-numret" (default PÅ); Svars-inkorg med
  röda ohanterade RING-rader + "Markera uppringd"; engångsknapp "Aktivera
  SMS-mottagning" (kör configure_sms_webhook). Optout-skippade räknas inte
  som fel i vågsammanfattningen.
- **Utrullningslistan:** exkluderar nu Klar+betald (= i praktiken uthämtad,
  gamla ärenden som aldrig stängts) per Sebastians feedback.
- **Tester:** node --check ×2 ✅, inline-JS 0 fel ✅, build ✅, 7/7 Node-
  tester ✅, browsertest: inkorg (röd RING, hanterad STOPP, tom-läge),
  rollout-filtret (Klar+betald bort, Klar+obetald kvar), kampanjtext + 
  checkbox ✅. Inga SMS skickade.
- **Driftsteg för Sebastian:** 1) merga, 2) klicka "Aktivera SMS-mottagning"
  i admin (engångs), 3) TESTA: SMS:a RING till 010-numret från egen mobil och
  verifiera autosvar + notis + inkorg, 4) kör första kampanjvågen.
- **Not till Codex:** sms_url sätts via API på numret — rör inte voice_start.
  Optout-storen `sms-optout` MÅSTE respekteras av alla framtida SMS-flöden.
- **Rörde INTE:** case-status/status/startsida/book-online, voice-simple.

### 2026-07-13 — Claude Code — KLAR (ringstatistik 30 dgr + bugg-transparent massutskick)

- **Branch:** `feat/call-stats-bug-notice` → PR mot `main`.
- **Ringstatistik (`call-dashboard.mjs` + admin):** GET-svaret har nytt
  `stats`-objekt över HELA 30-dagarsfönstret: totalt/besvarade/röstbrevlåda/
  missade/svarsgrad, unika nummer, "aldrig nådda" och "aldrig nådda utan
  kundkort" + per-dag-serie. Admin renderar 8 statkort + dagtabell (14 dgr,
  röda rader när missade > besvarade) under Live samtalsdashboard.
  Viktigt: röstbrevlåda räknas INTE som besvarat — kunden nådde inte fram.
  `emptyCallDashboard` returnerar `stats: null`; admin hanterar det.
- **Utskickstexterna (`send_status_link`):** omskrivna enligt Sebastians
  order — SMS + mail ber om ursäkt för telefonbuggen (600+ stoppade samtal
  senaste månaden, "felet låg hos tekniken, inte hos dig"), ger kundens
  servicenummer (Codex NEM-format, stor ruta i mailet), grön CTA till
  statussidan, förklarar Begär statusuppdatering-knappen + telefonpolicyn.
  **Codex mekanik orörd:** `reserveServiceNumber(...)`, `serviceNumber`,
  `?service=`-länk och idempotens exakt som i 978b31f.
- **Adminpanelen "Servicelänk-utrullning":** ny rubrik + beskrivning av de
  3 budskapen, och en `<details>` som visar exakt SMS-text + mailinnehåll så
  Sebastian läser innan han klickar Skicka.
- **Tester:** node --check ×2 ✅, admin inline-JS 0 fel ✅, build + checkout
  (38) ✅, `node --test` 7/7 ✅ (service-number + voice-simple), callflow
  tsc ✅, browsertest: statkorten/dagtabellen/röda rader/tom-läge renderar
  korrekt med fixturdata ✅. Inga SMS/mail skickade — utrullningen är
  Sebastians knapptryck i admin.
- **Rörde INTE:** `case-status.mjs`, `status/index.html`, startsida,
  `book-online/`, `voice-simple.mjs` (Codex områden).
- **TILLÄGG (samma dag, samma branch):**
  1. **Verifierad samtalsdata (30 dgr, live via /api/call-dashboard i
     Sebastians session):** 394 samtal, endast 11 besvarade (2,8 %).
     **Sista besvarade samtal: 2026-06-27 20:00** — matchar exakt
     incidentdatumet 06-28 i `docs/46elks-voice-fallback.md`
     (VOICE_WEBHOOK_SECRET-503:an). Därefter 0 besvarade av ~215.
     82 unika nummer, 73 aldrig nådda (51 utan kundkort, 22 med).
     46elks egna dashboard kräver inloggning som saknas i Claude-profilen —
     siffrorna ovan är samma API-källa som deras dashboard.
  2. **Statistik-bugg fixad i egna PR:n:** `isAnswered` räknade bara
     workshop/sebastian — men VOICE_*-env är inte satta i Netlify så ALLA
     besvarade samtal klassas "other". Nu räknas other som besvarat.
     OBS till Codex: sätt VOICE_WORKSHOP_PHONE/VOICE_SEBASTIAN_PHONE i
     Netlify så attribution per person fungerar igen.
  3. **Kampanjpanelen har vågutskick:** nytt fält "Max antal denna sändning"
     (default 25) — skickar N, resten kvar till nästa dag; followed_up-
     dubblettskyddet gör att ombyggd lista automatiskt exkluderar redan
     skickade. Browsertestat (2 av 5 + avbryt rör inget).
  4. **VIKTIGT OTESTAT:** inga besvarade samtal syns i datan efter
     voice-fixen (senaste datarad 07-12). Sebastian MÅSTE provringa numret
     innan massutskicken — de kommer generera återuppringningar.

### 2026-07-13 08:34 CEST — Codex — KLAR (publik servicestatus-sökning + skyltning)

- **Branch/commit:** `feat/status-lookup-entry`, feature-commit `978b31f`.
- **Gjorde:** Ersatte det förutsägbara datum/minut-baserade servicenumret med
  kryptografiskt slumpade 48-bitars koder i formatet
  `NEM-A1B2-C3D4-E5F6`. Koderna lagras på ärendet och i separat Blob-index.
  `/api/case-status/:id` kan nu slå upp säker servicekod med IP-baserad
  sökbegränsning; äldre fullständiga länkar fortsätter fungera.
- **Kundflöde:** `/status/` har sökformulär, normalisering och generiska
  felmeddelanden. Nya bokningar och `send_status_link` använder samma kod och
  länkar via `?service=`. Gamla aktiva ärenden får koden atomiskt när
  servicelänken skickas.
- **Skyltning:** "Följ reparation" finns i startsidans nav, första vy,
  egen sektion och footer samt på bokningssidans header, hero och bekräftelselöfte.
- **Filer/områden:** `_shared/service-number.mjs`, `case-status.mjs`,
  `booking.mjs`, minimal nödvändig ändring i `workshop-cases.mjs`,
  `status/index.html`, startsida, bokningssida och tester. Rörde INTE
  `call-dashboard.mjs`, ringstatistik eller kampanjutskickets adminmotor.
- **Tester:** 7/7 kritiska Node-tester, `npm run build`, checkout-verifiering,
  callflow TypeScript-check och inline-JS-syntax gröna. Browser-QA 1440x900 och
  390x844 för status/start/bokning; sidledsöverflöd korrigerat. Inga SMS/mail.
- **Överlämning till utskicksagent:** rebase på denna ändring innan aktiv-
  kund-utskicket. Behåll `reserveServiceNumber(...)`, `serviceNumber` och
  länken `?service=` i `send_status_link`; kampanjtexten kan ändras runt dem.
  Skicka inte gamla `shortCaseId(...).slice(0, 18)` som kundnummer.

### 2026-07-13 — Claude Code — KLAR (statusportal för kunder + servicelänk-utrullning)

- **Branch:** `feat/status-portal` → PR mot `main`.
- **NY publik funktion `case-status.mjs`** (`/api/case-status/:id`): GET =
  kundvänlig status (ENDAST förnamn/modell/steg/datum — aldrig efternamn,
  telefon, mail, priser); ärende-ID = kapabilitetsnyckel. POST
  `request_update` = kund begär statusuppdatering → SMS till Sebastian
  (SEBASTIAN_SMS_TO/WORKSHOP_SMS_TO) + timeline-notis; spärr 1 per 12h/ärende
  (statusUpdateRequestedAt på caset). Lätt rate limit in-memory.
- **NY sida `/status/?id=`** — stegvisare (Mottagen→Inlämnad→Felsökning→
  Repareras→Klar för hämtning→Utlämnad), kontextnoteringar (väntar del/svar/
  klar+betalning vid hämtning), Begär uppdatering-knapp, noindex,
  telefonpolicy-text ("telefonen för bokningar").
- **booking.mjs:** bekräftelse-SMS + kundmail innehåller nu servicelänken +
  servicenummer + policytext. OBS: fångade egen bugg innan commit —
  statusLink refererade odefinierad SITE_URL (hade kraschat varje bokning);
  nu env-baserad.
- **workshop-cases.mjs:** NY action `send_status_link` — skickar SMS + snyggt
  mail med länken till ett ärendes kund; idempotent via
  notifications.statusLink (force-flagga finns), timeline-loggas.
- **Admin: NY panel "Servicelänk-utrullning"** — bygger lista över aktiva
  ärenden (checked_in/diagnosing/repairing/waiting_parts/waiting_customer/
  ready) med kontaktväg, hoppar redan-skickade, förhandsvisning, sekventiell
  livesändning med progress/felrapport.
- **Tester:** node --check ×3 ✅, inline-JS 0 fel ✅, build/verify (38) ✅,
  callflow ✅, browsertest: statussidan renderar stegvisare/notering/knapp
  korrekt (skärmdump verifierad) ✅, utrullningslistan filtrerar rätt
  (aktiva med kontakt in; redan skickade/nya leads/utan kontakt ut) ✅.
- **Nästa (beslutat av Sebastian, EJ byggt än):** winback v2 — unika
  WIN-koder, vågutskick maxantal/dag, "SMS:a RING till 010-138 54 98"-
  mottagare (46elks sms_url-webhook), kvällslista i dashboarden.
- **Varning till Codex:** /api/case-status är PUBLIK by design — lägg ALDRIG
  till fler fält i GET-svaret utan PII-granskning.

### 2026-07-13 — Claude Code — KLAR (kampanjutskick ring-tillbaka-rabatt + 46elks-paginering 30 dgr)

- **Branch:** `feat/callback-campaign` → PR mot `main`.
- **Sebastians beslut:** massutskick till alla unika nummer som ringt senaste
  30 dagarna — 20 % rabatt, kod RING20, giltig 14 dagar.
- **Backend (`call-dashboard.mjs`):** fetchCalls paginerar nu 46elks (100/
  sida, följer `next`, max 12 sidor) med 30-dagarsfönster — tidigare hämtades
  BARA senaste 100 samtalen oavsett datum (därav "100" i räknaren).
- **Admin: ny panel "Kampanjutskick"** under Live samtalsdashboard:
  1) "Bygg mottagarlista" → unika nummer 30 dgr med antal samtal/senaste/
  status; filtrerar automatiskt bort redan kontaktade (followup/lead
  followed_up/converted/ignored) och nummer med AKTIVT ärende (checkbox för
  att inkludera). 2) Redigerbart SMS (förifyllt med RING20 + dynamiskt
  t.o.m.-datum + STOPP-rad); koden läses ur texten. 3) Skicka-knapp med
  antal + confirm; sekventiell sändning via befintliga send_discount-action
  → loggas per nummer i call-followups + lead followed_up (= dubblettskydd
  vid nästa kampanj). Progress + felrapport per nummer.
- **Tester:** node --check ✅, inline-JS 0 fel ✅, build/verify (38) ✅,
  browsertest med fixtures: dedup (2 samtal → 1 mottagare "2 samtal"),
  redan-kontaktad + aktivt ärende bortfiltrerade, avslutat ärende med,
  knapp/preview korrekta ✅. Ingen liveskickning testad (kräver Sebastian).
- **Varning till Codex:** send_discount-actionen är kampanjens motor — ändra
  inte utan att uppdatera kampanjpanelen; followed_up-statusen är
  dubblettskyddet mellan utskick.

### 2026-07-13 — Claude Code — KLAR (ärliga adminsiffror: fakturera/stale-logik, klickbara KPI:er, unika missade samtal, Arkivera-snabbknapp)

- **Branch:** `fix/honest-admin-metrics` → PR mot `main`.
- **Bakgrund (Sebastian):** "Gör nu 87 / Risk 73 / Fakturera 42" var brus —
  omöjligt att tolka, varje bokning flaggades "ska faktureras".
- **Rotorsaker fixade:** (1) `isReadyForBilling`: `hasAmount` var true även
  för payment.amount=0 → VARJE bokning/lead flaggades. Nu krävs belopp >0
  eller status ready/invoice_ready, och new/contacted exkluderas helt.
  (2) `isCaseStale` gällde alla statusar → varje lead äldre än 48h blev
  "stått stilla". Nu endast pågående arbete (checked_in/diagnosing/
  repairing/waiting_parts/ready).
- **Nytt UI:** alla 8 KPI-rutor i översikten är knappar — klick filtrerar
  ärendelistan till exakt de ärendena (chip "Visar: X (N)" + klick släpper);
  title-tooltips på allt + <details>-legend "Vad betyder siffrorna?".
  Kontrolltornets 7 rutor har definitions-tooltips.
- **Missade samtal:** dedupliceras per telefonnummer; räknaren = UNIKA nummer
  UTAN kundkort (7 dgr, 46elks live); kända kunder listas separat; källrad
  förklarar exakt vad som räknas; "N försök" per nummer.
- **Arkivera-snabbknapp** på kundkorten (bredvid Kontaktad/Väntar svar/
  Inlämnad) med confirm — stänger tyst; quick-status skickar numera alltid
  suppressThankYou som bälte.
- **Tester:** inline-JS 0 fel ✅, build/verify (38) ✅, browsertest med
  fixtures: readyBilling flaggar INTE ny bokning ✅, stale gäller ej
  waiting_customer/new ✅, filterklick + chip ✅, dedup 4 samtal → 2 unika
  utan kundkort + "2 försök" ✅.
### 2026-07-12 — Claude Code — KLAR (NEMOB OS V1 — PR #99 öppen)

- **Branch/PR:** `feat/nemob-os-v1` → PR #99 mot `main` (öppen, ej mergad).
- **Resultat:** komplett lokal ops-dashboard i `nemob-os/` (noll beroenden):
  dagsplan med topp 5 + motivering, uppgifts-CRUD med blockeringsorsak,
  prioriteringsmotor, morgon/mittdag/kväll-uppföljning, filbaserad persistens.
  Nordic endast read-only via env `NORDIC_BRIEF_URL` (aldrig i kod/logg).
- **Utanför mappen (allt i PR:en):** netlify.toml 404-blockerar `/nemob-os/*`,
  .gitignore för `nemob-os/data` + `.env`, npm-scripts `nemob-os` och
  `test:nemob-os`, launch-konfig.
- **Tester:** `node --test` 24/24 ✅, `npm run build` ✅,
  `verify:checkout-products` (38) ✅, manuellt 14-stegs sluttest i browser ✅
  (persistens efter omladdning, nere-simulering, 0 non-GET mot källan).
- **Till andra agenter:** `nemob-os/`-namnrymden är tagen. Stashes
  stash@{0,1} orörda. Sebastian: sätt `NORDIC_BRIEF_URL` i `nemob-os/.env`
  efter merge (se `nemob-os/.env.example`).

### 2026-07-12 — Claude Code — PÅGÅR (NEMOB OS V1 — personlig ops-dashboard i ny mapp `nemob-os/`)

- **Branch:** `feat/nemob-os-v1`.
- **Omfattning:** HELT ny, fristående mapp `nemob-os/` (lokal Node-server +
  statisk dashboard). Rör INTE befintliga funktioner eller sidor. Enda
  ändringar utanför mappen: `.gitignore` (nemob-os/data + .env) och
  `netlify.toml` (404-blockering av `/nemob-os/*` så mappen aldrig serveras
  publikt — publish är ".").
- **Nordic-integration:** endast read-only GET mot befintliga
  claude-brief-endpointen via privat env `NORDIC_BRIEF_URL`. Inga writes,
  inga SMS/mail, ingen slug i kod/logg/docs.
- **Till andra agenter:** ta inte `nemob-os/`-namnrymden, rör inte
  branchen. Stashes stash@{0,1} lämnade orörda.

### 2026-07-10 — Claude Code — KLAR (bulk-städning av gamla ärenden i produktion — DATA, ingen kod)

- **Vad:** 57 ärenden med status new/contacted äldre än 30 dagar arkiverades
  (status `archived` + `suppressThankYou` + timeline-notis "Bulk-städning
  2026-07-10 (godkänd av Sebastian)"). Kördes via Sebastians inloggade
  admin-session (Chrome), 29+28 i två omgångar, **57/57 OK, 0 fel**.
  Öppna ärenden: 157 → 100. Inga mail/SMS skickades (archived triggar aldrig
  utskick + suppress-flaggan som bälte), inget raderades.
- **MEDVETET EJ arkiverade:** de 21 "ready"-ärendena äldre än 30 dgr —
  Sebastian vill gå igenom dem själv innan de stängs (sannolikt hämtade &
  betalda men aldrig stängda). Lista finns i drift-trådens transkript.
- **Varning till Codex:** rör inte de arkiverade ärendena tillbaka till
  aktiva statusar utan Sebastians ord; suppressed-tackmail är permanent.

### 2026-07-10 — Claude Code — KLAR (live missade samtal i Kontrolltornet + snabbare call-dashboard)

- **Branch:** `fix/live-missed-calls-and-dashboard-speed` → PR mot `main`.
- **Problem (Sebastian):** "vi får inte live data eller missade samtal från
  46elks". Rotorsak 1: Kontrolltornets "Missade samtal" läste ALDRIG live-
  källan — bara manuella konsolen/tomma call_logs-storen; 46elks-datan fanns
  enbart i separata Samtal-vyn. Rotorsak 2: call-dashboard läste 150+ case-
  blobbar SEKVENTIELLT → 17–21 s per anrop (Netlify-loggen, 4 anrop/7 dgr).
- **Fix:** 1) `call-dashboard.mjs`: readBlobsParallel (chunk 25) för cases +
  blob-maps → förväntat ~2–3 s. 2) `admin/index.html`: Kontrolltorn-refresh
  anropar nu även loadCallDashboard och renderar missade/röstmeddelanden
  (senaste 7 dgr, live 46elks) i aiMissedCallsList — klickbara mot kundkort
  (contact-tab) när numret matchar case, annars "case-id saknas". Räknaren
  uppdateras från live-datan.
- **Tester:** node --check ✅, admin inline-JS 0 fel ✅, build/verify (38) ✅.
  Live-test kräver admin-token (fanns inte i tillgänglig Chrome-profil) —
  Sebastian verifierar efter merge: Uppdatera AI-brief → missade samtal ska
  fyllas + Samtal-vyn uppdateras på sekunder i stället för ~20 s.
- **OBS kvarstår:** admin-token ej sparad i Claude-styrda Chrome-profilen →
  bulk-städningen av 78 gamla ärenden väntar fortfarande på det.

### 2026-07-05 — Claude Code — KLAR (NAVEE ST5 Max + ST3 tillagda)

- **Branch:** `feat/navee-st5-max-st3` → PR mot `main`.
- **Sebastians beslut:** lägg till båda från NAVEE-listan. ST5 Max 11 990 kr /
  611 € (NAVEE rek., marginal ~2 811 kr 29 %), ST3 8 990 kr / 452 €
  (~2 130 kr 30 %). Båda i-lager + checkout → 38 köpbara. Inga påhittade
  specs (serie-beskrivning tills NAVEE-material finns), inga bilder ännu —
  kör mirror-scriptet när bilder läggs in.
- **Tester:** products.json giltig ✅, build ✅, verify (38) ✅.

### 2026-07-05 — Claude Code — KLAR (NAVEE-inköpspriser + ST3 Pro säljbar + ny push-uppställning)

- **Branch:** `feat/navee-costs-and-push` (stackad på
  `fix/thankyou-confirm-and-new-prices` — merga den PR:en först/samtidigt).
- **Källa:** NAVEE:s officiella prislista (sell-in DDP) via Sebastian.
  Våra priser låg redan på MSRP — inga kundpriser ändrade.
- **Gjort:** 1) `costEur` på alla 9 NAVEE-modeller från listan (XT5 Ultra 915,
  NT5 Ultra X 727, XT5 Pro 646, NT5 Max 592, N65i 458, V50i Pro 340, G5 312,
  V25i Pro II 255, K100 Max 206). UT5 Ultra X saknas på listan — fråga NAVEE.
  2) ST3 Pro: 10 990 kr / 553 € → i-lager + checkout (36 köpbara), badge
  "NAVEE rek.". 3) XT5 Pro + NT5 Max: pa-vag → i-lager (nya produkter,
  leveransklara). 4) Startsidans "Populärast just nu": G2 Max + G4 Max ut,
  XT5 Ultra (+3 344 kr marg) + ST3 Pro (+2 598, 30 %) in. G4 SE kvar som
  trafikdrivare (medvetet, tunn marginal).
- **Ej gjort:** ST5 Max + ST3 (finns på listan, ej i katalogen) — väntar
  Sebastians besked; GT3 Max finns INTE på NAVEE-listan (fråga leverantören).
- **Tester:** products.json giltig ✅, build ✅, verify (36) ✅, costEur
  läcker inte till HTML ✅.
- **Varning till Codex:** popularOrder i generatorn är marginalstyrd nu —
  stäm av här innan ändring. Waves 2/3-brancherna rör samma generator →
  konflikter förväntas vid merge, lös mot denna ordning.

### 2026-07-05 — Claude Code — KLAR (tackmail-bekräftelse + tyst stängning + nya KuKirin-priser)

- **Branch:** `fix/thankyou-confirm-and-new-prices` → PR mot `main`.
- **Backend (`workshop-cases.mjs`):** (1) Tackmail triggas nu ENDAST vid
  övergången till done/paid — tidigare kunde varje senare PATCH (t.ex. en
  anteckning) på ett obetackat done/paid-ärende skicka mailet i efterhand.
  (2) NY flagga `suppressThankYou: true` i PATCH-body → tyst stängning;
  sätter `notifications.thankYou.status="suppressed"` PERMANENT (annars
  skulle nästa PATCH trigga) + timeline-notis. Failed-status beter sig som
  förut (kan skickas om vid ny övergång).
- **Admin:** bekräftelsedialog när status→Avslutad eller betalstatus→Betald
  (endast vid faktisk övergång och om tackmail inte redan skickats/tystats):
  OK=skicka, Avbryt→andra rutan: OK=spara tyst (suppressThankYou),
  Avbryt=ångra. Synliga hints vid status-/betalvalen ("Avslutad skickar
  tackmail — du får bekräfta först. Arkiverad skickar inget.").
- **Priser (Sebastians beslut):** A1 5 995 kampanj (marginal ~540 kr),
  G2 Pro 7 990 (~1 990), G2 Master 11 990 (~1 650), C1 Pro 26Ah 6 995 (~520)
  — alla i-lager + checkout:true (create-checkout läser priceSek direkt;
  verify räknar nu 35). costEur satt internt på alla fyra.
- **Tester:** node --check workshop-cases ✅, admin inline-JS 0 fel ✅,
  products.json giltig ✅, build + verify (35) ✅, callflow tsc ✅.
- **Varning till Codex:** suppressThankYou/suppressed-semantiken är medveten —
  återinför inte state-baserad trigger (spamfällan).
### 2026-07-05 — Claude Code — KLAR (Riktiga Google-citat + betygsrättelse 5.0→4,7)

- **Branch:** `feat/google-reviews-quotes` → PR mot `main` (öppen, ej mergad).
- **Källa:** Google Maps-profilen läst via Sebastians Chrome (tillägget) —
  riktiga recensioner, ordagrant citerade med publika profilnamn.
- **VIKTIG RÄTTELSE:** Faktiskt betyg är **4,7 (12 recensioner)** — INTE 5.0
  som sajten påstod i text + `aggregateRating`-schema. Rättat på ALLA 4 sidor
  med schemat: `index.html`, `book-online`, `elscooter-reparation-orebro`,
  `kontakt`. Text: "4,7 av 5 på Google (12 recensioner)".
- **Citat tillagda (verbatim-utdrag):** startsidan 3 citatkort vid
  betygsblocket (Adam Salih batteriräddning samma dag · Gabriel D punktering/
  service · Tommie Irvhage elfel+kommunikation); bokningssidan 1 citat
  (Tommie) direkt ovanför Boka-knappen. Responsiv CSS (.review-quotes,
  1 kolumn ≤900px).
- **BIFYND till Sebastian:** Google-profilen är INTE claimad ("Gör anspråk på
  företaget" visas publikt) — claima den omgående (Google Business Profile).
  Det är gratis, tar 10 min och är den enskilt största off-page-SEO-åtgärden
  (svara på recensioner, öppettider, bilder). Profilen visar även öppet till
  kl 20 — stämmer inte med inlämning tis–lör 15–18; uppdatera tiderna där
  efter claim.
- **Tester:** 0 kvarvarande "5.0"-claims (escapad grep) ✅, alla JSON-LD-block
  parsar ✅, build/verify (31) ✅, browserverifierat: 3 kort + rätt namn +
  rätt betygstext ✅.
- **Varning till Codex:** Citaten är ordagranna utdrag ur publika Google-
  recensioner — ändra inte formuleringarna (autenticitet). Betyget uppdateras
  manuellt vid förändring; överväg att hämta det dynamiskt först när profilen
  är claimad.

### 2026-07-05 — Claude Code — KLAR (CRO våg 3: katalogfilter, batterisida, bildspegel)

- **Branch:** `feat/wave3-filter-battery-images` → PR mot `main` (öppen, ej mergad).
- **A. Katalogfilter (generatorn):** märkesknappar (Alla/NAVEE/Teverun/KuKirin)
  + "Endast i lager"-toggle + live-räknare ("Visar X modeller"). Döljer även
  tomma sektioner (fighter-push/brand-sektioner). Räknaren dedupliceras på
  modellnamn (korten dubbleras över sektioner). **Prissortering medvetet
  utelämnad** — kräver avdubblad katalog (eget projekt).
  **Browserverifierat:** 37 → Teverun 13 → +i lager 7 → reset 37; NAVEE-
  sektionen göms korrekt; inga trasiga bilder.
- **B. Batterisidan (295→600 ord):** stale "Batteridiagnos 349 kr" i hero →
  745 kr (prislistans pris); +3 sektioner (Så går diagnosen till 4 steg,
  Priser 745/945/offert, Vanliga frågor 4 st); FAQPage-schema (5 frågor,
  validerad JSON); adress tillagd i Service-schemats provider. Allt innehåll
  grundat i befintliga tjänster/claims — inget påhittat.
- **C. Bildspegel:** NY `scripts/mirror-product-images.mjs` laddar ner alla
  34 unika leverantörsbilder → `assets/products/mirror/` (4,8 MB; Shopify
  hämtas i 800px från CDN). Karta i `data/product-image-mirror.json`.
  Generatorn serverar lokala kopior med leverantörs-URL som onerror-fallback
  — **0 hotlinkade src kvar** (89 lokala refs i katalogen, 12 på startsidan).
  Saknas spegelfil används hotlink som förut = inget kan gå sönder.
  Vid nya produktbilder: kör `node scripts/mirror-product-images.mjs` +
  `npm run generate:products` (idempotent, misslyckade nedladdningar = hotlink).
- **EJ gjort (medvetet):** riktig bokningskalender — stort separat bygge som
  kräver Sebastians aktiva beslut (booking.mjs + Google Calendar-tillgänglighet).
- **Tester:** generator OK + idempotent ✅, inline-JS 0 fel ✅, FAQ-schema
  giltig ✅, verify:checkout-products (31) ✅, build ✅, callflow ✅,
  browsersmoke av filter + bilder ✅.
- **Varning till Codex:** `assets/products/mirror/` + mirror-kartan ägs av
  mirror-scriptet — redigera inte för hand. Katalogens filter-JS ligger i
  generatorns inline-script (använd \` -escapning eller konkatenering, backticks
  bryter template-literalen).

### 2026-07-05 — Claude Code — KLAR (CRO våg 2: bokningsfriktion, Product-schema, bildhygien, logga)

- **Branch:** `feat/wave2-seo-perf-friction` → PR mot `main` (öppen, ej mergad).
- **Bokningsfriktion (book-online):** e-post inte längre required — server-
  verifierat att `booking.mjs` bara kräver namn+telefon (mejl blir
  `not_requested` utan adress); JS kräver e-post ENDAST om kunden valt "E-post
  först". Rabattkod bakom "Har du rabattkod?"-details (ingen kupongjakt).
  Stöldgods-texten mjukad ("För allas trygghet… mitt eller ägarens tillstånd").
  Trygghetsrad ovanför submit: "Fast pris bekräftas alltid innan arbete ·
  Ring 010-138 54 98".
- **Generator (`generate-products.mjs`):** (1) Product+Offer JSON-LD för alla
  31 prissatta produkter (id `product-catalog-schema`, samma datakälla som
  korten — pris/lager kan aldrig divergera; idempotent remove+insert).
  (2) Katalog-head: title "Köp elscooter i Örebro – NAVEE, Teverun, KuKirin"
  (62 tkn, transaktionellt först), ny description/keywords, og:-taggar
  (saknades helt), H1 "Köp elscooter i Örebro – direkt av verkstaden."
  (3) Bildhygien: width/height + decoding=async + onerror-fallback på alla
  kort-/tumnagelbilder; `sizedSrc()` begär width=200 (thumbs)/800 (kort) från
  Shopify-CDN i stället för originalen. (4) `bookingHref` + refurb-länk →
  trailing slash (dödar 301 på varje köpklick). (5) Mojibake i statusCopy/
  ctaText fixad (beställas/förfrågan/rådgivning/UTGÅTT/Fråga oss).
- **Logga:** 512px/345 KB → 256px/86 KB via System.Drawing, båda filnamnen
  överskrivna (logo.png + nordic_logo_transparent.png = inga HTML-ändringar;
  visas max 150px → 86 KB räcker för 1,7x retina). ~520 KB mindre per sidvisning.
- **EJ gjort (medvetet):** global prisgaranti-badge — Sebastian beslutade
  "endast Mini Blade Ultra"; auditens förslag ändrar inte det. Kundcitat för
  5.0-betyget väntar på riktiga recensioner från Sebastian.
- **Tester:** schema = giltig JSON (31 produkter, availability-mappning) ✅,
  0 kvarvarande `/book-online?` ✅, inline-JS 0 fel ✅, generator idempotent ✅,
  build/verify (31)/callflow ✅.
- **Varning till Codex:** `docs/NEMOB_OS_V1_PLAN.md` (otrackad) är INTE min —
  rör den inte, någon annans pågående arbete. Katalogens head/schema ägs nu av
  generatorn — redigera aldrig nya-elscootrar-head direkt i HTML.

### 2026-07-05 — Claude Code — KLAR (klickbara ärendekort i AI Kontrolltorn/brief)

- **Branch:** `fix/clickable-operational-brief-cards` → PR mot `main`.
- **Vad:** Alla sex operativa listor i AI Kontrolltorn (prioriteringar, risk,
  missade samtal, väntar reservdel, klara för betalning, sälj/intäktspotential)
  renderas nu som `<a href="/admin/?case=<id>&tab=<tab>">` med aria-label,
  hover-stil och "Öppna →"-hint. Tab-mappning: risk/prio/delar→overview,
  betalning→payment, missade samtal/sälj→contact (ingen parts-tab finns).
  Klick fångas och öppnar kortet in-page (setAdminView cards + filter +
  cardTabState + scroll + focus-flash) med history.replaceState; ctrl/cmd/
  mittenklick ger vanlig navigering. Poster utan case-id → oklickbar med
  "case-id saknas" (ingen krasch). Risktexten visar nu kund · modell · pris ·
  orsaker · "stått stilla X dagar" · "Nästa: <åtgärd>".
- **Refaktor:** focusInitialCase använder nya openCaseDeepLink(id,tab) —
  deep-link efter reload fungerar som förut men byter även till kortvyn.
- **Filer:** endast `admin/index.html`. Inga writes, inga SMS/mail, kundexport
  orörd, inga paneler borttagna.
- **Tester:** inline-JS 0 fel ✅, build ✅, verify:checkout-products ✅,
  callflow tsc ✅. Manuellt (lokal serve + injicerad testdata): riskklick→
  overview ✅, betalklick→payment ✅, säljklick→contact ✅, reload på
  ?case=&tab=contact → rätt kort+flik ✅, nätverkslogg = inga POST mot
  Nordic-API (endast befintlig GA-pageview) ✅.

### 2026-07-04 — Claude Code — KLAR (Inlämningstider tis–lör 15–18, mån+sön stängt)

- **Branch:** `fix/dropoff-hours` → PR mot `main` (öppen, ej mergad).
- **Beslut (Sebastian):** Inlämning endast tisdag–lördag kl 15–18 tills ny
  tekniker är rekryterad. Rekryteringen kommuniceras POSITIVT ("Vi växer — vi
  söker en tekniker"), INTE som personalbrist-ursäkt (samma princip som
  Förtroendepaketet: inga krissignaler i bokningsflödet).
- **Gjort:** `book-online/index.html`: `fillDayOptions` hoppar över söndag+
  måndag (28 dagars fönster → 20 valbara dagar), `fillTimeOptions` →
  15:00–18:00 (7 slots, gamla 09–20-arrayen borta). Hours-boxen visar
  "Inlämning: Tis–lör 15–18" + rekryteringsrad med kontakt-länk.
  `index.html`: tidsraden tillagd i högsäsongs-notisen.
- **Tester:** inline-JS 0 syntaxfel ✅, logiktest (0 sön/mån bland valbara
  dagar, tider 15:00–18:00) ✅, build ✅, verify:checkout-products (31) ✅.
- **OBS:** Ingen server-side tidsspärr finns i `booking.mjs` (kalendern kollar
  bara krockar) — formulärspärren räcker nu, men en direkt-POST kan ange annan
  tid; admin ser och bekräftar ändå varje bokning manuellt.
- **Varning till Codex:** Tidsreglerna ligger i `fillDayOptions`/
  `fillTimeOptions` i book-online — ändra inte utan Sebastians beslut. När ny
  tekniker är på plats: återställ tider + ta bort rekryteringsraden.

### 2026-07-04 — Claude Code — KLAR (CRO Förtroendepaketet: startsida + bokningssida)

- **Branch:** `fix/cro-trust-package` → PR mot `main` (öppen, ej mergad).
- **Bakgrund:** Full UX/CRO/SEO-audit (2 agenter + prestandamätning). Största
  fyndet: sajten ber om ursäkt innan den säljer — krisnotiser som sektion 2 på
  startsidan OCH före bokningsformuläret, prismotsägelser, obelagt 5.0-betyg,
  intern jargong synlig för kund.
- **Gjort (index.html + book-online/index.html, ENDAST text/HTML — inga
  funktioner, inga generated-block):**
  1. Krisnotiserna → lugn rad ("Högsäsong — boka tid så prioriteras du");
     batterisäkerhetsraden BEHÅLLEN på bokningssidan. "under uppbyggnadsfasen"
     och "teknisk åtkomststörning" borta överallt.
  2. Klickbar telefon i desktop-nav (`nav-phone`, döljs på mobil där hamburgare
     + sticky redan har tel).
  3. Prisfixar: batteri-CTA:er 349→745 kr (= prislistans "Batterifelsökning
     grund"); dubblettraden "Hämtning enligt tabell fr. 349" borttagen (199 kr-
     raden i Extra tjänster + kampanjstrip är nu enda priset). **OBS Sebastian:
     bekräfta 745 resp. 199 — annars justera i PR:en.**
  4. "Se lediga tider" (falskt livetids-löfte) → "Boka tid" överallt.
  5. Intern jargong bort: "lättare för Google", "ärende i dashboarden",
     "Bättre Google-signaler", "speglas mot interna prisdatabasen" → kundspråk.
  6. "5.0 på Google" länkar nu till Google-recensionssökningen (samma URL-
     mönster som backend REVIEW_LINK). "Drop-in eller bokning" → "Bokning —
     drop-in i mån av tid" (konsistens).
  7. Emoji-bloggtumnaglar → riktiga verkstads-/showroombilder; partner-
     brickorna läsbarare (#555→#9aa39c). Oanvänd hero-preload borttagen från
     bokningssidan.
- **Tester:** `npm run build` (generatorn: "No HTML changes needed" — inga
  generated-block rörda) ✅, `verify:checkout-products` (31) ✅, 0 kvarvarande
  "lediga tider"/"uppbyggnadsfasen"/"åtkomststörning" ✅, bloggbilderna finns ✅.
- **Nästa (från audit, ej i denna PR):** formulärfriktion (e-post valfri vid
  "Ring mig" — kräver booking.mjs-verifiering), Product JSON-LD + bildhygien i
  generatorn, logga 2×353KB→1×~30KB, katalog-title/filter.
- **Varning till Codex:** Rör inte `fix/cro-trust-package`. Om du ändrar
  startsidans notis/pris-sektioner — koordinera här först.

### 2026-07-03 — Claude Code — KLAR (SEO runda 2: elsparkcykel-landningssida + punktering-FAQ)

- **Mål:** #1 på "elsparkcykel"-sökord (var topp-10) och "punktering elscooter
  Örebro" (var #2). 5 nya försök beslutade av Sebastian efter runda 1.
- **Gjort:** 1) NY landningssida `/laga-elsparkcykel-orebro/` (unik copy,
  Service/Breadcrumb/FAQPage-schema, semantisk brygga "elsparkcykel = elscooter");
  2) punkteringssidan: FAQ-sektion + FAQPage-schema + punkteringsfria
  däck-innehåll (konkurrenten på #1 är en däcksida); 3) intern länkning:
  startsidans seo-cards + footer, relaterade tjänster på reparation- och
  punkteringssidorna; 4) sitemap: ny sida + lastmod 2026-07-03; 5) verifiering.
- **Tester:** build ✅, verify:checkout-products ✅, JSON-LD giltig (3+3 block)
  ✅, browserkontroll av båda sidorna ✅ (title/H1/FAQ/länkar/inga trasiga bilder).
- **Obs:** claude-brief-endpointen mergades till main via PR #88 (låg i samma
  branch-historik) — Netlify env `CLAUDE_BRIEF_SLUG` måste sättas av Sebastian.

### 2026-07-03 — Claude Code — KLAR (Safe timeline writes — lost update-risken täppt)

- **Branch:** `fix/safe-case-timeline-writes` → PR mot `main` (öppen, ej mergad).
- **Problemet (HIGH från audit runda 2):** `appendCaseEvent` i
  `_shared/storage.js` läste hela case-blobben (eventual consistency = kan vara
  INAKTUELL), pushade timeline och skrev tillbaka HELA blobben →
  en samtidig/nyss gjord PATCH (status/betalning) kunde tyst återställas.
- **Vald design (Sebastians preferens 1):** appendCaseEvent skriver ALDRIG mer
  case-blobben — events lever enbart i separata `case-events`-storen.
  Motivering: (a) admin läser redan case-events som primär timeline-källa
  (case.timeline är bara fallback), (b) workshop-vyn använder inte timeline
  alls, (c) @netlify/blobs 8.2.0 saknar conditional writes (`onlyIfMatch`
  finns inte) så etag-strategi är omöjlig utan lib-uppgradering, (d) embedden
  från v1-funktioner har bara fungerat sedan 2026-06-30 (connectLambda-fixen)
  — inget beror på den. `workshop-cases.mjs` (v2) fortsätter embedda i sina
  EGNA single-request-writes — orört och säkert.
- **Filer:** `netlify/functions/_shared/storage.js` (RMW-blocket + oanvända
  `timelineText` borttagna), NY `scripts/smoke-safe-timeline.mjs`.
- **Tester:** smoke 5/5 PASS (status+payment kvar efter event, case-blob
  byte-identisk, event i case-events) ✅, `node --check` storage + alla 7
  callers ✅, build/verify/callflow ✅. Inga SMS/mail/production-writes.
- **Kvarstående (acceptabel) risk:** case-events blir enda källan för
  v1-genererade händelser; admin-fallbacken visar dem inte om case-events-
  endpointen är nere (samma läge som innan 30 juni). `updatedAt` bumpas inte
  längre av events (sorteringspåverkan marginell).
- **Varning till Codex:** Rör inte `fix/safe-case-timeline-writes`. Återinför
  ALDRIG case-blob-skrivning i appendCaseEvent — se kommentaren i storage.js.

### 2026-07-03 — Claude Code — KLAR (read-only briefing-endpoint /api/claude-brief/:slug)

- **Branch:** `main`. NY fil: `netlify/functions/claude-brief.mjs` (v2, inget annat rört).
- **Beteende:** GET `/api/claude-brief/:slug`; slug timing-safe mot env
  `CLAUDE_BRIEF_SLUG` (kräver ≥48 tecken). Fel slug ELLER saknad env → 404
  (aldrig 401 — endpointen ska inte gå att skilja från icke-existerande sida).
  60 req/h rate limit (medvetet in-memory per varm instans: endpointen får inte
  göra writes, så Blobs-räknare var uteslutet). Läser endast `workshop-cases`.
- **Svar:** generated_at, todays_bookings (time/first_name/vehicle/case_type/
  status), open_jobs (id/vehicle/status/days_open), overdue_offers_count
  (contacted/waiting_customer med pris, >3 dygn utan uppdatering),
  unpaid_invoices_count (payment.status=invoiced), week_revenue_sek (paid
  senaste 7 dygn), new_bookings_since_yesterday (channel != internal, skapade
  igår/idag Stockholm-tid). INGEN PII: endast förnamn, inga telefon/mail/
  adresser/betaldetaljer.
- **Tester:** fixture-test (aggregation + PII-läckagekontroll + 404/405/429)
  ✅, `npm run build` ✅, `verify:checkout-products` ✅.
- **Kräver:** Netlify env `CLAUDE_BRIEF_SLUG` (64-teckens slug genererad och
  lämnad till Sebastian, ej i repot). Utan env svarar endpointen 404 = safe
  not_configured-läge.

### 2026-07-02 — Claude Code — KLAR (produktstruktur: hjälm bort, G4-kostnad, populärast, begagnat/NEMOB Edition)

- **Branch:** `main`, commit `570a59d`. Filer: `data/products.json`,
  `scripts/generate-products.mjs`, `index.html`, `nya-elscootrar/index.html`,
  `sitemap.xml`, `docs/codex-handoff.md`, `.claude/launch.json` (ny, preview).
- **Gjort:** 1) HJÄLM-KAMPANJEN BORTTAGEN överallt — säg aldrig att hjälm ingår
  (endast rekommendation kvar). 2) G4 inköp 683 EUR internt (`costEur`, renderas
  ALDRIG publikt) + `needsPriceReview: true` — 9 950 kr ger nära noll marginal,
  PRIS MÅSTE SES ÖVER. 3) Startsidan: "Populärast just nu" med 6 större kort +
  badges + trust-rad. 4) 6 nya modeller utan pris (`checkout: false`, CTA
  "Kontakta oss för pris"): KuKirin G2 Master/G2 Pro/A1/C1 Pro 26Ah, NAVEE
  GT3 Max/ST3 Pro — inga bilder ännu (fallback verkstadsbild), inga påhittade
  specs/priser. 5) Ny `refurbished`-array i products.json + sektion
  "Begagnat, renoverat & NEMOB Edition" (`#begagnat-renoverat`) på utbudssidan.
  6) Dualtron Eagle Pro NEMOB Edition som kommande renovering — Storm
  Limited-motor och 72V-konvertering är UNDER UTVÄRDERING, ej installerade.
  7) Juridisk notis för custombyggen på båda sidorna.
- **Tester:** `npm run build` ✅ (idempotent), `verify:checkout-products` ✅
  (31 köpbara oförändrat), `nemob-callflow npm run check` ✅, browserkontroll
  via lokal preview ✅ (badges, CTA:er, begagnat-sektion, 0 hjälm-löften).
- **Varning till Codex:** costEur i products.json är internt inköpspris —
  exponera aldrig i genererad HTML. Nya modeller får inte ges checkout: true
  utan Stripe-produkt + pris.

### 2026-07-02 — Claude Code — KLAR (Teverun-sortiment +7 modeller & prisgaranti Mini Blade Ultra)

- **Branch:** `feat/teverun-range-prisgaranti` → PR mot `main` (öppen, ej mergad).
- **Bakgrund:** Sebastian delade Teveruns grossistlista (EUR, SRP/nettopris/
  lagerstatus). Beslut: INGEN rabattkampanj på Mini Blade Ultra (skyddar kunden
  som nyss betalade ~19k) — i stället **prisgaranti på endast den modellen**.
- **Gjorde (data/products.json → generator):**
  - **Prisgaranti** på `teverun-blade-mini-ultra`: badge "Prisgaranti" + villkor
    i short (svensk auktoriserad återförsäljare, före köp, med länk). Pris
    oförändrat 17 990.
  - **+7 nya Teverun-modeller** (24→31 produkter, Teverun 6→13): Blade Mini Pro
    14 990 (pa-vag juli) · Blade Mini Pro eKFV 15 490 (i-lager) · Blade Mini
    Ultra eKFV 19 990 (pa-vag) · Blade GT+ II 28 990 (pa-vag) · Fighter Mini
    23 990 (i-lager, fåtal) · Fighter Mini Pro 26 990 (pa-vag) · Fighter Supreme
    Ultra 49 990 (beställningsvara). Priser satta enligt husets befintliga
    EUR→SEK-kurva (13–15x SRP); marginaler 4 700–12 000 kr/st mot nettopriser.
    Bilder hotlänkas från teverun-europe.com (etablerat mönster).
  - **Lagerkorrigeringar:** Space Lite slut hos Teverun → `pa-vag`;
    Fighter Eleven+ "fåtal kvar hos leverantören" i delivery-texten.
- **Tester:** `generate:products` (31 produkter) ✅, `verify:checkout-products`
  (31 verifierade) ✅, `npm run build` ✅.
- **OBS till Sebastian:** priserna på de 7 nya är mina förslag enligt er
  priskurva — justera gärna i PR:en innan merge.
- **Varning till Codex:** Rör inte `feat/teverun-range-prisgaranti` eller
  `data/products.json` förrän PR:en är mergad.

### 2026-07-02 — Claude Code — KLAR (SEO: on-page-förbättringar elscooter-sökord Örebro)

- **Branch:** `main`, commit `bc4e60f`. Endast statiska sidor + sitemap, ingen
  funktions- eller datakod.
- **Gjorde (5 försök):** 1) synonymen "elsparkcykel" i description/keywords/
  brödtext på startsida, reparation, punktering, batteri; 2) FAQ-sektion +
  FAQPage-schema på `/elscooter-reparation-orebro/`; 3) Service-schema fixat
  (svenska namn med Ö, `alternateName` elsparkcykel, svensk `serviceType`) +
  sitemap `lastmod` 2026-07-02; 4) startsidans H1 innehåller nu
  "elscooter" + "Örebro"; 5) verifiering.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅,
  alla JSON-LD-block på ändrade sidor parsar som giltig JSON ✅.
- **Kvarvarande risk/nästa:** off-page (Google Business Profile, recensioner,
  lokala länkar) styr lokal ranking mest — kan inte göras i repot. FAQ-schema
  ger sällan rich results för kommersiella sajter numera men skadar inte.

### 2026-07-01 — Claude Code — KLAR (Audit runda 2: buggfixar efter full genomgång)

- **Branch:** `fix/audit-round2-hardening` → PR mot `main` (öppen, ej mergad).
- **Bakgrund:** Full trippel-audit (backend, admin-frontend, säkerhet). Säkerhet:
  ALLA 8 tidigare fynd verifierade FIXADE (case-media IDOR, voice-secrets,
  Stripe-webhook, booking honeypot/rate-limit, env-status auth, timing-safe
  tokens, Origin-allowlist, privata nummer borta). Denna PR täpper nya fynd:
- **Fixat (admin/index.html):** (1) AI-svarsförslag skickade
  `missed_call_followup` för vanliga bokningar → ursäkts-SMS för samtal som
  aldrig fanns; nu `simple_status` för icke-chat. (2) Styrknappar ("Kortare"
  m.fl.) skickar nu nuvarande utkast som kontext så AI:n faktiskt justerar
  texten i rutan. (3) Styrknappar disablas under generering (race).
  (4) Mojibake fixad (`fÃ¶r`→`för` m.fl.) i samtalslead-dialoger/notes.
- **Fixat (service-worker.js):** cache-first gäller nu ENDAST shell-filerna;
  övriga assets (analytics.js, manifest) går direkt till nätet. Offline-fallback
  nycklas på pathname så `/admin/?case=X`-djuplänkar funkar och cachen inte
  växer per query. `CACHE_NAME` v4→v5.
- **Fixat (functions):** `ai-sms-draft`: aiPreview med försvunnet case → 404
  (inte tyst utkast utan kontext) + `aiPreview` echo:as i svaret.
  `workshop-cases.mjs`: Resend-fel i tackmail förlorar inte längre hela
  PATCH:en (try/catch + failed-status + timeline-notis); trasig JSON → 400.
  `ai-daily-brief`: timeout (10s) på intern `/api/cases`-fetch.
  `ai-quote`: OpenAI-resultatet mergas nu (konservativt — AI kan aldrig sänka
  under prisregelns golv); tidigare kastades det (död AI-kostnad).
- **Tester:** `node --check` 5 filer ✅, inline-JS 0 fel ✅, lokala smokes
  (aiPreview+missing→404, echo, dryRun, quote-merge) ✅, build/verify/callflow ✅.
- **KVARSTÅENDE (dokumenterat, ej fixat här):** (a) HIGH: `appendCaseEvent`
  read-modify-write på hela case-blobben med eventual consistency kan tappa
  parallella PATCH-uppdateringar — behöver designbeslut (ETag-conditional
  writes eller timeline-on-read). (b) admin-token i localStorage (MVP-känt).
  (c) call-dashboard POST saknar try/catch; 46elks-fetch endast första sidan.
  (d) 6 duplicerade funktionsdeklarationer i admin (döda kopior).
  (e) render() på varje tangenttryck tappar osparade formulär.
- **Varning till Codex:** Rör inte `fix/audit-round2-hardening`. Ta gärna (d)
  duplicerade deklarationer som separat städ-PR — koordinera här.

### 2026-06-30 — Claude Code — KLAR (PR 2: admin litar på riktig 46elks-samtalskälla)

- **Branch:** `fix/admin-call-source-46elks` → PR mot `main` (öppen, ej mergad).
- **Insikt:** Den riktiga samtalskällan är `/api/call-dashboard` (`call-dashboard.mjs`,
  v2) som hämtar LIVE från 46elks (`api.46elks.com/a1/calls`), matchar mot
  `/api/cases` och räknar missade/besvarade. Ingen Cloudflare D1-proxy behövdes —
  D1 i `nemob-callflow` är Workerns egen IVR-logg, inte admins källa.
- **Buggen:** Admin gatade på en separat `call-logs`-probe mot den **tomma**
  Blob-storen `call-logs` (manuell fallback) INNAN den anropade den riktiga
  46elks-dashboarden → visade alltid "Ej kopplad" även när 46elks fanns.
- **Gjorde:** Tog bort `checkCallLogsSource`-proben i `loadCallDashboard`; admin
  litar nu på `call-dashboard`s egen `sourceUnavailable` (som speglar 46elks).
  Tog bort den oanvända `checkCallLogsSource`-funktionen.
- **Filer:** `admin/index.html`. Ingen datakod, inga writes.
- **Tester:** inline-JS 0 fel ✅, build/verify ✅.
- **Beroende:** Kräver `ELKS_USERNAME`/`ELKS_PASSWORD` i Netlify (samma som SMS).
  Saknas de → call-dashboard returnerar `sourceUnavailable` → admin visar ärligt
  "Ej kopplad". Manuell call-log (`call-logs.js`) kvarstår som fallback.
- **Nästa:** PR 5 (morgonbrief — `ai-daily-brief` finns redan, ev. förbättring).
- **Varning till Codex:** Rör inte `fix/admin-call-source-46elks`.

### 2026-06-30 — Claude Code — KLAR (PR 1: operativ AI-svar i kontakt-tabben)

- **Branch:** `feat/admin-ai-reply` → PR mot `main` (öppen, ej mergad).
- **Bekräftat först:** Blobs-fundamentet är LIVE i production (storage-health v2,
  `blobsAvailable:true`; customer-export = 105 telefon + 66 e-post, 0 fel). Det
  som dolde det var SW-cachen (PR #82).
- **Gjorde (PR 1):** På befintliga `chat-reply`-formen i kundkortets kontakt-tabb:
  knapp **AI-svarsförslag** + styrknappar (Kortare / Mer ursäktande / Be kunden
  boka / Ge prisindikation) + två mallar (ny chatt / missat samtal). AI-förslag
  fyller textarean; befintlig "Kopiera svar" + "Skicka riktigt SMS-svar"
  (confirm → `send_sms` → timeline) oförändrade. Inga autosvar.
- **Backend:** La `aiPreview`-läge i `ai-sms-draft.js` — använder OpenAI men
  skriver INGET (så styrning kan itereras utan timeline-spam). Riktig sändning
  går separat via `send_sms`. Kräver `OPENAI_API_KEY` (Sebastian satte den);
  utan nyckel faller den tillbaka till deterministisk mall (graceful).
- **Filer:** `admin/index.html`, `netlify/functions/ai-sms-draft.js`.
- **Tester:** `node --check` ✅, admin inline-JS 0 fel ✅, lokal aiPreview-smoke
  (200, inga writes, references null) ✅, build/verify/callflow ✅.
- **Nästa:** PR 2 (call-log read-only proxy från Cloudflare D1), PR 5
  (morgonbrief). PR 4 i ChatGPT-planen är redan gjord i #79.
- **Varning till Codex:** Rör inte `feat/admin-ai-reply`. Om du ändrar
  `ai-sms-draft.js` eller `chat-reply`-formen i admin — koordinera här först.
### 2026-06-30 — Claude Code — KLAR (Service worker cachade function-svar)

- **Branch:** `fix/sw-no-cache-functions` → PR mot `main` (öppen, ej mergad).
- **VIKTIG INSIKT:** Deployen fungerar (Netlify visade `main@675ba35 Published`).
  Anledningen att production "körde gammal kod" var att **admin/service-worker.js
  cachade `/.netlify/functions/*`-svar cache-first** — den exkluderade `/api/`
  men inte `/.netlify/`. Därför var `/api/cases` färsk (131) men `storage-health`
  /`customer-export` infrusna på sina första (v1) svar i browsern.
- **Gjorde:** Skrev om SW:s fetch-handler: hanterar bara same-origin GET, cachar
  ALDRIG `/api/`- eller `/.netlify/`-svar, bumpade `CACHE_NAME` v3→v4 (rensar
  gamla infrusna svar vid activate).
- **Filer:** `admin/service-worker.js`. Ingen datakod, inga writes.
- **Tester:** `node --check` ✅. (Build/verify ej relevant — bara SW.)
- **Nästa / överlämning:** Efter merge+deploy måste varje admin-browser hämta nya
  SW:n: ladda om `/admin/` 1–2 ggr, eller DevTools → Application → Service
  Workers → Unregister + reload. Då rensas v3-cachen och alla function-svar blir
  live. Därefter: PR 1 (operativ chatt/SMS). Alla Blobs/v2-fixar är redan på main
  och live — det var bara SW-cachen som dolde dem.
- **Varning till Codex:** SW cachar inte längre API/function-svar — räkna inte
  med SW-cache för dynamisk data.

### 2026-06-30 — Claude Code — KLAR (PR 0 / Steg 2b: connectLambda för v1-Blobs)

- **Branch:** `fix/blobs-connect-lambda-v1` → PR mot `main` (öppen, ej mergad).
- **EXAKT ROTORSAK:** `@netlify/blobs` v8 — v1-funktioner (`exports.handler`)
  får INTE Blobs-kontexten automatiskt; de måste anropa `connectLambda(event)`
  före `getStore()`. v2 (`export default`) auto-ansluter. Därför failade alla
  10 v1-Blobs-functions med `MissingBlobsEnvironmentError` trots identiskt anrop.
  Detta är den minimala, korrekta fixen (en rad/funktion) i stället för full
  v2-omskrivning.
- **Gjorde:** La `connectBlobs(event)`-helper i `_shared/storage.js` och anrop
  högst upp i alla 10 v1-Blobs-handlers: `ai-communication-draft`,
  `ai-daily-brief`, `ai-quote`, `ai-sms-draft`, `call-logs`, `case-events`,
  `communication-events`, `customer-export`, `sms-drafts`, `stripe-webhook`.
- **Tester:** `node --check` alla 11 ✅, lokal smoke (401 utan token, dryRun 200
  utan Blobs, export 200 med token) ✅, `npm run build` ✅,
  `verify:checkout-products` ✅, `nemob-callflow check` ✅.
- **Nästa / överlämning:** När mergad+deployad: kör `storage-health` (nu v2) +
  testa `customer-export`/`ai-sms-draft` (icke-dryRun) — Blobs ska nu fungera i
  hela v1-lagret. Sedan: PR 1 (operativ chatt/SMS, återanvänd `ai-*-draft`),
  PR 2 (call-log read-only proxy från D1).
- **Varning till Codex:** Rör inte `fix/blobs-connect-lambda-v1`. Om du ändrar
  någon av de 10 functions parallellt — koordinera här först.

### 2026-06-29 — Claude Code — KLAR (Steg 2: Blobs-rotorsak + v2-probe)

- **Branch:** `fix/storage-health-v2-blobs` → PR mot `main` (öppen, ej mergad).
- **ROTORSAK BEKRÄFTAD i production:** `storage-health` (v1, `exports.handler`)
  ger `MissingBlobsEnvironmentError` på ALLA stores inkl. `workshop-cases`,
  MEN `/api/cases` (v2, `workshop-cases.mjs`) returnerar 131 ärenden. Slutsats:
  **endast v2-funktioner (`export default` + `export const config`) får Netlify
  Blobs-kontexten; v1 (`exports.handler`) får den inte.** Det förklarar varför
  identiskt `getStore({name,consistency})` funkar i `.mjs` men inte i `.js`.
- **Gjorde:** Konverterade `storage-health.js` → `storage-health.mjs` (v2) som
  bevis-probe; la till `hasBlobsContext` (= `NETLIFY_BLOBS_CONTEXT` finns) och
  `functionVersion`. La även en protokoll-guard i `admin/service-worker.js` så
  `chrome-extension://`-requests inte kraschar `cache.put` (rad 41).
- **Filer:** `netlify/functions/storage-health.mjs` (ny), `storage-health.js`
  (borttagen), `admin/service-worker.js`. Ingen datakod, inga writes.
- **Tester:** `node --check` ✅ (mjs + sw), `npm run build` ✅,
  `verify:checkout-products` ✅, `nemob-callflow check` ✅.
- **Nästa / överlämning:** När denna PR mergats + deployats: kör `storage-health`
  igen — om `blobsAvailable:true` / `hasBlobsContext:true` är teorin spikad och
  **Steg 2b** = konvertera övriga Blobs-läsande v1-functions till v2
  (`customer-export`, `call-logs`, `communication-events`, `case-events`,
  `sms-drafts` + `_shared/storage.js`-interop). Steg 3 = call-log-ingest D1.
- **Varning till Codex:** Rör inte `fix/storage-health-v2-blobs` eller
  `fix/admin-panel-cleanup` (PR #79). Konvertera inte samma v1-functions
  parallellt — koordinera här först.
### 2026-06-29 — Claude Code — KLAR (Steg 1 av admin-audit)

- **Branch:** `fix/admin-panel-cleanup` →
  [PR #79](https://github.com/Litooo88/tubular-licorice-2179de/pull/79) (öppen,
  ej mergad).
- **Gjorde:** Full audit av admin-panelen på begäran. Steg 1 = säkra städfixar:
  tog bort död kod i `loadAiControlTower`, enade admin-token-källan
  (`aiFunctionFetch` + `api()`), tog bort dubbel `call-logs`-probe, förtydligade
  att `cases.mjs` är disablad/legacy (inte live `/api/cases`).
- **Filer/områden:** `admin/index.html`, `netlify/functions/cases.mjs`. Ingen
  datakod, inga writes, inga SMS/mail.
- **Tester:** `node --check cases.mjs` ✅, inline-JS syntaxkoll 0 fel ✅,
  `npm run build` ✅, `verify:checkout-products` ✅, `nemob-callflow check` ✅.
- **Nästa / överlämning:** Steg 2 (Blobs i production) är **blockerat** tills
  Sebastian kör `storage-health` + `/api/cases`-count från admin-browsern — det
  avgör om `MissingBlobsEnvironmentError` är global (admin visar cache) eller
  bara saknade stores. Identiskt `getStore`-anrop i `workshop-cases.mjs` (funkar)
  och i nya CJS-functions (failar) ⇒ skillnaden är runtime/deploy, inte kod.
  Steg 3 = call-log-ingest från Cloudflare D1 (`call_log`)/46elks; Netlify
  `call-logs.js` läser i dag Blob-storen `call-logs` som aldrig fylls.
- **Varning till Codex:** Rör inte `fix/admin-panel-cleanup`. Om du också ändrar
  `admin/index.html`, koordinera här först — vi vill inte krocka i samma fil.

### 2026-06-28 ~15:35Z — Codex — KLAR

- **Branch:** `main` för triage; ny fix-branch skapas först när en verifierad
  bugg/issue kräver kodändring.
- **Gjorde:** Fortsatt GitHub-triage enligt målet att hitta öppna PR:ar/issues,
  fixa verifierade buggar och PR/merge:a tills funktionerna är verifierade.
  GitHub connector + rå GitHub API visade 0 öppna PR:ar och 0 öppna issues.
  Verifierade även production no-token-skydd och admin-panelmarkörer.
- **Filer/områden:** GitHub PR/issues, admin/API/Netlify functions beroende på
  vad triagen visar.
- **Tester:** `node --check` på centrala Netlify functions ✅, statisk
  admin-smoke ✅, `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `cd nemob-callflow && npm run check` ✅. Production read-only/no-token:
  `/admin/` 200 med huvudpaneler ✅, authade functions utan token 401 ✅.
- **Nästa / överlämning:** Inga öppna GitHub-items att fixa just nu. Kvarvarande
  kända blockerare är extern config: `VOICE_WEBHOOK_SECRET` och
  `STRIPE_WEBHOOK_SECRET`.
- **Varning:** Poppa inte stashen. Inga SMS/mail, inga production-writes, ingen
  Supabase och ingen Claude/Next-merge.

### 2026-06-28 ~15:18Z — Codex — KLAR

- **Branch:** `fix/admin-operational-stability-audit`
- **Gjorde:** Stabiliserade admin som operativ kontrollpanel utan att ta bort
  paneler eller ersätta live-funktioner med mock. Kundexport fick tydligare
  versions-/källstatus, Kommunikationsradar säger uttryckligen att inget
  skickas, och operativ status/SMS-flöden dokumenterades.
- **Filer/områden:** Adminpanelen, kundexport, AI Kontrolltorn, demo/test-radar,
  live samtal, missade samtal, SMS/chattflöden och dokumentation.
- **Tester:** Baseline: `npm run build`, `npm run verify:checkout-products`,
  `cd nemob-callflow && npm run check` ✅. Efter ändring: `node --check
  netlify/functions/customer-export.js`, workshop JSON-parse, `npm run build`,
  `npm run verify:checkout-products`, `cd nemob-callflow && npm run check`,
  lokal handler-smoke och statisk admin-smoke ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön. Fortsatt extern config
  kvar: `VOICE_WEBHOOK_SECRET` och `STRIPE_WEBHOOK_SECRET`.
- **Varning:** Poppa inte stashen. Inga SMS/mail, inga production-writes, ingen
  Supabase och ingen Claude/Next-merge.

### 2026-06-28 ~15:02Z — Codex — KLAR

- **Branch:** `main`
- **Gjorde:** Fortsatte verifiering/triage efter PR #76. Bekräftade rent
  worktree före loggändringen, att stashen ligger kvar och att centrala
  read-only/dry-run handlers beter sig kontrollerat lokalt.
- **Filer/områden:** Ingen produktkod ändrad; endast sync-logg.
- **Tester:** Lokal handler-smoke: `ai-quote` 401 utan/fel token och E16 dry-run
  201 med 395 / 595–1995, `ai-daily-brief` 401 utan token och 200 med dry-run,
  `call-logs`, `customer-export` och `storage-health` 401 utan token och 200 med
  token i read-only/fallback-läge.
- **Nästa / överlämning:** Externa blockerare kvar: konfigurera
  `VOICE_WEBHOOK_SECRET` i Netlify och uppdatera 46elks voice-start URL med
  secret; `STRIPE_WEBHOOK_SECRET` saknas fortfarande för Stripe webhook.
- **Varning:** Poppa inte stashen, inga SMS/mail och inga production-writes.

### 2026-06-28 ~15:00Z — Codex — KLAR

- **Branch:** `codex/update-voice-secret-handoff`
- **Gjorde:** Uppdaterar durable handoff efter PR #75 så framtida agenter ser att
  Netlify voice-webhooks kräver `VOICE_WEBHOOK_SECRET`.
- **Filer/områden:** `docs/codex-handoff.md`, sync-logg.
- **Tester:** Docs-only; production no-secret smoke för voice endpoints gav 503.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~05:12Z — Codex — KLAR

- **Branch:** `codex/require-voice-webhook-secret`
- **Gjorde:** Gör `VOICE_WEBHOOK_SECRET` obligatorisk för Netlify voice-webhooks
  så routing/SMS inte kan aktiveras publikt om secret saknas.
- **Filer/områden:** `voice-start.mjs`, `voice-notify.mjs`,
  `voice-simple.mjs`, `docs/46elks-voice-fallback.md`, sync-logg.
- **Tester:** `node --check` för berörda functions ✅, lokal voice-smoke:
  saknad secret 503 ✅, fel secret 401 ✅, rätt secret 200 ✅, notify utan
  SMS-config gav `not_configured` utan SMS ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:58Z — Codex — KLAR

- **Branch:** `codex/anonymize-missed-call-doc-numbers`
- **Gjorde:** Anonymiserar gamla exempelnummer i missade-samtal-workflow så
  kund-/privatnummer inte ligger i repo.
- **Filer/områden:** `docs/MISSED_CALL_FOLLOWUP_WORKFLOW.md`, sync-logg.
- **Tester:** Riktad `rg` efter gamla nummer ✅. Docs-only; build ej körd.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:52Z — Codex — KLAR

- **Branch:** `codex/remove-hardcoded-voice-fallbacks`
- **Gjorde:** Tar bort hårdkodade privata telefonfallbacks ur voice-flöden och
  låter Netlify env vara enda källa för staff-routing/notify.
- **Filer/områden:** `voice-simple.mjs`, `voice-notify.mjs`,
  `call-dashboard.mjs`, sync-logg.
- **Tester:** `node --check` för berörda functions ✅, lokal voice-smoke utan
  configured primary/utan secret/fel secret/rätt secret ✅, notify utan
  mottagare gav `not_configured` utan SMS ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅, `rg` hittade inga hårdkodade privata nummer ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:50Z — Codex — KLAR

- **Branch:** `codex/update-case-media-auth-docs`
- **Gjorde:** Rättar kvarvarande docs som påstår att `case-media` är publik,
  efter verifiering att production ger 401 utan token.
- **Filer/områden:** API/safety docs, sync-logg.
- **Tester:** Production no-token smoke för `/api/case-media/test-case/test-media`
  gav 401 ✅. Docs-only; build ej körd.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:46Z — Codex — KLAR

- **Branch:** `codex/protect-booking-env-status`
- **Gjorde:** Stänger kvarvarande publik config-disclosure där
  `/api/booking-env-status` svarar 200 utan admin-token.
- **Filer/områden:** `netlify/functions/booking-env-status.mjs`,
  `admin/index.html`, relevanta docs, sync-logg.
- **Tester:** `node --check netlify/functions/booking-env-status.mjs` ✅,
  lokal handler-smoke utan/fel/rätt token ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~04:42Z — Codex — KLAR

- **Branch:** `codex/fix-product-page-redirect`
- **Gjorde:** Fixar kvarvarande redirect-konflikt där `_redirects` pekar gamla
  `/product-page/*` mot hemhash medan `netlify.toml` pekar mot katalogen.
- **Filer/områden:** `_redirects`, sync-logg.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `cd nemob-callflow && npm run check` ✅.
- **Nästa / överlämning:** PR/merge om GitHub är grön.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~01:45Z — Codex — KLAR

- **Branch:** `fix/optimize-root-assets`
- **Gjorde:** Stängde kvarvarande prestandafynd: optimerade root-logotyperna och
  tar bort orefererade stora root-PNG:er.
- **Filer/områden:** `logo.png`, `nordic_logo_transparent.png`,
  orefererade root-bilder, sync-logg.
- **Tester:** Loggorna verifierade 512x512 och byte-identiska ✅, oanvända
  root-PNG:er har inga referenser ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~01:25Z — Codex — KLAR

- **Branch:** `fix/prices-json-ld`
- **Gjorde:** Lade JSON-LD/structured data på publika `/priser/` för att stänga
  kvarvarande SEO-fynd från handoffen.
- **Filer/områden:** `priser/index.html`, sync-logg.
- **Tester:** JSON-LD parse-smoke ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~01:05Z — Codex — KLAR

- **Branch:** `fix/remove-nested-site-copy`
- **Gjorde:** Tog bort tracked äldre nested `nordic-emobility-site/`-kopia från
  deploy-repot och lägger ignore så den inte råkar återinföras.
- **Filer/områden:** nested kopia, `.gitignore`, recovery docs.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `cd nemob-callflow && npm run check` ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~00:45Z — Codex — KLAR

- **Branch:** `fix/voice-webhook-timing-safe`
- **Gjorde:** Hårdade 46elks voice-webhook secret-jämförelse så
  `VOICE_WEBHOOK_SECRET` inte jämförs med vanlig strängjämförelse.
- **Filer/områden:** `netlify/functions/voice-start.mjs`,
  `netlify/functions/voice-notify.mjs`, auth-helper och tester.
- **Tester:** `node --check` på berörda filer ✅, lokal voice-webhook
  auth-smoke utan/fel/rätt secret ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-28 ~00:20Z — Codex — KLAR

- **Branch:** `docs/update-admin-audit-resolution`
- **Gjorde:** Uppdaterade admin-auditens status så gamla "trasigt"/nästa-steg-fynd
  inte längre kan misstas för nuläge efter PR #50-#64.
- **Filer/områden:** `docs/ADMIN_SYSTEM_AUDIT_2026_06.md` och sync-logg.
- **Tester:** Inga buildtester körda; markdown-only.
- **Säkerhet:** Dokumentation endast. Inga SMS/mail, inga production-writes,
  stashen poppas inte.

### 2026-06-27 ~19:35Z — Codex — KLAR

- **Branch:** `docs/netlify-env-hardening-followup`
- **Gjorde:** Dokumenterade read-only Netlify-fynd efter PR #63: production
  deploy är `ready`, men `STRIPE_WEBHOOK_SECRET` saknas och vissa känsliga
  operativa env-vars behöver roteras/markeras som secret i Netlify.
- **Filer/områden:** `docs/codex-handoff.md`, `docs/AGENT_SYNC_LOG.md`.
- **Tester:** Inga buildtester körda; markdown-only.
- **Säkerhet:** Inga env-värden skrevs i docs, inga SMS/mail, inga
  production-writes, stashen poppades inte.

### 2026-06-27 ~18:55Z — Codex — KLAR

- **Branch:** `fix/timing-safe-admin-auth`
- **Gjorde:** Hårdade admin-auth i kvarvarande MJS-functions så `x-admin-token`
  jämförs timing-safe där endpoints redan kräver admin-token.
- **Filer/områden:** `netlify/functions/*.mjs` med lokal admin-auth samt
  `netlify/functions/create-checkout.js`.
- **Tester:** `node --check` på ändrade functions ✅, lokala auth-smokes för
  admin-token ✅, `npm run build` ✅, `npm run verify:checkout-products` ✅,
  `cd nemob-callflow && npm run check` ✅.
- **Säkerhet:** Inga SMS/mail, inga production-writes, stashen poppades inte.

### 2026-06-27 ~18:10Z — Codex — KLAR

- **Branch:** flera fokuserade branches, mergeade via PR #52-#61 till `main`.
- **Gjorde:** Stängde kvarvarande PR/buggspår från admin/audit-rundan:
  hardening av booking/voice ingress, admin media/auth-diagnostik, AI SMS
  true dry-run, timeline fallback från `/api/cases`, workshop-chat
  rate/idempotency, Stripe checkout origin + signerad webhook, live-SMS UI/POST
  safety, booking idempotency och riktig avstängning av gamla rescue
  `cases.mjs`.
- **Filer/områden:** `admin/index.html`, `netlify/functions/booking.mjs`,
  `workshop-chat.mjs`, `call-dashboard.mjs`, `create-checkout.js`,
  `stripe-webhook.js`, `cases.mjs`, AI/timeline functions och docs.
- **Tester:** Efter varje merge kördes `npm run build` ✅,
  `npm run verify:checkout-products` ✅ och
  `cd nemob-callflow && npm run check` ✅. Relevanta `node --check` och lokala
  handler-smokes kördes per PR.
- **Nästa / överlämning:** Open PR-listan var tom efter PR #61. Kvar som
  separat arbete: Netlify env/setup för `STRIPE_WEBHOOK_SECRET` och Stripe
  Dashboard webhook, samt ev. SEO/prestanda-fynd som stor logotyp och JSON-LD
  för `/priser/`.
- **Varning:** Inga SMS/mail skickades i tester, inga production-writes gjordes,
  stashen `feature/ai-operator-mvp3-timeline` poppades inte.

### 2026-06-27 ~16:00Z — Codex — KLAR

- **Branch:** `fix/admin-operational-truth-dashboard`
- **Gjorde:** Implementerade auditens admin-fixar: operativ KPI-modell med
  `Gör nu`, AI brief via `/api/cases`, tydlig Blob/call-log källstatus och
  mindre missvisande live-samtalsläge. Gjorde `/api/call-dashboard` GET
  read-only som default och explicit för källsaknad.
- **Filer/områden:** `admin/index.html`,
  `netlify/functions/ai-daily-brief.js`, `netlify/functions/call-logs.js`,
  `netlify/functions/customer-export.js`, `netlify/functions/call-dashboard.mjs`.
- **Tester:** `node --check` på ändrade functions ✅, `npm run build` ✅,
  `npm run verify:checkout-products` ✅, `cd nemob-callflow && npm run check`
  ✅, lokal `ai-daily-brief` dry-run smoke ✅.
- **Nästa / överlämning:** PR med titel `Fix admin operational truth dashboard`.
- **Varning:** Inga SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-27 ~00:00Z — Codex — KLAR

- **Branch:** `audit/admin-system-operational-map`
- **Gjorde:** Full systemrevision av admin, bookingflöde, KPI:er och relevanta
  Netlify Functions. Skapade operativ auditrapport.
- **Filer/områden:** `docs/ADMIN_SYSTEM_AUDIT_2026_06.md` och denna sync-logg.
- **Tester:** Ingen build/test körd eftersom endast dokumentation ändrades.
- **Nästa / överlämning:** Implementera rekommenderade fixar i små separata PR:
  KPI-modell, AI brief via `/api/cases`, tydlig call-log source status,
  `ai-sms-draft` true dry-run och timeline fallback.
- **Varning:** Ingen SMS/mail, inga production-writes, stashen poppas inte.

### 2026-06-26 ~12:40Z — Claude Code — KLAR

- **Branch:** `seo/sitemap-favicon` → mergad till `main` via
  [PR #37](https://github.com/Litooo88/tubular-licorice-2179de/pull/37)
  (merge-commit `ccdf9ad`, mergad av Sebastian).
- **Gjorde:** SEO-fix. Skapade `favicon.svg` (varumärkesgrön `#00C853`) och la
  `<link rel="icon">` på alla 19 publika sidor (efter `<meta charset>`). La till
  saknade sidor i `sitemap.xml`: `/nya-elscootrar/`, `/foretag/`, `/garanti/`.
  Commit `9fdfbd6`, 21 filer.
- **Tester:** `npm run build` ✅, `npm run verify:checkout-products` ✅.
- **Rör INTE:** ingen kod i AI Operator/MVP4, inga functions, ingen storage.
- **Notis:** Codex MVP4-commit `e716afc` (Communication radar demo) ligger också
  på `main`. Inga konflikter — SEO och MVP4 samexisterar.
- **Production:** PR mergad → Netlify deployar från `main`.

### 2026-06-26 (tidigare denna session) — Claude Code — KLAR

- **Gjorde:** Genomgång av hela sajten på begäran (read-only).
  - Hälsokoll: `npm run build` ✅, `npm run verify:checkout-products` ✅,
    `nemob-callflow` `tsc --noEmit` ✅.
  - Live-koll: startsida + `/book-online/` laddar korrekt.
  - Säkerhetsgranskning (ej åtgärdad) — viktigaste fynd att ta tag i:
    - **Kritiskt:** `netlify/functions/case-media.mjs` GET serverar kundbilder
      utan auth (före `requireAdmin`) och struntar i `publicOk` (IDOR-läcka).
    - **Högt:** inga signaturkontroller på 46elks voice-callbacks
      (`voice-notify.mjs`, `voice-start.mjs`); ingen Stripe-webhook som bekräftar
      betalning; `booking.mjs` saknar rate limiting/honeypot.
    - **Medel:** `booking-env-status.mjs` publik config-disclosure; admin-token i
      `localStorage`; icke-konstanttidsjämförelse i `requireAdmin`;
      `create-checkout.js` litar på `Origin`-header; `cases.mjs` är död
      duplicerad write-path på disabled route.
  - SEO-granskning — fynd kvar utöver det åtgärdade ovan:
    - Logotypen är 1,8 MB och laddas på varje sida (`logo.png` =
      `nordic_logo_transparent.png`, byte-identiska) — optimera.
    - ~7 MB oanvända PNG:er i repo-roten (`blade-gt2-promo.png`,
      `facebook-content-1/2.png`).
    - `/priser/` saknar JSON-LD; motsägelse i `_redirects` för `/product-page/*`.
- **Inga kodändringar** i detta steg (bara granskning).

---

## Postmall (kopiera)

```
### ÅÅÅÅ-MM-DD ~HH:MMZ — <Agent> — <PÅGÅR|KLAR>

- **Branch:** <branch / PR>
- **Gjorde:** <kort vad>
- **Filer/områden:** <vilka filer eller routes>
- **Tester:** <kommandon + resultat>
- **Nästa / överlämning:** <vad som är kvar>
- **Varning:** <vad den andra agenten bör undvika att röra just nu>
```

### 2026-08-22 — Claude Code — KLAR — Obesvarade förfrågningar: auto-svar <500 kr + pricksäkra utkast + stängningschans
- Auto-skickat (46elks, via /api/sms-drafts/:id/approve) till 6 småärenden <500 kr med gardering "Har vi redan pratat så bortse från detta". Testärende skippat.
- 31 individuella utkast (pris som från-pris, RING + bokningslänk, gardering) ersatte mallutkasten i inkorgen; mejlnotis skickad.
- PR #132 (feat/lead-prioritering) uppdaterad: closeProbability 0–100 = huvudsortering, autoReplyEligible-regel, admin visar "Chans X %", docs/LEAD-PRIORITERING.md. Ej mergad ännu — efter merge: kör berikning (missedCalls) så att sorteringen blir skarp.
- Kvar: dag-för-dag-sammanställning av samtal + utredning av "20% rabatt"-SMS.

### 2026-08-22 — Claude Code — KLAR — Click-to-call + SMS från NEMOB OS (PR feat/click-to-call)
- NY FUNKTION (namn reserverat): `netlify/functions/case-call.mjs` → POST /api/cases/:id/call. 46elks ringer Sebastians mobil (env VOICE_SEBASTIAN_PHONE) från 010-numret och kopplar in kunden; timeline + callLog på ärendet. Dubblettskydd 60 s.
- NEMOB OS: `lib/admin-actions.mjs` (enda POST-vägarna mot admin: call + sms), routes POST /api/lookup/:id/(call|sms), knappar i Slå upp-fliken. Tester 67/67, build OK.
- Samtalsrapport levererad till Sebastian (993 samtal 24 maj–21 aug, 10,8 % besvarade; RING20-kampanjen = 20 %-SMS:et). Skript i Claude-scratchpad, inget i repot.
- Obs för andra agenter: call-dashboard filtrerar direction=incoming — utgående click-to-call-samtal syns i 46elks men inte i dashboarden ännu (följearbete).

### 2026-08-23 — Claude Code — KLAR — Råd-knapp i NEMOB OS (PR feat/task-advice)
- `nemob-os/lib/advice.mjs`: regelråd (deadline/kund väntar/stora block/belastning per vardag) + Claude-lager via `@anthropic-ai/sdk` (claude-opus-5, json_schema) bakom ANTHROPIC_API_KEY, not_configured utan nyckel. POST /api/tasks/:id/advice ändrar inget; Tillämpa i UI gör PATCH.
- Root package.json har nu `@anthropic-ai/sdk` som dependency (kör `npm install` efter merge). Tester 68/68, smoke-testat i browser.
- Öppna PR:er från Claude: feat/click-to-call (case-call.mjs) och feat/task-advice. Oberoende av varandra.

### 2026-08-29 — Claude Code — KLAR — Ringlistan: ingen varm kund missas två gånger (mergad till main)
- NYA FUNKTIONER (namn reserverade): `ring-list.mjs` (API + store ring-list, statusar watch/new/done) och `ring-list-scan.mjs` (schemalagd */10: varmt nummer som ringer utan att nås ⇒ status new + info-SMS till kund (max 1/7 dgr, ej optout, ej 21–08, max 5/körning) + larm-SMS till Sebastian (max 1/6 tim)).
- Admin: röd sektion "Ringlista" överst, sorterad på flest försök; click-to-call när kundkort finns, snabb-SMS, Klar ⇒ watch. docs/RINGLISTA.md.
- Seedat: 156 watch-poster (alla återkontaktade) + 15 heta (ringt igen utan att nås); info-SMS skickat till 11, skippat för 4 som nyss fått personligt SMS (Simon, Adam E, Malin) — allt via API, loggat per post.
- Fix i samma pass: GET /api/ring-list batchar blob-läsning parallellt (sekventiellt timeoutade vid 150+).
- Bakgrund/data: 46 ringde tillbaka efter återkontakt, endast 18 nåddes; 15 oräddade. Mobilexporter (Motorola+Samsung) inlagda i samtalsrapporten; rotorsak juli = Comviq samtalsspärr 25 jun–14 aug (PTS).

### 2026-09-01 — Claude Code — KLAR — Repair Intelligence steg 1–2 live + veckoplan igång
- NYA FUNKTIONER (namn reserverade): `case-similar.mjs` (/api/case-similar, /api/repair-canon, /api/repair-stats) och `_shared/repair-index.mjs` (ROOT_CAUSES, brand-normalisering, repair-index-blob). workshop-cases: completion + rootCause/laborMinutes/symptom + indexskrivning; workshop-vyn steg 5 med fälten + Liknande fall (egna fall + kanon). Mergad till main (8ae8af7), deploy verifierad, kanon v1.3.1 (53 poster) synkad till blob repair-canon.
- Kampanj: RING20 skickad till 16 av 21 aldrig kontaktade nummer; 4 väntar — 46elks-SALDOT ÄR SLUT (29 kr). Sebastian påmind (kalender). OBS för alla agenter: SMS kan misslyckas med Forbidden tills saldot fylls på.
- Kanon batch 4 klar som FÖRSLAG (10 nya + 2 stärkta, 0 bekräftad, källpoolen i princip uttömd): kanon/diagnostik-kanon-v1.4-batch4-FORSLAG.json + BATCHRAPPORT-4.md. Rör ej före granskning.
- NEMOB OS autostartar nu via Windows-schemalagd aktivitet "NEMOB OS Server". Kalender: 2 dagliga påminnelser (ringlista 11:30, avslutfält 16:45) + friktionskoll 3/9, backfill 4/9, veckofacit 7/9.
- Kvar dag 2: prisintervall i quick-price, backfill-förslag (30 senaste), diagnosförslag vid intag.

### 2026-09-04 ~23:29Z — Codex — KLAR

- **Branch:** `fix/require-booking-vehicle-identity`
- **Gjorde:** Gjorde fabrikat och exakt modell obligatoriska i publik bokning samt
  speglar valideringen server-side så generiska märkesvärden inte accepteras.
- **Filer/områden:** `book-online/index.html`, `netlify/functions/booking.mjs`,
  `_shared/vehicle-identity.mjs`, test och API/datamodellsdokumentation. Märke
  och modell syns separat i ärendet och tillsammans i kalender/SMS/e-post.
- **Tester:** `npm run test:status` ✅ (11/11), `npm run
  verify:checkout-products` ✅, `npm run generate:products` ✅, `npm run
  build:dist` ✅, `node --check` för ändrade MJS-filer ✅, inline-JS syntax ✅,
  `git diff --check` ✅. Full `npm run build` stoppades endast av att rena
  klonen saknar installerat `@netlify/blobs`; `nemob-callflow npm run check`
  stoppades av saknad lokal `tsc`.
- **Nästa / överlämning:** Granska/merga branchen och låt Netlify deploya.
- **Varning:** Inga SMS/mejl eller production-data skrevs i detta arbete.
