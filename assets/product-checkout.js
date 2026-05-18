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
      alert("Kunde inte starta betalning just nu. Ring verkstaden på 010-138 54 98 så hjälper vi kunden direkt.");
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
