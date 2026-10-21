import { useEffect, useState, useSyncExternalStore } from "react";

// «Todo se puede deshacer» (Colmena 2.0, idea 05): a send or a decision waits ten seconds
// before it goes out, with «Deshacer». The wait lives here, outside any screen, so leaving
// the screen does not cancel it; closing the app sends what was already approved.
export const UNDO_MS = 10000;
const pending = new Map(); // id → {at, run, timer}
const subs = new Set();
let version = 0;
const notify = () => { version++; for (const fn of subs) fn(); };

export function schedule(id, run, ms = UNDO_MS) {
  cancel(id);
  const entry = { at: Date.now() + ms, run };
  entry.timer = setTimeout(() => fire(id), ms);
  pending.set(id, entry);
  notify();
}
async function fire(id) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  notify();
  try { await entry.run(); } catch (e) { window.dispatchEvent(new CustomEvent("colmena:undo-failed", { detail: { id, message: e?.message } })); }
}
export function cancel(id) {
  const entry = pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(id);
  notify();
  return true;
}
export const isPending = (id) => pending.has(id);

if (typeof window !== "undefined") window.addEventListener("beforeunload", () => { for (const id of [...pending.keys()]) fire(id); });

/** {waiting, secs, fraction}: the countdown of one id, ticking every second. */
export function useUndoable(id) {
  useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => version, () => version);
  const entry = pending.get(id);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!entry) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [entry]);
  if (!entry) return { waiting: false, secs: 0, fraction: 0 };
  const left = Math.max(0, entry.at - Date.now());
  return { waiting: true, secs: Math.ceil(left / 1000), fraction: left / UNDO_MS };
}
