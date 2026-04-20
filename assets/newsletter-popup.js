(function(){
  const code = "NORDIC10";
  const doneKey = "nemNewsletterDone";
  const dismissKey = "nemNewsletterDismissedUntil";

  function shouldOpen(){
    try{
      if(localStorage.getItem(doneKey)==="1") return false;
      const until = Number(localStorage.getItem(dismissKey) || 0);
      return Date.now() > until;
    }catch{
      return true;
    }
  }

  function rememberDismiss(){
    try{
      localStorage.setItem(dismissKey, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    }catch{}
  }

  function rememberDone(){
    try{
      localStorage.setItem(doneKey, "1");
    }catch{}
  }

  function createPopup(){
    if(document.getElementById("nemNewsletterPopup")) return document.getElementById("nemNewsletterPopup");
    const wrapper = document.createElement("div");
    wrapper.id = "nemNewsletterPopup";
    wrapper.className = "nem-newsletter-backdrop";
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-modal", "true");
    wrapper.setAttribute("aria-labelledby", "nemNewsletterTitle");
    wrapper.innerHTML = `
      <div class="nem-newsletter-card">
        <div class="nem-newsletter-top">
          <span class="nem-newsletter-kicker">Verkstadsrabatt</span>
          <button type="button" class="nem-newsletter-close" aria-label="St&auml;ng">&times;</button>
        </div>
        <div class="nem-newsletter-body">
          <h2 id="nemNewsletterTitle">F&aring; 10% rabatt p&aring; valfri service.</h2>
          <p>Registrera dig p&aring; Nordic E-Mobilitys nyhetsbrev och skriv rabattkoden i din bokning eller visa den vid inl&auml;mning.</p>
          <form class="nem-newsletter-form" name="newsletter-popup">
            <input type="hidden" name="form-name" value="newsletter">
            <input type="hidden" name="source" value="">
            <input type="hidden" name="discountCode" value="${code}">
            <input type="text" name="bot-field" tabindex="-1" autocomplete="off" style="display:none">
            <input type="email" name="email" required autocomplete="email" placeholder="din@email.se">
            <button type="submit">F&aring; koden</button>
          </form>
          <span class="nem-newsletter-small">G&auml;ller en g&aring;ng per kund. Kan inte kombineras med andra rabatter.</span>
          <div class="nem-newsletter-result" aria-live="polite"></div>
        </div>
      </div>`;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function openPopup(){
    const popup = createPopup();
    popup.classList.add("is-open");
    const email = popup.querySelector('input[type="email"]');
    setTimeout(()=>email && email.focus(), 60);
  }

  function closePopup(){
    const popup = document.getElementById("nemNewsletterPopup");
    if(popup) popup.classList.remove("is-open");
    rememberDismiss();
  }

  async function submitForm(form, result, button){
    const data = new FormData(form);
    data.set("source", location.pathname || "/");
    data.set("discountCode", code);
    data.set("subject", "Nyhetsbrev Nordic E-Mobility");
    const body = new URLSearchParams(data).toString();
    const response = await fetch("/__forms.html", {
      method: "POST",
      headers: {"Content-Type":"application/x-www-form-urlencoded"},
      body
    });
    if(!response.ok) throw new Error("newsletter failed");
    rememberDone();
    const bookingDiscount = document.getElementById("discountCode");
    if(bookingDiscount && !bookingDiscount.value){
      bookingDiscount.value = code;
      bookingDiscount.dispatchEvent(new Event("input", {bubbles:true}));
    }
    result.classList.add("is-visible");
    result.innerHTML = `Tack. Din rabattkod &auml;r:<br><span class="nem-newsletter-code">${code}</span>`;
    form.style.display = "none";
    button.disabled = false;
  }

  document.addEventListener("click", function(event){
    if(event.target.closest(".nem-newsletter-close")) closePopup();
    const popup = document.getElementById("nemNewsletterPopup");
    if(popup && event.target === popup) closePopup();
  });

  document.addEventListener("submit", async function(event){
    const form = event.target.closest(".nem-newsletter-form");
    if(!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    const result = form.parentElement.querySelector(".nem-newsletter-result");
    button.disabled = true;
    button.textContent = "Registrerar...";
    try{
      await submitForm(form, result, button);
    }catch{
      const bookingDiscount = document.getElementById("discountCode");
      if(bookingDiscount && !bookingDiscount.value){
        bookingDiscount.value = code;
        bookingDiscount.dispatchEvent(new Event("input", {bubbles:true}));
      }
      result.classList.add("is-visible");
      result.innerHTML = `Vi kunde inte spara e-posten just nu, men anv&auml;nd koden vid bokning:<br><span class="nem-newsletter-code">${code}</span>`;
      button.disabled = false;
      button.textContent = "F&aring; koden";
    }
  });

  document.addEventListener("keydown", function(event){
    if(event.key === "Escape") closePopup();
  });

  if(shouldOpen()){
    window.addEventListener("load", function(){
      setTimeout(openPopup, 5500);
    });
  }
})();
