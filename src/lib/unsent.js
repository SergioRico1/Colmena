import { useSyncExternalStore } from "react";

// Messages that did not reach their room (OpenClaw unsent list): they are kept on this
// computer until you retry or discard them, so a reload or a lost connection never eats
// what you wrote. They show in their conversation (marked «No se envió») and, all together,
// in the Bandeja under «No se enviaron». At most 30, newest first; attachments are not kept.
const KEY = "colmena:unsent:v1";
const MAX = 30;
const subs = new Set();

let list = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((u) => u && u.id && u.missionId && typeof u.text === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
})();

function commit(next) {
  list = next.slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  for (const fn of subs) fn();
}

/** {id, missionId, text, error, at}: the message that failed. */
export function addUnsent(entry) {
  if (!entry?.id || !entry.missionId || !String(entry.text || "").trim()) return;
  commit([{ ...entry, at: entry.at || new Date().toISOString() }, ...list.filter((u) => u.id !== entry.id)]);
}

export function removeUnsent(id) {
  if (list.some((u) => u.id === id)) commit(list.filter((u) => u.id !== id));
}

export function unsentOf(missionId) {
  return list.filter((u) => u.missionId === missionId);
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const snapshot = () => list;

/** The whole list, kept current. */
export function useUnsent() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
