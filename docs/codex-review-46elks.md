# Kod-review: nemob-callflow (Codex output)

**Reviewer:** Cowork
**Datum:** 2026-05-08
**Granskat:** src/*.ts, wrangler.toml, migrations/*, README.md, test/scenarios.sh, .env.example
**Verdict:** Solid grund. **2 P0-buggar, 1 GDPR-gap, 7 P1-issues**. Godkänd för deploy EFTER fixar.

---

## Vad Codex gjorde rätt (POSITIV NOTERING)

- ✅ Använder 46elks korrekta IVR-format (verifierat mot deras docs — Codex flaggade till och med att min spec var fel på `record.timeout` vs `timelimit`)
- ✅ HMAC-signaturvalidering är constant-time compare (säkert mot timing-attacks)
- ✅ IP CIDR-matchning fungerar korrekt
- ✅ Office hours med svensk tidszon + helgdagar 2026 hardkodade
- ✅ Apps Script som backup, fire-and-forget (blockerar inte huvudflödet)
- ✅ Scheduled handler för 90-dagars purge
- ✅ GDPR-text i voicemail-prompten ÄR exakt korrekt
- ✅ Smart routing-inversion (option 1 → Verkstaden först, option 2 → Sebastian) — matchar verksamheten bättre
- ✅ README är ärligt om vad som avviker från specen
- ✅ Operator-instruktioner förklarar native call-transfer korrekt

**Sammanfattning:** Codex har levererat 90% rätt. Resten är fixbart på 30-60 min.

---

## P0 — MÅSTE FIXAS INNAN DEPLOY

### P0-1 — `notifyCaller` SMS-bombar alla inkommande nummer

**Fil:** `src/notify.ts` rad 29-37

**Problem:** Funktionen skickar SMS till varje uppringare som hamnar i voicemail, inklusive:
- Robocalls / scam-uppringningar
- Marknadsundersökningsfirmor
- Felringningar
- Returnummer som inte tar emot SMS (kostar dig en SMS-credit på 0.30 SEK)
- Internationella spam-nummer (kan kosta MYCKET mer än 0.30 SEK)

**Risk:** Konstant kostnadsläckage + risk för "SMS to non-mobile" rejections från 46elks som genererar fler debiteringar.

**Fix:** Lägg till basic guards. Här är minimal fix (klistra in i `notify.ts`):

```typescript
function isLikelySwedishMobile(e164: string): boolean {
  // +46 followed by 7X (svenska mobilnummer börjar med 07X)
  return /^\+467\d{8}$/.test(e164);
}

export function notifyCaller(env: Env, to: string, ctx: ExecutionContext): void {
  // Spam-skydd: skicka bara till svenska mobilnummer
  if (!isLikelySwedishMobile(to)) {
    console.log(`Skipping caller SMS to non-Swedish-mobile: ${to}`);
    return;
  }
  
  const message = [
    "Hej! Tack for ditt samtal till Nordic E-Mobility.",
    "Vi ar upptagna just nu men har sett att du ringt.",
    "Vi aterkommer under dagen.",
    "Akut arende? Skriv hit pa SMS. /Nordic E-Mobility"
  ].join("\n");
  ctx.waitUntil(sendSms(env, to, message));
}
```

**Optional bonus (rate limiting):** Använd CALLFLOW_KV för att räkna SMS per nummer per dag, max 1 SMS/nummer/dygn. Kan adderas senare.

### P0-2 — Outside-hours-prompten saknar GDPR-consent

**Fil:** `src/flow.ts` rad 39-48 + `README.md` rad 147-149

**Problem:** När någon ringer utanför öppettider:
1. Spelas `OFFICE_HOURS_PROMPT_MP3_URL` (med Codex script: "...lämna ett meddelande efter pipet så hör vi av oss på morgonen")
2. Går DIREKT till `/record` (utan att spela voicemail-prompten)

**Konsekvens:** Inspelning sker UTAN GDPR-consent-text. **Det är olagligt enligt GDPR Art. 6.**

**Fix-alternativ A (rekommenderat):** Inkludera GDPR-consent i outside-hours-MP3:n. Uppdatera scriptet i README till:

> "Du hör en automatisk röst från Nordic E-Mobility. Du har ringt utanför våra öppettider måndag till fredag 9 till 18. Lämna ett meddelande efter pipet så hör vi av oss på morgonen. Genom att lämna ett meddelande godkänner du att samtalet spelas in och lagras i 90 dagar. Tryck fyrkant när du är klar."

**Fix-alternativ B:** Ändra `outsideHoursVoicemail` i `flow.ts` att kedja via `/voicemail` (som spelar voicemail-prompten med consent):

```typescript
export function outsideHoursVoicemail(env: Env, reqUrl: URL, payload: ElksPayload) {
  return {
    play: env.OFFICE_HOURS_PROMPT_MP3_URL,
    next: withParams(new URL("/voicemail", reqUrl.origin), {
      callid: callId(payload, reqUrl),
      from: caller(payload, reqUrl),
      ivr_choice: "outside_hours"
    })
  };
}
```

→ **Rekommenderar Alt A** (en MP3-prompt mindre att hantera, mer compliant av design).

---

## GDPR-GAP

### GDPR-1 — 90-dagars retention på voicemail-inspelningar är inte verifierad

**Fil:** README.md rad 191-192

**Problem:** Codex säger att inspelningar lagras hos 46elks "according to their retention config", men har INGEN kod som faktiskt sätter denna config. Default på 46elks är typiskt 30 dagar (bra för GDPR), men:
- Om 46elks ändrar default till längre → ni bryter consent ("90 dagar")
- Om någon recoverar äldre filer manuellt → consent är överskriden

**Fix:** Boss måste manuellt verifiera i 46elks dashboard:
1. Gå till 46elks → Account Settings → Recordings retention
2. Sätt till **MAX 90 dagar** (kortare är bättre för GDPR)
3. Dokumentera screenshot i `docs/gdpr-46elks-retention.png`

**Långsiktigt fix:** Bygg en cron som dagligen anropar 46elks API och raderar inspelningar äldre än 90 dagar (programmatic enforcement). Inte krav för v1.

---

## P1 — BÖR FIXAS INOM 1-2 VECKOR

### P1-1 — Personliga mobilnummer i `.env.example`

**Fil:** `.env.example` rad 7-8

```
SEBASTIAN_NUMBER=+46101385498
WORKSHOP_NUMBER=+46101385498
```

**Problem:** `.env.example` är en mall som ska committas till git. Personliga mobilnummer ska INTE ligga där.

**Fix:** Ändra till tomma värden:
```
SEBASTIAN_NUMBER=
WORKSHOP_NUMBER=
```

### P1-2 — `REQUIRE_ELKS_SIGNATURE=false` är default

**Fil:** `.env.example` rad 6

**Problem:** Default false betyder att produktionen körs på ENBART IP-allowlist. Om 46elks lägger till nya IP:er och du glömmer uppdatera → traffic börjar avvisas. Om någon spoofar källadress → nu accepterad utan HMAC-check.

**Status:** Codex noterar att `x-elks-signature` "inte är dokumenterat av 46elks". Verifierat — 46elks använder INTE HMAC i sin standard-callback. Så denna feature är optional och kan inte aktiveras utan att 46elks själva implementerar det.

**Acceptabel risk för v1.** IP-allowlist är primary defense. Lämna `false`. Dokumentera tydligt i README.

### P1-3 — Apps Script-logging utan `ctx.waitUntil`

**Fil:** `src/log.ts` rad 30

**Problem:** `fetch()` utan `ctx.waitUntil()` kan dödas innan den slutförts om Workers returnerar response först. Inkonsekvent loggning till Apps Script.

**Fix:** Kräver att `logCall` tar emot `ctx`-parameter. Refactor:

```typescript
export async function logCall(env: Env, row: CallLogRow, ctx?: ExecutionContext): Promise<void> {
  // ... D1-write som innan ...
  
  if (env.APPS_SCRIPT_WEBHOOK_URL && ctx) {
    ctx.waitUntil(
      fetch(env.APPS_SCRIPT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch((err) => console.warn("Apps Script backup log failed", err))
    );
  } else if (env.APPS_SCRIPT_WEBHOOK_URL) {
    // fallback för calls utan ctx (scheduled handler)
    await fetch(env.APPS_SCRIPT_WEBHOOK_URL, { ... });
  }
}
```

Och uppdatera alla `logCall(env, ...)`-anrop i `index.ts` att skicka `ctx` när det finns.

### P1-4 — Holiday-listan är hardkodad för 2026

**Fil:** `src/officeHours.ts` rad 1-18

**Problem:** Listan är `SWEDISH_PUBLIC_HOLIDAYS_2026`. Funkar 2026 men då måste någon manuellt lägga till 2027-listan i januari.

**Fix:** Antingen:
- Anropa ett externt API (api.lankalender.se eller liknande) — risk för dependency-fail
- Hardkoda 2027 också nu (lägger till ~10 rader)
- Sätt en kalenderpåminnelse i Boss kalender 2026-12-15

**Rekommendation:** Hardkoda 2027 nu, sätt påminnelse för 2027-12. Lågt underhåll.

### P1-5 — Verifying.ts saknar testtäckning för `state` och `attempt`

**Fil:** `test/scenarios.sh`

**Problem:** Testerna verifierar att routes returneras korrekt, men inte att hangup-eventet med `state=success` och `attempt=workshop` faktiskt loggas som "answered" med `answered_by=workshop` i D1.

**Fix:** Lägg till scenario 6 i scenarios.sh:

```bash
echo "Scenario 6: hangup event - Verkstaden answered"
post_form "/event/hangup?callid=test-6&from=$CALLER&ivr_choice=1&attempt=workshop" "callid=test-6&state=success&duration=42"
# (kontrollera D1 att rad har answered_by='workshop', status='answered', duration_s=42)
```

### P1-6 — Inget rate-limiting på `/voice`-endpoint

**Problem:** Om någon DDoS:ar `/voice` med spoofade 46elks-IP:er kan de generera massor av D1-writes och eventuellt SMS.

**Fix:** Cloudflare Workers har inbyggd rate-limiting via `wrangler.toml`. Lägg till:

```toml
[[unsafe.bindings]]
name = "RATE_LIMITER"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 60, period = 60 }  # 60 req/min per IP
```

Sen wrappa `/voice`-handlern. Optional för v1.

### P1-7 — `compatibility_date = "2026-05-10"` är framtida datum

**Fil:** `wrangler.toml` rad 3

**Problem:** Idag är 2026-05-11 (du är i framtiden vs när Codex skrev). Datum borde vara dagens eller äldre.

**Fix:** Ändra till `"2026-05-08"` eller äldre.

---

## ROUTING-INVERSIONS-ALERT

Codex har **inverterat** option 1 vs 2 jämfört med min spec:

| Option | Min spec | Codex implementation | Vilken är rätt? |
|---|---|---|---|
| 1 | → Sebastian (verkstad) | → Verkstaden (verkstad) | **Codex är rätt** — Verkstaden är intake/floor |
| 2 | → Verkstaden (sales) | → Sebastian (sales) | **Codex är rätt** — Sebastian gör tunga konsultationer |

→ **Boss bekräftar: är detta rätt routing?** (jag tror ja)

---

## SAMMANFATTAD ÅTGÄRDSLISTA INNAN DEPLOY

| # | Fix | Vem | Tid |
|---|---|---|---|
| P0-1 | Lägg till `isLikelySwedishMobile`-check i notify.ts | Cowork kan skriva diff | 5 min |
| P0-2 | Inkludera GDPR-text i outside-hours MP3-script | Boss vid MP3-inspelning | 0 min (redan när du gör MP3) |
| P1-1 | Ta bort personliga nummer från `.env.example` | Cowork kan skriva diff | 1 min |
| P1-7 | Justera `compatibility_date` | Cowork kan skriva diff | 1 min |
| P1-4 | Lägg till 2027 helgdagar | Cowork kan skriva diff | 5 min |
| GDPR-1 | Verifiera 46elks retention-setting i dashboard | Boss måste göra | 5 min |
| Routing | Bekräfta att option 1 = Verkstaden är rätt | Boss bekräftar | 10 sek |

**Total tid:** ~15 min för Cowork + 10 min för Boss = klart att deploya.

---

## Vad jag rekommenderar nu

1. **Bekräfta routing** (option 1 = Verkstaden, option 2 = Sebastian) — JA eller NEJ?
2. Säg "kör fixarna" så skriver jag de fyra Cowork-fixarna direkt i koden
3. Sen kör vi deployment-runbooken
