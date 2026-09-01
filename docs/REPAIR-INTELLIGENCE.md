# Repair Intelligence Loop — steg 1–2 (byggt 2026-09-01)

Varje avslutat ärende blir en datarad; datan visas vid nästa liknande jobb.

## Fånga (workshop-vyn, steg 5)
Tre fält vid avslut: **grundorsak** (enum `ROOT_CAUSES` i
`_shared/repair-index.mjs`), **arbetstid** (snabbknappar 15–120 min) och
**symptom** (förifyllt från ärendet). Sparas i `completion` via vanliga
PATCH:en; "Ready for payment" tar med fälten automatiskt. Märke normaliseras
till `vehicle.brand` (regexlista). Vid avslut/data skrivs raden idempotent
till blob-storen `repair-index` (nyckel = caseId, ingen kund-PII).

## Slå upp
`case-similar.mjs` (admin-token):
- `GET /api/case-similar?jobType=&brand=&q=` → liknande rader + aggregat
  (vanligaste grundorsak, pris P25–P75, snittid) + kanontips ur blobben
  `repair-canon` (⚠ för safety-critical). Visas i workshop-vyns steg 5.
- `PUT /api/repair-canon {posts, version}` → synkar kunskapsbanken (PII-vakt).
- `GET /api/repair-stats` → mätningen: ifyllnadsgrad senaste 30 avslut,
  pris per jobbtyp, träffräknare. Ingen dashboard — JSON räcker.

## Kvar (dag 2+)
Prisintervall i quick-price, AI-backfill av 30 senaste avsluten (godkänns i
batch), diagnosförslag vid intag. Friktionskoll dag 3: under 80 %
ifyllnadsgrad ⇒ formuläret bantas.
