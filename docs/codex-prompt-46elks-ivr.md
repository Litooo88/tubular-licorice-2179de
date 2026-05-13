# Codex Prompt — 46elks IVR Webhook (Nordic E-Mobility)

**Skapad:** 2026-05-08 av Cowork (review/hardening av Boss originalprompt)
**Avsedd för:** Codex som bygger Cloudflare Workers-webhook
**Status:** Klar att skickas till Codex

---

## Hur denna prompt skiljer sig från Boss originalversion

9 säkerhetsgap, GDPR-luckor och tekniska missar fixade:

1. Mid-call DTMF-transfer (#-tangent) **avskaffat** — fungerar inte tillförlitligt i 46elks utan extra bridge. Ersatt med native call-transfer som Sebastian kan göra direkt på sin mobil.
2. Hold-music **omdesignat** — spelas FÖRE connect, inte samtidigt (begränsning i 46elks).
3. Auto-SMS till caller **förkortat** — borttagen verksamhetsadress för att inte trigga marknadsföringslag/PUL.
4. GDPR-consent-line **explicit text** specificerad.
5. Storage-strategi **explicit specifierad**: 46elks egen recording-storage (de raderar efter 30 dagar default — vi konfigurerar 90).
6. **Webhook-säkerhet tillagd**: 46elks IP-allowlist + shared secret.
7. Apps Script som logging-target **kompletterad** med Cloudflare D1 som primary, Apps Script som backup.
8. **Office hours** uppgraderat från "nice-to-have" till **mandatory** med explicit logik.
9. **Ärlig setup-instruktion** — README listar alla `wrangler secret put`-kommandon explicit.

---

## PROMPTEN (kopiera nedan till Codex)

---

# TASK: Build 46elks call-routing webhook for Nordic E-Mobility

## Context

Nordic E-Mobility is a small e-mobility workshop in Örebro, Sweden. They use 46elks (Swedish telephony provider) for their main business number. Currently, calls route via a static JSON config in 46elks' "Voice Start" field. We're migrating to a Cloudflare Workers webhook for richer logic.

## Tech stack (locked)

- **Runtime:** Cloudflare Workers (NOT Vercel — we need <50ms cold start)
- **Storage:**
  - Cloudflare D1 (call logs)
  - Cloudflare R2 (NOT used — we rely on 46elks' built-in recording storage with 90-day retention configured via API)
  - Cloudflare KV (for shared secrets, transient state)
- **Deploy:** Wrangler CLI (`wrangler deploy`)
- **Cron triggers:** For purging expired call-log entries (separate from voicemail recordings)
- **Language:** TypeScript

## Repo structure

Extend existing repo OR create new repo `nemob-callflow`. Recommend:

```
nemob-callflow/
├── src/
│   ├── index.ts              # Worker entry, route handlers
│   ├── flow.ts               # IVR flow logic (intro → dial → voicemail)
│   ├── auth.ts               # 46elks webhook validation (HMAC + IP allowlist)
│   ├── notify.ts             # SMS sending (missed call notifications)
│   ├── log.ts                # D1 logging + Apps Script backup
│   ├── officeHours.ts        # Time/day logic
│   └── types.ts              # 46elks webhook payload types
├── migrations/
│   └── 0001_init.sql         # D1 schema for call_log table
├── test/
│   └── scenarios.sh          # Curl-based test script
├── wrangler.toml
├── package.json
├── README.md
└── .env.example              # Lists all required env vars
```

## Required environment variables

Listed for `wrangler secret put` setup:

```
ELKS_USERNAME             # 46elks API username (for outbound API calls)
ELKS_PASSWORD             # 46elks API password
ELKS_FROM_NUMBER          # Verkstadsnummer in E.164 (the public number)
ELKS_WEBHOOK_SECRET       # Shared secret for HMAC validation of incoming
ELKS_ALLOWED_IPS          # Comma-sep 46elks IP ranges (verify current list at 46elks docs)
SEBASTIAN_NUMBER          # E.164, e.g. +46700243319
LENNART_NUMBER            # E.164, e.g. +46722607753
APPS_SCRIPT_WEBHOOK_URL   # Backup logging endpoint (optional)
INTRO_MP3_URL             # Public URL to welcome.mp3
HOLD_MUSIC_MP3_URL        # Public URL to hold-music.mp3 (5-second loop max)
VOICEMAIL_PROMPT_MP3_URL  # Public URL to voicemail-prompt.mp3
OFFICE_HOURS_PROMPT_MP3_URL  # Public URL to outside-hours-prompt.mp3
```

## IVR flow specification

### Inbound call lands on `POST /voice`

#### Step 1 — Validate request

- Check `Authorization` HMAC header against `ELKS_WEBHOOK_SECRET`
- Check source IP against `ELKS_ALLOWED_IPS`
- If either fails → 403, log silent rejection
- Parse 46elks payload: `from`, `to`, `callid`, `direction`, `created`

#### Step 2 — Office hours check

```typescript
function isOfficeHours(now: Date, tz: string = 'Europe/Stockholm'): boolean {
  // Office hours: Mon-Fri 09:00-18:00 Europe/Stockholm
  // Saturday-Sunday: closed
  // Swedish public holidays: closed (consider hardcoding 2026 dates)
}
```

- **If outside office hours:** Skip IVR, play `OFFICE_HOURS_PROMPT_MP3_URL`, then go straight to voicemail (Step 6).
- **If office hours:** Continue to Step 3.

#### Step 3 — Intro IVR (only during office hours)

Return 46elks JSON response:

```json
{
  "play": "{{INTRO_MP3_URL}}",
  "ivr": {
    "1": "https://yourworker.com/route/sebastian",
    "2": "https://yourworker.com/route/lennart",
    "timeout": 8,
    "default": "https://yourworker.com/route/sebastian"
  }
}
```

**Welcome MP3 script (Boss provides this MP3):**
> "Välkommen till Nordic E-Mobility. Tryck 1 för verkstad, tryck 2 för försäljning. Vi kopplar dig direkt."

#### Step 4 — Hold music + dial

When `/route/sebastian` or `/route/lennart` is hit:

```json
{
  "play": "{{HOLD_MUSIC_MP3_URL}}",
  "next": "https://yourworker.com/dial/{primary}"
}
```

Then `/dial/sebastian` returns:

```json
{
  "connect": "{{SEBASTIAN_NUMBER}}",
  "callerid": "{{ELKS_FROM_NUMBER}}",
  "timeout": 25,
  "next": "https://yourworker.com/dial/lennart-fallback?callid={callid}",
  "whenhangup": "https://yourworker.com/event/hangup?callid={callid}"
}
```

**Important:** Do NOT attempt to implement mid-call DTMF transfer ("press # to send to Lennart"). 46elks doesn't reliably support this without a SIP bridge layer. Instead:

- If Sebastian wants to forward the call mid-conversation, he uses **his mobile's native call-transfer feature** (most modern Android/iOS phones support this on the carrier level).
- Document this in README under "Operator instructions for Sebastian/Lennart".

#### Step 5 — Lennart fallback

`/dial/lennart-fallback` returns:

```json
{
  "connect": "{{LENNART_NUMBER}}",
  "callerid": "{{ELKS_FROM_NUMBER}}",
  "timeout": 25,
  "next": "https://yourworker.com/voicemail?callid={callid}",
  "whenhangup": "https://yourworker.com/event/hangup?callid={callid}"
}
```

#### Step 6 — Voicemail

`/voicemail` returns:

```json
{
  "play": "{{VOICEMAIL_PROMPT_MP3_URL}}",
  "next": {
    "record": "https://yourworker.com/event/voicemail-saved?callid={callid}",
    "timeout": 90,
    "skipBeep": false
  }
}
```

**Voicemail prompt MP3 script (mandatory exact text — Boss must record this):**
> "Du har kommit till Nordic E-Mobilitys röstbrevlåda. Lämna ditt namn, telefonnummer och vad det gäller efter pipet. Genom att lämna ett meddelande godkänner du att samtalet spelas in och lagras i 90 dagar för att vi ska kunna återkomma. Tryck fyrkant när du är klar."

This GDPR-consent line is **mandatory** — without it, recording calls is technically illegal under GDPR Art. 6 (lawful basis missing).

#### Step 7 — Notifications

When `/event/voicemail-saved` is hit (caller left a message):

**SMS to Sebastian:**
```
Missat samtal från {caller_e164} kl {HH:MM}.
Voicemail: {recording_url}
```

**SMS from ELKS_FROM_NUMBER to caller:**
```
Hej! Tack för ditt samtal till Nordic E-Mobility.
Vi är upptagna just nu men har sett att du ringt.
Vi återkommer under dagen.
Akut ärende? Skriv hit på SMS. /Nordic E-Mobility
```

**Notes on auto-SMS to caller:**
- Do NOT include verksamhetsadress in this SMS — risk of being classified as direct marketing under Marknadsföringslagen
- Do NOT include "tryck för rabatt" or any sales language
- This is a transactional service confirmation — that's the only legal framing

When Lennart picks up after Sebastian misses (`/event/hangup` with `answered_by=lennart` and `state=success`):

**SMS to Sebastian:**
```
Lennart tog samtal från {caller_e164} kl {HH:MM}, varaktighet {duration}s.
```

#### Step 8 — Logging

Every call event writes one row to D1 `call_log` table:

```sql
CREATE TABLE call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  callid TEXT NOT NULL,
  caller_e164 TEXT NOT NULL,
  duration_s INTEGER,
  answered_by TEXT,         -- 'sebastian' | 'lennart' | 'voicemail' | 'missed'
  status TEXT,              -- 'answered' | 'missed' | 'voicemail' | 'rejected'
  ivr_choice TEXT,          -- '1' | '2' | 'default' | 'outside_hours'
  recording_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_callid ON call_log(callid);
CREATE INDEX idx_timestamp ON call_log(timestamp);
```

**Backup logging:** After D1 write succeeds, fire-and-forget POST to `APPS_SCRIPT_WEBHOOK_URL` with same payload. Do NOT block on it. Wrap in try/catch — Apps Script quotas can fail silently.

## Webhook security

```typescript
function validateRequest(req: Request, env: Env): boolean {
  // 1. Check IP allowlist
  const ip = req.headers.get('CF-Connecting-IP');
  const allowed = env.ELKS_ALLOWED_IPS.split(',');
  if (!allowed.some(range => ipInRange(ip, range))) return false;

  // 2. Check HMAC signature (46elks signs requests with shared secret)
  const sig = req.headers.get('x-elks-signature');
  const body = await req.text();
  const expected = await hmacSha256(env.ELKS_WEBHOOK_SECRET, body);
  return constantTimeCompare(sig, expected);
}
```

## Cron triggers

Add to `wrangler.toml`:

```toml
[triggers]
crons = ["0 3 * * *"]  # Daily 03:00 UTC = 04:00/05:00 Stockholm
```

Cron handler: delete `call_log` rows older than 90 days (recordings are auto-purged by 46elks based on their own retention config — set this via 46elks dashboard to 90 days).

## /stats endpoint (optional, recommended)

`GET /stats` returns:

```json
{
  "calls_today": 23,
  "missed_today": 4,
  "avg_duration_s": 187,
  "fallback_rate": 0.18,
  "office_hours_calls": 19,
  "outside_hours_calls": 4
}
```

Auth this endpoint with a query param `?key={ADMIN_KEY}` or basic auth.

## Test scenarios

`test/scenarios.sh` simulates 5 cases via curl against the deployed worker (or local dev server with `wrangler dev`):

1. **Office hours, IVR option 1, Sebastian answers** — expect Sebastian's leg to connect
2. **Office hours, IVR option 1, Sebastian misses, Lennart answers** — expect 25s timeout then Lennart connects
3. **Office hours, IVR option 1, both miss** — expect voicemail prompt + SMS notifications
4. **Office hours, IVR option 2** — expect Lennart route directly
5. **Outside office hours** — expect outside-hours prompt + voicemail (no IVR)

Each scenario should assert:
- Correct HTTP response from worker
- D1 row inserted with expected `answered_by`, `status`, `ivr_choice`
- (For scenarios 3 and 5) SMS API call mocked/verified

## README requirements

Mandatory sections in `README.md`:

1. **Architecture diagram** (ASCII or Mermaid) of call flow
2. **Setup steps** (honest — list every `wrangler secret put` command)
3. **How to swap Sebastian/Lennart numbers** (just `wrangler secret put SEBASTIAN_NUMBER`)
4. **How to update prompt MP3s** (where to host, expected format: MP3 mono 8kHz 64kbps for telephony)
5. **Operator instructions for Sebastian/Lennart** — including how to do native call-transfer on Android/iOS
6. **Office hours configuration** (where to edit the hours, how to add holidays)
7. **GDPR compliance notes** — what data we collect, retention periods, data subject access procedure
8. **Cost estimate** (Cloudflare Workers free tier handles ~100k calls/mo, 46elks SMS ~0.30 SEK each)
9. **Troubleshooting** — common 46elks errors, how to test webhook with curl

## Deliverables checklist

- [ ] Source code in `nemob-callflow/` repo
- [ ] All env vars documented in `.env.example`
- [ ] D1 migration ready: `wrangler d1 execute nemob-callflow --file=migrations/0001_init.sql`
- [ ] `test/scenarios.sh` runs and passes against `wrangler dev`
- [ ] README complete (all 9 sections above)
- [ ] Sample 46elks "Voice Start" URL in README

## Assets Boss provides separately (BLOCKERS)

These must exist before deploy:

- `welcome.mp3` (intro IVR — script in Step 3)
- `voicemail-prompt.mp3` (with mandatory GDPR consent line — script in Step 6)
- `outside-hours-prompt.mp3` (script: "Hej! Du har ringt utanför våra öppettider mån-fre 9-18. Lämna ett meddelande efter pipet så hör vi av oss på morgonen.")
- `hold-music.mp3` (royalty-free, 5-15 second loop)
- E.164 numbers for Sebastian and Lennart
- 46elks API credentials (username, password)
- Verkstadsnummer (the public-facing 46elks number)
- Apps Script webhook URL (or skip if D1-only logging is acceptable initially)

## Out of scope (do NOT build)

- Mid-call DTMF transfer to switch operator (use native phone transfer instead)
- Custom hold music DURING dial attempts (46elks plays standard ring — accept this)
- Any auto-SMS containing marketing language or business address
- Storage of voicemail audio in R2 (use 46elks built-in storage)

## Acceptance criteria

When this is done, Boss should be able to:

1. Run `wrangler deploy` and have webhook live in <2 minutes
2. Update 46elks "Voice Start" field to point to `https://nemob-callflow.workers.dev/voice`
3. Call the verkstadsnummer and hear welcome prompt
4. Test all 5 scenarios pass
5. View call log in D1 via `wrangler d1 execute nemob-callflow --command "SELECT * FROM call_log LIMIT 10"`
6. Receive SMS notifications correctly when missing calls

---

## END OF PROMPT
