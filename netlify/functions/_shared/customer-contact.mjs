// Kundkontaktlagret: mallar, riskbedömning och godkännande via SMS.
//
// Bakgrund (Sebastian 2026-10-06): kundkontakten är den uppgift han drar sig
// från längst, och admin är ytan han inte öppnar. Utkastinkorgen fanns redan
// (sms-draft-inbox) men krävde ett besök i admin för varje godkännande. Det här
// lagret gör två saker: delar in utgående SMS i "får skickas direkt" och
// "kräver ditt ja" enligt docs/SAFETY_AND_APPROVAL_RULES.md, och gör att ett
// ja kan ges genom att svara på ett SMS i stället för att logga in.
//
// Allt här är rena funktioner utan sidoeffekter så att reglerna kan testas —
// det är dem hela förtroendet hänger på.

const clean = (value, max = 900) => String(value || "").trim().slice(0, max);

// Fras som alltid avslutar ett kundmeddelande. Avsändaren kan vara 076-numret
// (ett vanligt mobilnummer för kunden), så företagsnamnet måste stå i texten.
const SIGN = "/Nordic E-Mobility";

const namnet = (ctx) => {
  const namn = clean(ctx?.namn, 40).split(" ")[0];
  return namn ? ` ${namn}` : "";
};

// Hela frasen, inte bara substantivet: utan modell blir det "ditt fordon" i
// stället för "din" plus ett tomrum. Kunderna lämnar in både scootrar och
// cyklar, så fallbacken måste passa båda.
const fordonet = (ctx) => {
  const modell = clean(ctx?.modell, 40);
  return modell ? `din ${modell}` : "ditt fordon";
};
const Fordonet = (ctx) => {
  const fras = fordonet(ctx);
  return fras.charAt(0).toUpperCase() + fras.slice(1);
};

// NIVÅ 1 — autoskick tillåtet enligt säkerhetsreglerna ("bokningsbekräftelse,
// missat samtal-svar, fråga om modell/fel, enkel statusuppdatering").
// NIVÅ 2 — allt som rör pris över 995 kr, rabatt, garanti, batteri eller
// reklamation. Där får AI bara föreslå.
export const CONTACT_TEMPLATES = {
  mottagen: {
    niva: 1,
    rubrik: "Vi har tagit emot fordonet",
    bygg: (ctx) => `Hej${namnet(ctx)}! Vi har tagit emot ${fordonet(ctx)} i verkstaden. Vi hör av oss så snart vi vet vad som behövs. ${SIGN}`,
  },
  inlamning: {
    niva: 1,
    rubrik: "Instruktioner för inlämning",
    bygg: (ctx) => {
      const alternativ = [];
      if (clean(ctx?.grannnamn, 40)) alternativ.push(`lämna den hos vår granne ${clean(ctx.grannnamn, 40)}`);
      alternativ.push("ställ den utanför vårt garage och smsa en bild när den står där");
      alternativ.push("eller boka tid på nordicemobility.se/book-online");
      return `Hej${namnet(ctx)}! Så här lämnar du in ${fordonet(ctx)}: ${alternativ.join(", ")}. Svara på detta sms om du vill ha en annan lösning. ${SIGN}`;
    },
  },
  status: {
    niva: 1,
    rubrik: "Statusuppdatering utan prisuppgift",
    bygg: (ctx) => `Hej${namnet(ctx)}! Läget på ${fordonet(ctx)}: ${clean(ctx?.status, 300) || "vi jobbar på den"}. Vi hör av oss igen när det händer något. ${SIGN}`,
  },
  klar: {
    niva: 1,
    rubrik: "Klar för avhämtning",
    bygg: (ctx) => `Hej${namnet(ctx)}! ${Fordonet(ctx)} är klar för avhämtning. Hämta tisdag eller torsdag 10-16, eller hör av dig om du behöver en annan tid. ${SIGN}`,
  },
  bokad: {
    niva: 1,
    rubrik: "Bokningsbekräftelse",
    bygg: (ctx) => `Hej${namnet(ctx)}! Vi har bokat in ${fordonet(ctx)} ${clean(ctx?.tid, 80) || "enligt överenskommelse"}. Hör av dig om tiden inte passar. ${SIGN}`,
  },
  aterkoppling: {
    niva: 1,
    rubrik: "Svar på missat samtal",
    bygg: (ctx) => `Hej${namnet(ctx)}! Vi såg att du sökt oss utan att komma fram - ursäkta det. Berätta vad det gäller i ett sms, eller boka direkt på nordicemobility.se/book-online, så tar vi det därifrån. ${SIGN}`,
  },
  pris: {
    niva: 2,
    rubrik: "Prisuppgift",
    bygg: (ctx) => `Hej${namnet(ctx)}! ${Fordonet(ctx)}: ${clean(ctx?.atgard, 200) || "åtgärden"} går på ${clean(ctx?.pris, 20)} kr. Svara JA så sätter vi igång. ${SIGN}`,
  },
  batteri: {
    niva: 2,
    rubrik: "Batteriärende",
    bygg: (ctx) => `Hej${namnet(ctx)}! Angående batteriet på ${fordonet(ctx)}: ${clean(ctx?.text, 400)} ${SIGN}`,
  },
  fritext: {
    niva: 2,
    rubrik: "Fritext",
    bygg: (ctx) => clean(ctx?.text, 800),
  },
};

// Ord som tvingar fram ett godkännande oavsett mall. Kontrollen ligger på
// TEXTEN och inte bara på mallvalet — en "statusuppdatering" som råkar nämna
// garanti är inget autoskick.
const RISKORD = /(garanti|reklamation|rabatt|batteri|ers[aä]ttning|kostnadsfri|gratis|f[öo]rsening|skadest[åa]nd)/i;
const PRISGRANS = 995;

export const requiresApproval = (templateId, ctx = {}) => {
  const mall = CONTACT_TEMPLATES[templateId];
  if (!mall) return { approval: true, reason: "okänd mall" };
  if (mall.niva === 2) return { approval: true, reason: `mallen ${templateId} kräver godkännande` };
  const pris = Number(ctx.pris || ctx.belopp || 0);
  if (pris > PRISGRANS) return { approval: true, reason: `pris ${pris} kr över ${PRISGRANS} kr` };
  const text = mall.bygg(ctx);
  const traff = text.match(RISKORD);
  if (traff) return { approval: true, reason: `texten nämner "${traff[0]}"` };
  return { approval: false, reason: "autoskick tillåtet" };
};

export const buildMessage = (templateId, ctx = {}) => {
  const mall = CONTACT_TEMPLATES[templateId];
  if (!mall) return "";
  return clean(mall.bygg(ctx), 900);
};

// Svarstolkning. Sebastian svarar på digest-SMS:et med radnummer:
//   "1 ok" / "1ok" / "1 ja" / "1 skicka"      -> skicka utkast 1
//   "alla ok"                                  -> skicka allt
//   "1 nej" / "1 skippa"                       -> kasta utkast 1
//   "1 ändra: ring mig först"                  -> ersätt texten och skicka
// Allt annat returnerar null och behandlas som ett vanligt SMS. Ett kundsvar
// får ALDRIG tolkas som ett kommando — "1" betyder RING i kundflödet.
export const parseApprovalReply = (raw) => {
  const text = clean(raw, 900).trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/^(alla|allt)\s*(ok|ja|skicka)$/.test(lower)) return { kind: "ok", all: true };
  if (/^(ok|ja|skicka)\s*(alla|allt)$/.test(lower)) return { kind: "ok", all: true };

  const andra = text.match(/^(\d{1,2})\s*(?:ändra|andra|byt)(\W[\s\S]*)?$/i);
  if (andra) {
    // Separatorn (":" eller "-") ska bort, inte hamna i meddelandet. "1 ändra:"
    // utan text efter är inget kommando — då vet vi inte vad han vill skicka.
    const nyText = clean(andra[2], 800).replace(/^[\s:-]+/, "").trim();
    if (nyText.length < 2) return null;
    return { kind: "andra", index: Number(andra[1]), text: nyText };
  }

  const ok = lower.match(/^(\d{1,2})\s*(ok|ja|skicka)$/);
  if (ok) return { kind: "ok", index: Number(ok[1]) };

  const nej = lower.match(/^(\d{1,2})\s*(nej|skippa|skip|bort)$/);
  if (nej) return { kind: "nej", index: Number(nej[1]) };

  return null;
};

// Digest-SMS:et. Hålls kort med flit: varje SMS-del kostar 0,52 kr och ett
// meddelande över 160 tecken blir två delar. Hela texterna går i mejlet.
export const buildContactDigest = ({ drafts = [], now = new Date() } = {}) => {
  if (!drafts.length) return null;
  const datum = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "numeric" });
  const rader = drafts.slice(0, 5).map((d, i) => {
    const namn = clean(d?.meta?.namn, 18) || clean(d?.meta?.telefon, 18) || "okänd";
    const vad = clean(d?.rubrik || d?.meta?.tjanst, 24);
    return `${i + 1}. ${namn}${vad ? ` - ${vad}` : ""}`;
  });
  const extra = drafts.length > 5 ? ` (+${drafts.length - 5} fler i mejlet)` : "";
  return `[Nordic] ${datum}: ${drafts.length} sms-utkast väntar${extra}\n${rader.join("\n")}\nSvara "1 ok" för att skicka, "alla ok" för allt, "1 nej" för att kasta. Hela texterna i mejlet.`;
};

export const PRISGRANS_SEK = PRISGRANS;
