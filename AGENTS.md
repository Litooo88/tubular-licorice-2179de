# AGENTS.md

Detta är den permanenta instruktionen för Codex och andra kodagenter i Nordic
E-Mobility-repot.

## Börja alltid här

Läs följande innan kodändringar:

1. `docs/AGENT_SYNC_LOG.md` — **delad realtidslogg mellan agenter.** Flera
   agenter (Codex, Claude Code) jobbar ofta parallellt i samma mapp. Läs de
   senaste posterna först, och **logga in vad du gör** enligt protokollet där
   (post `PÅGÅR` när du börjar, `KLAR` när du lämnar över).
2. `docs/NORDIC_PROJECT_CONTEXT.md`
3. `docs/CODEBASE_RECOVERY_SUMMARY.md`
4. `docs/SAFETY_AND_APPROVAL_RULES.md`
5. Relevant domändokument, särskilt `docs/API_CONTRACTS.md`,
   `docs/DATABASE_SCHEMA.md` och `docs/ADMIN_WORKFLOW.md`

Äldre dokument under `docs/` innehåller viktig historik, men kan vara delvis
inaktuella. Kontrollera alltid påståenden mot koden.

## Faktisk arkitektur

- Rotprojektet är en statisk HTML/JavaScript-sajt på Netlify, inte en
  React/Next-app.
- API:t ligger främst i `netlify/functions/`.
- Adminytorna är statiska route-mappar som `admin/`, `workshop/`, `checkout/`,
  `prices/` och `quick-price/`.
- Operativ data ligger idag främst i Netlify Blobs.
- `nemob-callflow/` är en separat Cloudflare Worker i TypeScript med D1.
- Det finns för närvarande ingen `storage.ts`, ingen Supabase-integration och
  inget gemensamt storage-adapterlager.

## Hårda regler

- Gör inga destruktiva ändringar och radera inte data eller befintliga routes
  utan uttrycklig order.
- Ändra inte datamodell eller statusvärden utan en dokumenterad migration och
  bakåtkompatibilitetsplan.
- Hårdkoda aldrig secrets, tokens, privata telefonnummer eller API-nycklar.
- All kunddata, SMS, betalning och admin-actions ska hanteras server-side och
  vara auth-skyddade. Publika intake-endpoints får endast ta emot minsta
  nödvändiga data och får aldrig exponera kunddata.
- `localStorage` är endast MVP/demo tills Supabase är inkopplat. Utöka inte
  användningen för kunddata, betaldata eller auktoritativa verksamhetsdata.
- AI får föreslå, prioritera och skapa utkast men får inte själv fatta eller
  verkställa högriskbeslut. Följ `docs/SAFETY_AND_APPROVAL_RULES.md`.
- Lägg nya integrationer bakom dry-run eller tydligt `not_configured`-läge när
  miljövariabler saknas.
- Bevara befintliga routes och externa kontrakt om uppgiften inte uttryckligen
  kräver en migrering.

## Arbetssätt

- Bygg små, testbara steg.
- Följ befintliga mönster där de är säkra, men duplicera inte auth- eller
  storage-logik i nya funktioner. Nya adapters ska hållas isolerade.
- Gör inte stora omskrivningar utan uttrycklig order.
- Arbeta med befintliga lokala ändringar; återställ dem inte.
- Uppdatera relevant dokumentation när API, datamodell, workflow, säkerhet eller
  integrationer ändras.

## Minsta verifiering

Kör efter relevanta ändringar:

```powershell
npm run build
npm run verify:checkout-products
cd nemob-callflow
npm run check
```

Kör även `node --check` på ändrade `.js`/`.mjs`-filer när det är relevant.

## Leverans

Varje handoff ska dokumentera:

- ändrade filer
- beteendeförändringar
- körda testkommandon och resultat
- kvarvarande risker eller manuella verifieringar
