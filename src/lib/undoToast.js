import { useSyncExternalStore } from "react";
import { cancel, pause as pauseWait, resume as resumeWait, schedule } from "./undoable.js";

// «Deshacer» for five seconds (T3 Code does it when you unpin, settle or archive): archiving,
// deleting, moving or discarding anything shows one quiet notice with «Deshacer».
//
// Two ways, the safest one for each case:
// - later(): the change waits five seconds and only then reaches the server (a delete the
//   server cannot take back). Meanwhile the thing leaves every list (hidden keys), so it
//   feels done at once; «Deshacer» brings it back and nothing was sent. When the wait ends
//   the same notice says it is on its way, then that it is done — or why it failed.
// - reversible(): the change is already made and can be undone (archive → unarchive,
//   snooze → wake). «Deshacer» runs the opposite call.
// And promise(): a notice that changes state as work goes (sonner toast.promise): working,
// then done or failed.
// The waits ride on src/lib/undoable.js (the ten-second wait of sends), so leaving the screen
// never cancels them and closing the app sends what was already decided. Every countdown
// stops while the window is hidden or the pointer rests on the notices (setPaused).
export const TOAST_MS = 5000;
export const DONE_MS = 2500;
export const ERROR_MS = 6000;
const MAX = 5;

let toasts = []; // [{id, kind, text, at, ms, undo, keys, wait}] — kind: later|done|working|success|error
const timers = new Map(); // id → { timer, left, since }
let paused = false;
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

// A notice that goes away on its own (done, success, error): its time left, which stops
// while the countdowns are paused.
function arm(id, ms) {
  disarm(id);
  if (!ms) return;
  const t = { timer: null, left: ms, since: Date.now() };
  timers.set(id, t);
  if (!paused) t.timer = setTimeout(() => dismiss(id), ms);
}
function disarm(id) {
  const t = timers.get(id);
  if (t) clearTimeout(t.timer);
  timers.delete(id);
}

function push(toast) {
  // One notice per thing: doing it again replaces the old notice (the old change already ran).
  toasts = [...toasts.filter((t) => t.id !== toast.id), { at: Date.now(), ...toast }].slice(-MAX);
  notify();
}
/** Changes a notice in place (working → done…), keeping its place in the stack. */
export function update(id, patch, ms = null) {
  let found = false;
  toasts = toasts.map((t) => (t.id === id ? ((found = true), { ...t, ...patch, at: Date.now() }) : t));
  if (!found) return false;
  if (ms !== null) arm(id, ms); else disarm(id);
  notify();
  return true;
}
export function dismiss(id) {
  const before = toasts.length;
  disarm(id);
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) notify();
}
function failed(text, message, id = "failed-" + ++seq) {
  const body = message ? `${text}: ${message}` : text;
  if (!update(id, { kind: "error", text: body, undo: null }, ERROR_MS)) {
    push({ id, kind: "error", text: body, ms: ERROR_MS });
    arm(id, ERROR_MS);
  }
}

/** A short notice that something did not work (it goes away on its own). */
export function failure(text, message = null) {
  failed(text, message);
}

/**
 * The change waits five seconds. keys ("mission:<id>", "bot:<id>"…) leave the lists at
 * once. Returns the notice id. `undone` runs when you press «Deshacer». `working` and `done`
 * are what the notice says once the change goes out and once it is made.
 */
export function later({ id, text, run, keys = [], undone = null, error = "No se pudo hacer", ms = TOAST_MS, working = null, done = null }) {
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
    // The same notice, on its way and then done (or why not).
    if (!update(toastId, { kind: "working", text: working || text, undo: null, wait: null })) push({ id: toastId, kind: "working", text: working || text });
    try {
      await run();
      update(toastId, { kind: "success", text: done || text }, DONE_MS);
    } catch (e) {
      failed(error, e?.message, toastId);
      throw e;
    } finally {
      // The server's answer (the refreshed state) now carries the change; a failure shows it again.
      show(keys);
      notify();
    }
  }, ms);
  if (paused) pauseWait(waitId);
  push({ id: toastId, kind: "later", text, ms, undo, keys, wait: waitId });
  return toastId;
}

/** The change is already made; «Deshacer» runs `undo` (the opposite call). */
export function reversible({ id, text, undo, error = "No se pudo deshacer", ms = TOAST_MS }) {
  const toastId = id || "done-" + ++seq;
  let used = false;
  const run = async () => {
    if (used) return;
    used = true;
    dismiss(toastId);
    try { await undo(); } catch (e) { failed(error, e?.message); }
  };
  push({ id: toastId, kind: "done", text, ms, undo: run });
  arm(toastId, ms);
  return toastId;
}

/**
 * A notice that follows a piece of work (sonner toast.promise): «loading» while it runs,
 * then «success» (text, or a function of the result) or «error» (with the reason).
 * Returns the same promise.
 */
export function promise(work, { id, loading, success, error = "No se pudo hacer" } = {}) {
  const toastId = id || "work-" + ++seq;
  push({ id: toastId, kind: "working", text: loading });
  disarm(toastId);
  const p = Promise.resolve(typeof work === "function" ? work() : work);
  p.then(
    (result) => update(toastId, { kind: "success", text: typeof success === "function" ? success(result) : success || loading }, DONE_MS),
    (e) => failed(typeof error === "function" ? error(e) : error, typeof error === "function" ? null : e?.message, toastId),
  );
  return p;
}

/**
 * Countdowns stop while the window is hidden or the pointer is on the notices, and go on
 * where they were (a notice you are reading never runs out under you).
 */
export function setPaused(value) {
  if (paused === !!value) return;
  paused = !!value;
  for (const t of toasts) if (t.wait) (paused ? pauseWait : resumeWait)(t.wait);
  for (const [id, t] of timers) {
    if (paused) { clearTimeout(t.timer); t.timer = null; t.left = Math.max(0, t.left - (Date.now() - t.since)); }
    else { t.since = Date.now(); t.timer = setTimeout(() => dismiss(id), t.left); }
  }
  notify();
}
export const isPaused = () => paused;

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

/** The notices now (outside React). */
export const currentToasts = () => toasts;

// For tests: start clean.
export function _reset() { for (const id of timers.keys()) disarm(id); toasts = []; hidden.clear(); paused = false; notify(); }
