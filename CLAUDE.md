# CLAUDE.md

Detta är permanent projektminne och arbetsinstruktion för Claude Code.

## Projektminne

Använd dokumenten under `docs/` som projektminne. Börja med:

1. `docs/NORDIC_PROJECT_CONTEXT.md`
2. `docs/CODEBASE_RECOVERY_SUMMARY.md`
3. `docs/SAFETY_AND_APPROVAL_RULES.md`
4. relevant API-, databas- eller workflow-dokument

Verifiera alltid dokumentation mot aktuell kod. Äldre handoff-dokument kan
beskriva historiska eller delvis genomförda lösningar.

## Arbetsregler

- Implementera små, avgränsade uppgifter.
- Kör build och relevanta tester efter ändringar.
- Skriv tydliga, fokuserade commits när commit efterfrågas.
- Skapa inga stora omskrivningar utan uttrycklig order.
- Bevara befintliga routes och publika kontrakt.
- Lägg nya integrationer bakom dry-run eller ett säkert `not_configured`-läge
  om miljövariabler saknas.
- Håll storage-adapter isolerad. Skapa inte fler direkta, duplicerade
  `getStore(...)`-mönster i ny kod.
- Hårdkoda inga secrets.
- Lägg inte kunddata, betaldata eller auktoritativa verksamhetsdata i
  `localStorage`.
- AI-funktioner ska skapa förslag och utkast, inte genomföra högriskåtgärder
  utan godkännande.

## Viktiga arkitekturfakta

- Roten är en statisk Netlify-sajt med Netlify Functions.
- Ops-vyerna är statiska HTML/JavaScript-sidor, inte ramverksroutes.
- Netlify Blobs används för workshop-cases, media, prislista och call leads.
- `nemob-callflow/` är en separat Cloudflare Worker med D1 och TypeScript.
- Det finns ännu ingen `storage.ts`, Supabase-klient eller gemensam typmodell
  för ops-datan.

## Verifiering

Minst:

```powershell
npm run build
npm run verify:checkout-products
cd nemob-callflow
npm run check
```

Dokumentera ändrade filer, testresultat och kvarvarande risker i handoffen.
