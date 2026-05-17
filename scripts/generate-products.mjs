import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "products.json"), "utf8"));

const products = catalog.products;
const accessories = catalog.accessories || [];

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
  upphord: "UTGATT"
};

const statusCopy = {
  "i-lager": "Kan bestallas nu",
  "pa-vag": "På väg till sortimentet",
  forbestall: "Tas hem efter forfragan",
  "demo-bara": "Demo och radgivning",
  slut: "Tillfalligt slut",
  upphord: "Saljs inte langre"
};

const legalityText = {
  "off-road-only": "Prestandamodell: kontrollera regler. Ofta avsedd för privat mark eller inhägnat område.",
  "check-rules": "Kontrollera användningsområde och regler innan köp.",
  "confirmed-context-needed": "Regelstatus beror på exakt version och användning. Vi kontrollerar innan affär."
};

const ctaText = (item) => {
  if (item.status === "i-lager") return "Köp nu";
  if (item.status === "pa-vag") return "Förbeställ";
  if (item.status === "forbestall") return "Begär offert";
  if (item.status === "demo-bara") return "Boka demo";
  return "Fraga oss";
};

const bookingHref = (item) => `/book-online?service=bestallning&modell=${slugModel(item.name)}`;

const mainImage = (item) => item.images?.[0] || "/assets/workshop/scooter-on-bench.jpg";

const galleryAttr = (item) => escapeAttr(JSON.stringify(item.images || []));

const buyAttrs = (item) => item.checkout ? ` data-product="${escapeAttr(item.id)}"` : "";

function productCard(item, options = {}) {
  const images = item.images || [];
  const price = formatPrice(item.priceSek) || escapeHtml(item.priceNote || "Pris efter modell");
  const monthly = item.priceSek ? Math.ceil(item.priceSek / 24) : null;
  const legal = item.legality ? `<p class="product-legal">${escapeHtml(legalityText[item.legality] || item.legality)}</p>` : "";
  const thumbs = images
    .slice(1, 4)
    .map((src, index) => `<img loading="lazy" src="${escapeAttr(src)}" alt="${escapeAttr(item.name)} extra bild ${index + 2}">`)
    .join("");
  return `
        <article class="card product-card" data-brand="${escapeAttr(item.brand)}" data-status="${escapeAttr(item.status)}" data-gallery="${galleryAttr(item)}">
          <a class="product-media" href="${escapeAttr(bookingHref(item))}"${buyAttrs(item)} aria-label="${escapeAttr(ctaText(item))} ${escapeAttr(item.name)}">
            <span class="tag ${item.brand === "KuKirin" ? "orange" : ""}">${escapeHtml(item.badge || statusLabel[item.status] || "Modell")}</span>
            <img loading="lazy" src="${escapeAttr(mainImage(item))}" alt="${escapeAttr(item.name)}">
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
            <img loading="lazy" src="${escapeAttr(mainImage(item))}" alt="${escapeAttr(item.name)}">
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
        .product-card{position:relative}
        .product-media{height:210px;display:flex;align-items:center;justify-content:center;background:#111712;position:relative;text-decoration:none}
        .product-media .tag{position:absolute;top:10px;left:10px;z-index:2;margin:0}
        .product-media img{height:100%;width:100%;object-fit:contain;padding:12px;background:transparent}
        .product-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px;background:#0b100c;border-top:1px solid var(--line)}
        .product-thumbs img{height:58px;width:100%;object-fit:contain;background:#111712;border:1px solid var(--line);border-radius:6px;padding:4px}
        .product-thumbs-empty{display:block;color:#8d9a91;font-size:12px;min-height:42px}
        .product-meta{display:flex;justify-content:space-between;gap:8px;color:#90a097;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
        .product-legal{margin-top:10px;color:#ffd9b3;font-size:12px;line-height:1.45}
        .klarna,.stock-copy{font-size:12px;color:#9eaaa2;margin-top:-6px;margin-bottom:10px}
        .catalog-brand{margin-top:36px}
        .brand-row{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:16px;border-top:1px solid var(--line);padding-top:22px}
        .brand-row h3{font-size:30px;line-height:1.1}
        .brand-row p{color:var(--muted);max-width:520px}
        .fighter-push{margin-top:24px;border:1px solid rgba(255,138,28,.34);background:linear-gradient(135deg,rgba(255,138,28,.13),rgba(0,200,83,.07));border-radius:8px;padding:22px}
        .accessory-card .product-media{height:190px}
        @media(max-width:980px){.catalog-intro{grid-template-columns:1fr}.brand-row{display:block}.brand-row p{margin-top:8px}}
      </style>
      <div class="section-head">
        <div>
          <span class="eyebrow">NYA ELSCOOTRAR</span>
          <h2>Hela utbudet från NAVEE, Teverun och KuKirin.</h2>
        </div>
        <p>Vi visar hela sortimentet SEO-vänligt direkt i sidan, med samma pris och status som checkout. Kunden ska kunna jämföra, klicka på modell, se bilder och gå vidare till köp utan att fastna.</p>
      </div>
      <div class="catalog-intro">
        <div class="catalog-note">
          <h3>Utvalt sortiment från NAVEE, Teverun och KuKirin</h3>
          <p>Vi lyfter modeller vi kan rådge kring och hjälpa kunden med efter köpet. Demo-scootrar från bland annat Teverun och NAVEE beräknas komma i slutet av juni eller början av juli.</p>
          <div class="catalog-actions">
            <a href="#brand-navee">NAVEE</a>
            <a href="#brand-teverun">Teverun</a>
            <a href="#brand-kukirin">KuKirin</a>
            <a href="#tillbehor-reservdelar">Tillbehor och reservdelar</a>
          </div>
        </div>
        <div class="catalog-note">
          <h3>Köp med verkstadsstöd</h3>
          <p>Betala tryggt via checkout. Vi kontaktar kunden om leverans, montering, hjälm, inbyte och efterservice. Prestandamodeller markeras försiktigt så de inte säljs som vanliga trafikfordon utan kontroll.</p>
        </div>
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
      <p class="rule-note">Obs: Prestandamodeller och ombyggda fordon kan omfattas av särskilda regler. Fråga oss eller läs <a href="/regler-elscooter/">regelguiden</a> innan du väljer modell för allmän väg.</p>
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
    </div>
  </section>`;
}

function homeProductCard(item) {
  const price = formatPrice(item.priceSek);
  const gallery = galleryAttr(item);
  const border = item.brand === "KuKirin" ? "#ff6d00" : item.brand === "Teverun" ? "rgba(0,200,83,.35)" : "rgba(0,200,83,.3)";
  const buttonStyle = item.brand === "KuKirin" ? ' style="background:rgba(255,109,0,.15);border-color:rgba(255,109,0,.4);color:#ff6d00"' : "";
  return `    <div class="prod" data-gallery="${gallery}" style="border-color:${border}">
      <div class="prod-img" style="background:linear-gradient(135deg,#0a1a0f,#111);position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden">
        <div style="position:absolute;top:8px;left:8px;background:${item.brand === "KuKirin" ? "#ff6d00" : "#00C853"};color:#000;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;z-index:1">${escapeHtml(item.badge || statusLabel[item.status])}</div>
        <div style="position:absolute;top:8px;right:8px;background:#fff;color:#000;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;z-index:1">${escapeHtml(statusLabel[item.status])}</div>
        <img width="500" height="500" loading="lazy" decoding="async" src="${escapeAttr(mainImage(item))}" alt="${escapeAttr(item.name)}" style="max-height:100%;max-width:100%;object-fit:contain;filter:brightness(.95)" onerror="this.outerHTML='&#9889;'">
      </div>
      <div class="prod-body">
        <div class="prod-name">${escapeHtml(item.name.replace(/^NAVEE |^KuKirin |^Teverun /, ""))}</div>
        <div style="font-size:11px;color:#888;margin:4px 0">${escapeHtml(item.spec)}</div>
        <div style="font-size:11px;color:#b0b0b0;line-height:1.5;margin-bottom:10px">${escapeHtml(item.short)}</div>
        <div class="prod-price">${price}</div>
        <a href="${escapeAttr(bookingHref(item))}" class="prod-btn" data-product="${escapeAttr(item.id)}" data-price="${item.priceSek}"${buttonStyle}>${escapeHtml(ctaText(item))}</a>
      </div>
    </div>`;
}

function homeProductsSection() {
  const homeOrder = [
    "navee-xt5-ultra",
    "navee-n65i",
    "navee-v50i-pro",
    "kukirin-g4-special",
    "kukirin-g2",
    "teverun-fighter-eleven-plus"
  ];
  const featured = homeOrder.map((id) => products.find((item) => item.id === id)).filter(Boolean);
  return `<!-- PRODUKTER -->
<section class="products" id="produkter">
<div class="container">
  <span class="section-label">Produkter</span>
  <h2 class="section-title">6 modeller vi vill lyfta just nu</h2>
  <p class="section-sub">Startsidan visar bara de tydligaste valen. Hela katalogen med NAVEE, Teverun, KuKirin, Monorim och reservdelar finns på utbudssidan.</p>
  <div class="legal-note">Produktinfo ska läsas tillsammans med användningsområde. Modeller med hög effekt eller hög hastighet kan vara avsedda för privat mark eller inhägnat område, inte vanlig trafik. <a href="/regler-elscooter/">Läs regelguiden innan köp</a>.</div>
  <div class="legal-note" style="margin-bottom:10px;background:rgba(0,200,83,.08);border-color:rgba(0,200,83,.22);color:#dce8df">Betala tryggt med <strong>kort, Klarna och andra tillgängliga betalsätt</strong>. Stripe visar de alternativ som är aktiverade och kvalificerade för ordern. Vi hjälper dig med leverans, rådgivning och service efter köpet.</div>
  <div class="products-grid" style="grid-template-columns:repeat(3,1fr)">
${featured.map((item) => homeProductCard(item)).join("\n")}
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

function updateFile(filePath, updater) {
  const fullPath = path.join(root, filePath);
  const before = fs.readFileSync(fullPath, "utf8");
  const after = updater(before).replace(/[ \t]+$/gm, "");
  if (after === before) return false;
  fs.writeFileSync(fullPath, after, "utf8");
  return true;
}

const changed = [];

if (
  updateFile("nya-elscootrar/index.html", (html) => {
    let next = html
      .replace(/<title>[\s\S]*?<\/title>/, "<title>Premium elscootrar, reservdelar och uppgraderingar i Örebro | Nordic E-Mobility</title>")
      .replace(
        /<meta name="description" content="[^"]*">/,
        '<meta name="description" content="Hela utbudet från NAVEE, Teverun och KuKirin hos Nordic E-Mobility i Örebro. Köp elscooter, jämför modeller, reservdelar, Monorim-uppgraderingar och service med lokal verkstadsstöd.">'
      )
      .replace(
        /<span class="eyebrow">[\s\S]*?<\/span>\s*<h1>[\s\S]*?<\/h1>\s*<p class="lead">[\s\S]*?<\/p>/,
        '<span class="eyebrow">PREMIUM I ÖREBRO</span>\n        <h1>Premium elscootrar för svensk vardag.</h1>\n        <p class="lead">Hela sortimentet från NAVEE, Teverun och KuKirin - med lokal service, garanti och provkörning i Örebro. Vi hjälper kunden att köpa rätt modell, förstå reglerna och få verkstadsstöd efter köpet.</p>'
      );
    next = next.replace(
      /  <section class="section" id="nya-elscootrar">[\s\S]*?\n  <section class="section alt" id="dack-punktering">/,
      `${nyaElscootrarSection()}\n\n  <section class="section alt" id="dack-punktering">`
    );
    return next;
  })
) {
  changed.push("nya-elscootrar/index.html");
}

if (
  updateFile("index.html", (html) => {
    let next = html.replace(/<!-- PRODUKTER -->[\s\S]*?\n<!-- BLOGG -->/, `${homeProductsSection()}\n\n<!-- BLOGG -->`);
    next = next.replace(/const productGalleries=\{[\s\S]*?\n\};/, galleryObject());
    next = next.replace(
      "const gallery=productGalleries[galleryKey(name)]||[baseImage].filter(Boolean);",
      "let gallery=productGalleries[galleryKey(name)]||[];\n  try{if(card.dataset.gallery)gallery=JSON.parse(card.dataset.gallery)}catch{}\n  if(!gallery.length)gallery=[baseImage].filter(Boolean);"
    );
    return next;
  })
) {
  changed.push("index.html");
}

console.log(`Generated product HTML for ${products.length} products and ${accessories.length} accessories.`);
if (changed.length) console.log(`Updated: ${changed.join(", ")}`);
else console.log("No HTML changes needed.");
