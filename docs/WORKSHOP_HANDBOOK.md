# Workshop Handbook v0.1

## Syfte

Denna handbok är Nordic E-Mobilitys operativa grund för verkstad, admin och
AI-stöd. Den ska göra arbetet tydligt, spårbart och säkert när Sebastian,
verkstaden, praktikant eller AI-assistent hanterar kundärenden.

AI får hjälpa till med prioritering, sammanfattning och utkast. AI fattar inte
bindande beslut och skickar inte kundmeddelanden utan godkännande.

## Standardflöde för ärende

1. Kund kontaktar Nordic E-Mobility via bokning, telefon, SMS, mail eller
   workshop-chat.
2. Ärende skapas i admin.
3. Kund identifieras med namn och telefonnummer.
4. Fordonsmodell och felbeskrivning dokumenteras.
5. Riskklassning görs.
6. Felsökning bokas eller utförs enligt prioritet.
7. Kostnadsförslag eller prisintervall kommuniceras.
8. Kund godkänner innan arbete som kräver godkännande.
9. Reparation utförs.
10. Test/provkörning och kvalitetskontroll dokumenteras.
11. Betalning hanteras.
12. Kunden hämtar fordonet.
13. Ärendet avslutas eller följs upp.

## Mottagning och inlämning

- Bekräfta namn, telefonnummer och eventuell e-post.
- Fråga efter modell, fel, när felet uppstod och om fordonet är modifierat.
- Dokumentera om laddare, nycklar eller andra tillbehör lämnats in.
- Ta bild vid skador, batteririsk, fuktskada eller oklart skick.
- Uppmuntra bokad tid via `https://www.nordicemobility.se/book-online/`.
- Uppmuntra inte drop-in som standard.

## Kundidentifiering

Minsta data:

- namn
- telefonnummer
- fordon/modell om möjligt
- vad kunden vill ha hjälp med

Om e-post saknas är telefonnummer den primära kontaktytan. Lägg inte kunddata i
localStorage eller fria anteckningar utanför adminflödet.

## Modellidentifiering

Kontrollera:

- märke och modell
- serienummer om möjligt
- spänning/batterityp om relevant
- däckdimension
- bromstyp
- felkod i display/app

Om modellen är okänd: skriv vad som syns på fordonet och be kunden komplettera.

## Riskklassning

Hög risk kräver Sebastian eller ansvarig tekniker:

- batteri, BMS, cellpack eller laddproblem
- lukt, värme, svullnad eller fuktskada
- reklamation eller missnöjd kund
- garantiuttalanden
- juridiskt ansvar
- rabatt
- pris över 995 kr
- osäker diagnos där kunden kan tolka texten som ett löfte

## Felsökning

Starta med det enkla:

- kundens symptom
- visuell kontroll
- däck, broms, kablage och kontakter
- laddare/laddport
- felkoder
- provkörning endast om säkert

Dokumentera vad som är testat. Skriv inte fast slutpris innan diagnosen är
tillräckligt säker.

## Kostnadsförslag

- Ge startpris eller intervall när felet är osäkert.
- Säg att slutpris bekräftas innan arbete.
- Pris över 995 kr kräver godkännande.
- Batteriärenden kräver alltid manuell kontroll.
- Reservdel över 500 kr kräver godkännande.

## Kundgodkännande

Godkännande ska vara tydligt och spårbart. Spara i ärendets timeline eller
anteckning:

- vad kunden godkände
- belopp/intervall
- datum/tid
- kanal
- vem som tog beslutet

## Reparation

- Följ godkänt arbete.
- Dokumentera avvikelser.
- Stoppa om nytt fel upptäcks som påverkar pris eller säkerhet.
- Beställ inte dyra delar utan godkännande.

## Test och provkörning

- Kontrollera bromsar.
- Kontrollera gasreglage/display.
- Kontrollera att felkod inte återkommer.
- Provkör bara när fordonet är säkert.
- Dokumentera testresultat.

## Betalning

- Betald status får bara sättas efter verifierad betalning.
- Swish företag: 123 240 6775.
- Bankgiro: 5290-5494.
- Spara belopp, metod och referens om möjligt.

## Utlämning

- Sammanfatta utfört arbete.
- Informera om kvarstående risker eller rekommenderad uppföljning.
- Lämna inte ut osäkert batteriärende utan tydlig bedömning.
- Ge bokningslänk för ny service.

## Uppföljning

- Missade samtal hanteras via akutpanelen i admin.
- Recensionslänk kan skickas efter avslutat ärende.
- Reklamation eller missnöjd kund eskaleras till Sebastian.

## Praktikant får göra

- sortera ärenden efter status
- fylla i modell, telefonnummer och enkel felbeskrivning
- kopiera godkända SMS-utkast
- utföra enklare visuell kontroll
- dokumentera bilder och interna anteckningar
- packa upp och märka reservdelar

## Praktikant får inte göra

- arbeta med batteripack utan godkännande
- ge slutpris utan godkännande
- lova garanti eller ersättning
- skicka högriskmeddelanden
- beställa reservdelar över 500 kr
- markera betalning utan verifiering
- radera kunddata eller ärenden
