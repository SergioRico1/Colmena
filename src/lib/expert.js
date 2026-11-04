import { useEffect, useState } from "react";
import { useStore } from "./store.jsx";
import { patch } from "./api.js";

// «Modo experto» (Colmena 3, design/V3Sistema.dc.html): one switch at the foot of the sidebar.
// It never removes anything; it decides how much of each thing shows (tools and arguments,
// tokens and cache, the Inspector, shortcuts, Ajustes › Avanzado). Saved in settings.expert;
// the switch answers at once and the server catches up. <html data-expert> lets CSS follow it.
let local = null;
const subs = new Set();

export function useExpert() {
  const { settings = {}, run } = useStore();
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    subs.add(fn);
    return () => subs.delete(fn);
  }, []);
  // ?experto=1 forces it on in this tab only (visual QA, scripts/v3-shot.cjs).
  const forced = typeof location !== "undefined" && new URLSearchParams(location.search).get("experto") === "1";
  const saved = forced || !!settings.expert;
  useEffect(() => { if (local === saved) local = null; }, [saved]);
  const on = local ?? saved;
  useEffect(() => {
    if (on) document.documentElement.dataset.expert = "1";
    else delete document.documentElement.dataset.expert;
  }, [on]);
  const set = (v) => {
    local = !!v;
    subs.forEach((fn) => fn());
    run(() => patch("/settings", { expert: !!v })).catch(() => { local = null; subs.forEach((fn) => fn()); });
  };
  return [on, set];
}
