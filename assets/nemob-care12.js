/* CARE 12: dölj tillfällig kampanj utanför kampanjperioden. Villkoren finns kvar. */
(() => {
  const now = Date.now();
  const start = Date.parse("2026-11-26T00:00:00+01:00");
  const end = Date.parse("2027-01-01T00:00:00+01:00");
  if (now >= start && now < end) {
    document.querySelectorAll("[data-nemob-care12]").forEach(el => { el.hidden = false; });
  }
})();
