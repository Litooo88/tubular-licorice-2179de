# Full systemrevision: Nordic E-Mobility

Datum: 2026-09-07. Utförd av Codex, med Claude Codes pågående arbete beaktat.
Granskad kod: **4162d63**, lokal main vid start. Detta är en revision, inte en
implementation eller ett godkännande av production.

## Slutsats

Systemet har en användbar grund: verkliga verkstadsärenden, fungerande
produktgenerator, servicestatus och ett växande Repair Intelligence-flöde.
Det stora hindret är nu **motstridiga kontrakt mellan befintliga funktioner**,
inte avsaknad av fler AI-paneler eller behov av ett nytt ramverk.

Åtgärda först publik bokningsrespons, förlorade samtidiga uppdateringar,
dolda utskick i läsanrop, SMS-utkastens format och betalningens fallback.
Samordna därefter KPI:er, timeline och felstatus. Ny kosmetisk redesign eller
ökad automatisering bör inte gå före dessa åtgärder.

**Befintliga tester är gröna, men revisionen reproducerar fel som de inte täcker.**
Det innebär inte att verkliga kunder har drabbats av varje fel; ingen
produktionsdata eller leverantörshistorik har lästs för att fastställa det.

## Metod och begränsningar

- Kod, routes, datakällor, auth, sidoeffekter, byggkedja och projektminne granskades.
- Tester kördes i separat detached worktree:
  `F:/nordic-emobility-audit-2026-09-07`, låst till ovanstående commit.
  Befintliga installerade beroenden återanvändes via katalogjunctions.
- Lokal statisk `dist/` visades på `http://127.0.0.1:4317`. Ingen Netlify-backend
  var kopplad till denna webbläsarvy. API-felen där är därför inte bevis för
  ett aktuellt produktionsavbrott. Inget riktigt token användes i webbläsaren.
- Startsida, bokning, adminöversikt, telefoni, workshop, quick-price, checkout,
  prices, priser, status och öppen chatt inspekterades visuellt. Skärmbilder
  omfattar bred och smal viewport, inte en full enhets-/tillgänglighetscertifiering.
- Syntetiska handler-tester kördes i VM med separat env, minneslagring och
  blockerad verklig nätverkstrafik. Utgående provider-anrop ersattes med stubbar.
  Inga produktionscredentials, verkliga kundkort eller privata SMS behövdes.
- `git fetch origin` misslyckades med anslutningsfel till GitHub. Publik
  webbläsaröppning misslyckades med `net::ERR_NETWORK_CHANGED`. Senaste remote,
  aktuell deploy, verkliga saldon, leveranser och datamängder är **inte verifierade**.
- Ingen ny dependency installerades. Sårbarhetsdatabas, externa juridiska
  uppgifter, partnerpåståenden och produktprestanda verifierades inte online.

Lokal reproducerbar evidens finns i
`F:/nordic-emobility-audit-2026-09-07/audit-evidence/`:
`audit-probes.mjs`, `probe-results.json`, `syntax-audit.mjs`,
`syntax-results.json` och skärmbilder `01-home.png` till `11-chat-open.png`.
Detta är separat revisionsunderlag, inte deploybar applikationskod.

## Prioriterade fynd

P1 = bör rättas före utökad drift/automatisering. P2 = tydlig nästa åtgärd.
"Reproducerat" avser syntetiskt lokalt test. "Kodbelagt" betyder att
konsekvensen följer av koden men inte har körts mot production.

### F01 / P1: publik bokningsrepetition kan lämna ut interna ärendefält

**Reproducerat.** `netlify/functions/booking.mjs:1030` beräknar idempotensnyckel
från klientens header eller bokningsfingeravtryck. Vid dubblett returnerar
`booking.mjs:1161` hela det aktuella lagrade `caseItem`, inklusive senare
interna noteringar och betalningsfält. Endpointen är avsiktligt publik.

Syntetiskt test: samma kända idempotensnyckel, inget admin-token, HTTP 200 med
en intern sentinel-notering och betalningsobjekt. Testet visar inte att
godtyckliga nycklar går att gissa, men replay behöver inget ägarbevis. Även
nybokningssvaret returnerar hela case-objektet (`booking.mjs:1256`).

**Fix:** gemensam minimal publik response-whitelist för ny och upprepad
bokning. Idempotens får aldrig ge en fullständig läsrätt till ett ärende.
**Acceptans:** injicera privata/internal-fält i ett befintligt case; inget av
dem får synas i publik ny-/dubblettrespons. Behåll idempotens och kundens kvittens.

### F02 / P1: samtidiga case-uppdateringar tappar data

**Reproducerat.** `netlify/functions/workshop-cases.mjs:801` bygger en hel
ersättningspost från tidigare läst case; `:847` lägger till note och `:958`
skriver hela posten. Strong consistency hindrar inte två parallella
read-modify-write-operationer från att skriva över varandra.

Två parallella PATCH med varsin notering gav **200 + 200, men endast en
notering sparades**. Liknande helobjektsskrivningar finns i `case-sms.mjs`,
`sms-draft-inbox.mjs` och `outbox-flush.mjs`.

**Fix:** definiera versions-/konfliktkontroll eller serialiserad mutation per
case med dokumenterat stöd i lagringslösningen. En UI-spärr räcker inte för
bot/admin/scheduler samtidigt. Gör inga påhittade transaktionsanrop till Blobs.
**Acceptans:** konkurrerande status, note, betalning och SMS-logg får antingen
bevaras eller ge en tydlig konflikt som kan försökas om. Aldrig tyst dataförlust.

### F03 / P1: vanlig dashboard-GET kan skicka SMS och skriva Blobs

**Reproducerat.** `netlify/functions/call-dashboard.mjs:534` gör saldokontroll.
Lågt saldo och utgången throttle leder till `postSms` och skrivning i
`ops-warnings` (`:553`). Det sker också vid GET utan `syncLeads`, trots att
responsen sätter `readOnly: true` (`:659`). `?dryRun=1` stoppar inte detta.
Admin anropar dashboarden vid laddning (`admin/index.html:4644`).

Test: GET med syntetiskt lågt saldo gav 200 och `readOnly:true`, samtidigt som
**ett SMS-anrop och en Blob-write simulerades**. Inget verkligt SMS skickades.

**Fix:** separera saldoavläsning från notifieringskommando/scheduler. Ett
deklarerat read-only-/dry-run-anrop måste stoppa alla sidoeffekter, inklusive
interna larm. Behåll saldovakten i uttryckligen godkänt körläge.
**Acceptans:** observera samtliga provider-/storage-anrop under GET och dry-run;
antal writes/sends ska vara noll även vid lågt saldo och saknad throttlepost.

### F04 / P1: två inkompatibla SMS-utkastformat delar samma store

**Reproducerat i backend och befintlig UI-funktion.**
`netlify/functions/sms-drafts.js:44` skapar `id`, `status`, `createdAt`,
`requiresApproval` etc. `sms-draft-inbox.mjs:88` skriver i samma `sms-drafts`
men med caseId som nyckel och `meta.namn/telefon`, utan samma id/statusfält.
Inboxens GET returnerar båda format (`:65`).

`admin/index.html:1783` förutsätter `d.meta.namn`; en legacy-post saknar meta.
Catchen `:1798` döljer då hela inkorgen. Ett syntetiskt utkast skapades med
den gamla API:n: GET gav count 1 men den riktiga UI-funktionen dolde panelen.
Approve i nya inboxen förutsätter dessutom att utkastets nyckel är caseId
(`sms-draft-inbox.mjs:118`).

**Fix:** versionsmärkt normaliseringsadapter och tydlig nyckelmappning, eller
separerade stores med dokumenterad migration. Äldre drafts ska fortsatt kunna
läsas. Blanda inte statusen "godkänd" med "godkänn och skicka".
**Acceptans:** blandad lagring med båda format visas utan crash; korrekt
mottagare/caseId; ingen send före separat explicit godkännande.

### F05 / P1: checkout-fallback kan ta bort frakt och villkorsgodkännande

**Reproducerat med Stripe-stub.** `netlify/functions/create-checkout.js:176`
provar successivt sessionspayloads utan policyfält och sedan utan frakt.
Alla `invalid_request_error` kan utlösa fallback (`:191`), inte bara en
specifik frivillig betalmetod.

För syntetisk Teverun-produkt accepterades försök 11 utan ursprunglig
**699 kr frakt** och utan `consent_collection`, efter simulerade providerfel.
Produktverifieringens 44 godkända produkter testar inte detta kontrakt.

**Fix:** obligatorisk totalsumma/frakt och beslutade policyfält får inte
släppas för att få en lyckad session. Fallera kontrollerat om dessa inte kan
uppfyllas; begränsa fallback till faktiskt frivilliga parametrar.
**Acceptans:** samma obligatoriska ekonomiska villkor i varje tillåten retry.
Ingen verklig Stripe-session behöver skapas för regressionstestet.

### F06 / P1: misslyckat köat tackmail kan förlora återförsöket

**Reproducerat.** `netlify/functions/outbox-flush.mjs:29` behandlar
`sendThankYou()` som framgång om den inte kastar. Providerfel kan returneras
som `email.status = failed`; catchen aktiveras då inte. Queueposten raderas
på `:56` och timeline säger ändå "skickat" på `:41`.

Test: failed-status, HTTP 200, tom kö och felaktigt skickat-event.
**Fix:** skilj accepterad leverans från failed/not_configured; behåll
återförsöksbar post, backoff och tydligt fel. Se också direktavslut i
`workshop-cases.mjs:938` som lägger skickat-event utan motsvarande statusvillkor.
**Acceptans:** provider-429/5xx/not_configured får aldrig radera en oskickad
köpost eller skapa ett falskt leveranskvitto. Använd idempotens vid retry.

### F07 / P1 villkorlig: inkommande SMS-webhook är öppen om hemlighet saknas

**Kodbelagt, production-konfiguration okänd.**
`netlify/functions/sms-inbound.mjs:71` kontrollerar hemligheten endast om env
är satt. Avsändare, mottagare och riktning i request-body är inte i sig ett
äkthetsbevis. Funktionen kan därefter lagra inkommande text/optout och starta
notifierings-/svarsflöde. Inga inkommande riktiga SMS lästes i revisionen.

**Fix:** dokumenterad fail-closed-registrering av webhook + verifiering före
alla mutations-/sendvägar. Detta måste planeras tillsammans med
`elks-webhook-sync.mjs` så att skärpt auth inte tyst stoppar riktig telefoni.
**Acceptans:** fel/saknad verifiering ger noll writes/sends. Kontrollera bara
boolesk konfigurationsstatus i production, aldrig visa hemligheten.

### F08 / P2: AI och admin räknar olika sanning

**Reproducerat.** `ai-daily-brief.js:219` kapar till tio prioriteringar innan
totalen räknas (`:240`). `:45` behandlar belopp 0 som färdigt belopp, och `:225`
kan göra ett nytt case faktureringsklart. `:30` känner inte igen sitt eget
"Modell saknas"-fallbackvärde som saknad modell.

Test med tolv nya obekräftade cases utan modell och med betalbelopp 0:
**Gör nu = 10, klara att fakturera = 12, risk/saknad modell = 0.**
Admin har andra regler vid `admin/index.html:1312` och `:1342`.

**Fix:** ett testat operativt urval för API och lokal UI-fallback. Räkna hela
urvalet före presentationens maxgräns; noll/saknat belopp är inte en faktura.
Behåll raw-status och separera "aktiv reparation" från "ej arkiverad".

### F09 / P2: dryRun i responsen betyder inte alltid inga writes

**Reproducerat.** `ai-daily-brief.js:270` sätter `dryRun:true` när OpenAI-key
saknas, medan en vanlig POST fortfarande skriver rekommendation (`:327`).
Testet gav `dryRun:true` och en simulerad write till `ai-recommendations`.

Explicit input `dryRun:true` är däremot säker i de testade AI-handlers:
daily 200, quote 201, **0 Blob-reads, 0 writes, 0 nätverksanrop**.
**Fix:** separata fält för deterministisk AI, providerstatus och faktisk
sidoeffektspolicy. Lita inte enbart på svarets befintliga dryRun-label.
JSON-body `null` ger dessutom daily 500 före authkontrollen (`:288`);
normalisera/validera body och gör auth först. Vanligt saknat/fel token gav 401.

### F10 / P2: separat timeline döljer tidigare case-historik

**Kodbelagt.** `admin/index.html:2343` använder inbäddad `case.timeline` bara
när `case-events` är helt tom. En separat intern notering räcker för att
status-/betalnings-/SMS-historik i den andra källan inte längre ska visas.

**Fix:** sammanfoga och deduplicera källorna med tydlig proveniens, utan
dubbelregistrering. **Acceptans:** ett case med två inbäddade händelser och
en separat note visar alla tre även efter omladdning.

### F11 / P2: prisregler och offentliga löften är inte samordnade

**Kodbelagt/visuellt.** AI-defaults i `_shared/business-rules.js:71` anger
bromsjustering från 289 och batterifelsökning från 495. Prisdatabasens seed
anger 295 respektive 745 (`price-catalog.mjs:39`, `:58`), vilket även syns
publikt i `/priser/`. Om tjänsterna avsiktligt skiljer sig behöver de egna
namn/artiklar; de får inte se ut som samma erbjudande med olika pris.

Bokningen lovar "Inom 4 timmar" (`book-online/index.html:251`) och visar
"SMS + e-post" även när email är valfritt (`:341`, `:565`). Ett mottaget
ärende, bekräftad tid och faktiskt levererad kvittens är olika saker.

**Fix:** låt Sebastian besluta prisversion/tjänstegränser och faktisk
återkopplingsnivå. Codex kopplar godkänd källa; Claude uppdaterar motsvarande
publika texter. Dokumentera villkor och verifiera publicerade fakta, inte
bara generera fler löften eller högre konverteringspåståenden.

### F12 / P2: fel, okänd källa och äkta noll blandas i UI

**Visuellt belagt i lokal vy utan backend/token.** Admin visar nollor innan
data finns, kvarstående "Laddar ärenden..." efter fel och bokstavlig
`Kunde inte l&auml;sa data.`. Workshop/quick-price har också kvar laddtext
efter fel. Telefonin visar korrekt okända tal på flera ställen, men
"Ej kopplad" används även när token saknas och konfigurationen är okänd.

**Fix:** samma states överallt: auth_required, loading, ready_empty,
ready_with_data, unavailable, stale. Visa senaste lyckade hämtning och källa.
Unknown får inte räknas som 0; döljs inte som en tom inkorg. Ingen redesign krävs.

### F13 / P2: flera andra GET-flöden är inte skrivfria

**Reproducerat:** `/api/price-catalog` GET med tom store seedar `items`
(`price-catalog.mjs:103`). **Kodbelagt:** `case-similar.mjs:138` skriver
träffstatistik; servicestatus kan reparera index via
`_shared/service-number.mjs:70`. Det är andra sidoeffekter än utskick men
fortfarande oförenligt med ett generellt löfte om noll production-writes.

**Fix:** separat initialization/mätkommando eller uttrycklig read-only-policy.
Upprätta en verifierad allowlist för smoke-test; anta inte att GET är säkert.

### F14 / P2: chattutkast lämnar kunddata i localStorage

**Kodbelagt.** `assets/workshop-chat.js:22` sparar text/namn/telefon/modell
på input utan TTL. Borttagning sker vid lyckad inskickning. Detta är riktig
kunddata, inte bara UI-inställningar, och går emot repots begränsning.

**Fix:** minnesbaserat utkast eller avgränsad, explicit sessionshantering;
bestäm retention/clear och testa delad enhet. Ändra inte admin-tokenhantering
samtidigt i denna lilla PR. Bredare roll-/sessionauth är en separat riskplan.

### F15 / P2: lokala NEMOB OS kan tolka korrupt data som tomt system

**Kodbelagt, inte manipulerat på riktig data.** `nemob-os/lib/store.mjs:18`
fångar alla läs-/JSON-fel och återgår till EMPTY_STATE. Nästa save kan då
ersätta en trasig men återvinningsbar fil med tom/ny data. Atomisk rename
skyddar själva skrivningen men inte detta felläge.

**Fix:** endast ENOENT får skapa tomt system. Övriga fel ska blockera writes,
visa återställningsbehov och behålla original. Lägg separat backup/restore-test.

### F16 / P2: projektminne och testgränser speglar inte nuvarande system

`AGENTS.md`, recovery/API-docs och äldre MVP-dokument säger fortfarande bland
annat att gemensam storage-adapter saknas eller att SMS inte skickas.
Det stämmer inte med aktuell kod. Strategiplanens generella "Inga SMS eller
mail skickas automatiskt" måste skiljas från faktiska boknings-/schedulerflöden.

Netlify-build kör voice/status, men inte de reproducerade kontraktsfallen,
NEMOB OS eller knowledge-sviten. Ingen `.github/`-workflow hittades i snapshoten;
GitHubs faktiska branchskydd/externa checks kunde inte kontrolleras.

**Fix:** en aktuell arkitektur-/kontraktsöversikt plus märkning av historiska
docs. Lägg riktiga integrationstester med provider-/storage-stubbar i PR-grinden.
Behåll separat ägarskap i Codex/Claude-worktrees; se arbetsplanen nedan.

### F17 / P2: intern kunskapsrad är inte automatiskt anonymiserad

**Kodbelagt.** `_shared/repair-index.mjs:77` bygger en teknisk whitelist, men
kopierar fritext för symptom, grundorsaksnotering, delar och workSummary utan
PII-redaktion. Kommentaren "INGEN kund-PII" garanteras därför inte av koden.
Detta är ett authat internt index, inte belägg för en publik läcka.

**Fix:** granska/redigera fritext vid kunskapsöverföring och kräv särskilt
godkännande före publik SEO/social återanvändning. Testa med syntetisk e-post,
telefon och personuppgift i teknisk text. Återanvänd den befintliga
knowledge-importens beprövade redaktionsregler där de är lämpliga.

### F18 / P2: analytics inkluderar full URL även på adminytan

**Kodbelagt, ingen analytics-trafik verifierad.** `assets/analytics.js:24`
skickar location.href samt sökparametrar efter lagrat samtycke. Samma script
laddas i admin, utan ett internt route-undantag. En kund-/case-referens i en
adminlänk kan därför följa med till analysleverantören efter tidigare samtycke.

**Fix:** undanta interna/capability-routes och tillåt endast godkända publika
parametrar. Behåll samtyckesgrinden; den finns och är en förbättring. Testa
eventpayloads lokalt utan att skicka events till en riktig analytics-property.

## Aktuell systemkarta

### Sidor

| Sida | Syfte och källa | Fungerar / demo | Brist och risk | Nästa avgränsade fix |
| --- | --- | --- | --- | --- |
| `/` | Service-/köpvägar, statisk text och genererad produktkatalog | Renderar; tydliga två huvudvägar; statuslänk finns | P2: lång sida, löften/priser/statistik kräver gemensam faktakälla | Samordna fakta före kosmetik; Claude äger publik copy |
| `/book-online/` | Publikt formulär till `/api/bookings` | Exakt modell/märke valideras för service; kvittenslogik finns; inget formulär skickades | P1 F01; P2 dubbla bekräftelselöften; kalenderkontroll är inte atomisk reservation | Minimal offentlig response, sedan kapacitets-/retrytest |
| `/admin/` översikt | `/api/cases`, daily brief, ring-list, SMS-inbox | Ny operativ KPI-layout och source-fallback finns; demo är ihopfälld och tydligt märkt | P1 F03/F04; P2 F08/F09/F12 | En read-only uppdatering + gemensam KPI-tolkning |
| `/admin/` kundkort | `/api/cases/:id`, events, drafts, media | Riktig backend, inte hårdkodade demokunder; historikflödet kodgranskat | P1 F02, P2 F10; full autentiserad kundresa ej visuellt testad | Konflikttest och sammanhängande timeline |
| `/admin/` telefoni | Primärt 46elks REST via `/api/call-dashboard` | Ej samma källa som legacy `call-logs`; manuelldel/demo separerade | P1 F03; antal/privatlinje måste ha rätt proveniens; inget livearkiv läst | Read-only-kontrakt och tydliga okända states |
| `/workshop/` | Samma cases, prisrader, liknande reparationer | Stegvis arbete, auto-refresh pausas vid arbete, strukturerad completion | P1 concurrent writes; fel+laddtext; full arbetsorder ej körd | Bevara arbete, verifiera spara/återöppna/avslut |
| `/prices/` | Adminprisdatabas via `/api/price-catalog` | Authad katalogredigering; inte publika `/priser/` | P2 F11/F13; ladd-/authstatus vag | Read-only GET och beslutad prisversion |
| `/quick-price/` | Katalog, lokal offertkorg, explicit skapa case | Kopierbar preliminär text; ingen betalning vid kopiering | P2 prisdrift, tomt 0 och kvarvarande laddning vid fel | Tydlig unavailable och konsekvent prisartikel |
| `/checkout/` | Verkstadens betalflöde via cases/katalog | Ej samma som publik Stripe-kassa; har riktiga SMS-/avslutsknappar | P1 F02/F06; manuellt betald är inte bankverifierad betalning | Testa belopp/approval/avslut utan riktig send |
| `/priser/` | Statisk publik serviceprislista | Läslig mobil stapling; bokningsväg finns | P2 F11; horisontell scroll synlig i smal viewport, orsak behöver layouttest | Harmoniserade priser; liten responsive-fix med skärmbildstest |
| `/nya-elscootrar/`, `/produkt/*` | Genererad katalog från `data/products.json` | 44 produkt-/checkout-ID:n verifierade; idempotent build | P1 F05; betalsätt/frakt i copy behöver matcha faktisk kassa | Sessionspayload-test före fler produktändringar |
| `/status/` | Begränsad publik DTO via separat servicenummer | Tydlig enkel entré; ingen riktig kund söktes | P2 GET-indexwrite; äldre case-länkar är också capabilities | Behåll whitelist och testa indexfallback utan oväntad write |
| Chattwidget | `/api/workshop-chat`, lokal formulärstate | Är asynkron intake, inte live bemannad AI-chatt; tydlig text | P2 F14; exakt modell mindre strikt än booking | Begränsa retention och harmonisera intakekrav |
| NEMOB OS | Lokal JSON, lokal kunskap, explicit proxy till Nordic | Bra testad prioritering/kunskap; LAN kräver PIN; loopback annat skydd | P2 F15; inte helt read-only längre, call/sms-actions finns | Återställningstest och aktuell driftdokumentation |

Skärmbilderna visar layout/state, inte lyckade kundtransaktioner. Exempel:
`03-admin-no-token.png` visar noll/ladd/fel-konflikten; `04-admin-telephony-no-token.png`
visar source-status; `09-public-prices.png` visar smal prisvy.

### API och sidoeffekter

| Endpoint / funktion | Auth och datakälla | Läsläge / fungerande gräns | Skrivning/sändning eller kvarstående risk |
| --- | --- | --- | --- |
| `POST /api/bookings` (`booking.mjs`) | Publik intake; workshop-cases, index, idempotency, kalender | Honeypot, enkel rate limit, datum och fordonsvalidering | Skapar case, notifierar kund/personal och kalender; F01. Publikt pickupCaseId kan uppdatera angivet case (`:1197`), kräver separat ägarskapsgranskning |
| `/api/cases` (`workshop-cases.mjs`) | x-admin-token; workshop-cases | GET är verklig huvudkälla, sorterar och läser case-objekt | POST/PATCH/DELETE muterar; vissa actions sänder; F02. Status på generell PATCH saknar enum-whitelist (`:805`) |
| `/api/call-dashboard` | x-admin-token; 46elks calls/me + flera Blobs | 60-dagarsfönster, paginering, separat privatlinje; okänd källa kan rapporteras | GET saldolarm skriver/sänder, syncLeads=1 skriver; POST flera explicita actions. Ingen authad live-GET kördes |
| `ai-daily-brief` | x-admin-token; primärt intern `/api/cases`, sedan service_cases; optional calls/drafts/parts | GET bygger regelbaserad brief; explicit dryRun använder tomma dataset | POST normalt sparar rekommendation; F08/F09. Saknade sidokällor fångas |
| `ai-quote` | x-admin-token; price_rules/default business-rules | Explicit dryRun: 201, E16 395 / 595-1995, diagnos och approval true | Normal-läge kan läsa/spara rekommendation/event; inte smoke-säkert utan flagga |
| `ai-sms-draft` | x-admin-token; case/kund/price-rules och AI/fallback | Skapar förslag, inte SMS-sändning | Normalt persistent draft och event, ev. AI-provider; inte ett read-only test |
| `call-logs` | x-admin-token; legacy call-logs store | GET och sourceUnavailable; auth testad | POST normalt call/event-write; explicita readOnly/dryRun-flaggor finns. Bevisar inte 46elks-import |
| `customer-export` | x-admin-token; `/api/cases`, direkt workshop-cases fallback, optional customers/communication-events | Dedup/filter, phones och emails, source/storageHealth; inga send-anrop | Read-only; partial/unavailable får inte tolkas som att kunder saknas. Inga verkliga adressantal fastställdes |
| `storage-health` (v2 `.mjs`) | Server-side token; list av sex stores | Read-only, env-signaler som booleans, inga tokenvärden | Storeåtkomst är inte bevis för att importen fyller data; runtime ej liveverifierad |
| `case-events` | x-admin-token; case-events + casevalidering | GET per case | POST skapar event/note; timeline-integrationen F10 |
| Legacy `/.netlify/functions/sms-drafts` | x-admin-token; sms-drafts | GET, statusflöde inklusive dry_run | POST/PATCH sparar, skickar inte SMS; sent kan vara manuell markering, inte kvitto |
| `/api/sms-drafts` (`sms-draft-inbox`) | x-admin-token; samma sms-drafts + cases/optout | GET väntande förslag | PUT kan mailnotifiera; approve skickar SMS och skriver/raderar; F04. Namnlikhet är farlig |
| `/api/price-catalog` | x-admin-token; price-catalog/items | Seed + sparad katalog | GET kan skriva seed; PUT/POST ändrar katalog; F11/F13 |
| `/api/cases/:id/sms`, `:id/call` | x-admin-token; case + 46elks | Explicit operatörsaction | Riktiga sends/calls och loggar; ska aldrig användas i read-only smoke |
| `/api/case-status/:id` | Servicenummer/äldre capability, begränsad kund-DTO | GET status med no-store | GET kan reparera index; POST request_update skriver och kan SMS-notifiera |
| `/api/workshop-chat` | Publik intake; cases/index/idempotency | Namn/telefon/meddelande, inte en lista över kunder | Skapar ärende och notifieringar; inget sådant anrop gjordes |
| `create-checkout` / `stripe-webhook` | Publik produkt-ID till serverkatalog; webhook signatur | Pris väljs server-side; ingen klientangiven totalsumma | Stripe-session, betalningslagring/notifiering; F05. Verklig webhookleverans ej testad |
| `/api/sms-inbound`, voice- och notify-hooks | Providerkontrakt, varierande secret/IP-skydd | Kräver egen konfigurationsrevision, inte admin-token som ersättning | SMS/call-event/voicemail kan skriva/notifiera; F07; inga riktiga meddelanden lästes |
| `outbox-flush`, `ring-list-scan`, `ring-escalate`, `elks-webhook-sync` | Schemalagda serverfunktioner | Inte passiva dashboards | Köutskick, listor/larm, providerkonfiguration; F06. Aktiva driftscheman ej verifierade |
| `/api/case-similar`, `repair-canon`, `repair-stats` | x-admin-token; repair-index/canon | Återanvänder tidigare reparationer och visar safety-vakt | similar-GET mäter hits; canon-PUT explicit import. Coverage för regression behövs |
| `/api/claude-brief/:slug` | Separat minst 48 tecken capability, constant-time compare | Minimal brief, no-store, read-only; ej använd i revisionen | Secret i URL kräver skydd mot delning/loggar. Inte samma auth som admin |
| Cloudflare Worker `nemob-callflow` | D1 call_log, providerkontroll + ADMIN_KEY för rapport | TypeScript check grön, separat arkitektur | Huvudadminens dashboard läser nu 46elks direkt, inte D1. Aktuell routning måste verifieras innan ändring |

Ytterligare kodgranskade stöd: case-media, booking-env-status,
calendar-self-test, shared auth/http/storage, produktskapande och
publiceringsallowlist. Inga live-kalender-, media- eller betalningsoperationer kördes.

### Datakällor: det som är sant i denna version

1. `/api/cases` läser riktiga `workshop-cases` i Netlify Blobs. Det är en API-väg
   till Blobs, inte en separat databas som fungerar helt oberoende av Blobs.
2. Legacy v1-funktioner ansluter numera context via `connectBlobs(event)` i
   `_shared/storage.js`. `storage-health.mjs` är v2. Den tidigare
   MissingBlobsEnvironmentError-orsaken får inte återanvändas som aktuell
   production-diagnos utan ny mätning.
3. Kundexport använder nu `/api/cases` först och separata kund-/kommunikations-
   stores som komplettering. E-postantal och telefonantal är olika mått.
4. Live telefoni kommer primärt från 46elks REST. Legacy `call_logs` och
   Cloudflare D1 är andra källor och kan vara tomma utan att växeln är tom.
5. Demo-radarn är faktiskt märkt och ihopfälld i aktuell admin. Den ska inte
   byggas om för att lösa ett äldre redan åtgärdat demo/live-problem.
6. `sms-drafts` och timeline har däremot verkliga kontraktskonflikter, F04/F10.
7. Installerad Blobs-SDK samlar själv alla list-sidor om `paginate` inte sätts
   (`node_modules/@netlify/blobs/dist/main.js:140`). **Ingen påstådd
   pagineringsbugg i vanliga store.list()**. Sekventiell läsning av alla case
   kan däremot bli långsam; `workshop-cases.mjs:360` läser en post i taget.
8. `dist/` byggs med allowlist, inte genom publicering av hela repot. Docs,
   scripts, kund-/OS-data och node_modules ska inte följa med publik artefakt.
   Lokal build bekräftade allowlist-verifieringen.
9. Adminens service worker cachar skalet men undantar `/api/` och
   `/.netlify/` (`admin/service-worker.js:25`). Äldre fel med cacheade
   API-svar ska inte beskrivas som aktuella utan ny evidens.

Kvarstående säkerhetsgränser att planera separat: delat admin-token i
localStorage utan personliga serverroller, in-memory-rate-limits som inte
delas mellan instanser, verifierad backup/restore av operativa Blobs och
provider-webhooks med återleverans/idempotens. Revisionen certifierar inte
hela systemet mot intrång eller leverantörsavbrott.

## Föreslagen gemensam KPI-modell

Behåll UI:s korta namn men dela **definition**, inte bara etikett. Varje mått
ska ha source, fetchedAt och availability. Okänd källa är null/okänd, inte 0.
Urvalet ska vara identiskt i huvudbrief, lokal fallback och klickbar ärendelista.
Detta är förslag, ingen datamodellmigration är gjord.

| KPI | Definition att besluta och regressionstesta |
| --- | --- |
| Gör nu | Unika ärenden med förfallen/idag nästa åtgärd, ej bekräftad ny förfrågan, säkerhetsrisk eller operativt stopp. Räkna före top-N |
| Nya utan bekräftelse | Ny kundförfrågan där ingen av avsedda kontaktkanaler lyckats; visa partial/not_requested separat |
| Missade samtal att följa upp | Verklig växelkälla, ej hanterade kontakter. Ange om enheten är samtal eller unika nummer och vilket tidsfönster som gäller |
| Väntar kund | waiting_customer eller dokumenterat väntande godkännande; nästa påminnelsedatum, inte automatiskt skickad påminnelse |
| Väntar del | waiting_parts och/eller öppet part_need, deduplicerat per case |
| Klara att hämta | Alla ready som inte lämnats ut. Delmängden kund ej notifierad visas separat och får inte ersätta totalen |
| Klara att fakturera/betala | Utfört/godkänt arbete och fastställt belopp över 0 utan betald/invoiced-status. Förfrågningar och estimates räknas inte som fakturor |
| Risk/stått stilla | Tydliga säkerhetsflaggor, passerat kundlöfte/nextAction och stagnerat verkstadsarbete. Saknad modell är datakvalitet, visas separat |
| Ej arkiverade | Tekniskt statusurval, uttryckligt om done ingår. Inte antal fysiskt inlämnade fordon |
| Möjligt inflöde | Fastställda obetalda belopp i vald period, märkt potential. Håll skilt från bokförd/betald intäkt och generiska leads |

Komplettera Repair Intelligence med ifyllnadsgrad modell/grundorsak/arbetstid,
återanvända verifierade lösningar och tid till nästa konkreta åtgärd. Visa
inte heuristisk lead-poäng som uppmätt stängningssannolikhet utan kalibrering.

## Tester och faktisk evidens

| Kontroll | Resultat |
| --- | --- |
| `npm run build` | PASS: voice 24/24, status 11/11, 45 produkter, 4 tillbehör, 44 produktsidor; inga HTML-ändringar; dist 45 poster |
| `npm run verify:checkout-products` | PASS: 44 checkout-produkter |
| `npm run check` i nemob-callflow | PASS: tsc --noEmit; inga levande scenarier körda |
| `npm run test:nemob-os` | PASS: 75/75 |
| `npm run test:knowledge` | PASS: 6/6; tre av dessa ingår även i OS-sviten, summera inte som unika nya tester |
| Syntaxaudit | PASS: 108 JS/MJS/CJS-filer, 136 inline-script och 166 JSON-LD-block |
| Explicit AI dry-run | daily 200; quote 201 med E16 395/595/1995 och approval/diagnos true; 0 reads/writes/nätverk |
| Auth utan/fel token | 401 för daily/quote och call-logs/customer-export/case-events/sms-drafts/ai-sms-draft med normala payloads |
| Ogiltig null-body | daily returnerar JSON 500 före auth; F09 |
| Reproduktionsharness | 11 evidensposter; samtliga assertions för observerat beteende passerade. Detta inkluderar bekräftade FEL, inte bara godkända funktioner |
| Browser | 11 sparade skärmbilder, statisk lokal vy; inga formulär/sends/betalningar genomförda |
| Production/remote | EJ VERIFIERAT: nätverksfel; ingen authad production-smoke körd |

Reproduktion: `node --experimental-vm-modules audit-evidence/audit-probes.mjs`
från den separata audit-worktreen. Experimentell VM-varning är väntad.
Probe-skriptet läser inte miljöfiler och alla externa requests är stubbar.

## Arbetsfördelning med Claude Code

**Claude är samarbetspartner i huvudarkitekturen, inte en kodkälla som ska
mergeas från den gamla Next/Supabase-prototypen.** Pågående GSC/query-mining
i sync-loggen lämnas orört. Ingen ny uppgift har skickats till Claude här.

| Ordning | Avgränsad PR / leverans | Föreslagen huvudägare | Granskare / acceptans |
| --- | --- | --- | --- |
| 1 | Publik boknings-whitelist och ägarskap för pickup-referens, F01 | Codex | Claude kontrollerar att kundkvittensen fortfarande fungerar; inga privata fält |
| 2 | Case-mutationskontrakt och samtidighet, F02 | Codex | Claude provar två separata klienter med syntetiska notes/status; inga förlorade uppdateringar |
| 3 | Read-only dashboard och ärliga dryRun-labels, F03/F09/F13 | Codex | Provider-spy: inga sends/writes i läsläge, även vid fel/lågt saldo |
| 4 | Versionsadapter för drafts och sammanfogad timeline, F04/F10 | Codex | Claude testar inbox/kundkort med äldre och nya format; dokumenterad migration |
| 5 | Checkout-fallback och outbox-ack/retry, F05/F06 | Codex | Providerfel testas utan riktig betalning/mail; ekonomiska villkor bevaras |
| 6 | Webhook-konfigurationsinventering och stegvis auth-hardening, F07 | Codex + Sebastian | Sebastian godkänner separat driftsändring; fungerande telefon får inte brytas |
| 7 | En KPI-definition och UI-states, F08/F12 | Codex: kontrakt; Claude: liten UI/copy-PR därefter | Samma syntetiska cases ger samma urval i alla vyer; ingen samtidig redigering av admin |
| 8 | Pris-/löftesmatris, dokumentationssanering och chattretention, F11/F14/F16 | Claude: fakta/copy/docs; Codex: avgränsad retentionfix | Sebastian fastställer priser/SLA; båda granskar samma faktamatris |
| 9 | NEMOB OS återställning och kunskapsloopen, F15 | Codex | Backup/restore-test; därefter mer casebaserad kunskap, inte fler demoagenter |
| Parallellt | GSC/query-mining, innehållsbriefar från verifierade verkstadsfakta | Claude | Endast läsning/utkast tills operativ data är stabil; ingen automatisk publicering |

Ta F17/F18 som små integritets-PR:er innan mer kundbaserat innehåll eller
analytics byggs ut: Codex äger redaktion/routegrind, Claude granskar att
publiceringsunderlag och mätdefinitioner inte behöver privata identifierare.

### Samarbetsregler som behövs i praktiken

- En egen git-worktree per agent och uppgift. Ingen växling/reset i den andres
  gemensamma arbetsmapp; inga stash-pop/reset/restore av andras förändringar.
- Starta med synkad commit när nätverk fungerar, namnge ägda filer och logga
  PÅGÅR/KLAR. Sync-loggens båda poster måste bevaras vid konflikt.
- En ägare åt gången för `admin/index.html`, booking, workshop-cases och
  SMS-moduler. Den andra granskar diff/testfall, inte parallellredigerar.
- En liten PR per kontrakt. Ingen historikomskrivning eller direkt main-push
  för att snabbt komma runt andra agenters ändringar.
- Handoff: commit, ändrade filer, exakta sidoeffekter, testkommando,
  schema-/migrationspåverkan, rollback och vad som inte har verifierats.
- Grön build räcker inte. Kräv scenario-test för berörd användarresa och
  noll externa sends i testmiljön. Claude kan effektivt skriva acceptansfall
  och granska begriplighet medan Codex äger backendriskerna.

## Handoff och stopplinje

Endast denna rapport och egen post i `docs/AGENT_SYNC_LOG.md` ändrades i
huvudrepot. Applikationen har inte ändrats. Ingen branch byttes i delad mapp.
Revisionsunderlag/testgenerering ligger i den separata lokala worktreen.
Inga commits pushades och ingen deploy startades av revisionen.

Båda befintliga stashes lämnades orörda (`9ab992f`, `15b497d`). Befintligt
otrackat `tmp/` lämnades orört. **Inga verkliga mail, SMS, samtal, betalningar
eller production-writes gjordes.** Inga privata SMS eller kundlistor hämtades.

Rekommenderad nästa implementation är PR 1 ovan, följd av den tydligt avgränsade
read-only-fixen; starta inte en stor sammanslagen omskrivning. Ny production-
verifiering behöver nätverk och separat godkännande för varje skrivande flöde.
