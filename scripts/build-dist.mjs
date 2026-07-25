import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bygger publiceringsartefakten dist/ med en UTTRYCKLIG allowlist.
// Bakgrund (webbaudit 2026-07-24): publish="." exponerade hela reporoten
// publikt — data/products.json (interna inköpspriser), docs/, funktionskällkod,
// AGENTS.md/CLAUDE.md m.m. Allt som inte står i listorna nedan hamnar INTE
// i deployen. Lägg aldrig tillbaka publish="." i netlify.toml.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

// Publika sidor och tillgångar.
const PUBLIC_DIRS = [
  "angra-kop",
  "assets",
  "audio", // används av 46elks-röstflödet (voice-simple.mjs)
  "batterireparation-elscooter",
  "book-online",
  "elcykel-service-orebro",
  "elscooter-reparation-orebro",
  "foretag",
  "foretag-serviceavtal",
  "garanti",
  "guider",
  "integritet",
  "kontakt",
  "laga-elsparkcykel-orebro",
  "nya-elscootrar",
  "om-oss",
  "priser",
  "punktering-elscooter-orebro",
  "regler-elscooter",
  "status",
  "villkor",
];

// Interna driftgränssnitt som personalen når via URL. De följer med tills de
// flyttats till skyddad subdomän (se webbaudit åtgärd 22) — men själva
// repointerna (data/, docs/, netlify/, scripts/ ...) gör det aldrig.
const OPS_DIRS = ["admin", "checkout", "workshop", "prices", "quick-price"];

const PUBLIC_FILES = [
  "index.html",
  "__forms.html", // krävs för Netlify Forms-detektering
  "robots.txt",
  "sitemap.xml",
  "favicon.svg",
  "logo.png",
  "nordic_logo_transparent.png",
  "dualtron-logo.png",
  "teverun-logo.jpg",
  "google9d601eb7d4900b70.html",
];

// Filer/kataloger som ALDRIG får finnas i dist — byggd artefakt verifieras.
const FORBIDDEN = [
  "data",
  "docs",
  "netlify",
  "scripts",
  "tests",
  "content",
  "private-reports",
  "nemob-os",
  "nemob-callflow",
  "node_modules",
  "AGENTS.md",
  "CLAUDE.md",
  "package.json",
  "package-lock.json",
];

// Publika nyckelfiler som MÅSTE finnas — annars är artefakten trasig.
const REQUIRED = [
  "index.html",
  "nya-elscootrar/index.html",
  "book-online/index.html",
  "villkor/index.html",
  "sitemap.xml",
  "robots.txt",
  "__forms.html",
  "assets/analytics.js",
];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const copied = [];
const missing = [];

for (const dir of [...PUBLIC_DIRS, ...OPS_DIRS]) {
  const from = path.join(root, dir);
  if (!fs.existsSync(from)) {
    missing.push(dir);
    continue;
  }
  fs.cpSync(from, path.join(dist, dir), { recursive: true });
  copied.push(dir);
}

for (const file of PUBLIC_FILES) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) {
    missing.push(file);
    continue;
  }
  fs.copyFileSync(from, path.join(dist, file));
  copied.push(file);
}

const errors = [];

for (const name of FORBIDDEN) {
  if (fs.existsSync(path.join(dist, name))) {
    errors.push(`FÖRBJUDEN i dist: ${name}`);
  }
}

for (const name of REQUIRED) {
  if (!fs.existsSync(path.join(dist, name))) {
    errors.push(`SAKNAS i dist: ${name}`);
  }
}

// Skanna artefakten efter interna fältnamn som aldrig får publiceras.
const scanForSecrets = (dirPath) => {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      scanForSecrets(fullPath);
      continue;
    }
    if (!/\.(html|js|json|txt|xml)$/i.test(entry.name)) continue;
    const text = fs.readFileSync(fullPath, "utf8");
    if (/costEur/.test(text)) {
      errors.push(`costEur läcker i ${path.relative(dist, fullPath)}`);
    }
  }
};
scanForSecrets(dist);

if (missing.length) {
  console.warn(`Varning – fanns inte i repot (hoppades över): ${missing.join(", ")}`);
}

if (errors.length) {
  console.error("dist-verifiering misslyckades:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`dist/ byggd: ${copied.length} poster kopierade, verifiering OK.`);
