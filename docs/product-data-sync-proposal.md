# Produktdata och status - förslag

Syfte: slippa manuell produktstatus på både startsidan och `/nya-elscootrar/`.

## Alternativ 1: Delad datafil

Skapa till exempel `data/products.json` med namn, varumärke, pris, status, leveranstid, bild, CTA och vilka sidor produkten ska visas på.

Fördelar:
- Snabbast och billigast att bygga.
- Passar statisk Netlify-site.
- Sebastian/Codex kan uppdatera en fil och båda sidor följer samma status.

Nackdelar:
- Kräver fortfarande GitHub/commit eller ett enkelt adminlager ovanpå senare.

Rekommendation: bästa första steg.

## Alternativ 2: Headless CMS

Använd ett CMS för produktkort och status, till exempel Decap CMS, Sanity eller Contentful.

Fördelar:
- Sebastian kan uppdatera produkter i webbgränssnitt.
- Kan hantera bilder, status, kampanjer och SEO mer strukturerat.

Nackdelar:
- Mer setup, fler konton och mer underhåll.
- Risk att bli onödigt stort innan produktflödet är stabilt.

Rekommendation: bra senare om katalogen växer och uppdateras ofta.

## Alternativ 3: Enkel adminpanel

Bygg en intern adminvy där Sebastian väljer status som `I LAGER`, `PÅ VÄG`, `SLUT`, `FÖRBESTÄLL` och uppdaterar pris/CTA. Datan kan lagras i Netlify Blobs, Supabase eller en JSON-fil via GitHub API.

Fördelar:
- Mest användarvänligt för snabb lagerstatus.
- Kan kopplas till befintlig adminportal.

Nackdelar:
- Kräver inloggning, skriv-API och mer säkerhet.
- Mer kod än en datafil.

Rekommendation: bygg först efter att produktdatafilen är på plats.

## Min rekommendation

Starta med delad `data/products.json` och rendera både startsidans 6 utvalda produkter och hela katalogen från samma källa. När det fungerar stabilt kan adminpanelen bli ett tunt gränssnitt ovanpå samma data.
