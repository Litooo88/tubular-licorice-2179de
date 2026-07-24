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

### 2026-07-24 — Claude Code — KLAR (webbaudit prio 0 + delar av prio 1 åtgärdade)

- **Branch:** `fix/webbaudit-prio0`, 6 commits. GitHub onåbart under passet
  (`git fetch` timeout) — **EJ pushat**, mappen står kvar på branchen.
  Nästa agent: pusha + öppna PR när nätet är uppe, eller merga lokalt.
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
