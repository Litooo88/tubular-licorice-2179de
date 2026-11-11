// Gemensam navigering för alla adminsidor (Sebastians önskan 2026-10-30:
// kommunikationen ska inte gömma sig på en egen flik). På mobilen en fast
// bottenmeny inom tumavstånd, på dator en rad överst. Märket på Kommunikation
// visar SMS som väntar på godkännande + kontakter som väntar på svar.
// Ingen kunddata sparas i webbläsaren: bara två siffror i sessionStorage i 3 min.
(() => {
  if (document.getElementById("adminNav")) return;
  const items = [
    { href: "/admin/", label: "Ärenden", icon: "🔧", match: (p) => p === "/admin/" || p === "/admin/index.html" },
    { href: "/admin/kommunikation/", label: "Kommunikation", icon: "💬", badge: true, match: (p) => p.startsWith("/admin/kommunikation") },
    { href: "/admin/ring-upp/", label: "Ring upp", icon: "📞", match: (p) => p.startsWith("/admin/ring-upp") },
    { href: "/admin/nova-rapport/", label: "Nova", icon: "🤖", match: (p) => p.startsWith("/admin/nova-rapport") },
  ];
  const path = location.pathname;
  const style = document.createElement("style");
  style.textContent = `
    #adminNav{position:sticky;top:0;z-index:50;display:flex;gap:6px;padding:8px 10px;margin:0 0 12px;background:rgba(8,11,9,.96);border-bottom:1px solid #253027;backdrop-filter:blur(6px)}
    #adminNav a{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border-radius:8px;color:#d7e4da;text-decoration:none;font:600 14px/1.1 system-ui,-apple-system,Segoe UI,sans-serif;border:1px solid transparent;position:relative}
    #adminNav a.on{background:#00c853;color:#031006}
    #adminNav a:not(.on):hover{border-color:#2f3d33}
    #adminNav .ico{font-size:16px}
    #adminNav .badge{min-width:18px;padding:1px 6px;border-radius:999px;background:#ffb020;color:#1a1200;font-size:12px;font-weight:800;line-height:16px;text-align:center}
    #adminNav .badge[hidden]{display:none}
    @media (max-width:700px){
      #adminNav{position:fixed;top:auto;bottom:0;left:0;right:0;margin:0;padding:6px 6px calc(6px + env(safe-area-inset-bottom));border-top:1px solid #253027;border-bottom:0}
      #adminNav a{flex-direction:column;gap:3px;padding:6px 2px;font-size:11px}
      #adminNav .ico{font-size:20px}
      #adminNav .badge{position:absolute;top:2px;right:calc(50% - 26px)}
      body{padding-bottom:calc(72px + env(safe-area-inset-bottom))!important}
    }
    @media print{#adminNav{display:none}}`;
  document.head.appendChild(style);
  const nav = document.createElement("nav");
  nav.id = "adminNav";
  nav.setAttribute("aria-label", "Adminmeny");
  nav.innerHTML = items.map((item) => `<a href="${item.href}" class="${item.match(path) ? "on" : ""}"${item.match(path) ? ' aria-current="page"' : ""}><span class="ico" aria-hidden="true">${item.icon}</span><span>${item.label}</span>${item.badge ? '<span class="badge" id="adminNavBadge" hidden></span>' : ""}</a>`).join("");
  document.body.insertBefore(nav, document.body.firstChild);

  const showBadge = (counts) => {
    const el = document.getElementById("adminNavBadge");
    if (!el || !counts) return;
    const total = Number(counts.pending || 0) + Number(counts.waiting || 0);
    el.hidden = !total;
    el.textContent = total > 99 ? "99+" : String(total);
    el.title = `${counts.pending || 0} SMS väntar på godkännande, ${counts.waiting || 0} kontakter väntar på svar`;
  };
  const KEY = "nordicAdminNavCounts";
  // Sidor som redan har siffrorna (kommunikationssidan) uppdaterar märket direkt.
  window.nordicAdminNavCounts = (counts) => {
    const value = { at: Date.now(), pending: counts.pending || 0, waiting: counts.waiting || 0 };
    try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch {}
    showBadge(value);
  };
  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch {}
  if (cached && Date.now() - cached.at < 3 * 60 * 1000) { showBadge(cached); return; }
  let token = "";
  try { token = String(localStorage.getItem("nordicAdminToken") || "").trim(); } catch {}
  if (!token) return;
  // Kommunikationssidan hämtar själv samma data - där räknar sidan om märket.
  if (path.startsWith("/admin/kommunikation")) return;
  setTimeout(async () => {
    try {
      const response = await fetch("/api/kommunikation?days=7", { headers: { "x-admin-token": token } });
      if (!response.ok) return;
      const data = await response.json();
      const counts = {
        at: Date.now(),
        pending: Array.isArray(data.pending) ? data.pending.length : 0,
        waiting: Array.isArray(data.contacts) ? data.contacts.filter((c) => c && c.waiting).length : 0,
      };
      try { sessionStorage.setItem(KEY, JSON.stringify(counts)); } catch {}
      showBadge(counts);
    } catch {}
  }, 1500);
})();
