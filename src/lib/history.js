import { useSyncExternalStore } from "react";
import { api } from "./api.js";

// Older pages of long conversations (T3 Code history paging): a chat opens with its latest
// messages (GET /api/missions/:id) and, as you scroll up, the pages before them arrive from
// GET /api/missions/:id/history?antes=<oldest shown>. They are kept per mission while the app
// runs, so going back to a chat keeps everything you had scrolled through.
const pages = new Map(); // missionId → { messages, steps, cursor, olderCount, loading, error }
const subs = new Set();
const emit = () => { for (const fn of subs) fn(); };
const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export function olderPages(missionId) {
  return (missionId && pages.get(missionId)) || null;
}

/** The older pages of a mission (null until the first one loads). */
export function useOlderPages(missionId) {
  return useSyncExternalStore(subscribe, () => olderPages(missionId), () => null);
}

const byId = (list) => new Map(list.map((x) => [x.id, x]));

/**
 * Loads the page before `cursor` (the oldest message shown). Resolves to the new state, or
 * null when there is nothing older or a page is already on its way.
 */
export async function loadOlder(missionId, cursor) {
  const prev = olderPages(missionId);
  const from = prev?.cursor ?? cursor;
  if (!missionId || !from || prev?.loading) return null;
  pages.set(missionId, { messages: [], steps: [], olderCount: 0, ...prev, cursor: from, loading: true, error: null });
  emit();
  try {
    const page = await api(`/missions/${encodeURIComponent(missionId)}/history?antes=${encodeURIComponent(from)}`);
    const cur = pages.get(missionId);
    const have = new Set(cur.messages.map((m) => m.id));
    const steps = byId(page.steps || []);
    for (const s of cur.steps) steps.set(s.id, s);
    const next = { messages: [...(page.messages || []).filter((m) => !have.has(m.id)), ...cur.messages], steps: [...steps.values()], cursor: page.cursor ?? null, olderCount: page.olderCount || 0, loading: false, error: null };
    pages.set(missionId, next);
    emit();
    return next;
  } catch (error) {
    pages.set(missionId, { ...pages.get(missionId), loading: false, error: error.message });
    emit();
    return null;
  }
}

/**
 * The recent window moved on (new messages arrived and a refetch brought a later window):
 * what fell out of it joins the older pages, so nothing goes missing in between.
 */
export function carryOver(missionId, dropped = [], steps = []) {
  const cur = olderPages(missionId);
  if (!cur || (!dropped.length && !steps.length)) return;
  const have = new Set(cur.messages.map((m) => m.id));
  const all = byId(cur.steps);
  for (const s of steps) if (!all.has(s.id)) all.set(s.id, s);
  pages.set(missionId, { ...cur, messages: [...cur.messages, ...dropped.filter((m) => !have.has(m.id))], steps: [...all.values()] });
  emit();
}

/** Joins the older pages and the recent window into one timeline, oldest first. */
export function joinPages(older, recent = { messages: [], steps: [] }) {
  if (!older) return recent;
  const shown = new Set(recent.messages.map((m) => m.id));
  // The older steps go first, in the order they started; the recent ones keep their order.
  const latest = new Set(recent.steps.map((s) => s.id));
  const when = (s) => s.startedAt || "";
  const before = older.steps.filter((s) => !latest.has(s.id)).sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0));
  return { messages: [...older.messages.filter((m) => !shown.has(m.id)), ...recent.messages], steps: [...before, ...recent.steps] };
}

/** For tests. */
export function resetPages() {
  pages.clear();
  emit();
}
