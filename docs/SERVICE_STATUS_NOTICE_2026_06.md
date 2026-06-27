# Service Status Notice 2026-06

## Syfte

Nordic E-Mobility har tillfalligt hog belastning under hogsasong. Under samma
period har verksamheten haft teknisk atkomststorning kopplad till telefon,
e-post och kontoinloggning. Informationen ska ge kunderna lugn, tydlig och
professionell forklaring utan att avskracka nya bokningar.

Budskapet ar:

- bokning rekommenderas
- langre svarstid kan forekomma
- missade kontakter gors igenom lopande
- bokade arenden och fordon som redan ar inne prioriteras
- vissa reservdelar och leveranser kan ta langre tid under hogsasong

## Uppdaterade sidor

- `index.html`
  - Kort amber/gul serviceinformation efter kampanjraden och fore
    "Sa funkar det".
  - Tydlig CTA till `/book-online/` med texten "Boka service eller felsokning".

- `book-online/index.html`
  - Langre serviceinformation i bokningspanelen fore praktisk tidsinformation.
  - Praktisk bokningsinformation: boka helst minst 12 timmar innan inlamning,
    drop-in endast i man av tid och batteririskrad.
  - Tidigare exakt tidslofte tonades ned till aterkoppling i turordning for
    att inte lova mer an verkstaden kan halla under hog belastning.

## Kontrollerade men ej uppdaterade sidor

- `workshop/index.html`
  - Intern verkstadsyta, inte kundvand. Ingen publik servicebanner lades in.

- `prices/index.html`
  - Intern prisdatabas/adminyta. Ingen publik servicebanner lades in.

## Ton och sakerhet

Texten namner inte privata persondetaljer. Den anvander neutral formulering
kring "tillfalligt hog belastning", "teknisk atkomststorning", "langre
svarstid" och "bokning rekommenderas".

Texten undviker dramatisk eller privat forklarande formulering.

## Borttagning senare

Nar belastningen ar normal igen kan notice-blocket tas bort eller tonas ned:

- ta bort `<section class="service-status">` fran `index.html`
- ta bort `<div class="service-notice">` fran `book-online/index.html`
- behall garna formuleringen om att bokning rekommenderas om den fortfarande
  stammer operativt

## Verifiering

Kontrollera efter andringar:

```powershell
npm run build
npm run verify:checkout-products
cd nemob-callflow
npm run check
cd ..
```

Kontrollera ocksa manuellt att:

- bokningslanken `/book-online/` fungerar
- texten inte tar over startsidan
- informationen inte innehaller privata detaljer
- produktkort och bokningsflode fortfarande fungerar
