// Prioriteringsmotor för obesvarade förfrågningar/utkast.
//
// Sebastians regel (2026-08): prioritera efter
//   1. flest gånger kunden ringt (missade samtal = aktiv kontaktvilja)
//   2. senast i tiden (färska förfrågningar före gamla)
//   3. chatten granskad: leder den till bokning eller är den generell?
//   4. om bokning: mest pengar på snabbast tid (kr/minut ur prislistan)
//
// Ren modul — inga I/O. Poäng 0–100 + läsbar motivering.

const clean = (v) => String(v || "").toLowerCase();

export const detectTopic = (text) => {
  const s = clean(text);
  if (/upph[aä]mtning av f[aä]rdig/.test(s)) return "hamtning";
  if (/punkter|d[aä]ck|slang|hjul|luft/.test(s)) return "dack";
  if (/batteri|laddar|laddning|bms|r[aä]ckvidd/.test(s)) return "batteri";
  if (/felkod|display|startar|fels[oö]k|elsystem|el-fel/.test(s)) return "felsokning";
  if (/broms/.test(s)) return "broms";
  if (/service|genomg[aå]ng|check/.test(s)) return "service";
  if (/r[aå]dgivning|prisuppskattning|kostnadsfri/.test(s)) return "radgivning";
  return null;
};

// Typiskt ordervärde och tidsåtgång per ämne (ur skarpa prislistan, avrundat).
export const TOPIC_ECONOMY = {
  dack: { valueSek: 600, minutes: 35 },
  felsokning: { valueSek: 650, minutes: 50 },
  batteri: { valueSek: 900, minutes: 60 },
  broms: { valueSek: 450, minutes: 30 },
  service: { valueSek: 545, minutes: 45 },
  hamtning: { valueSek: 600, minutes: 40 },
  radgivning: { valueSek: 0, minutes: 10 },
};

// Intentklassning av kundens text: "bokning" | "generell" | "oklar".
export const classifyIntent = (message, service) => {
  const s = clean(`${service || ""} ${message || ""}`);
  if (!s.trim()) return "oklar";
  const concreteFault = /punkter|trasig|s[oö]nder|startar inte|laddar inte|felkod|l[aä]cker|missljud|hackar|byta|byte|glapp|kortslut|brinn|r[oö]k|slang|d[aä]ck|broms/.test(s);
  const timeWord = /idag|imorgon|akut|snabbt|n[aä]r kan|boka|h[aä]mta|l[aä]mna in|denna vecka|helgen/.test(s);
  const modelWord = /xiaomi|ninebot|segway|kukirin|kugoo|navee|vsett|dualtron|inokim|emove|halo|teverun|e-wheels|ewheels|nitrox|v[aä]ssla|surron|g30|g2|g3|g4|st3|gt3/.test(s);
  const generalOnly = /vad kostar|ungef[aä]r|r[aå]dgivning|undrar om|s[aä]ljer ni|k[oö]pa|prisuppskattning|kostnadsfri/.test(s);
  if (concreteFault || timeWord) return "bokning";
  if (generalOnly) return "generell";
  return modelWord ? "bokning" : "oklar";
};

// Poängsätter ett utkast/lead. meta: { missedCalls, alderDagar, ursprung, tjanst }
export const scoreLead = (meta = {}) => {
  const missedCalls = Math.max(0, Number(meta.missedCalls) || 0);
  const age = Math.max(0, Number(meta.alderDagar) || 0);
  const intent = classifyIntent(meta.ursprung, meta.tjanst);
  const topic = detectTopic(`${meta.tjanst || ""} ${meta.ursprung || ""}`);
  const econ = TOPIC_ECONOMY[topic] || { valueSek: 300, minutes: 30 };
  const rate = econ.minutes ? econ.valueSek / econ.minutes : 0; // kr/min

  const callScore = Math.min(missedCalls, 10) * 4;                         // max 40
  const recencyScore = Math.max(0, 20 - age * 0.5);                        // max 20
  const intentScore = { bokning: 25, oklar: 10, generell: 0 }[intent];     // max 25
  const valueScore = intent === "generell" ? 0 : Math.min(15, Math.round(rate)); // max 15

  const priority = Math.round(callScore + recencyScore + intentScore + valueScore);
  const parts = [];
  if (missedCalls) parts.push(`${missedCalls} missade samtal`);
  parts.push(`${age} d`);
  parts.push(intent === "bokning" ? "bokningsintention" : intent === "generell" ? "generell fråga" : "oklar intention");
  if (intent !== "generell" && econ.valueSek) parts.push(`~${econ.valueSek} kr/${econ.minutes} min`);
  return { priority, intent, topic, estValueSek: econ.valueSek, estMinutes: econ.minutes, reason: parts.join(" · ") };
};
