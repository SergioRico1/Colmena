// The first-run choice: two options as a radio group (arrow keys move), «Continuar» decides.
(function () {
  const api = window.colmenaMode || null;
  const options = [...document.querySelectorAll(".option")];
  const hint = document.getElementById("hint");
  let mode = "cloud";
  const pick = (m) => {
    mode = m;
    for (const o of options) o.setAttribute("aria-checked", String(o.dataset.mode === m));
    hint.textContent = m === "cloud" ? "Te pediremos tu correo de trabajo en tu navegador." : "Colmena arrancará con los datos de este ordenador.";
  };
  for (const o of options) {
    o.addEventListener("click", () => pick(o.dataset.mode));
    o.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const next = options[(options.indexOf(o) + 1) % options.length];
      pick(next.dataset.mode);
      next.focus();
    });
  }
  document.getElementById("go").addEventListener("click", () => api && api.choose(mode));
  document.getElementById("close").addEventListener("click", () => api && api.close());
})();
