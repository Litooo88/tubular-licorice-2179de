import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "products.json"), "utf8"));

const products = catalog.products;
const accessories = catalog.accessories || [];
const refurbished = catalog.refurbished || [];

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeAttr = (value = "") => escapeHtml(value).replace(/'/g, "&#39;");

const formatPrice = (value) =>
  typeof value === "number" ? `${new Intl.NumberFormat("sv-SE").format(value)} kr` : "";

const slugModel = (name) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const statusLabel = {
  "i-lager": "I LAGER",
  "pa-vag": "PÅ VÄG",
  forbestall: "FÖRBESTÄLL",
  "demo-bara": "DEMO",
  slut: "SLUT",
  upphord: "UTGÅTT"
};

const statusCopy = {
  "i-lager": "Kan beställas nu",
  "pa-vag": "På väg till sortimentet",
  forbestall: "Tas hem efter förfrågan",
  "demo-bara": "Demo och rådgivning",
  slut: "Tillfälligt slut",
  upphord: "Säljs inte längre"
};

const legalityText = {
  "off-road-only": "Prestandamodell: kontrollera regler. Ofta avsedd för privat mark eller inhägnat område.",
  "check-rules": "Kontrollera användningsområde och regler innan köp.",
  "confirmed-context-needed": "Regelstatus beror på exakt version och användning. Vi kontrollerar innan affär."
};

const ctaText = (item) => {
  if (item.status === "i-lager") return "Köp nu";
  if (item.status === "pa-vag") return "Förbeställ";
  if (item.status === "forbestall") return item.priceSek ? "Begär offert" : "Kontakta oss för pris";
  if (item.status === "demo-bara") return "Boka demo";
  return "Fråga oss";
};

const bookingHref = (item) => `/book-online/?service=bestallning&modell=${slugModel(item.name)}`;

const mainImage = (item) => item.images?.[0] || "/assets/workshop/scooter-on-bench.jpg";

// Begär rätt storlek från Shopify-CDN:et i stället för originalet
// (tumnaglarna är 58px höga, kortbilderna ~210px) — stor bandbreddsbesparing.
const sizedSrc = (src, width) => {
  if (!/cdn\.shopify\.com/.test(src)) return src;
  if (/([?&])width=\d+/.test(src)) return src.replace(/([?&])width=\d+/, `$1width=${width}`);
  return `${src}${src.includes("?") ? "&" : "?"}width=${width}`;
};

// Lokal bildspegel (scripts/mirror-product-images.mjs): servera lokala kopior
// först, med leverantörens URL som onerror-fallback. Saknas spegeln används
// leverantörs-URL:en direkt precis som innan — inget går sönder.
let imageMirror = {};
try {
  imageMirror = JSON.parse(fs.readFileSync(path.join(root, "data", "product-image-mirror.json"), "utf8"));
} catch {}
const displaySrc = (src, width) => imageMirror[src] || sizedSrc(src, width);
const fallbackSrc = (src, width) =>
  imageMirror[src] ? sizedSrc(src, width) : "/assets/workshop/scooter-on-bench.jpg";

const galleryAttr = (item) => escapeAttr(JSON.stringify((item.images || []).map((src) => imageMirror[src] || src)));

const buyAttrs = (item) => item.checkout ? ` data-product="${escapeAttr(item.id)}"` : "";

const paymentStrip = (compact = false) => `<div class="payment-methods${compact ? " compact" : ""}" aria-label="Tillgängliga betalsätt i checkout">
              <span class="pay-logo klarna">Klarna</span>
              <span class="pay-logo apple">Apple Pay</span>
              <span class="pay-logo gpay">Google Pay</span>
              <span class="pay-logo card">VISA</span>
              <span class="pay-logo card">MC</span>
              <span class="pay-logo stripe">Stripe</span>
            </div>`;

function productCard(item, options = {}) {
  const images = item.images || [];
  const price = formatPrice(item.priceSek) || escapeHtml(item.priceNote || "Pris efter modell");
  const monthly = item.priceSek ? Math.ceil(item.priceSek / 24) : null;
  const legal = item.legality ? `<p class="product-legal">${escapeHtml(legalityText[item.legality] || item.legality)}</p>` : "";
  const thumbs = images
    .slice(1, 4)
    .map((src, index) => `<button type="button" data-open-product aria-label="Visa ${escapeAttr(item.name)} bild ${index + 2}"><img loading="lazy" decoding="async" width="200" height="200" src="${escapeAttr(displaySrc(src, 200))}" alt="${escapeAttr(item.name)} extra bild ${index + 2}" onerror="this.onerror=null;this.src='${escapeAttr(fallbackSrc(src, 200))}'"></button>`)
    .join("");
  return `
        <article class="card product-card" data-brand="${escapeAttr(item.brand)}" data-status="${escapeAttr(item.status)}" data-gallery="${galleryAttr(item)}">
          <a class="product-media" href="${escapeAttr(bookingHref(item))}" data-open-product aria-label="Visa bilder och information om ${escapeAttr(item.name)}">
            <span class="tag ${item.brand === "KuKirin" ? "orange" : ""}">${escapeHtml(item.badge || statusLabel[item.status] || "Modell")}</span>
            <img loading="lazy" decoding="async" width="500" height="500" src="${escapeAttr(displaySrc(mainImage(item), 800))}" alt="${escapeAttr(item.name)}" onerror="this.onerror=null;this.src='${escapeAttr(fallbackSrc(mainImage(item), 800))}'">
          </a>
          ${thumbs ? `<div class="product-thumbs">${thumbs}</div>` : `<div class="product-thumbs product-thumbs-empty"><span>Fler bilder läggs till när leverantörsmaterial finns.</span></div>`}
          <div class="card-body">
            <div class="product-meta"><span>${escapeHtml(item.brand)}</span><span>${escapeHtml(statusLabel[item.status] || item.status)}</span></div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="spec">${escapeHtml(item.spec)}</p>
            <p class="copy">${escapeHtml(item.short)}</p>
            ${legal}
            <div class="price">${price}</div>
            ${monthly ? `<p class="klarna">Ca ${formatPrice(monthly)}/mån vid 24 mån. Klarna visas i checkout om ordern kvalificerar.</p>` : ""}
            ${item.checkout ? paymentStrip(true) : ""}
            <p class="stock-copy">${escapeHtml(item.delivery || statusCopy[item.status] || "")}</p>
            <div class="card-actions">
              <a class="btn ${options.primary ? "primary" : "ghost"}" href="${escapeAttr(bookingHref(item))}"${buyAttrs(item)}>${escapeHtml(ctaText(item))}</a>
            </div>
          </div>
        </article>`;
}

function accessoryCard(item) {
  const price = formatPrice(item.priceSek) || escapeHtml(item.priceNote || "Pris efter offert");
  return `
        <article class="card product-card accessory-card" data-brand="${escapeAttr(item.brand)}" data-gallery="${galleryAttr(item)}">
          <div class="product-media">
            <span class="tag">${escapeHtml(item.badge || item.brand)}</span>
            <img loading="lazy" decoding="async" width="500" height="500" src="${escapeAttr(displaySrc(mainImage(item), 800))}" alt="${escapeAttr(item.name)}" onerror="this.onerror=null;this.src='${escapeAttr(fallbackSrc(mainImage(item), 800))}'">
          </div>
          <div class="card-body">
            <div class="product-meta"><span>${escapeHtml(item.brand)}</span><span>${escapeHtml(statusLabel[item.status] || "OFFERT")}</span></div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="spec">${escapeHtml(item.spec)}</p>
            <p class="copy">${escapeHtml(item.short)}</p>
            <div class="price">${price}</div>
            <div class="card-actions"><a class="btn ghost" href="/book-online/">Begär offert</a></div>
          </div>
        </article>`;
}

function refurbCard(item) {
  const detailList = (item.details || [])
    .map((detail) => `<li>${escapeHtml(detail)}</li>`)
    .join("");
  const legal = item.legalNote ? `<p class="product-legal">${escapeHtml(item.legalNote)}</p>` : "";
  const image = item.images?.length
    ? `<img loading="lazy" decoding="async" src="${escapeAttr(displaySrc(item.images[0], 800))}" alt="${escapeAttr(item.name)}" onerror="this.onerror=null;this.src='${escapeAttr(fallbackSrc(item.images[0], 800))}'">`
    : `<img loading="lazy" src="/assets/workshop/scooter-on-bench.jpg" alt="Renovering pågår i verkstaden – riktiga bilder på ${escapeAttr(item.name)} publiceras när bygget är klart">`;
  return `
        <article class="card product-card refurb-card" data-brand="${escapeAttr(item.brand)}">
          <div class="product-media">
            <span class="tag orange">${escapeHtml(item.badge || "NEMOB Edition")}</span>
            ${image}
          </div>
          <div class="card-body">
            <div class="product-meta"><span>${escapeHtml(item.brand)}</span><span>${escapeHtml(item.statusText || "Under renovering")}</span></div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="spec">${escapeHtml(item.spec)}</p>
            <p class="copy">${escapeHtml(item.short)}</p>
            ${detailList ? `<ul class="refurb-details">${detailList}</ul>` : ""}
            ${legal}
            <div class="price">${escapeHtml(item.priceNote || "Pris efter specifikation")}</div>
            <p class="stock-copy">${escapeHtml(item.statusText || "")} • Riktiga produktbilder publiceras när bygget är klart.</p>
            <div class="card-actions">
              <a class="btn ghost" href="/book-online/?service=bestallning&modell=${slugModel(item.name)}">${escapeHtml(item.cta || "Anmäl intresse")}</a>
            </div>
          </div>
        </article>`;
}

function refurbishedSection() {
  if (!refurbished.length) return "";
  return `
      <section class="catalog-brand" id="begagnat-renoverat">
        <div class="brand-row">
          <div>
            <span class="eyebrow">BEGAGNAT, RENOVERAT &amp; NEMOB EDITION</span>
            <h3>Unika byggen från verkstaden.</h3>
          </div>
          <p>Utvalda premium-scootrar som renoveras, uppgraderas och kvalitetssäkras i vår verkstad i Örebro. För dig som vill ha något mer personligt än standard.</p>
        </div>
        <div class="refurb-promise">
          <span>Genomgångna fordon</span><span>Renoverade delar</span><span>Funktionskontroll</span><span>Möjlig uppgradering</span><span>Estetisk förbättring</span><span>Hållbar återanvändning</span><span>Begränsat antal — varje exemplar är unikt</span>
        </div>
        <div class="grid three catalog-grid">
${refurbished.map((item) => refurbCard(item)).join("\n")}
        </div>
        <p class="rule-note">Kraftigare elscootrar och custombyggen kan omfattas av andra regler än vanliga elsparkcyklar. Kontrollera alltid gällande regler innan användning i trafik.</p>
      </section>`;
}

function brandSection(brand) {
  const list = products.filter((product) => product.brand.toLowerCase() === brand.toLowerCase());
  return `
      <section class="catalog-brand" id="${escapeAttr(`brand-${brand.toLowerCase()}`)}">
        <div class="brand-row">
          <div>
            <span class="eyebrow">${escapeHtml(brand)}</span>
            <h3>${escapeHtml(brand)} sortiment</h3>
          </div>
          <p>${escapeHtml(list.length)} modeller i katalogen. Status och pris kommer från samma produktdata som checkout.</p>
        </div>
        <div class="grid three catalog-grid">
${list.map((item) => productCard(item)).join("\n")}
        </div>
      </section>`;
}

function nyaElscootrarSection() {
  const featured = products.filter((item) => item.featured);
  const teverun = products.filter((item) => item.brand === "Teverun" && item.name.includes("Fighter"));
  const orderable = products.filter((item) => item.checkout && !["slut", "upphord", "demo-bara"].includes(item.status));
  return `
  <section class="section" id="nya-elscootrar">
    <div class="wrap">
      <style>
        .catalog-intro{display:grid;grid-template-columns:1.05fr .95fr;gap:18px;margin-bottom:28px}
        .catalog-note{border:1px solid rgba(0,200,83,.22);background:rgba(0,200,83,.08);border-radius:8px;padding:18px;color:#dce8df}
        .catalog-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
        .catalog-actions a{border:1px solid var(--line-strong);background:#101410;border-radius:999px;padding:9px 12px;text-decoration:none;font-size:13px;font-weight:900}
        .catalog-filter{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 22px;padding:14px;border:1px solid var(--line);border-radius:8px;background:#0b100c}
        .catalog-filter .cf-btn{border:1px solid #2f3a32;background:#111712;color:#cfd8d2;border-radius:8px;padding:10px 16px;font:inherit;font-weight:700;font-size:14px;cursor:pointer}
        .catalog-filter .cf-btn.is-active{background:#00c853;border-color:#00c853;color:#031006}
        .catalog-filter .cf-toggle{display:inline-flex;align-items:center;gap:8px;color:#cfd8d2;font-size:14px;font-weight:700;cursor:pointer;margin-left:auto}
        .catalog-filter .cf-toggle input{width:auto}
        .catalog-filter .cf-count{color:#8d9a91;font-size:13px}
        @media(max-width:620px){.catalog-filter .cf-toggle{margin-left:0}}
        .product-card{position:relative}
        .product-media{height:210px;display:flex;align-items:center;justify-content:center;background:#111712;position:relative;text-decoration:none;cursor:zoom-in}
        .product-media::after{content:"Visa bilder";position:absolute;right:10px;bottom:10px;border:1px solid rgba(255,255,255,.24);background:rgba(0,0,0,.7);color:#fff;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:900;opacity:0;transform:translateY(4px);transition:.18s}
        .product-media:hover::after,.product-media:focus-visible::after{opacity:1;transform:none}
        .product-media .tag{position:absolute;top:10px;left:10px;z-index:2;margin:0}
        .product-media img{height:100%;width:100%;object-fit:contain;padding:12px;background:transparent}
        .product-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px;background:#0b100c;border-top:1px solid var(--line)}
        .product-thumbs button{height:58px;width:100%;border:1px solid var(--line);border-radius:6px;background:#111712;padding:4px;cursor:zoom-in}
        .product-thumbs img{height:100%;width:100%;object-fit:contain}
        .product-thumbs-empty{display:block;color:#8d9a91;font-size:12px;min-height:42px}
        .product-meta{display:flex;justify-content:space-between;gap:8px;color:#90a097;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
        .product-legal{margin-top:10px;color:#ffd9b3;font-size:12px;line-height:1.45}
        .campaign-note{margin:10px 0 8px;border:1px solid rgba(255,109,0,.42);background:rgba(255,109,0,.13);color:#ffd0a6;border-radius:8px;padding:9px 10px;font-size:12px;line-height:1.45;font-weight:800}
        .klarna,.stock-copy{font-size:12px;color:#9eaaa2;margin-top:-6px;margin-bottom:10px}
        .payment-methods{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 12px}
        .payment-methods.compact{gap:5px;margin:8px 0 10px}
        .pay-logo{display:inline-flex;align-items:center;justify-content:center;min-height:24px;border-radius:5px;padding:4px 7px;background:#f4f6f5;color:#071008;font-size:11px;font-weight:950;line-height:1;letter-spacing:0}
        .pay-logo.klarna{background:#ffb3c7;color:#111}
        .pay-logo.apple{background:#fff;color:#000}
        .pay-logo.gpay{background:#fff;color:#1f1f1f}
        .pay-logo.card{background:#15251a;color:#dfffea;border:1px solid rgba(0,200,83,.24)}
        .pay-logo.stripe{background:#635bff;color:#fff}
        .catalog-brand{margin-top:36px}
        .brand-row{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:16px;border-top:1px solid var(--line);padding-top:22px}
        .brand-row h3{font-size:30px;line-height:1.1}
        .brand-row p{color:var(--muted);max-width:520px}
        .fighter-push{margin-top:24px;border:1px solid rgba(255,138,28,.34);background:linear-gradient(135deg,rgba(255,138,28,.13),rgba(0,200,83,.07));border-radius:8px;padding:22px}
        .accessory-card .product-media{height:190px}
        .refurb-card{border-color:rgba(255,138,28,.36)}
        .refurb-details{margin:10px 0 4px;padding:0;display:grid;gap:5px}
        .refurb-details li{list-style:none;font-size:12px;color:#cdd7d0;border-left:2px solid rgba(255,138,28,.5);padding-left:9px;line-height:1.45}
        .refurb-promise{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
        .refurb-promise span{border:1px solid rgba(255,138,28,.3);background:rgba(255,138,28,.08);color:#ffd9b3;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:800}
        .catalog-product-modal{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.82);backdrop-filter:blur(8px);padding:18px}
        .catalog-product-modal.is-open{display:flex}
        .catalog-product-dialog{width:min(920px,100%);max-height:calc(100vh - 36px);overflow:auto;background:#0d0f0e;border:1px solid #26342b;border-radius:8px;color:#fff;box-shadow:0 30px 90px rgba(0,0,0,.55)}
        .catalog-modal-head{display:flex;justify-content:space-between;gap:14px;padding:18px 20px;border-bottom:1px solid #202820}
        .catalog-modal-head h3{margin:0 0 5px;font-size:24px}
        .catalog-modal-close{width:38px;height:38px;border-radius:999px;border:1px solid #344238;background:#162018;color:#fff;font-size:24px;cursor:pointer;flex:0 0 auto}
        .catalog-modal-body{display:grid;grid-template-columns:minmax(240px,380px) 1fr;gap:22px;padding:20px}
        .catalog-modal-stage{position:relative;background:#111712;border:1px solid #243026;border-radius:8px}
        .catalog-modal-stage img{width:100%;aspect-ratio:1/1;object-fit:contain;padding:12px;display:block}
        .catalog-modal-nav{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:999px;border:1px solid #344238;background:rgba(0,0,0,.72);color:#fff;font-size:22px;cursor:pointer}
        .catalog-modal-prev{left:8px}.catalog-modal-next{right:8px}
        .catalog-modal-thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:9px}
        .catalog-modal-thumbs button{border:1px solid #27352b;background:#111;border-radius:6px;padding:3px;cursor:pointer}
        .catalog-modal-thumbs button.is-active{border-color:#00C853}
        .catalog-modal-thumbs img{width:100%;aspect-ratio:1/1;object-fit:contain;border-radius:4px}
        .catalog-modal-list{display:grid;gap:10px;margin:14px 0;padding:0}
        .catalog-modal-list li{list-style:none;border:1px solid #222;background:#111;border-radius:8px;padding:11px 12px;color:#d7ddd9;font-size:14px}
        .catalog-modal-list strong{display:block;color:#fff;margin-bottom:3px}
        .catalog-modal-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
        .catalog-modal-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 18px;border-radius:6px;text-decoration:none;font-weight:900}
        .catalog-modal-actions .buy{background:#00C853;color:#021307}
        .catalog-modal-actions .ask{border:1px solid #344238;color:#fff}
        @media(max-width:980px){.catalog-intro{grid-template-columns:1fr}.brand-row{display:block}.brand-row p{margin-top:8px}}
        @media(max-width:700px){.catalog-modal-body{grid-template-columns:1fr}.catalog-modal-head h3{font-size:20px}}
      </style>
      <div class="section-head">
        <div>
          <span class="eyebrow">NYA ELSCOOTRAR</span>
          <h2>Utvalda elscootrar — med verkstaden bakom varje köp.</h2>
        </div>
        <p>Vi säljer modeller vi själva kan serva. Hela sortimentet från NAVEE, Teverun och KuKirin med samma pris och status som checkout — och service, garanti och reservdelar i vår verkstad i Örebro efter köpet.</p>
      </div>
      <div class="catalog-intro">
        <div class="catalog-note">
          <h3>Utvalt sortiment från NAVEE, Teverun och KuKirin</h3>
          <p>Vi lyfter modeller vi kan rådge kring och hjälpa kunden med efter köpet. Demo-scootrar från bland annat Teverun och NAVEE beräknas komma i slutet av juni eller början av juli.</p>
          <div class="catalog-actions">
            <a href="#brand-navee">NAVEE</a>
            <a href="#brand-teverun">Teverun</a>
            <a href="#brand-kukirin">KuKirin</a>
            <a href="#begagnat-renoverat">Begagnat &amp; NEMOB Edition</a>
            <a href="#tillbehor-reservdelar">Tillbehor och reservdelar</a>
          </div>
        </div>
        <div class="catalog-note">
          <h3>Köp med verkstadsstöd</h3>
          <p>Betala tryggt via checkout. KuKirin har gratis hemleverans eller gratis leverans till vår verkstad med leverans 5 arbetsdagar efter mottagen betalning. Teverun har fraktavgift 60 EUR och leverans 5-7 arbetsdagar. Vi kontaktar kunden om leverans, montering, inbyte och efterservice. Hjälm rekommenderas alltid – vi hjälper gärna till med rätt storlek och modell.</p>
          ${paymentStrip()}
        </div>
      </div>
      <div class="catalog-filter" role="group" aria-label="Filtrera sortimentet">
        <button type="button" class="cf-btn is-active" data-filter-brand="alla">Alla märken</button>
        <button type="button" class="cf-btn" data-filter-brand="NAVEE">NAVEE</button>
        <button type="button" class="cf-btn" data-filter-brand="Teverun">Teverun</button>
        <button type="button" class="cf-btn" data-filter-brand="KuKirin">KuKirin</button>
        <label class="cf-toggle"><input type="checkbox" id="filterInStock"> Endast i lager</label>
        <span class="cf-count" id="filterCount" aria-live="polite"></span>
      </div>
      <div class="grid three catalog-grid">
${featured.map((item) => productCard(item, { primary: item.id === "teverun-fighter-eleven-plus" })).join("\n")}
      </div>
      <div class="fighter-push" id="teverun-fighter">
        <div class="teverun-head">
          <div>
            <span class="eyebrow">TEVERUN FIGHTER</span>
            <h3>Fighter-serien ska vara enkel att välja rätt.</h3>
          </div>
          <p>Vi vill lyfta Fighter-modellerna tydligt, men utan att lova fel regelform. Kunden får veta status, pris och nästa steg direkt.</p>
        </div>
        <div class="grid three catalog-grid">
${teverun.map((item) => productCard(item, { primary: item.id === "teverun-fighter-eleven-plus" })).join("\n")}
        </div>
      </div>
      ${brandSection("NAVEE")}
      ${brandSection("Teverun")}
      ${brandSection("KuKirin")}
      ${refurbishedSection()}
      <section class="catalog-brand" id="tillbehor-reservdelar">
        <div class="brand-row">
          <div>
            <span class="eyebrow">TILLBEHOR & RESERVDELAR</span>
            <h3>KuKirin-delar och Monorim-uppgraderingar.</h3>
          </div>
          <p>Reservdelar och premiumkit ska visas som egna affärer, men offereras efter exakt modell så kunden inte köper fel del.</p>
        </div>
        <div class="grid catalog-grid">
${accessories.map((item) => accessoryCard(item)).join("\n")}
        </div>
      </section>
      <p class="rule-note">Kraftigare elscootrar och custombyggen kan omfattas av andra regler än vanliga elsparkcyklar. Kontrollera alltid gällande regler innan användning i trafik — fråga oss eller läs <a href="/regler-elscooter/">regelguiden</a> innan du väljer modell för allmän väg.</p>
      <div class="order-list" id="bestall-scooter">
        <h3>Snabb beställning</h3>
        <p>Har kunden redan valt modell kan köp startas direkt. Samma produkt-ID används av Stripe-checkout.</p>
        <div class="order-grid">
${orderable
  .map(
    (item) => `          <div class="order-item"><div><strong>${escapeHtml(item.name)}</strong><span>${formatPrice(item.priceSek)} • ${escapeHtml(statusLabel[item.status])}</span></div><a class="btn ghost" href="${escapeAttr(bookingHref(item))}" data-product="${escapeAttr(item.id)}">${escapeHtml(ctaText(item))}</a></div>`
  )
  .join("\n")}
        </div>
      </div>
      <div class="catalog-product-modal" id="catalogProductModal" aria-hidden="true">
        <div class="catalog-product-dialog" role="dialog" aria-modal="true" aria-labelledby="catalogModalTitle">
          <div class="catalog-modal-head">
            <div>
              <h3 id="catalogModalTitle">Produktinformation</h3>
              <p id="catalogModalPrice" style="color:#00C853;font-weight:900;margin:0"></p>
            </div>
            <button class="catalog-modal-close" type="button" aria-label="Stäng produktinformation">&times;</button>
          </div>
          <div class="catalog-modal-body">
            <div>
              <div class="catalog-modal-stage">
                <button class="catalog-modal-nav catalog-modal-prev" type="button" aria-label="Föregående bild">&#8249;</button>
                <img id="catalogModalImage" alt="">
                <button class="catalog-modal-nav catalog-modal-next" type="button" aria-label="Nästa bild">&#8250;</button>
              </div>
              <div class="catalog-modal-thumbs" id="catalogModalThumbs"></div>
            </div>
            <div>
              <p id="catalogModalSummary" style="color:#d7ddd9;line-height:1.6;margin:0 0 12px"></p>
              <ul class="catalog-modal-list" id="catalogModalDetails"></ul>
              ${paymentStrip()}
              <p style="color:#9aa59e;font-size:13px;line-height:1.55;margin-top:12px">Checkout visar Klarna, kort, Apple Pay, Google Pay och andra betalsätt när de är aktiverade och ordern kvalificerar.</p>
              <div class="catalog-modal-actions">
                <a class="buy" id="catalogModalBuy" href="/book-online">Köp nu</a>
                <a class="ask" href="/book-online/">Fråga verkstaden</a>
                <a class="ask" href="/regler-elscooter/">Läs regelguiden</a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <script>
      (()=>{const modal=document.getElementById('catalogProductModal');if(!modal)return;const title=document.getElementById('catalogModalTitle'),price=document.getElementById('catalogModalPrice'),image=document.getElementById('catalogModalImage'),summary=document.getElementById('catalogModalSummary'),details=document.getElementById('catalogModalDetails'),thumbs=document.getElementById('catalogModalThumbs'),buy=document.getElementById('catalogModalBuy');let gallery=[],galleryIndex=0;function render(){if(!gallery.length)return;image.src=gallery[galleryIndex];thumbs.innerHTML=gallery.map((src,index)=>\`<button type="button" class="\${index===galleryIndex?'is-active':''}" aria-label="Visa bild \${index+1}"><img src="\${src}" alt=""></button>\`).join('');thumbs.querySelectorAll('button').forEach((button,index)=>button.addEventListener('click',()=>{galleryIndex=index;render()}))}function info(card){const name=card.querySelector('h3')?.textContent.trim()||'Produkt';const priceText=card.querySelector('.price')?.textContent.trim()||'Kontakta oss';const spec=card.querySelector('.spec')?.textContent.trim()||'Specifikation saknas.';const copy=card.querySelector('.copy')?.textContent.trim()||'Kontakta verkstaden om du vill veta om modellen passar din körning och lokala regler.';const stock=card.querySelector('.stock-copy')?.textContent.trim()||card.querySelector('.product-meta span:last-child')?.textContent.trim()||'';const img=card.querySelector('.product-media img');const link=card.querySelector('.card-actions a[data-product], .card-actions a');let images=[];try{if(card.dataset.gallery)images=JSON.parse(card.dataset.gallery)}catch{}if(!images.length&&img?.src)images=[img.getAttribute('src')];return {name,priceText,spec,copy,stock,imgAlt:img?.alt||name,href:link?.href||'/book-online/',productId:link?.dataset.product||'',cta:link?.textContent.trim()||'Köp nu',images}}function open(card){const item=info(card);title.textContent=item.name;price.textContent=item.priceText;summary.textContent=item.copy;gallery=item.images;galleryIndex=0;image.alt=item.imgAlt;render();details.innerHTML=[\`<li><strong>Specifikation</strong>\${item.spec}</li>\`,\`<li><strong>Status / leverans</strong>\${item.stock}</li>\`,\`<li><strong>Nästa steg</strong>Köp direkt i checkout eller skicka fråga om du vill kontrollera modell, regler, inbyte eller leverans först.</li>\`].join('');buy.href=item.href;buy.textContent=item.cta;if(item.productId){buy.dataset.product=item.productId}else{delete buy.dataset.product}modal.classList.add('is-open');modal.setAttribute('aria-hidden','false');modal.querySelector('.catalog-modal-close').focus()}function close(){modal.classList.remove('is-open');modal.setAttribute('aria-hidden','true')}document.querySelectorAll('.product-card').forEach((card)=>{card.querySelectorAll('[data-open-product]').forEach((trigger)=>trigger.addEventListener('click',(event)=>{event.preventDefault();open(card)}));});modal.querySelector('.catalog-modal-close').addEventListener('click',close);modal.querySelector('.catalog-modal-prev').addEventListener('click',()=>{if(!gallery.length)return;galleryIndex=(galleryIndex-1+gallery.length)%gallery.length;render()});modal.querySelector('.catalog-modal-next').addEventListener('click',()=>{if(!gallery.length)return;galleryIndex=(galleryIndex+1)%gallery.length;render()});modal.addEventListener('click',(event)=>{if(event.target===modal)close()});document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&modal.classList.contains('is-open'))close()})})();
      (()=>{const bar=document.querySelector('.catalog-filter');if(!bar)return;
      const countEl=document.getElementById('filterCount');
      const stockToggle=document.getElementById('filterInStock');
      let brand='alla';
      function cards(){return document.querySelectorAll('.product-card:not(.accessory-card):not(.refurb-card)')}
      function apply(){
        const onlyStock=stockToggle&&stockToggle.checked;
        let visible=0;const seen=new Set();
        cards().forEach((card)=>{
          const okBrand=brand==='alla'||card.dataset.brand===brand;
          const okStock=!onlyStock||card.dataset.status==='i-lager';
          const show=okBrand&&okStock;
          card.style.display=show?'':'none';
          if(show){const key=card.querySelector('h3')?.textContent||'';if(!seen.has(key)){seen.add(key);visible++;}}
        });
        document.querySelectorAll('.fighter-push,.catalog-brand:not(#tillbehor-reservdelar):not(#begagnat-renoverat)').forEach((section)=>{
          const any=[...section.querySelectorAll('.product-card:not(.accessory-card):not(.refurb-card)')].some((card)=>card.style.display!=='none');
          section.style.display=any?'':'none';
        });
        if(countEl)countEl.textContent='Visar '+visible+(visible===1?' modell':' modeller');
      }
      bar.querySelectorAll('.cf-btn').forEach((button)=>button.addEventListener('click',()=>{
        brand=button.dataset.filterBrand;
        bar.querySelectorAll('.cf-btn').forEach((other)=>other.classList.toggle('is-active',other===button));
        apply();
      }));
      if(stockToggle)stockToggle.addEventListener('change',apply);
      apply();})();
      </script>
    </div>
  </section>`;
}

function homeProductCard(item) {
  const price = formatPrice(item.priceSek);
  const gallery = galleryAttr(item);
  const border = item.brand === "KuKirin" ? "#ff6d00" : item.brand === "Teverun" ? "rgba(0,200,83,.35)" : "rgba(0,200,83,.3)";
  const buttonStyle = item.brand === "KuKirin" ? ' style="background:rgba(255,109,0,.15);border-color:rgba(255,109,0,.4);color:#ff6d00"' : "";
  return `    <div class="prod pop-card" data-gallery="${gallery}" style="border-color:${border}">
      <div class="prod-img" style="background:linear-gradient(135deg,#0a1a0f,#111);position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden">
        <div class="pop-badge" style="background:${item.brand === "KuKirin" ? "#ff6d00" : "#00C853"}">${escapeHtml(item.badge || statusLabel[item.status])}</div>
        <div style="position:absolute;top:10px;right:10px;background:#fff;color:#000;font-size:10px;font-weight:800;padding:3px 8px;border-radius:3px;z-index:1">${escapeHtml(statusLabel[item.status])}</div>
        <img width="500" height="500" loading="lazy" decoding="async" src="${escapeAttr(displaySrc(mainImage(item), 800))}" alt="${escapeAttr(item.name)}" style="max-height:100%;max-width:100%;object-fit:contain;filter:brightness(.95)" onerror="this.onerror=null;this.src='${escapeAttr(fallbackSrc(mainImage(item), 800))}'">
      </div>
      <div class="prod-body">
        <div class="prod-name">${escapeHtml(item.name.replace(/^NAVEE |^KuKirin |^Teverun /, ""))}</div>
        <div style="font-size:11px;color:#888;margin:4px 0">${escapeHtml(item.spec)}</div>
        <div style="font-size:12px;color:#b8c2bb;line-height:1.5;margin-bottom:10px">${escapeHtml(item.short)}</div>
        <div class="prod-price">${price}</div>
        <div class="pop-trust">Service, garanti &amp; reservdelar i vår verkstad i Örebro</div>
        ${paymentStrip(true)}
        <a href="${escapeAttr(bookingHref(item))}" class="prod-btn pop-cta" data-product="${escapeAttr(item.id)}" data-price="${item.priceSek}"${buttonStyle}>${escapeHtml(ctaText(item))}</a>
      </div>
    </div>`;
}

function homeComingSoonCard(item, options = {}) {
  const href = options.href || bookingHref(item);
  const cta = options.cta || ctaText(item);
  const note = options.note ? `<div style="font-size:11px;color:#ffd9b3;line-height:1.5;margin:6px 0 10px">${escapeHtml(options.note)}</div>` : "";
  return `    <div class="prod soon-card">
      <div class="prod-body">
        <span class="soon-badge">${escapeHtml(item.badge || "Kommer snart")}</span>
        <div class="prod-name" style="margin-top:8px">${escapeHtml(item.name)}</div>
        <div style="font-size:11px;color:#888;margin:4px 0">${escapeHtml(item.spec)}</div>
        <div style="font-size:12px;color:#b0b0b0;line-height:1.5;margin-bottom:8px">${escapeHtml(item.short)}</div>
        ${note}
        <a href="${escapeAttr(href)}" class="prod-btn" style="background:transparent;border:1px solid rgba(0,200,83,.4);color:#7ee2a8">${escapeHtml(cta)}</a>
      </div>
    </div>`;
}

function homeProductsSection() {
  // Ordningen styrs av marginal + leverantörens rekommendationer (NAVEE
  // 2026-07: XT5 Pro, NT5 Max, ST5 Max, ST3 Pro). G4 SE behålls som
  // trafikdrivare trots tunn marginal.
  const popularOrder = [
    "kukirin-g4-special",
    "navee-xt5-ultra",
    "kukirin-g3-pro",
    "teverun-blade-mini-ultra",
    "navee-st3-pro",
    "teverun-blade-gt-ii"
  ];
  const popular = popularOrder.map((id) => products.find((item) => item.id === id)).filter(Boolean);
  const comingSoon = ["navee-gt3-max"]
    .map((id) => products.find((item) => item.id === id))
    .filter(Boolean);
  const eaglePro = refurbished.find((item) => item.id === "dualtron-eagle-pro-nemob");
  return `<!-- PRODUKTER -->
<section class="products" id="produkter">
<div class="container">
  <style>
    .payment-methods{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 12px}
    .payment-methods.compact{gap:5px;margin:8px 0 10px}
    .pay-logo{display:inline-flex;align-items:center;justify-content:center;min-height:24px;border-radius:5px;padding:4px 7px;background:#f4f6f5;color:#071008;font-size:11px;font-weight:950;line-height:1;letter-spacing:0}
    .pay-logo.klarna{background:#ffb3c7;color:#111}
    .pay-logo.apple{background:#fff;color:#000}
    .pay-logo.gpay{background:#fff;color:#1f1f1f}
    .pay-logo.card{background:#15251a;color:#dfffea;border:1px solid rgba(0,200,83,.24)}
    .pay-logo.stripe{background:#635bff;color:#fff}
    .pop-card{box-shadow:0 12px 34px rgba(0,0,0,.35);transition:transform .18s,box-shadow .18s}
    .pop-card:hover{transform:translateY(-4px);box-shadow:0 20px 48px rgba(0,200,83,.14)}
    .pop-card .prod-img{min-height:250px}
    .pop-badge{position:absolute;top:10px;left:10px;color:#000;font-size:11px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:999px;z-index:1;box-shadow:0 4px 14px rgba(0,0,0,.4)}
    .pop-trust{font-size:11px;color:#8fd3a8;font-weight:700;margin:2px 0 6px}
    .pop-cta{font-weight:900;letter-spacing:.02em}
    .soon-card{border-style:dashed;border-color:rgba(0,200,83,.3);background:rgba(0,200,83,.03)}
    .soon-badge{display:inline-block;background:rgba(0,200,83,.14);border:1px solid rgba(0,200,83,.3);color:#7ee2a8;font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border-radius:999px}
    .nemob-band{margin-top:26px;border:1px solid rgba(255,138,28,.32);background:linear-gradient(135deg,rgba(255,138,28,.1),rgba(0,200,83,.05));border-radius:10px;padding:20px 22px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:14px}
    .nemob-band h3{margin:0 0 6px;font-size:20px}
    .nemob-band p{margin:0;color:#c9d3cc;font-size:13px;line-height:1.55;max-width:640px}
  </style>
  <span class="section-label">Populärast just nu</span>
  <h2 class="section-title">Modellerna våra kunder väljer.</h2>
  <p class="section-sub">Vi säljer modeller vi själva kan serva. Varje köp backas av rådgivning, garanti och reservdelar från vår specialistverkstad i Örebro — så att du kommer tillbaka på vägen utan krångel.</p>
  <div class="legal-note">Kraftigare elscootrar och custombyggen kan omfattas av andra regler än vanliga elsparkcyklar. Kontrollera alltid gällande regler innan användning i trafik. <a href="/regler-elscooter/">Läs regelguiden innan köp</a>.</div>
  <div class="legal-note" style="margin-bottom:10px;background:rgba(0,200,83,.08);border-color:rgba(0,200,83,.22);color:#dce8df">Betala tryggt med <strong>Klarna, Apple Pay, Google Pay, kort och andra tillgängliga betalsätt</strong>. KuKirin har gratis leveransval och 5 arbetsdagars leverans efter mottagen betalning. Teverun har fraktavgift 60 EUR och leverans 5-7 arbetsdagar. Vi hjälper dig med leverans, rådgivning och service efter köpet.</div>
  ${paymentStrip()}
  <div class="products-grid" style="grid-template-columns:repeat(3,1fr)">
${popular.map((item) => homeProductCard(item)).join("\n")}
  </div>
  <div class="products-grid" style="grid-template-columns:repeat(3,1fr);margin-top:14px">
${comingSoon.map((item) => homeComingSoonCard(item)).join("\n")}
${eaglePro ? homeComingSoonCard(eaglePro, { href: "/nya-elscootrar/#begagnat-renoverat", cta: "Anmäl intresse", note: eaglePro.legalNote }) : ""}
  </div>
  <div class="nemob-band">
    <div>
      <h3>Begagnat, renoverat &amp; NEMOB Edition</h3>
      <p>Utvalda premium-scootrar som renoveras, uppgraderas och kvalitetssäkras i vår verkstad i Örebro. Begränsat antal — varje exemplar är unikt. För dig som vill ha något mer personligt än standard.</p>
    </div>
    <a href="/nya-elscootrar/#begagnat-renoverat" class="btn-secondary">Se aktuella byggen &#8594;</a>
  </div>
  <div style="margin-top:24px;text-align:center"><a href="/nya-elscootrar/" class="btn-secondary">Se hela utbudet &#8594;</a></div>
</div>
</section>`;
}

function galleryObject() {
  const entries = products
    .filter((item) => item.images?.length)
    .map((item) => `  ${JSON.stringify(item.name.toLowerCase().replace(/\s+/g, " ").trim())}: ${JSON.stringify(item.images)}`);
  return `const productGalleries={\n${entries.join(",\n")}\n};`;
}

const detectEol = (value) => (value.includes("\r\n") ? "\r\n" : "\n");
const toLf = (value) => value.replace(/\r\n/g, "\n");
const trimTrailingSpaces = (value) => value.replace(/[ \t]+$/gm, "");
const generatedBlock = (value) => toLf(value).replace(/^\n/, "").trimEnd();

function updateFile(filePath, updater) {
  const fullPath = path.join(root, filePath);
  const before = fs.readFileSync(fullPath, "utf8");
  const eol = detectEol(before);
  const beforeLf = toLf(before);
  const afterLf = trimTrailingSpaces(toLf(updater(beforeLf)));
  if (afterLf === trimTrailingSpaces(beforeLf)) return false;
  fs.writeFileSync(fullPath, afterLf.replace(/\n/g, eol), "utf8");
  return true;
}

// Product+Offer-schema för alla prissatta produkter — genereras från samma
// datakälla som korten så pris/lagerstatus i rich results aldrig divergerar.
const schemaAvailability = {
  "i-lager": "https://schema.org/InStock",
  "pa-vag": "https://schema.org/PreOrder",
  forbestall: "https://schema.org/PreOrder",
  "demo-bara": "https://schema.org/InStoreOnly",
  slut: "https://schema.org/OutOfStock",
  upphord: "https://schema.org/Discontinued"
};

const productSchemaJson = () => {
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Elscootrar hos Nordic E-Mobility i Örebro",
    itemListElement: products
      .filter((item) => Number(item.priceSek) > 0)
      .map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Product",
          name: item.name,
          brand: { "@type": "Brand", name: item.brand },
          image: item.images?.[0],
          description: item.short,
          offers: {
            "@type": "Offer",
            price: item.priceSek,
            priceCurrency: "SEK",
            availability: schemaAvailability[item.status] || "https://schema.org/InStock",
            url: `https://www.nordicemobility.se${bookingHref(item)}`,
            seller: { "@type": "LocalBusiness", name: "Nordic E-Mobility" }
          }
        }
      }))
  };
  return `<script type="application/ld+json" id="product-catalog-schema">\n${JSON.stringify(itemList)}\n</script>`;
};

const changed = [];

if (
  updateFile("nya-elscootrar/index.html", (html) => {
    let next = html
      .replace(/<title>[\s\S]*?<\/title>/, "<title>Köp elscooter i Örebro – NAVEE, Teverun, KuKirin | Nordic E-Mobility</title>")
      .replace(
        /<meta name="description" content="[^"]*">/,
        '<meta name="description" content="Köp elscooter från NAVEE, Teverun och KuKirin hos specialistverkstaden i Örebro. Prisgaranti på utvalda modeller, leveranskontroll och service efter köpet.">'
      )
      .replace(
        /<meta name="keywords" content="[^"]*">/,
        '<meta name="keywords" content="köp elscooter Örebro, elscooter butik Örebro, NAVEE Sverige, Teverun Sverige, KuKirin Sverige, elscooter pris">'
      )
      .replace(
        /<span class="eyebrow">[\s\S]*?<\/span>\s*<h1>[\s\S]*?<\/h1>\s*<p class="lead">[\s\S]*?<\/p>/,
        '<span class="eyebrow">NAVEE · TEVERUN · KUKIRIN</span>\n        <h1>Köp elscooter i Örebro – direkt av verkstaden.</h1>\n        <p class="lead">Hela sortimentet från NAVEE, Teverun och KuKirin - med lokal service, garanti och provkörning i Örebro. Vi hjälper kunden att köpa rätt modell, förstå reglerna och få verkstadsstöd efter köpet.</p>'
      );
    if (!next.includes('property="og:title"')) {
      next = next.replace(
        '<link rel="canonical" href="https://www.nordicemobility.se/nya-elscootrar/">',
        '<link rel="canonical" href="https://www.nordicemobility.se/nya-elscootrar/">\n<meta property="og:type" content="website">\n<meta property="og:title" content="Köp elscooter i Örebro – NAVEE, Teverun, KuKirin">\n<meta property="og:description" content="Hela sortimentet med service, garanti och leveranskontroll hos verkstaden i Örebro.">\n<meta property="og:url" content="https://www.nordicemobility.se/nya-elscootrar/">\n<meta property="og:image" content="https://www.nordicemobility.se/assets/showroom/showroom-group-wide.jpg">'
      );
    }
    next = next.replace(/<script type="application\/ld\+json" id="product-catalog-schema">[\s\S]*?<\/script>\n?/, "");
    next = next.replace("</head>", `${productSchemaJson()}\n</head>`);
    next = next.replace(
      /  <section class="section" id="nya-elscootrar">[\s\S]*?\n  <section class="section alt" id="dack-punktering">/,
      `${generatedBlock(nyaElscootrarSection())}\n\n  <section class="section alt" id="dack-punktering">`
    );
    return next;
  })
) {
  changed.push("nya-elscootrar/index.html");
}

if (
  updateFile("index.html", (html) => {
    let next = html.replace(/<!-- PRODUKTER -->[\s\S]*?\n<!-- BLOGG -->/, `${generatedBlock(homeProductsSection())}\n\n<!-- BLOGG -->`);
    next = next.replace(/const productGalleries=\{[\s\S]*?\n\};/, galleryObject());
    next = next.replace(
      "const gallery=productGalleries[galleryKey(name)]||[baseImage].filter(Boolean);",
      "let gallery=productGalleries[galleryKey(name)]||[];\n  try{if(card.dataset.gallery)gallery=JSON.parse(card.dataset.gallery)}catch{}\n  if(!gallery.length)gallery=[baseImage].filter(Boolean);"
    );
    next = next
      .replace(
        "`<li><strong>N&auml;sta steg</strong>Klicka p&aring; best&auml;ll/fr&aring;ga s&aring; skapas en order- eller r&aring;dgivningsf&ouml;rfr&aring;gan till verkstaden.</li>`",
        "`<li><strong>N&auml;sta steg</strong>Klicka p&aring; K&ouml;p nu f&ouml;r trygg checkout, eller fr&aring;ga verkstaden om du vill dubbelkolla modell, regler eller leverans f&ouml;rst.</li>`"
      )
      .replace(
        "productModalBuy.textContent=/bevaka|frÃ¥ga/i.test(card.querySelector('.prod-btn')?.textContent||'')?'FrÃ¥ga / bevaka':'BestÃ¤ll / frÃ¥ga';",
        "const ctaText=card.querySelector('.prod-btn')?.textContent||'';\n  productModalBuy.textContent=/bevaka|frÃ¥ga/i.test(ctaText)?'FrÃ¥ga / bevaka':'KÃ¶p nu';"
      )
      .replace(
        "productModalBuy.textContent=/bevaka|fråga/i.test(card.querySelector('.prod-btn')?.textContent||'')?'Fråga / bevaka':'Beställ / fråga';",
        "const ctaText=card.querySelector('.prod-btn')?.textContent||'';\n  productModalBuy.textContent=/bevaka|fråga/i.test(ctaText)?'Fråga / bevaka':'Köp nu';"
      );
    return next;
  })
) {
  changed.push("index.html");
}

console.log(`Generated product HTML for ${products.length} products and ${accessories.length} accessories.`);
if (changed.length) console.log(`Updated: ${changed.join(", ")}`);
else console.log("No HTML changes needed.");
