# Missed Call Follow-Up Workflow

## Syfte

Detta workflow är ett akutläge för missade samtal när live-källa för call logs
saknas eller ännu inte är säkert kopplad. Det ska hjälpa Sebastian att snabbt
sortera nummer, se befintliga kunder och kopiera SMS-utkast utan att admin
skickar något automatiskt.

## Så gör Sebastian

1. Öppna 46elks eller annan samtalslista.
2. Kopiera raderna med missade samtal eller bara telefonnumren.
3. Öppna `/admin/`.
4. Gå till **Akut uppföljning – missade samtal**.
5. Klistra in samtalslistan i fältet **Klistra in missade samtal / nummer från
   46elks**.
6. Klicka på **Analysera nummer**.
7. Granska prioritet, kundmatchning och SMS-utkast.
8. Kopiera vald lista eller rapport och skicka manuellt i godkänt verktyg.

## Testexempel

Använd dessa endast för lokal/manuell test, inte som aktiv mockdata i UI:

```text
+46702102025
+46702102025
+46707544800
+46704923079
0700593391
+46700731460
0739973717
```

Förväntat: 7 rader, 7 nummerträffar, 6 unika nummer och 1 återkommande nummer.

## Parser och normalisering

Parsern hittar svenska mobilnummer i bland annat dessa format:

- `+467...`
- `07...`
- med mellanslag
- utan mellanslag
- med bindestreck
- dubbletter

Nummer normaliseras till `+467...`. Exempel:

- `0701234567` blir `+46701234567`
- `070 123 45 67` blir `+46701234567`
- `+46 70 123 45 67` blir `+46701234567`

## Kundmatchning

Admin matchar mot redan skyddade kundärenden från `/api/cases`, som i sin tur
läser `workshop-cases` via Netlify Functions. Matchningen använder
telefonnummer på kundkort/case och skriver inte något till backend.

För varje nummer visas:

- telefonnummer
- antal försök
- matchad kund om den finns
- modell om den finns
- case-status om den finns
- e-post om den finns
- prioritet
- rekommenderad åtgärd
- lokalt SMS-utkast

## Prioritet

- 3+ försök: hög prio
- matchad kund + missat samtal: hög prio
- okänt nummer + många försök: hög prio
- 1 försök + okänt nummer: normal prio

## Exporter

Panelen kan kopiera:

- alla unika nummer
- hög prio
- okända nummer
- identifierade kunder
- SMS-text för identifierad kund
- SMS-text för okänt nummer
- komplett rapport

## Säkerhet

Inget SMS skickas från denna vy. Inget mail skickas. Funktionen gör inga
production-writes, läser inte privata SMS och kopplar inte Gmail live.

All text ska granskas innan den skickas manuellt. Batteri, reklamation,
missnöjd kund, garanti, rabatt, juridiskt ansvar och pris över 995 kr kräver
manuell kontroll enligt `docs/SAFETY_AND_APPROVAL_RULES.md`.

## Nästa steg senare

Nästa säkra iteration bör vara:

- 46elks webhook för call events
- read-only call-log-listning i admin
- explicit godkännande innan SMS skickas
- audit-logg/timeline-event för skickat meddelande
- idempotency för webhook-events och SMS-sändning

Ingen live-sändning ska aktiveras innan approval-flöde, audit trail och
provider-konfiguration är verifierade.
