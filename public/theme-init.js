// Theme init before paint: same trick as brnr. Self-hosted (not inline) so
// the boot page never needs a script-src 'unsafe-inline' CSP allowance.
(function () {
  const stored = localStorage.getItem("theme");
  document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";
})();
