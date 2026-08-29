# Ringlistan — ingen varm kund missas två gånger

Bakgrund (2026-08-29): av 46 kunder som ringde tillbaka efter vår återkontakt
nåddes bara 18 i telefon. 15 var fortfarande oräddade. Regeln nedan täpper den
läckan.

## Regeln

Ett VARMT nummer = finns i blob-storen \`ring-list\` (seedad med alla
återkontaktade) eller \`campaign-sent\`. När ett varmt nummer ringer växeln
utan att nås gör \`ring-list-scan.mjs\` (schemalagd var 10:e minut) tre saker:

1. Posten väcks till status **new** i ringlistan (försök++, tidsstämpel).
2. Kunden får info-SMS: står på återuppringningslistan, svara RING för
   uppringning inom 24 tim, svar kostar vanlig taxa, STOPP avregistrerar.
   Max 1 per nummer per 7 dagar, aldrig till optout, aldrig 21–08, max 5 per
   körning.
3. Sebastian larmas per SMS (max 1 per nummer per 6 tim, ej nattetid).

RING-svar hanteras av befintliga sms-inbound + ring-escalate (24h-larm).

## Admin

Sektionen **🔥 Ringlista** (röd) överst i admin visar status new, sorterad på
flest försök. Knappar: Ring via växeln (click-to-call när kundkort finns),
SMS (snabbskick, loggas på posten) och Klar. Klar sätter status **watch** —
numret bevakas vidare och väcks igen om kunden ringer och missas på nytt.

## API (admin-token)

- GET  /api/ring-list — åtgärdslistan
- POST /api/ring-list — upsert {phone, name?, caseId?, reason?, status?,
  attempts?, lastCustomerCallAt?, sendInfoSms?}
- POST /api/ring-list/:telefon/done
- POST /api/ring-list/:telefon/sms {message}

Funktioner: \`ring-list.mjs\`, \`ring-list-scan.mjs\` (namnen reserverade i
sync-loggen). Store: \`ring-list\`, nyckel = normaliserat telefonnummer.
