# Admin Workflow

## Målflöde

Följande statusflöde är den planerade gemensamma modellen för ops-systemet:

1. **NY FÖRFRÅGAN**
2. **BOKAD**
3. **INLÄMNAD**
4. **VÄNTAR FELSÖKNING**
5. **FELSÖKNING PÅGÅR**
6. **PRISFÖRSLAG SKICKAT**
7. **INVÄNTAR GODKÄNNANDE**
8. **VÄNTAR RESERVDEL**
9. **REPARATION PÅGÅR**
10. **TEST / KVALITETSKONTROLL**
11. **KLAR FÖR UPPHÄMTNING**
12. **BETALNING SKICKAD**
13. **BETALD**
14. **AVSLUTAD**
15. **REKLAMATION / ÅTERKOMST**

## Viktig nulägesnot

Koden använder idag en enklare statusmodell:

- `new`
- `contacted`
- `waiting_customer`
- `checked_in`
- `diagnosing`
- `repairing`
- `waiting_parts`
- `ready`
- `done`
- `archived`

Betalning ligger separat som `unpaid`, `invoice_ready`, `invoiced`, `paid`.
Byt inte direkt till målflödet utan migration, UI-uppdatering och
bakåtkompatibel mappning.

## Föreslagen mappning under migrering

| Målstatus | Nuvarande närmaste status |
|---|---|
| NY FÖRFRÅGAN | `new` |
| BOKAD | `contacted` eller `new` med bokad tid |
| INLÄMNAD | `checked_in` |
| VÄNTAR FELSÖKNING | `checked_in` |
| FELSÖKNING PÅGÅR | `diagnosing` |
| PRISFÖRSLAG SKICKAT | `waiting_customer` + `quote` |
| INVÄNTAR GODKÄNNANDE | `waiting_customer` |
| VÄNTAR RESERVDEL | `waiting_parts` |
| REPARATION PÅGÅR | `repairing` |
| TEST / KVALITETSKONTROLL | `repairing` + workshopnotering |
| KLAR FÖR UPPHÄMTNING | `ready` |
| BETALNING SKICKAD | `ready` + `payment.status=invoice_ready` |
| BETALD | `payment.status=paid` |
| AVSLUTAD | `done` |
| REKLAMATION / ÅTERKOMST | saknas, måste införas via migration |

## Roller och godkännande

- Verkstaden får uppdatera verkstadsstatus, logg, bilder och reservdelsbehov.
- Sebastian godkänner slutpris, batteriärenden, reklamation, rabatt, garanti,
  betalning och högriskkommunikation.
- AI får rekommendera nästa status men inte själv flytta ärenden genom
  godkännandesteg.

## Krav per steg

- Varje statusändring ska skapa en `case_event`/timeline-händelse.
- Orsak och operatör ska sparas för manuella ändringar.
- Prisförslag ska ha belopp/intervall, sammanfattning och godkännandestatus.
- Reservdelsstatus ska ange del, kostnad, beställningsstatus och godkännare.
- Betald får endast sättas efter verifierad betalning.
- Avslutad får endast sättas när arbete, betalning och kundkommunikation är
  dokumenterade.
