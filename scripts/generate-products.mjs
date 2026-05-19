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
  const campaignNote =
    item.id === "kukirin-g4-special"
      ? `<p class="campaign-note"><strong>Kampanj:</strong> svart crosshjälm ingår för de 5 första G4 Special Edition-ordrarna.</p>`
      : "";
  const thumbs = images
    .slice(1, 4)
    .map((src, index) => `<button type="button" data-open-product aria-label="Visa ${escapeAttr(item.name)} bild ${index + 2}"><img loading="lazy" src="${escapeAttr(src)}" alt="${escapeAttr(item.name)} extra bild ${index + 2}"></button>`)
    .join("");
  return `
        <article class="card product-card" data-brand="${escapeAttr(item.brand)}" data-status="${escapeAttr(item.status)}" data-gallery="${galleryAttr(item)}">
          <a class="product-media" href="${escapeAttr(bookingHref(item))}" data-open-product aria-label="Visa bilder och information om ${escapeAttr(item.name)}">
            <span class="tag ${item.brand === "KuKirin" ? "orange" : ""}">${escapeHtml(item.badge || statusLabel[item.status] || "Modell")}</span>
            <img loading="lazy" src="${escapeAttr(mainImage(item))}" alt="${escapeAttr(item.name)}">
          </a>
          ${thumbs ? `<div class="product-thumbs">${thumbs}</div>` : `<div class="product-thumbs product-thumbs-empty"><span>Fler bilder läggs till när leverantörsmaterial finns.</span></div>`}
          <div class="card-body">
            <div class="product-meta"><span>${escapeHtml(item.brand)}</span><span>${escapeHtml(statusLabel[item.status] || item.status)}</span></div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="spec">${escapeHtml(item.spec)}</p>
            <p class="copy">${escapeHtml(item.short)}</p>
            ${campaignNote}
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
          <p>Betala tryggt via checkout. KuKirin har gratis hemleverans eller gratis leverans till vår verkstad. Teverun har fraktavgift 60 EUR. Vi kontaktar kunden om leverans, montering, hjälm, inbyte och efterservice.</p>
          ${paymentStrip()}
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
      </script>
    </div>
  </section>`;
}

function homeProductCard(item) {
  const price = formatPrice(item.priceSek);
  const gallery = galleryAttr(item);
  const border = item.brand === "KuKirin" ? "#ff6d00" : item.brand === "Teverun" ? "rgba(0,200,83,.35)" : "rgba(0,200,83,.3)";
  const buttonStyle = item.brand === "KuKirin" ? ' style="background:rgba(255,109,0,.15);border-color:rgba(255,109,0,.4);color:#ff6d00"' : "";
  const campaignNote =
    item.id === "kukirin-g4-special"
      ? `<div style="border:1px solid rgba(255,109,0,.42);background:rgba(255,109,0,.13);color:#ffd0a6;border-radius:8px;padding:8px 9px;font-size:11px;line-height:1.45;font-weight:800;margin:8px 0">Kampanj: svart crosshjälm ingår för de 5 första ordrarna.</div>`
      : "";
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
        ${campaignNote}
        <div class="prod-price">${price}</div>
        ${paymentStrip(true)}
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
  <style>
    .payment-methods{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 12px}
    .payment-methods.compact{gap:5px;margin:8px 0 10px}
    .pay-logo{display:inline-flex;align-items:center;justify-content:center;min-height:24px;border-radius:5px;padding:4px 7px;background:#f4f6f5;color:#071008;font-size:11px;font-weight:950;line-height:1;letter-spacing:0}
    .pay-logo.klarna{background:#ffb3c7;color:#111}
    .pay-logo.apple{background:#fff;color:#000}
    .pay-logo.gpay{background:#fff;color:#1f1f1f}
    .pay-logo.card{background:#15251a;color:#dfffea;border:1px solid rgba(0,200,83,.24)}
    .pay-logo.stripe{background:#635bff;color:#fff}
  </style>
  <span class="section-label">Produkter</span>
  <h2 class="section-title">6 modeller vi vill lyfta just nu</h2>
  <p class="section-sub">Startsidan visar bara de tydligaste valen. Hela katalogen med NAVEE, Teverun, KuKirin, Monorim och reservdelar finns på utbudssidan.</p>
  <div class="legal-note">Produktinfo ska läsas tillsammans med användningsområde. Modeller med hög effekt eller hög hastighet kan vara avsedda för privat mark eller inhägnat område, inte vanlig trafik. <a href="/regler-elscooter/">Läs regelguiden innan köp</a>.</div>
  <div class="legal-note" style="margin-bottom:10px;background:rgba(0,200,83,.08);border-color:rgba(0,200,83,.22);color:#dce8df">Betala tryggt med <strong>Klarna, Apple Pay, Google Pay, kort och andra tillgängliga betalsätt</strong>. KuKirin har gratis leveransval. Teverun har fraktavgift 60 EUR. Vi hjälper dig med leverans, rådgivning och service efter köpet.</div>
  ${paymentStrip()}
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
