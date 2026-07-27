# ChatGPT Repair Knowledge Export

Det här dokumentet beskriver hur ChatGPT-historik kan användas som seed-data till
Nordic E-Mobilitys Repair Intelligence Loop.

## Syfte

Sebastian har under lång tid felsökt elscootrar, batterier, BMS, controllers,
felkoder, motorer och kundcase i ChatGPT. Den historiken innehåller tekniska
mönster som kan bli första versionen av verkstadens kunskapsbank.

Målet är inte att importera allt som sanning. Målet är att skapa en
**granskningskö** med kandidater.

```text
ChatGPT-historik
→ extraherade repair-kandidater
→ manuell granskning
→ godkända kunskapsposter
→ NEMOB OS / Repair Intelligence
```

## Input

Exportera ChatGPT-data och leta upp filen:

```text
conversations.json
```

Lägg inte denna fil i repot. Den kan innehålla privat data.

## Körning

Från projektets rotmapp:

```powershell
node scripts/extract-chatgpt-repair-knowledge.mjs C:\path\to\conversations.json repair-knowledge-export
```

Mac/Linux:

```bash
node scripts/extract-chatgpt-repair-knowledge.mjs ~/Downloads/chatgpt-export/conversations.json repair-knowledge-export
```

## Output

Scriptet skapar:

```text
repair-knowledge-export/
├── repair_knowledge_seed.jsonl
├── repair_cases_candidates.csv
├── error_code_index.csv
└── extraction_summary.json
```

### `repair_knowledge_seed.jsonl`

En rad per möjlig kunskapspost. Avsedd för maskinell import efter granskning.

### `repair_cases_candidates.csv`

Manuell granskningsfil. Öppnas enklast i Excel/Google Sheets.

### `error_code_index.csv`

Snabb indexfil över upptäckta felkoder, märke, källa och trolig orsak.

### `extraction_summary.json`

Statistik över körningen: antal konversationer, kandidater, felkodsträffar,
statusfördelning och märkesfördelning.

## Statusar

Scriptet försöker märka kandidater med:

| Status | Betydelse |
| --- | --- |
| `confirmed_fix` | Texten antyder att felet blev löst eller bekräftat. |
| `likely_cause` | Texten antyder trolig orsak men inte slutverifiering. |
| `disproven` | Texten antyder att hypotes/test inte var rätt. |
| `diagnostic_step` | Texten innehåller främst test- eller felsökningssteg. |
| `unknown` | Oklart. Kräver granskning. |

## Granskningsregel

Ingen post ska direkt bli auktoritativ verkstadskunskap.

Rekommenderad review-kedja:

```text
needs_review
→ approved
→ imported
```

eller:

```text
needs_review
→ rejected
```

## Integritetsregel

Scriptet gör enkel anonymisering av:

- e-postadresser
- svenska mobilnummer
- personnummerliknande nummer

Det räcker inte som fullständig sekretessgranskning. Innan data importeras till
NEMOB OS ska kundnamn, telefonnummer, adresser och privata detaljer rensas bort
manuellt.

## Viktig begränsning

Det här är en deterministisk MVP. Den använder nyckelord, regex och enkla
heuristiker. Den gör inga AI-anrop och kan därför missa nyanser.

Den ska ses som:

```text
råmaterial → inte facit
```

## Nästa steg

1. Kör exporten lokalt.
2. Öppna `repair_cases_candidates.csv`.
3. Markera 20–50 starkaste poster som `approved`.
4. Importera endast godkända poster till Repair Intelligence-databasen.
5. Bygg sedan `case-similar` mot godkända poster och avslutade verkstadsärenden.
