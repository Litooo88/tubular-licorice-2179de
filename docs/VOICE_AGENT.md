# Röstassistenten (AI som för riktig dialog när ingen svarar)

Status 2026-10-07: **dag 1 klar i kod** — verktygs-API, samtalsroutning och
systemprompt. Plattformskonto, nummer/SIP och de första testsamtalen återstår
(dag 2–3). Allt är env-gatat: utan `VOICE_AGENT_SECRET` och `VOICE_AGENT_SIP`
beter sig telefonin exakt som förut.

## Vad den är och inte är

Sebastians design (2026-10-06): en **sekreterare**, inte en tekniker.
Den svarar när varken Sebastian eller fallback-numret svarar (och utanför
telefontid), för en riktig dialog, samlar fakta, ger kunden status på
pågående ärende, svarar på publika "från"-priser och öppettider, och bokar
**ett telefonmöte med Sebastian** när något kräver beslut. Efter samtalet får
Sebastian en sammanfattning per SMS och mail.

Den får **aldrig**: lova slutpris, ge rabatt, svara på garanti/reklamation,
säga betalstatus, läsa interna anteckningar, nämna andra kunder, boka in
verkstadsjobb själv eller skicka fri text till kunden. Det är kodat, inte bara
promptat: verktygs-API:t exponerar inte de fälten (`_shared/voice-agent.mjs`,
testat i `tests/voice-agent.test.mjs`).

## Arkitektur

```
Kund ringer 010 / 076
  └─ 46elks → voice-simple.mjs
       ├─ connect Sebastian (15 s)  → svarar: klart
       ├─ connect fallback          → svarar: klart
       ├─ connect VOICE_AGENT_SIP   ← NYTT: assistenten (20 s)
       │     └─ plattformen (ElevenLabs Agents / Retell) kör STT+LLM+TTS
       │           och anropar våra tools:
       │           POST /api/voice-agent/lookup | prices | slots | book-meeting
       │           POST /api/voice-agent/summary   (webhook efter samtalet)
       └─ svarar ingen: vanlig telefonsvarare (prompt → pip → inspelning)
```

Vi bygger **inte** egen realtidsröst (STT/TTS/turn-taking är ett eget
ingenjörsprojekt och blir inte billigare än ~1 kr/min ändå). Vi äger
logiken: vad den får säga, vad den slår upp, vad den bokar och hur
sammanfattningen ser ut. Byter vi plattform byter vi bara SIP-adress och
prompt.

### Plattformsval

| | ElevenLabs Agents | Retell | Vapi |
|---|---|---|---|
| Svenska röster | Mycket bra (egen TTS) | Bra (ElevenLabs/Cartesia under huven) | Bra |
| Inkommande via SIP från 46elks | Ja (SIP trunk inbound) | Ja | Ja |
| Tools/webhooks | Ja, JSON-schema | Ja | Ja |
| Pris per samtalsminut | ≈ 0,8–1,1 kr | ≈ 0,7–1,3 kr | ≈ 0,5–1,0 kr + modell |
| Rekommendation | **Börja här** | Alternativ om svensk latens är sämre | — |

Budget: ~100–150 samtalsminuter/mån ≈ 1 000–1 500 kr. Mätt mot en missad
kund värd ~900 kr (benchmarken) räcker det med två räddade samtal i månaden.

## Env-variabler (Netlify)

| Variabel | Vad |
|---|---|
| `VOICE_AGENT_SECRET` | Delad hemlighet; plattformen skickar den som `x-voice-agent-secret` (eller Bearer). Saknas → 503 `not_configured`. |
| `VOICE_AGENT_SIP` | Assistentens SIP-adress, t.ex. `sip:xxxx@sip.rtc.elevenlabs.io`. Saknas → ingen routning. |
| `SEBASTIAN_SMS_TO` / `WORKSHOP_SMS_TO` | Dit möte- och sammanfattnings-SMS går (finns redan). |
| `ADMIN_TOKEN` | Används internt för att skapa mötesärendet via `/api/cases` (finns redan). |
| `RESEND_API_KEY`, `EMAIL_FROM`, `WORKSHOP_EMAIL` | Sammanfattningsmail (finns redan). |

## Verktygen (det plattformen får anropa)

Alla kräver hemligheten. `GET /api/voice-agent/health` visar vad som är konfigurerat.

| Tool | In | Ut (kundsäkert) |
|---|---|---|
| `lookup` | `{ phone }` | `found`, `firstName`, `active[]` {serviceNumber, vehicle, service, step, note, promisedDate, latestUpdate}, `recent` |
| `prices` | `{ query }` | `items[]` {name, fromPrice, likelyMin/Max, requiresDiagnosis, say}, `threshold`, `policy` |
| `slots` | `{}` | närmaste lediga inlämningstider tis/tors 10–16 (från bokningssidans slot-API) |
| `book-meeting` | `{ phone, name, topic, preferredTime, vehicle }` | skapar internt ärende (källa `voice-agent`), SMS till Sebastian, bekräftelse-SMS till kunden, returnerar `say` |
| `summary` | `{ callId, phone, durationSec, outcome, summary, transcript, meetingBooked }` | sparar i `voice-agent-calls`, SMS + mail till Sebastian |

Lagring: `voice-agent-meetings`, `voice-agent-calls` (Netlify Blobs).

## Systemprompt (klistras in i plattformen)

```
Du är receptionist hos Nordic E-Mobility, en elscooterverkstad i Örebro.
Du svarar när Sebastian, som driver verkstaden, inte kan ta samtalet.
Tala svenska, kort och vänligt, en fråga i taget. Låt kunden prata klart.

Ditt jobb:
1. Ta reda på vad det gäller: vilket fordon (märke, modell), vad som är
   fel eller vad kunden vill, och om kunden redan har ett ärende hos oss.
2. Har kunden ett ärende: anropa lookup med kundens nummer och berätta
   steget och den senaste uppdateringen med egna ord. Säg aldrig något
   som inte står i svaret från lookup.
3. Prisfrågor: anropa prices. Säg "från"-priset och spannet. Säg alltid
   att exakt pris ges efter felsökning eller av Sebastian. Lova aldrig
   ett pris, ge aldrig rabatt.
4. Bokning av inlämning: anropa slots och föreslå närmaste lediga tid,
   tisdag eller torsdag 10–16. Du bokar inte själv; be kunden boka på
   nordicemobility.se/book-online eller erbjud ett telefonmöte.
5. Allt som kräver ett beslut (garanti, reklamation, missnöje, pris över
   995 kr, batteri, specialfall): säg att Sebastian ringer upp, fråga när
   det passar, och anropa book-meeting. Bekräfta att ett SMS kommer.
6. Avsluta med en kort sammanfattning av vad ni kommit överens om.

Du får aldrig: nämna betalningar eller skulder, läsa upp interna
anteckningar, prata om andra kunder, uppge Sebastians privata nummer,
diskutera lön, hyra eller företagets ekonomi, eller låtsas vara människa
om kunden frågar (säg att du är verkstadens digitala receptionist).
Om kunden är arg: beklaga, lova inget, boka telefonmöte.
Öppettider telefon: vardagar 9–18. Inlämning och hämtning: tisdag och
torsdag 10–16, Pistolvägen i Örebro.
```

## Läge 2026-10-07 (dag 2 påbörjad i ElevenLabs)

- Agent: **Nordic Receptionist**, id `agent_7501m4a5b9d7fnftyzxeqhx7tq5s`. Svensk prompt, första
  meddelande, språk svenska, röst Sanna Hartfield (Calm and Soothing), LLM Claude Sonnet 5.5,
  systemverktyget "Avsluta konversation" på. Inte publicerad än.
- Hemlighet i arbetsytan: `nordic_voice_agent_secret` (samma värde ska in i Netlify som
  `VOICE_AGENT_SECRET`).
- Verktyg skapade i biblioteket: `lookup` (`tool_6401m4a6akvnfv4b8etx6963zhfn`), `prices`
  (`tool_6401m4a6edk7ehc8tt0nqt9rh3vj`). Kvar: `slots` (osparad kopia `copy_lookup`,
  `tool_8501m4a6q11jejwveqwg8qv34msw`), `book-meeting`, koppla till agenten, publicera,
  SIP-inbound, post-call webhook, Netlify-env.
- OBS: webbgränssnittets "Redigera som JSON" använder ett eget schema (properties som
  array med `id`/`required`-boolean), inte API:ts. Formuläret är pålitligare.

## Dag 2–3 (återstår)

1. Skapa konto på ElevenLabs Agents, skapa en agent med prompten ovan och
   en svensk röst, lägg till de fem tools (URL `https://www.nordicemobility.se/api/voice-agent/<tool>`,
   header `x-voice-agent-secret`). Sätt post-call webhook till `/summary`.
2. Aktivera SIP-inbound på agenten, kopiera SIP-adressen → `VOICE_AGENT_SIP`
   i Netlify. Sätt `VOICE_AGENT_SECRET` (samma värde på båda sidor).
3. Testa med `VOICE_TEST_NOW` på privatlinjen först: ring 076, låt det ringa
   ut, prata med assistenten, kontrollera att `lookup` ger rätt status för ett
   känt nummer, att `book-meeting` ger två SMS och ett ärende i admin, och att
   sammanfattningen kommer som SMS + mail.
4. Första veckan: lyssna på/läs varje transkript (`voice-agent-calls`).
   Justera prompten, inte koden, tills tonen sitter.

## Risker

- Plattformen nere → samtalet faller vidare till telefonsvararen (20 s).
- Kunden tror den pratar med en människa → prompten säger ifrån på fråga.
- Felaktig status → `lookup` läser bara `customerUpdates` och steg, aldrig
  `notes`; det kunden hör är det Sebastian själv skrivit till kunden.
- Kostnad → plattformens minutpris, följs upp i kostnadsrapporten månadsvis.
