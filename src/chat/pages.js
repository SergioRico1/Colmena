// The last page of each channel you read, kept in memory so opening it again (or after hovering
// it in the sidebar) paints at once while the fresh page comes. Only the newest end is kept: a
// page from the middle (a jump to an old message) is never shown in its place. Screens replace it
// with what the server says as soon as it answers, so it is never trusted beyond that first paint.
import { chat } from "./api.js";
import { mergeGhosts } from "./store.js";

const KEEP = 100; // messages per channel
const CHANNELS = 30; // channels kept, the least recently used go first
const pages = new Map(); // id → { messages, before }
const inflight = new Map();

export function cachedPage(id) {
  const p = pages.get(id);
  if (!p) return null;
  pages.delete(id); pages.set(id, p); // most recently used last
  return p;
}

/** Keeps the newest end of a channel as it was on screen (`after`: there were newer ones, skip). */
export function keepPage(id, messages, { before = false, after = false } = {}) {
  if (!id || after || !Array.isArray(messages) || !messages.length) return;
  pages.delete(id);
  pages.set(id, { messages: messages.slice(-KEEP), before: before || messages.length > KEEP });
  while (pages.size > CHANNELS) pages.delete(pages.keys().next().value);
}

/** Loads a channel's newest page ahead of time (hovering it in the sidebar). */
export function prefetchChannel(id) {
  if (!id || pages.has(id) || inflight.has(id)) return;
  const job = chat.get(`/channels/${id}/messages?limit=50`)
    .then((page) => { mergeGhosts(page.ghosts); if (!pages.has(id)) keepPage(id, page.messages, { before: page.hasBefore, after: page.hasAfter }); })
    .catch(() => {})
    .finally(() => inflight.delete(id));
  inflight.set(id, job);
}

/** A channel left (or removed): forget what was kept of it. */
export const forgetPage = (id) => { pages.delete(id); };
