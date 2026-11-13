// Before the first paint: the theme chosen last time (Ajustes › General › Tema, mirrored in
// localStorage by src/lib/theme.js), or the system's. A plain script so it runs before the app.
(function () {
  var mode = "system";
  try { mode = localStorage.getItem("colmena.theme") || "system"; } catch (e) { /* no storage */ }
  var dark = mode === "dark" || (mode !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme-mode", mode === "dark" || mode === "light" ? mode : "system");
})();
