# Codebase Recovery Summary

## Varför dokumentet finns

Tidigare AI-konversationer har försvunnit. Detta dokument är den tekniska
återhämtningsbilden som Codex, Claude Code och ChatGPT ska använda innan de
ändrar projektet.

## Teknikstack

- Statisk HTML/CSS/JavaScript i repo-roten och route-mappar
- Netlify hosting och Netlify Functions (`.mjs`/`.js`)
- Netlify Blobs (`@netlify/blobs`)
- Stripe Node SDK
- 46elks SMS/voice
- Resend e-post
- Google Calendar service account
- Separat Cloudflare Worker i `nemob-callflow/`
- TypeScript endast i Cloudflare Worker-delen
- D1 för samtalslogg och KV-binding för framtida transient state

Rotens build genererar produkt-HTML från `data/products.json`. Det finns ingen
frontend-bundler eller ramverksrouter.

## Routes och ytor

Primära workflow-ytor:

- `/`
- `/book-online/`
- `/admin/`
- `/workshop/`
- `/quick-price/`
- `/checkout/`
- `/prices/`

Andra viktiga ytor:

- `/nya-elscootrar/`
- `/priser/`
- `/kontakt/`
- servicesidor och guider

Aktiva Netlify API-routes finns i `netlify/functions/` och dokumenteras i
`docs/API_CONTRACTS.md`.

Cloudflare Worker-routes finns som explicita `url.pathname`-kontroller i
`nemob-callflow/src/index.ts`.

## Komponenter och ansvar

Det finns inga ramverkskomponenter. De huvudsakliga ansvarsenheterna är:

- `admin/index.html`: full admin, kundkort, SMS, pris, betalning och content
- `workshop/index.html`: förenklad verkstadsvy
- `quick-price/index.html`: snabbpris och intern ärendeskapning
- `checkout/index.html`: betalningsinstruktion och avslut
- `prices/index.html`: prisdatabas
- `book-online/index.html`: publik bokning
- `assets/workshop-chat.js`: publik intake-widget
- `netlify/functions/booking.mjs`: bokning, kalender och bekräftelser
- `netlify/functions/workshop-cases.mjs`: aktivt `/api/cases`
- `netlify/functions/call-dashboard.mjs`: samtalsleads
- `netlify/functions/price-catalog.mjs`: prisdatabas
- `netlify/functions/case-media.mjs`: ärendebilder
- `netlify/functions/create-checkout.js`: Stripe produkt-checkout
- `nemob-callflow/`: fristående 46elks IVR/telefoni-worker

`netlify/functions/cases.mjs` är en räddad/disabled route och ska inte
återaktiveras utan analys av route-kollision.

## Storage-lösning

Det finns ingen `storage.ts` och inget isolerat adapterlager.

Direkta Netlify Blob-anrop används i flera funktioner:

- `workshop-cases`
- `case-media`
- `price-catalog`
- `call-leads`
- `call-followups`

Produktdata ligger i `data/products.json`. Cloudflare Worker använder D1
`call_log`. Framtida adapters bör införas isolerat och testas innan befintliga
anrop migreras.

## Auth och localStorage

Admin-API skyddas idag med `ADMIN_TOKEN` via `x-admin-token`. Token sparas i
`localStorage` under `nordicAdminToken`. Operatörsnamn sparas under
`nordicAdminOperator`.

Övrig localStorage gäller workshop-chat-utkast och newsletter-preferenser.
Ingen ny kund- eller betaldata får läggas där.

## Vad som redan fungerar

- Publik webbplats, servicesidor och produktkatalog
- Produktgenerator och checkout-produktverifiering
- Publik bokning med kalenderkontroll
- Skapande av workshop-cases i Netlify Blobs
- SMS/e-post-bekräftelser när providers är konfigurerade
- Adminärenden, status, prisrader, workshoplogg och timeline
- Snabbpris, prisdatabas och checkout-flöde för verkstadsärenden
- Ärendebilder och contentutkast
- Publik workshop-chat som skapar ärende
- Call dashboard och call leads
- Stripe Checkout för produkter
- Separat 46elks Cloudflare Worker med IVR, D1-logg och rapporter

## Vad som saknas

- Gemensam datamodell och migrationssystem för ops-data
- `storage.ts`/repository-adapter
- Supabase/Postgres och RLS
- Rollbaserad auth och server-side session
- Tvåvägs-SMS-inbox och delivery reports
- Gemensamma typer mellan klient och API
- Implementerade AI-endpoints för SMS-utkast, daily brief och quote
- Full reservdelsworkflow
- Riktig Fortnox-integration
- Samlad automatiserad testsvit för ops-flödet

## Risker

- Masterliknande admin-token ligger i browserns `localStorage`.
- Auth-, env- och storage-hjälpare är duplicerade mellan funktioner.
- Schemalösa Blob-dokument saknar migrationskontroll.
- Publik media-GET och publik booking-env-status behöver säkerhetsgranskning.
- Publika intake-endpoints behöver rate limiting/spamskydd.
- Två parallella telefoniimplementationer finns: Netlify fallback och
  Cloudflare Worker.
- Den äldre nested kopian `nordic-emobility-site/` togs bort ur `main` efter
  hardening-rundan och är ignorerad för att inte råka återinföras.
- Äldre docs och vissa texter kan vara historiska eller inaktuella.
- Root-build testar inte automatiskt hela Cloudflare Worker-delen.

## Nästa rekommenderade steg

1. Inför ett isolerat storage/repository-lager utan att ändra beteende.
2. Definiera gemensamma typer och validering för service cases.
3. Hardena auth, mediaåtkomst och publika diagnostics-endpoints.
4. Lägg till rate limiting och idempotency för publika intake-endpoints.
5. Skapa Supabase-schema/migrationer och planera dual-write.
6. Implementera AI-endpoints i dry-run med approval-regler.
7. Bygg tvåvägs-SMS och delivery-report-flöde.
8. Lägg till integrationstester för bokning, admin, SMS-utkast och betalning.

## Verifieringskommandon

```powershell
npm run build
npm run verify:checkout-products
cd nemob-callflow
npm run check
```
