# Deployment Runbook — nemob-callflow

**Skapad:** 2026-05-08 av Cowork
**För:** Boss (Sebastian)
**Tid:** ~45-60 min totalt
**Förutsättningar:** Cowork har gjort kod-fixarna (P0-1, P1-1, P1-4, P1-7). MP3-filer finns publicerade.

---

## Förberedelser (BOSS måste göra detta innan vi börjar)

### F1. Skapa Cloudflare-konto (om du inte har)

1. Gå till [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Verifiera email
3. **Workers Plan:** Free tier räcker (100k requests/dygn). Du behöver inte uppgradera.

### F2. Installera Wrangler CLI

Öppna **PowerShell** eller **Terminal** på din Windows-maskin:

```bash
npm install -g wrangler
wrangler --version
```

Förväntat output: ngn version >= 3.x.

### F3. Logga in på Wrangler

```bash
wrangler login
```

Detta öppnar en browser → logga in på Cloudflare → tryck "Allow". Tillbaka i terminal ser du "You are now logged in".

### F4. MP3-filer redo

Du behöver dessa fyra filer publicerade på en stabil HTTPS-URL:

- `welcome.mp3`
- `voicemail-prompt.mp3`
- `outside-hours-prompt.mp3` (med GDPR-text — se `docs/codex-review-46elks.md` P0-2)
- `hold-music.mp3`

**Var publicera dem?** Tre alternativ:

**Alt A (enklast):** Lägg dem i din existerande Netlify-sajt under `/audio/`-mappen. Fungerar direkt eftersom Netlify servar statiska filer. URL:er blir:
- `https://www.nordicemobility.se/audio/welcome.mp3`
- etc

**Alt B:** Cloudflare R2 (mer "rätt", lite mer setup). Hoppa om du inte vill lära dig R2.

**Alt C:** ElevenLabs hostar MP3:erna direkt om du genererar dem där.

→ **Rekommendation: Alt A.** Säg till om du vill ha hjälp med Netlify-uppladdning.

### F5. 46elks-credentials redo

Logga in på [46elks.com](https://46elks.com) → Settings → API → kopiera:
- API username (typ `u_abc123def`)
- API password (random sträng)

Anteckna säkert (lösenordshanterare). **Skicka INTE dessa till mig.**

---

## Steg 1 — Skapa Cloudflare D1-databas

```bash
cd E:\nordic-emobility-github-push\nemob-callflow
wrangler d1 create nemob-callflow
```

**Förväntat output:**
```
✅ Successfully created DB 'nemob-callflow'
[[d1_databases]]
binding = "DB"
database_name = "nemob-callflow"
database_id = "1234abcd-5678-..."
```

**Kopiera `database_id`-värdet.**

---

## Steg 2 — Skapa KV-namespace

```bash
wrangler kv namespace create CALLFLOW_KV
```

**Förväntat output:**
```
🌀 Creating namespace with title "nemob-callflow-CALLFLOW_KV"
✨ Success!
[[kv_namespaces]]
binding = "CALLFLOW_KV"
id = "abcd1234..."
```

**Kopiera `id`-värdet.**

---

## Steg 3 — Uppdatera wrangler.toml

Öppna `E:\nordic-emobility-github-push\nemob-callflow\wrangler.toml`:

```toml
name = "nemob-callflow"
main = "src/index.ts"
compatibility_date = "2026-05-08"

[[d1_databases]]
binding = "DB"
database_name = "nemob-callflow"
database_id = "KLISTRA_IN_DATABASE_ID_FRÅN_STEG_1"   # ← här

[[kv_namespaces]]
binding = "CALLFLOW_KV"
id = "KLISTRA_IN_KV_ID_FRÅN_STEG_2"   # ← här

[triggers]
crons = ["0 3 * * *"]
```

**Spara filen.**

---

## Steg 4 — Migrera D1-schemat

```bash
wrangler d1 execute nemob-callflow --remote --file=migrations/0001_init.sql
```

**Notera:** Använd `--remote` för production-databas (inte `--local`).

**Förväntat output:**
```
🌀 Executing on remote database nemob-callflow
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
✓ executed 3 commands in 0.4 sec
```

---

## Steg 5 — Sätt secrets (10 kommandon)

**VIKTIGT:** Varje `wrangler secret put` öppnar en prompt där du klistrar in värdet. **Värdet visas INTE på skärmen** — det är design.

Kör dessa **en i taget**:

```bash
wrangler secret put ELKS_USERNAME
# Klistra in: u_abc123def... (från 46elks)

wrangler secret put ELKS_PASSWORD
# Klistra in: din-46elks-password

wrangler secret put ELKS_FROM_NUMBER
# Klistra in: +46101385498

wrangler secret put ELKS_ALLOWED_IPS
# Klistra in: 176.10.154.199,85.24.146.132,185.39.146.243,2001:9b0:2:902::199

wrangler secret put SEBASTIAN_NUMBER
# Klistra in: +46101385498 (eller ditt aktuella mobilnummer)

wrangler secret put LENNART_NUMBER
# Klistra in: +46101385498

wrangler secret put ADMIN_KEY
# Klistra in: en-slumpmässig-hemlig-string-32-tecken
# Generera med: node -e "console.log(crypto.randomBytes(32).toString('hex'))"

wrangler secret put INTRO_MP3_URL
# Klistra in: https://www.nordicemobility.se/audio/welcome.mp3 (din publicerade URL)

wrangler secret put HOLD_MUSIC_MP3_URL
# Klistra in: https://www.nordicemobility.se/audio/hold-music.mp3

wrangler secret put VOICEMAIL_PROMPT_MP3_URL
# Klistra in: https://www.nordicemobility.se/audio/voicemail-prompt.mp3

wrangler secret put OFFICE_HOURS_PROMPT_MP3_URL
# Klistra in: https://www.nordicemobility.se/audio/outside-hours-prompt.mp3
```

**Optional (skippa om du inte använder Apps Script-backup):**
```bash
wrangler secret put APPS_SCRIPT_WEBHOOK_URL
# Klistra in din Apps Script webhook URL
```

**Skippas helt:**
- `ELKS_WEBHOOK_SECRET` (HMAC är inte aktiv för v1)
- `REQUIRE_ELKS_SIGNATURE` (default false)

---

## Steg 6 — Verifiera setup

```bash
wrangler secret list
```

Du ska se ALLA secrets från Steg 5. Inga värden visas (bra, så ska det vara), bara namn.

---

## Steg 7 — Deploya

```bash
wrangler deploy
```

**Förväntat output:**
```
Total Upload: 14.32 KiB / gzip: 4.21 KiB
Uploaded nemob-callflow (1.83 sec)
Published nemob-callflow (0.47 sec)
  https://nemob-callflow.<din-cloudflare-account>.workers.dev
Current Deployment ID: ...
```

**Kopiera worker-URL:en.** Den ser ut typ `https://nemob-callflow.boss-account.workers.dev`.

---

## Steg 8 — Smoke-test webhook

Innan du kopplar in 46elks, testa att webhooken svarar:

```bash
curl -X POST https://nemob-callflow.<din-account>.workers.dev/voice \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "callid=test&from=+46701234567&to=+46101385498"
```

**Förväntat:** JSON-respons med antingen `ivr` (om office hours) eller `play` (om utanför).

**Om du får 403:** ELKS_ALLOWED_IPS blockerar din lokala IP. För smoke-test: kör temporärt:
```bash
wrangler secret delete ELKS_ALLOWED_IPS
# Gör smoke-test
# Sätt tillbaka:
wrangler secret put ELKS_ALLOWED_IPS
# Klistra in IPs igen
```

ELLER acceptera att smoke-test inte funkar och hoppa till Steg 9.

---

## Steg 9 — Koppla in 46elks

1. Logga in på [46elks.com](https://46elks.com)
2. Numbers → välj ditt verkstadsnummer (010-138 54 98)
3. **Voice Start:** Sätt URL till:
   ```
   https://nemob-callflow.<din-account>.workers.dev/voice
   ```
4. Spara

---

## Steg 10 — Live-test

### Test 1 — Office hours, option 1
1. Ring 010-138 54 98 från din egen mobil
2. Hör välkomstprompten
3. Tryck **1** → Hold music spelar → Lennarts mobil ringer
4. Lennart svarar → samtalet kopplas

**Verifiera i D1:**
```bash
wrangler d1 execute nemob-callflow --remote --command "SELECT * FROM call_log ORDER BY id DESC LIMIT 5"
```

Du ska se rader för "started", "route", "answered" med korrekta värden.

### Test 2 — Option 1, Lennart svarar inte
1. Lennart sätter mobil i flygplansläge
2. Ring 010-138 54 98 → tryck 1
3. Vänta 25s → automatiskt fallback till Sebastian
4. Sebastian svarar

### Test 3 — Båda missar → voicemail
1. Båda i flygplansläge
2. Ring → tryck 1 → vänta 50s totalt
3. Voicemail-prompten spelar (med GDPR-consent-text)
4. Lämna meddelande
5. Sebastian får SMS med caller-nummer + recording URL
6. Caller får SMS med "Tack för samtalet..."

### Test 4 — Outside hours
1. Vänta till kl 18:01 fredag (eller helg)
2. Ring → outside-hours-prompten → voicemail

### Test 5 — Stats endpoint
```bash
curl "https://nemob-callflow.<din-account>.workers.dev/stats?key=DIN_ADMIN_KEY"
```

Ska returnera JSON med `calls_today`, `missed_today`, etc.

---

## Steg 11 — Verifiera GDPR-retention på 46elks

1. 46elks Dashboard → Account → Settings → Recordings
2. Sätt retention till **MAX 90 dagar**
3. Screenshot:a inställningen, spara i `docs/gdpr-46elks-retention.png`

---

## Felsökning

### `wrangler login` öppnar inte browser
- Använd `wrangler login --browser=false` och öppna URL:en manuellt

### `wrangler d1 create` säger "name already in use"
- Du har redan skapat den. Kör `wrangler d1 list` för att hitta ID

### Worker returnerar 500 på live-samtal
- Kör `wrangler tail` i en separat terminal för att se realtids-loggar
- Vanligaste orsak: env-var saknas eller MP3-URL svarar inte 200

### 46elks Voice Start ger felmeddelande "Could not parse response"
- Worker returnerar inte valid JSON. Använd `wrangler tail` att se vad som händer
- Verifiera att Content-Type-header är `application/json`

### SMS skickas inte
- Verifiera ELKS_USERNAME + ELKS_PASSWORD
- 46elks default kräver att du har "credit" på kontot. Toppa upp om saldot är 0
- Kolla 46elks → Activity logs

### D1-loggning fungerar lokalt men inte i produktion
- Du kör `--local` istället för `--remote`. Lägg till `--remote`-flaggan

---

## Roll-back-plan

Om något går katastrofalt fel under live-test:

1. **Snabbast:** Återgå till gamla 46elks Voice Start-config (kopiera-klistra in JSON från innan migrering)
2. Om du inte sparade gamla config: skicka ALLA samtal till voicemail temporärt:
   ```json
   {"play": "https://www.nordicemobility.se/audio/system-down.mp3", "next": {"record": "https://nemob-callflow.account.workers.dev/event/voicemail-saved", "timelimit": 90}}
   ```

3. Felsök i lugn och ro, deploya fix, växla tillbaka

---

## Rapportera tillbaka till Cowork

Efter varje steg, säg vilket steg du är på + skicka antingen:
- "Step X funkade" (kort bekräftelse)
- Screenshot av eventuella fel

**SKICKA INGA SECRETS** även om felmeddelandet innehåller dem. Maska först.

---

## Nästa session efter live-deploy

När detta är live har vi följande väntande:
- SEO-fixar (P0-fynd från audit)
- Hemsidan-omstrukturering (Option 1, /verkstad/ + /butik/)
- Snipcart-integration för shop
- 3 nya stadssidor (Kumla, Hallsberg, Karlskoga)
