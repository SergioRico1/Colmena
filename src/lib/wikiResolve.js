import { useSyncExternalStore } from "react";
import { post } from "./api.js";

// The `[[links]]` of chat messages, deliverables and notes → which note each one names
// (POST /api/wiki/resolve). Asked for in batches (every link drawn in the same moment goes in
// one call) and kept: the same name is never asked twice. When the notes change (the server
// says so on /api/events, lib/store.jsx repeats it as «colmena:changed») what is on screen is
// asked again, and keeps showing what it had meanwhile.

const MAX = 300; // per call (docs/CONTRACT.md §16)
const known = new Map(); // name as written → {slug, exists, title, archived, alias?}
const wanted = new Set();
const subs = new Set();
let timer = null;
let version = 0;

const emit = () => { version++; for (const fn of subs) fn(); };
async function flush() {
  timer = null;
  const targets = [...wanted].slice(0, MAX);
  for (const t of targets) wanted.delete(t);
  if (wanted.size) timer = setTimeout(flush, 0);
  if (!targets.length) return;
  try {
    const { results = {} } = await post("/wiki/resolve", { targets });
    for (const t of targets) if (results[t]) known.set(t, results[t]);
    emit();
  } catch { /* the links stay as plain links to the note's address */ }
}
function ask(target) {
  if (!target || target.length > 300 || wanted.has(target)) return;
  wanted.add(target);
  if (!timer) timer = setTimeout(flush, 16);
}
/** Forget what is known: every link on screen is asked again (they keep their answer meanwhile). */
export function refreshNoteLinks() {
  if (known.size > 2 * MAX) { known.clear(); emit(); return; }
  for (const t of known.keys()) ask(t);
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("colmena:changed", (e) => { if ((e.detail?.kinds || []).some((k) => k === "wikiPages")) refreshNoteLinks(); });
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const snapshot = () => version;
/** What a link names: {slug, exists, title, archived} once the server has said; null before. */
export function useNoteTarget(target) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const hit = known.get(target) || null;
  if (!hit && typeof window !== "undefined") ask(target);
  return hit;
}
/** For tests: what is known, set by hand. */
export function primeNoteTargets(results) {
  for (const [k, v] of Object.entries(results || {})) known.set(k, v);
  emit();
}
