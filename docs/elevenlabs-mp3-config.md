# MP3-generering för 46elks IVR — ElevenLabs-config

**Skapad:** 2026-05-08 av Cowork
**För:** Boss (Sebastian)
**Kostnad:** ElevenLabs Starter $5/mo (räcker för dessa 4 filer + framtida updates)
**Tid:** ~30 min för alla fyra filer

---

## Varför ElevenLabs (vs OpenAI TTS)

| Kriterie | ElevenLabs | OpenAI TTS |
|---|---|---|
| Svenska röstkvalitet | **Mycket bra** (multilingual v2) | OK men lätt monoton |
| Pris | $5/mo (10k tecken) | $15/1M tecken (ca samma) |
| Naturlighet i intonation | Vinner | Sämre på pauser |
| Telefoni-format export | Manuellt | Manuellt |
| Disclosure-krav | Båda kräver "AI-röst" deklareras |  |

→ **ElevenLabs vinner för svenska röster.** Codex-README:n nämnde OpenAI som default — använd ElevenLabs istället.

---

## Steg 1 — Skapa konto

1. Gå till [elevenlabs.io](https://elevenlabs.io)
2. Sign up med din email
3. Välj **Starter Plan** ($5/mo) — fri tier räcker INTE eftersom den vattenmärker filerna

---

## Steg 2 — Välj svensk röst

ElevenLabs har förbyggda röster. Rekommenderade för verkstadsbranschen:

| Röst-ID | Namn | Karaktär | Bra för |
|---|---|---|---|
| `pNInz6obpgDQGcFmaJgB` | Adam | Lugn, mogen man | Welcome, voicemail |
| `EXAVITQu4vr4xnSDxMaL` | Sarah | Varm, professionell kvinna | Outside-hours |
| `IKne3meq5aSn9XLyUdCD` | Charlie | Vänlig, vardaglig man | Hold music intro (om du vill) |

**Mitt val:** Använd **Adam** (`pNInz6obpgDQGcFmaJgB`) för alla fyra filer för konsistens. Om du vill ha kontrast mellan dag/natt → Adam för office-hours, Sarah för outside-hours.

**Settings i ElevenLabs UI:**
- Stability: `0.65` (lite variation, inte robotisk)
- Similarity boost: `0.75`
- Style exaggeration: `0.0` (neutral)
- Use speaker boost: ✅ ON
- Model: **eleven_multilingual_v2** (KRITISKT — utan denna blir svenska uttalet trasigt)

---

## Steg 3 — Generera de fyra MP3:erna

För varje fil: gå till "Text to Speech" → klistra in scriptet → välj röst + settings ovan → "Generate" → "Download MP3".

### Fil 1 — `welcome.mp3`

**Script (kopiera EXAKT):**

```
Du hör en automatisk röst från Nordic E-Mobility. Välkommen.

Tryck 1 för verkstad, service och bokning.

Tryck 2 för ny elscooter, försäljning eller inbyte.

Vi kopplar dig direkt.
```

**Notera:** Tomma rader = ElevenLabs lägger naturlig paus (ger användaren tid att höra alternativen).

### Fil 2 — `voicemail-prompt.mp3`

**Script (kopiera EXAKT — varenda ord är juridiskt viktigt):**

```
Du hör en automatisk röst från Nordic E-Mobility. Du har kommit till vår röstbrevlåda.

Lämna ditt namn, telefonnummer och vad det gäller efter pipet.

Genom att lämna ett meddelande godkänner du att samtalet spelas in och lagras i 90 dagar för att vi ska kunna återkomma.

Tryck fyrkant när du är klar.
```

**KRITISKT:** Ändra INTE consent-meningen. GDPR Art. 6 kräver explicit consent + retention-period.

### Fil 3 — `outside-hours-prompt.mp3`

**Script (med GDPR-fix från P0-2 — kopiera EXAKT):**

```
Du hör en automatisk röst från Nordic E-Mobility. 

Du har ringt utanför våra öppettider, måndag till fredag klockan 9 till 18.

Lämna ett meddelande efter pipet så hör vi av oss på morgonen.

Genom att lämna ett meddelande godkänner du att samtalet spelas in och lagras i 90 dagar.

Tryck fyrkant när du är klar.
```

**Skillnad mot Codex-README:** Sista två meningarna lagts till för GDPR-compliance (eftersom `outsideHoursVoicemail` går direkt till `/record` utan att spela voicemail-prompten).

### Fil 4 — `hold-music.mp3`

**ElevenLabs gör INTE musik.** Du behöver royalty-fri musik från:

- **Pixabay Music** (gratis, ingen attribution): [pixabay.com/music/search/hold/](https://pixabay.com/music/search/hold/)
- **YouTube Audio Library** (gratis): filtrera "Music for waiting", välj instrumental, max 30s loop
- **Bensound.com** (gratis med attribution)

**Krav:**
- 5-15 sekunder loop (inte längre — låter konstigt om kallaren slipper hålla länge)
- Instrumental (ingen sång)
- Lugn (inte stressande EDM)
- 8 kHz eller 16 kHz mono efter export

**Mitt förslag:** Sök "soft piano hold" på Pixabay. Hämta första bästa, klipp till 8 sekunder, exportera som mono MP3.

---

## Steg 4 — Konvertera till telefoni-format

ElevenLabs exporterar i 22 kHz stereo MP3 by default. Telefoni vill ha 8 kHz mono. Stora filer = långsammare nedladdning av 46elks → uppringare hör tystnad innan prompten startar.

**Konvertera med Audacity (gratis):**

1. Ladda ner Audacity → öppna MP3:en
2. Tracks → Mix → Mix Stereo Down to Mono
3. Tracks → Resample → 8000 Hz
4. File → Export → Export as MP3 → Bit Rate: 64 kbps, Mono

**Eller med ffmpeg (kommando):**

```bash
ffmpeg -i welcome-orig.mp3 -ac 1 -ar 8000 -b:a 64k welcome.mp3
```

(Kör för alla fyra filerna.)

---

## Steg 5 — Verifiera filerna lokalt

Spela upp varje MP3 och kontrollera:

- ✅ Hörs prompten tydligt? (om inte, höj volym i Audacity före export)
- ✅ Är det ~2-3 sekunder TYSTNAD i början? Om ja, klipp bort (annars hör uppringaren tystnad innan ord)
- ✅ Slutar prompten ABRUPT eller med naturlig fade? Naturligt är bättre
- ✅ Är consent-meningen begriplig (inte slöts ihop med övrig text)?

---

## Steg 6 — Publicera filerna

**Rekommenderat: lägg dem i din Netlify-sajt.**

```bash
# I din lokala kopia av nordic-emobility-github-push
mkdir -p audio
mv ~/Downloads/welcome.mp3 audio/
mv ~/Downloads/voicemail-prompt.mp3 audio/
mv ~/Downloads/outside-hours-prompt.mp3 audio/
mv ~/Downloads/hold-music.mp3 audio/

git add audio/
git commit -m "Add IVR prompts for 46elks callflow"
git push
```

Netlify deployar automatiskt → ~1 min senare är de tillgängliga på:

- `https://www.nordicemobility.se/audio/welcome.mp3`
- `https://www.nordicemobility.se/audio/voicemail-prompt.mp3`
- `https://www.nordicemobility.se/audio/outside-hours-prompt.mp3`
- `https://www.nordicemobility.se/audio/hold-music.mp3`

**Verifiera:** Klistra in en URL i browser → MP3 ska börja spela direkt.

---

## Steg 7 — Säg till Cowork

När alla fyra filerna är publicerade och kan spelas via URL:erna ovan, säg:

> "MP3:erna ligger på Netlify, alla fyra URL:erna funkar."

Då gör jag/vi nästa steg: kör genom deployment-runbooken (`docs/deployment-runbook-46elks.md`).

---

## Kostnadssammanfattning

| Komponent | Kostnad | Notering |
|---|---|---|
| ElevenLabs Starter | $5/mo (~52 kr) | För framtida prompt-uppdateringar |
| Pixabay/YouTube musik | 0 kr | Royalty-free |
| Audacity | 0 kr | Open source |
| Netlify hosting | 0 kr | Redan inkluderat i din plan |
| **TOTAL månadskostnad** | **~52 kr** | Endast om du behåller ElevenLabs |

**Pro-tip:** Avsluta ElevenLabs efter du genererat alla MP3:er om du inte planerar uppdatera prompts ofta. Reaktivera bara när du behöver.

---

## Underhåll

**När byts MP3:erna?**

- Telefonnummer ändras → uppdatera prompten (om numret nämns muntligt)
- Öppettider ändras → uppdatera outside-hours-prompten
- GDPR-retention ändras → uppdatera consent-text
- Brand voice ändras → överväg att byta röst

**Hur uppdatera utan downtime?**

Workers cachear inte MP3-URL:erna. Bara skriv över filen i `audio/`-mappen, push till git, Netlify deployar. Nya samtal får nya MP3:n direkt.
