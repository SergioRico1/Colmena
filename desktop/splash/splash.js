// The start-up window's only behaviour: after 20 s, the slow face and its two ways out.
// ?slow=1 shows it at once (visual QA).
(function () {
  const SLOW_MS = 20000;
  const starting = document.getElementById("starting");
  const slow = document.getElementById("slow");
  const api = window.colmenaSplash || null;
  const showSlow = () => {
    starting.hidden = true;
    slow.hidden = false;
  };
  if (new URLSearchParams(location.search).get("slow") === "1") showSlow();
  else setTimeout(showSlow, SLOW_MS);
  document.getElementById("retry").addEventListener("click", () => (api ? api.retry() : location.reload()));
  const log = document.getElementById("log");
  if (api) log.addEventListener("click", () => api.openLog());
  else log.hidden = true;
})();
