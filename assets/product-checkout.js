(function () {
  async function startCheckout(link) {
    const productId = link.dataset.product;
    if (!productId) return false;

    const originalText = link.textContent;
    let redirecting = false;
    link.textContent = "Startar trygg betalning...";
    link.setAttribute("aria-busy", "true");
    link.style.pointerEvents = "none";

    try {
      const response = await fetch("/.netlify/functions/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Kunde inte starta betalning.");
      }
      redirecting = true;
      window.location.href = data.url;
      return true;
    } catch (error) {
      console.error("Product checkout failed", error);
      // Riktig reservväg i stället för återvändsgränd: erbjud
      // beställningsförfrågan (länkens href pekar redan på beställningsläget).
      const fallback = link.getAttribute("href") || "/book-online/";
      const useFallback = window.confirm(
        "Kunde inte starta betalning just nu.\n\nVill du skicka en beställningsförfrågan i stället? Vi återkommer med betalning och leverans — oftast samma dag.\n\n(Du kan också ringa verkstaden på 010-138 54 98.)"
      );
      if (useFallback) window.location.href = fallback;
      return false;
    } finally {
      if (!redirecting) {
        link.textContent = originalText;
        link.removeAttribute("aria-busy");
        link.style.pointerEvents = "";
      }
    }
  }

  document.addEventListener("click", function (event) {
    const link = event.target.closest("a[data-product]");
    if (!link) return;
    event.preventDefault();
    startCheckout(link);
  });
})();
