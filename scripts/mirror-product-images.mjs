// Speglar leverantörsbilder från data/products.json till lokala assets så
// katalogen inte är beroende av att teverun-europe.com, cdn.shopify.com,
// naveetech.com eller kukirinscooter.com behåller sina bild-URL:er.
//
//   node scripts/mirror-product-images.mjs
//
// - Laddar ner varje unik bild-URL till assets/products/mirror/<hash>.<ext>
// - Shopify-bilder hämtas i width=800 (CDN:et skalar åt oss)
// - Idempotent: redan nedladdade filer laddas inte om
// - Skriver data/product-image-mirror.json (original-URL -> lokal sökväg)
//   som generate-products.mjs använder; saknas en fil används leverantörs-
//   URL:en precis som innan, så ett misslyckat svep bryter ingenting.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "products.json"), "utf8"));
const mirrorDir = path.join(root, "assets", "products", "mirror");
const mapPath = path.join(root, "data", "product-image-mirror.json");

fs.mkdirSync(mirrorDir, { recursive: true });

let existingMap = {};
try { existingMap = JSON.parse(fs.readFileSync(mapPath, "utf8")); } catch {}

const shopifySized = (src, width) => {
  if (!/cdn\.shopify\.com/.test(src)) return src;
  if (/([?&])width=\d+/.test(src)) return src.replace(/([?&])width=\d+/, `$1width=${width}`);
  return `${src}${src.includes("?") ? "&" : "?"}width=${width}`;
};

const extFor = (url, contentType = "") => {
  const clean = new URL(url).pathname.toLowerCase();
  const match = clean.match(/\.(jpe?g|png|webp|gif|avif)$/);
  if (match) return match[1] === "jpeg" ? "jpg" : match[1];
  if (/webp/.test(contentType)) return "webp";
  if (/png/.test(contentType)) return "png";
  return "jpg";
};

const urls = [...new Set(
  [...(catalog.products || []), ...(catalog.accessories || [])]
    .flatMap((item) => item.images || [])
    .filter((src) => /^https:\/\//.test(src))
)];

console.log(`${urls.length} unika leverantörsbilder att spegla.`);

const results = { ok: 0, skipped: 0, failed: 0 };
const map = {};

for (const original of urls) {
  const hash = crypto.createHash("sha1").update(original).digest("hex").slice(0, 12);
  const existingLocal = existingMap[original];
  if (existingLocal && fs.existsSync(path.join(root, existingLocal.replace(/^\//, "")))) {
    map[original] = existingLocal;
    results.skipped++;
    continue;
  }
  const downloadUrl = shopifySized(original, 800);
  try {
    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NordicEMobility-mirror/1.0)" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!/image\//.test(contentType)) throw new Error(`inte en bild: ${contentType}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1000) throw new Error("misstänkt liten fil");
    const ext = extFor(downloadUrl, contentType);
    const fileName = `${hash}.${ext}`;
    fs.writeFileSync(path.join(mirrorDir, fileName), buffer);
    map[original] = `/assets/products/mirror/${fileName}`;
    results.ok++;
    console.log(`OK   ${Math.round(buffer.length / 1024)} KB  ${fileName}  <- ${new URL(original).hostname}`);
  } catch (error) {
    results.failed++;
    console.log(`FAIL ${original} (${error.message}) — behåller hotlink`);
  }
}

fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n", "utf8");
const totalKb = fs.readdirSync(mirrorDir).reduce((sum, file) => sum + fs.statSync(path.join(mirrorDir, file)).size, 0) / 1024;
console.log(`\nKlart: ${results.ok} nedladdade, ${results.skipped} fanns redan, ${results.failed} misslyckades (hotlink kvar).`);
console.log(`Mirror-mappen: ${Math.round(totalKb)} KB totalt. Karta: data/product-image-mirror.json`);
