# AI Operator Production Status

Senast uppdaterad: 2026-06-26

## Basläge

- Main innehåller PR #35-merge: `c5259fa6b97a0727a048bd501aa1806e687c2a00`.
- AI Operator MVP är mergead till `main`.
- Produktionssmoke körs endast med read-only/dry-run-anrop.
- Stashen `stash@{0}: On feature/ai-operator-mvp3-timeline: Park unrelated local changes before AI operator preview` ska ligga kvar och får inte poppas som del av verifiering eller rollback.

## Lokala tester

Körda från `main` före MVP4-branchen:

- `npm run build` - godkänd
- `npm run verify:checkout-products` - godkänd
- `cd nemob-callflow && npm run check` - godkänd

## Production smoke utan token

URL: `https://www.nordicemobility.se`

- `POST /.netlify/functions/ai-daily-brief?dryRun=1` utan `x-admin-token` returnerade `401 {"error":"Unauthorized"}`.
- `POST /.netlify/functions/ai-quote` med dryRun-payload utan `x-admin-token` returnerade `401 {"error":"Unauthorized"}`.

## Production smoke med token

Terminalmiljön hade ingen säker lokal `ADMIN_TOKEN`, så inga authade terminalanrop kördes i denna verifiering.

Tidigare browser-console-test med sparad admin-token har visat att auth-skyddet fungerar och att dryRun kan användas utan SMS. Vid ny verifiering ska token aldrig loggas och endast följande dry-run-anrop köras:

- `POST /.netlify/functions/ai-daily-brief?dryRun=1`
- `POST /.netlify/functions/ai-quote` med `dryRun: true`

## Bedömning inför MVP4

AI Operator är lokalt verifierad och production-endpoints blockerar korrekt utan token. Authad production-verifiering från terminal kräver att `ADMIN_TOKEN` sätts säkert lokalt och får inte skrivas till logg eller dokumentation.
