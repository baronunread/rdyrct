// Theme init before paint: same trick as brnr. Self-hosted (not inline) so
// the boot page never needs a script-src 'unsafe-inline' CSP allowance.
//
// A stored choice always wins. With nothing stored we follow the operating
// system, and fall back to light: the marketing page is most people's first
// screen, and dark-first turns away more of them than it wins.
(function () {
  const stored = localStorage.getItem("theme");
  const os = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = stored === "light" || stored === "dark" ? stored : os;
})();
