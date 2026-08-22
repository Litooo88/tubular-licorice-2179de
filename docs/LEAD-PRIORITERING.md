# Lead-prioritering — Sebastians regel

Gäller obesvarade förfrågningar, SMS-utkastinkorgen och framtida uppringningslistor.
Implementerad i `netlify/functions/_shared/lead-priority.mjs` (`scoreLead`), används av
`sms-draft-inbox.mjs` (sortering + "Varför här"-rad i admin).

## Ordningen

1. **Flest gånger ringt.** Missade samtal *från* kundens nummer i 46elks-loggen = aktiv
   kontaktvilja. Väger tyngst: 5 p per samtal, tak vid 10 (max 50 p).
2. **Senast i tiden.** Ärendets ålder: 15 p vid 0 dagar, 0 p vid 40+ dagar.
3. **Chatten granskad — bokning, köp, generell eller oklar?** Konkret fel ("fungerar ej",
   "reparera", "trasig", stöldskada…), tidsord eller modellnamn ⇒ *bokning* (20 p); "vill
   köpa / säljer ni" ⇒ *köp — butikslead* (15 p); ren pris-/rådgivningsfråga utan fel ⇒
   *generell* (0 p); tomt ⇒ 8 p. Felbeskrivning vinner alltid över prisfråga.
4. **Om bokning: mest pengar på snabbast tid.** Kr per minut ur prislistan per ämne
   (däck ~600 kr/35 min, felsökning ~650/50, batteri ~900/60, broms ~450/30,
   service ~545/45). Max 15 p. Endast bokningsintention får värdepoäng.

Summa 0–100. Varje rad i inkorgen visar poäng + motivering, t.ex.
`15 missade samtal · 29 d · bokningsintention · ~600 kr/35 min`.

## Datakällor och begränsningar

- Missade samtal kräver berikning från `call-dashboard` vid import (importören skickar
  `meta.missedCalls` + `meta.lastCallDate`). Utan berikning räknas 0 samtal.
- 46elks-loggen ser bara *inkommande* samtal till företagsnumret. Samtal Sebastian ringt
  från egen mobil syns inte — den kunskapen finns bara i huvudet och fångas i granskningen.
- Ordervärden är typvärden ur prislistan, inte offerter. Bindande pris sätts alltid av
  människa.

## Regler som inte får brytas

- Poängen sorterar — **den skickar aldrig**. Varje utskick godkänns per ärende i admin.
- Kunder med pågående ärende i verkstaden eller redan besvarade samtal ska filtreras
  bort *före* poängsättning (korskörning mot ärendedatabas + samtalslogg).
