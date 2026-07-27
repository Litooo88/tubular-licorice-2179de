# ChatGPT → NEMOB OS Repair Knowledge

Detta flöde gör tidigare tekniska ChatGPT-dialoger till en lokal, manuellt
godkänd och sökbar kunskapsbank i NEMOB OS.

## Säkerhetsmodell

```text
ChatGPT-export
→ deterministisk extraktion
→ automatisk grundredaktion
→ lokal manuell granskning
→ explicit godkännande
→ lokal import
→ sökbart beslutsstöd
```

Inget importeras automatiskt som verkstadssanning. Endast poster med
`reviewStatus: approved` kan importeras. Importerad data lagras lokalt i
`nemob-os/data/`, som är gitignorerad.

## 1. Exportera ChatGPT-data

Packa upp exporten och hitta `conversations.json`. Lägg aldrig exporten i repot.

## 2. Extrahera kandidater

Från repo-roten:

```powershell
npm run knowledge:extract -- C:\Users\Sebastian\Downloads\chatgpt-export\conversations.json
```

Mac/Linux:

```bash
npm run knowledge:extract -- ~/Downloads/chatgpt-export/conversations.json
```

Standardmappen `repair-knowledge-export/` skapas med:

- `repair_knowledge_seed.jsonl`
- `repair_cases_candidates.csv`
- `error_code_index.csv`
- `extraction_summary.json`

Extraktorn arbetar på tekniska meddelandesegment, inte bara en hel konversation
per post. Den försöker identifiera märke, modell, felkod, symptom, tester,
rotorsak, bekräftad lösning, delar, spänningar, pris och tidsuppgifter.

## 3. Bygg lokal granskningssida

```powershell
npm run knowledge:review -- repair-knowledge-export\repair_knowledge_seed.jsonl
```

Det skapar:

```text
repair-knowledge-export/review.html
```

Öppna filen lokalt i webbläsaren. Sidan har inga externa script och skickar
ingen data över internet. Du kan:

- redigera märke, modell, felkoder och orsak
- justera symptom, tester, delar, lösning och lärdom
- godkänna eller avvisa varje post
- filtrera på märke, säkerhet och granskningsstatus
- ladda ner `approved_repair_knowledge.jsonl`

Granskningsläget sparas även lokalt i webbläsaren tills du laddar ner filen.

## 4. Importera godkända poster

Kör först dry-run:

```powershell
npm run knowledge:import -- approved_repair_knowledge.jsonl --dry-run
```

Riktig import:

```powershell
npm run knowledge:import -- approved_repair_knowledge.jsonl
```

Standardmål:

```text
nemob-os/data/repair-knowledge.jsonl
```

Importen är:

- idempotent — samma post dupliceras inte
- atomisk — målfilen ersätts först när hela skrivningen lyckats
- strikt — ogiltiga enums eller icke godkända poster importeras inte
- integritetsspärrad — `privacyCleaned` måste vara `true`

## 5. Sök i NEMOB OS

Starta NEMOB OS:

```powershell
npm run nemob-os
```

Öppna dashboarden och klicka **Kunskapsbank**, eller gå till:

```text
http://127.0.0.1:4571/knowledge.html
```

API:

```text
GET /api/knowledge/stats
GET /api/knowledge/search?q=Ninebot%20E16&limit=20
```

Valfria filter:

```text
brand=ninebot
errorCode=E16
rootCause=wiring
```

API:t returnerar endast importerade/godkända poster och exponerar inte hela
ChatGPT-exporten.

## Vad som fortfarande kräver människa

Automatisk redaktion tar bort vanliga e-postadresser, svenska mobilnummer och
personnummerliknande värden. Den kan inte garantera att namn, ovanliga nummer,
adresser eller privata sammanhang upptäcks. Varje post ska därför granskas innan
godkännande.

Tekniska slutsatser från ChatGPT-historik kan vara gamla, hypotetiska eller
modellberoende. Bekräfta alltid mot fordonets kopplingsschema, mätvärden,
kompatibilitet och aktuell säkerhetsbedömning.

## Test och verifiering

```powershell
npm run test:knowledge
npm run test:nemob-os
npm run build
```

Separat syntaxkontroll:

```powershell
node --check scripts/extract-chatgpt-repair-knowledge.mjs
node --check scripts/build-repair-knowledge-review.mjs
node --check scripts/import-repair-knowledge.mjs
node --check nemob-os/lib/repair-knowledge.mjs
node --check nemob-os/server.mjs
```
