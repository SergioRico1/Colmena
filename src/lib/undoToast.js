import { useSyncExternalStore } from "react";
import { cancel, schedule } from "./undoable.js";

// «Deshacer» for five seconds (T3 Code does it when you unpin, settle or archive): archiving,
// deleting, moving or discarding anything shows one quiet notice with «Deshacer».
//
// Two ways, the safest one for each case:
// - later(): the change waits five seconds and only then reaches the server (a delete the
//   server cannot take back). Meanwhile the thing leaves every list (hidden keys), so it
//   feels done at once; «Deshacer» brings it back and nothing was sent.
// - reversible(): the change is already made and can be undone (archive → unarchive,
//   snooze → wake). «Deshacer» runs the opposite call.
// The waits ride on src/lib/undoable.js (the ten-second wait of sends), so leaving the screen
// never cancels them and closing the app sends what was already decided.
export const TOAST_MS = 5000;

let toasts = []; // [{id, text, at, ms, undo, kind}]
const hidden = new Map(); // "kind:id" → number of pending changes hiding it
const subs = new Set();
let version = 0;
const notify = () => { version++; for (const fn of subs) fn(); };
const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getVersion = () => version;
let seq = 0;

const hide = (keys) => { for (const k of keys) hidden.set(k, (hidden.get(k) || 0) + 1); };
const show = (keys) => {
  for (const k of keys) {
    const n = (hidden.get(k) || 0) - 1;
    if (n > 0) hidden.set(k, n); else hidden.delete(k);
  }
};
function push(toast) {
  // One notice per thing: doing it again replaces the old notice (the old change already ran).
  toasts = [...toasts.filter((t) => t.id !== toast.id), toast].slice(-3);
  notify();
}
export function dismiss(id) {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) notify();
}
function failed(text, message) {
  const id = "failed-" + ++seq;
  push({ id, kind: "error", text: message ? `${text}: ${message}` : text, at: Date.now(), ms: 6000 });
  setTimeout(() => dismiss(id), 6000);
}

/**
 * The change waits five seconds. keys ("mission:<id>", "bot:<id>"…) leave the lists at
 * once. Returns the notice id. `undone` runs when you press «Deshacer».
 */
export function later({ id, text, run, keys = [], undone = null, error = "No se pudo hacer", ms = TOAST_MS }) {
  const toastId = id || "later-" + ++seq;
  const waitId = "toast:" + toastId;
  if (cancel(waitId)) { const prev = toasts.find((t) => t.id === toastId); if (prev?.keys) show(prev.keys); }
  hide(keys);
  const undo = () => {
    if (!cancel(waitId)) return;
    show(keys);
    dismiss(toastId);
    undone?.();
    notify();
  };
  schedule(waitId, async () => {
    dismiss(toastId);
    try {
      await run();
    } catch (e) {
      failed(error, e?.message);
      throw e;
    } finally {
      // The server's answer (the refreshed state) now carries the change; a failure shows it again.
      show(keys);
      notify();
    }
  }, ms);
  push({ id: toastId, kind: "later", text, at: Date.now(), ms, undo, keys });
  return toastId;
}

/** The change is already made; «Deshacer» runs `undo` (the opposite call). */
export function reversible({ id, text, undo, error = "No se pudo deshacer", ms = TOAST_MS }) {
  const toastId = id || "done-" + ++seq;
  let used = false;
  const timer = setTimeout(() => dismiss(toastId), ms);
  const run = async () => {
    if (used) return;
    used = true;
    clearTimeout(timer);
    dismiss(toastId);
    try { await undo(); } catch (e) { failed(error, e?.message); }
  };
  push({ id: toastId, kind: "done", text, at: Date.now(), ms, undo: run });
  return toastId;
}

/** «Deshacer» on the newest notice (Ctrl+Z outside a text field). */
export function undoLast() {
  const last = [...toasts].reverse().find((t) => t.undo);
  if (!last) return false;
  last.undo();
  return true;
}

export const isHidden = (key) => hidden.has(key);
/** Re-renders when a notice or a hidden key changes; returns the notices. */
export function useToasts() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return toasts;
}
/** A filter for lists: drops what is waiting to be deleted (kind = "mission", "bot"…). */
export function useHidden(kind) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return (id) => hidden.has(kind + ":" + id);
}
export function useHiddenVersion() {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}
/** Drops hidden items from a list of records with ids. */
export const visible = (kind, list) => (Array.isArray(list) && hidden.size ? list.filter((x) => !hidden.has(kind + ":" + x?.id)) : list);

// For tests: start clean.
export function _reset() { toasts = []; hidden.clear(); notify(); }
