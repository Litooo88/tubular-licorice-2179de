// Prioriteringsmotor för obesvarade förfrågningar/utkast.
//
// Sebastians regel (2026-08): prioritera efter
//   1. flest gånger kunden ringt (missade samtal = aktiv kontaktvilja) — väger tyngst
//   2. senast i tiden (färska förfrågningar före gamla)
//   3. chatten granskad: bokning / köp (butik) / generell / oklar
//   4. om bokning: mest pengar på snabbast tid (kr/minut ur prislistan)
//
// Ren modul — inga I/O. Poäng 0–100 + läsbar motivering.

const clean = (v) => String(v || "").toLowerCase();

export const detectTopic = (text) => {
  const s = clean(text);
  if (/upph[aä]mtning av f[aä]rdig/.test(s)) return "hamtning";
  if (/punkter|d[aä]ck|slang|hjul|luft/.test(s)) return "dack";
  if (/batteri|laddar|laddning|bms|r[aä]ckvidd/.test(s)) return "batteri";
  if (/felkod|display|startar|fels[oö]k|elsystem|el-fel|reglage|gas|nyckel|t[aä]nd|kabl|kontakt/.test(s)) return "felsokning";
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

// Intentklassning: "bokning" | "kop" | "generell" | "oklar".
// Konkreta felbeskrivningar vinner alltid över prisfrågor ("vad kostar X" om X är ett fel = bokning).
export const classifyIntent = (message, service) => {
  const s = clean(`${service || ""} ${message || ""}`);
  if (!s.trim()) return "oklar";
  const concreteFault = /punkter|trasig|s[oö]nder|fungerar (inte|ej|d[aå]ligt)|funkar (inte|ej)|startar inte|laddar inte|felkod|l[aä]cker|missljud|hackar|byta|bytt|byte|glapp|kortslut|brinn|r[oö]k|slang|d[aä]ck|broms|reparera|laga|f[oö]rst[oö]r|saknas|st[oö]ld|stulen|stj[aä]la|nyckel|startkab|problem som/.test(s);
  const timeWord = /idag|imorgon|akut|snabbt|n[aä]r kan|boka|h[aä]mta|l[aä]mna in|denna vecka|helgen/.test(s);
  const modelWord = /xiaomi|ninebot|segway|kukirin|kugoo|navee|vsett|dualtron|inokim|emove|halo|teverun|e-wheels|ewheels|nitrox|v[aä]ssla|surron|iscooter|es[1-4]\b|g30|g2\b|g3\b|g4\b|st3|gt3/.test(s);
  const purchase = /vill k[oö]pa|k[oö]pa (en|ny)|s[aä]ljer ni|till salu|intresserad av att k[oö]pa/.test(s);
  if (concreteFault || timeWord) return "bokning";
  if (purchase) return "kop";
  const generalOnly = /vad kostar|ungef[aä]r|r[aå]dgivning|undrar om|prisuppskattning|kostnadsfri/.test(s);
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

  const callScore = Math.min(missedCalls, 10) * 5;                                   // regel 1: max 50
  const recencyScore = Math.max(0, 15 - age * 0.375);                                // regel 2: max 15 (0 vid 40+ d)
  const intentScore = { bokning: 20, kop: 15, oklar: 8, generell: 0 }[intent];       // regel 3: max 20
  const valueScore = intent === "bokning" ? Math.min(15, Math.round(rate)) : 0;      // regel 4: max 15

  const priority = Math.min(100, Math.round(callScore + recencyScore + intentScore + valueScore));
  const parts = [];
  if (missedCalls) parts.push(`${missedCalls} missade samtal`);
  parts.push(`${age} d`);
  parts.push({ bokning: "bokningsintention", kop: "köpintention (butik)", generell: "generell fråga", oklar: "oklar intention" }[intent]);
  if (intent === "bokning" && econ.valueSek) parts.push(`~${econ.valueSek} kr/${econ.minutes} min`);
  return { priority, intent, topic, estValueSek: intent === "bokning" ? econ.valueSek : 0, estMinutes: econ.minutes, reason: parts.join(" · ") };
};
