# NEMOB OS — Arbetsflödesmanual

Så här används systemet varje dag. Tre beröringar: morgon, eftermiddag, kväll.
Grundprincip: **uppgiftslistan är permanent, planen är färskvara.** Du
prioriterar aldrig i huvudet — du håller uppgifternas fakta ärliga (deadline,
risk, kund väntar, intäkt), så räknar motorn.

## Morgon (5 min, med kaffet)

1. Starta servern om den inte kör: `npm run nemob-os` → öppna
   <http://127.0.0.1:4571>.
2. Kolla **Nordic-panelen**: dagens bokningar, nya sedan igår, försenade
   offerter, äldsta öppna jobb. Fråga dig: *har något hänt sedan igår som
   måste bli en uppgift?* Lägg i så fall in den direkt.
3. Tryck **"Generera om dagsplan"**. Motorn rangordnar allt aktivt:
   akut risk → LVU/myndighetsdeadline → kund som väntar → intäkt idag →
   blockerare → snabba vinster.
4. Läs **morgonbriefen** — den besvarar morgonfrågorna åt dig (vad är akut,
   vad ger mest pengar, vad först, vad före lunch). Håller du inte med:
   "Prioritera" (pin) eller ändra deadline, generera om.

## Under dagen (sekunder per händelse)

- Börjar på något → **Starta**.
- Klart → **Klar**. Fastnar → **Blockera** + orsak (tvingande).
- Något nytt brinner → **"+ Akut uppgift"** — hamnar överst automatiskt och
  planen genereras om direkt.
- Hinner inte → **Flytta** (tomt datum = imorgon; den återkommer själv).

## Eftermiddag/lunch (2 min)

Sektionen **"Kontroll mitt på dagen"** visar automatiskt klart/tillkommit/
blockerat. Svara på de fyra frågorna i formuläret och spara. Har förmiddagen
spårat ur → generera om planen; eftermiddagsblocket byggs om från det som
återstår.

## Kväll (3 min, innan du stänger)

**Kvällssammanfattningen** räknar facit: gjort, inte gjort, blockerat med
orsaker, flyttat. Fyll i det systemet inte kan veta:

- *Varför* blev vissa saker inte gjorda?
- Vad flyttas?
- **Vad ska börja först imorgon?** ← viktigaste fältet; det är morgondagens
  första rad så du aldrig startar dagen från noll.

## Vad som händer med datan

- Uppgifter försvinner aldrig vid dagsbyte — de rullar vidare tills Klar
  eller Flyttad. Flyttade återkommer automatiskt på sitt datum.
- Dagsplan och uppföljningssvar sparas per datum i `nemob-os/data/`
  (lokalt, gitignorerat).
- Nordic-panelen är avsiktligt read-only: den informerar dina uppgifter,
  men ärenden hanterar du som vanligt i admin/verkstadsvyn.

## Om det känns tungt

Missar du lunchkontrollen gör det inget. Missar du kvällen tappar du
"först imorgon"-tråden — det är den som gör morgonen snabb. Skala aldrig
upp ambitionen; skala ned tills tre beröringar per dag känns lätt.
