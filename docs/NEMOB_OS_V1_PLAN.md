# NEMOB OS v1.0 — 30-dagars implementationsplan

**Fokus: Repair Intelligence Loop v1.** Inte hemsida, inte design, inte nya dashboards.
Skapad 2026-07-05. Ägare: Sebastian. Byggs av Claude Code/Codex i små, avgränsade PR:er.

## Målbild (Definition of Done för v1.0)

Efter 30 dagar ska följande vara sant:

1. Varje avslutat ärende sparar strukturerat: symptom, märke, orsak, åtgärder,
   delar, arbetstid, slutpris.
2. Varje nytt ärende visar automatiskt "liknande tidigare fall" med orsak,
   pris och tid — innan teknikern börjar skruva.
3. Prisintervall vid bokning/quick-price kan slås upp mot verklig falldata,
   inte bara prislistan.
4. Minst 80 % av historiska avslutade ärenden är backfillade med orsak/märke
   (AI-förslag, Sebastian-godkända).
5. Minst 2 SEO-/content-artefakter är genererade från riktig falldata.

## Arkitekturprinciper (låsta för v1)

- **Ingen ny infrastruktur.** Netlify Blobs räcker. Ny blob: `repair-index`
  (en kompakt rad per avslutat ärende). Ingen Supabase, ingen vektordatabas.
- **Noll ny friktion vid intag.** Symptom härleds från bokningens
  `message`/`service`. Teknikern får max 2 nya obligatoriska fält, och bara
  vid avslut: `rootCause` (dropdown) + `laborMinutes` (snabbknappar).
- **AI föreslår, människa godkänner.** Backfill och diagnostikförslag är
  utkast. Inga automatiska högriskbeslut.
- **Bakåtkompatibelt.** Befintliga cases utan nya fält får fungera överallt.
  Inga ändrade publika kontrakt.

## Datamodell v1 (utbyggnad av `completion` i workshop-cases)

Nya fält (utöver befintliga `jobType`, `serviceActions`, `position`,
`priceRows`, `totalCost`, `testRunDone`, `safetyCheckDone`):

| Fält | Typ | Sätts av |
|---|---|---|
| `symptom` | kort text | härleds vid intag, justeras vid avslut |
| `rootCause` | enum: `battery_cell`, `bms`, `charger`, `controller`, `wiring`, `display`, `puncture`, `tire_wear`, `brake_wear`, `water_damage`, `crash_damage`, `user_error`, `unknown` | tekniker (dropdown, obligatorisk vid avslut) |
| `rootCauseNote` | kort text | tekniker (valfri) |
| `laborMinutes` | tal | tekniker (snabbknappar 15/30/45/60/90/120+) |
| `vehicle.brand` | enum, auto-normaliserad via regex mot modellfältet (`xiaomi`, `ninebot`, `segway`, `vassla`, `voi`, `nitrox`, `blimo`, `emove`, `kugoo`, `inokim`, `other`) | systemet, aldrig teknikern |

`repair-index`-blob: en JSON-rad per avslutat ärende med
`caseId, closedAt, brand, model, jobType, symptom, rootCause, serviceActions,
partsUsed, laborMinutes, totalCost`. Skrivs när status sätts till klar.
Detta är den enda listan `case-similar` läser — aldrig full case-list.

---

## Vecka 1 (dag 1–7): Fånga datan

**Mål: från och med nu läcker inget avslutat ärende kunskap.**

- Dag 1–2: Schemautbyggnad i `netlify/functions/workshop-cases.mjs` —
  `ROOT_CAUSES`-enum, `laborMinutes`, `symptom`, `rootCauseNote` i
  `completion`; `brand`-normalisering (regexfunktion + enum) på vehicle.
  Samma valideringsmönster som `JOB_TYPES`. Bakåtkompatibelt.
- Dag 2–3: `repair-index`-blob skrivs vid avslut (i samma statusövergång som
  sätter `readyAt`). Idempotent: nyckel = caseId.
- Dag 3–5: Avslutsformuläret i `/workshop/`: orsak-dropdown + tidsknappar.
  Symptomfältet förifyllt från bokningsdata, redigerbart.
- Dag 5–7: Verifiering (`npm run build`, `verify:checkout-products`,
  manuellt ärende hela vägen intag→avslut). Buffert.

**DoD vecka 1:** ett testärende avslutas och dess rad syns i `repair-index`
med alla fält ifyllda.

## Vecka 2 (dag 8–14): Slå upp kunskapen

**Mål: teknikern ser facit från tidigare fall innan skruvandet börjar.**

- Dag 8–10: Ny endpoint `netlify/functions/case-similar.mjs` (admin-auth):
  in: `jobType`, `brand`, symptomord → ut: matchande index-rader +
  aggregat (vanligaste orsak, snittpris, snittid, delar). Ren filtrering
  och ordmatchning — ingen AI, ingen embedding i v1.
- Dag 10–12: "Liknande fall"-ruta i `/workshop/`-intagsvyn och i
  `/quick-price/`: "3 liknande: Xiaomi + startar ej → 2× BMS, 1× kontroller.
  Snitt 1 450 kr / 50 min."
- Dag 12–14: **Backfill:** batchjobb (körs lokalt/via admin-endpoint i
  dry-run-läge) där Claude föreslår `rootCause` + `brand` + `laborMinutes`-
  uppskattning ur `workSummary`/`partsUsed` för redan avslutade ärenden.
  Output = förslagslista som Sebastian godkänner i batch innan skrivning.

**DoD vecka 2:** minst 80 % av historiska avslutade ärenden i indexet;
"liknande fall" visas vid intag med verklig data.

## Vecka 3 (dag 15–21): Låt datan styra pengarna

**Mål: prissättning och lager slutar vara gissningar.**

- Dag 15–17: Prisintervall från falldata i `/quick-price/`: vid val av
  jobType+brand visas P25–P75 av verkliga slutpriser + snittid bredvid
  prislistans pris. Avvikelse prislista↔verklighet flaggas (endast internt).
- Dag 17–19: Delförbrukning: aggregat per märke ur `partsUsed`-raderna i
  indexet → enkel "vad ska ligga på hyllan"-lista i admin (text, inte ny
  dashboard). Strukturerad `parts[]` (artikel+antal) läggs till som VALFRITT
  fält vid avslut — fritext `partsUsed` behålls som fallback.
- Dag 19–21: AI-diagnostikutkast v0: vid nytt ärende genererar befintligt
  `claude-brief`-mönster ett kort diagnosförslag grundat på de liknande
  fallen ("troligast BMS, kolla laddport först, förvänta 45–60 min").
  Märkt som förslag. Dry-run/`not_configured` om nyckel saknas.

**DoD vecka 3:** quick-price visar dataintervall; diagnosförslag genereras
för nya ärenden med ≥2 liknande fall.

## Vecka 4 (dag 22–30): Skörda och mäta

**Mål: loopen producerar utåtriktat värde och vi vet att den snurrar.**

- Dag 22–24: Uppgradera `case-analyze.mjs` att använda de nya strukturerade
  fälten (symptom/orsak/tid) i content-utkasten → tekniskt trovärdig copy
  i stället för generisk. Generera 2 riktiga artefakter (t.ex. case-sida
  "Xiaomi startar ej — BMS-byte" + socialt inlägg) från verkliga jobb med
  content-godkännande.
- Dag 24–26: SEO-prioritering från falldata: lista vanligaste
  symptom+märke-kluster ur indexet → beslutsunderlag för nästa
  landningssida (bara listan, sidan byggs senare).
- Dag 26–28: Mätning (inget nytt UI — en admin-endpoint/JSON räcker):
  ifyllnadsgrad rootCause/laborMinutes, antal intag där "liknande fall"
  hade träff, prislista-vs-verklighet-avvikelser.
- Dag 28–30: Utvärdering med Sebastian + tekniker: vilka fält skippas i
  praktiken? Justera friktion. Skriv v1.1-backlog. Uppdatera detta dokument
  med utfall.

**DoD vecka 4:** 2 publicerade/godkända content-artefakter från riktiga jobb;
mät-endpoint visar ifyllnadsgrad ≥80 % på nya avslut.

---

## KPI:er för hela perioden

| KPI | Mål dag 30 |
|---|---|
| Avslut med rootCause + laborMinutes ifyllt | ≥ 80 % |
| Historiska ärenden backfillade i repair-index | ≥ 80 % |
| Nya intag som får ≥1 liknande fall-träff | mäts (baslinje) |
| Content-artefakter från verklig falldata | ≥ 2 |
| Ny infrastruktur införd | 0 |

## Största risker och motmedel

1. **Teknikern hoppar över fälten.** → Max 2 obligatoriska klick, endast vid
   avslut, mät ifyllnadsgrad vecka 4 och skär bort allt som skippas.
2. **För lite data → "0 liknande fall" dödar förtroendet.** → Backfill i
   vecka 2 är inte valfri; den är förutsättningen för allt i vecka 3.
3. **Parallellarbete Codex/Claude i samma filer** (`workshop-cases.mjs`,
   `/workshop/`, `admin/`). → Varje uppgift loggas PÅGÅR i
   `AGENT_SYNC_LOG.md` innan start; små PR:er, aldrig långlivade branches.
4. **Scope creep mot dashboards/design.** → Allt utåt i v1 är text-rutor i
   befintliga vyer. Nya vyer är explicit förbjudna i denna plan.
5. **Blob-list-skalning.** → All läsning går via `repair-index`, aldrig
   full case-list. Omprövas först vid >2 000 ärenden.

## Beroenden

- Sebastian: godkänner rootCause-enum-listan (dag 1), backfill-batchen
  (dag 12–14), content-artefakterna (vecka 4).
- Ingen ny miljövariabel krävs för vecka 1–2. Vecka 3:s AI-utkast kräver
  befintlig Anthropic-nyckel (annars `not_configured`).

## Verifiering per PR (minimum)

```powershell
npm run build
npm run verify:checkout-products
cd nemob-callflow; npm run check   # endast om callflow rörs
```
