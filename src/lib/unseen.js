// «Nuevos»: what arrived in a conversation while you were not looking at its end — reading
// further up, or with the window hidden. A thin divider goes before the first of those
// messages and the «Ir al final» button says how many there are; both go once you have read
// them (you reach the end, or you write). Your own messages never count. No framework: the
// virtual list (Timeline.jsx) feeds it the rows that count and where the reader is.

export const NO_UNSEEN = Object.freeze({ first: null, count: 0 });

/**
 * The rows that came after what was already there. `prev` and `next` are the rows that count
 * ([{ key, own }], oldest first) before and after a change. Returns [] when nothing arrived
 * (also the first time: what a chat opens with is its history, and a page of older messages
 * goes before what was there), and null when the list is another one altogether (another
 * version of the conversation): whatever was marked no longer stands.
 */
export function arrivals(prev, next) {
  if (!prev.length || !next.length) return [];
  const at = new Map(next.map((r, i) => [r.key, i]));
  // The last row that is still there (a message being sent changes its key when it lands).
  let anchor = -1;
  for (let i = prev.length - 1; i >= 0 && anchor < 0; i--) if (at.has(prev[i].key)) anchor = at.get(prev[i].key);
  if (anchor < 0) return null;
  const known = new Set(prev.map((r) => r.key));
  return next.slice(anchor + 1).filter((r) => !known.has(r.key));
}

/**
 * The mark after `arrived` rows came in. `seen`: the reader has them in front (the list is
 * following the end, or the row is on screen) and the window is visible; `atEnd`: the end
 * itself is in view. Your own message means you are there: nothing is left unseen.
 */
export function unseenAfter(state, arrived, { seen = true, atEnd = seen } = {}) {
  let next = state;
  for (const row of arrived || []) {
    if (row.own) next = NO_UNSEEN;
    else if (!seen) next = { first: next.first ?? row.key, count: next.count + 1 };
    // Something new read at the end: an older mark above it has done its job.
    else if (next.count && atEnd) next = NO_UNSEEN;
  }
  return next;
}

/** «3 mensajes nuevos» on the button. */
export const unseenLabel = (count) => (count === 1 ? "1 mensaje nuevo" : `${count} mensajes nuevos`);

/**
 * Where the button takes you: to the divider while it is still further down than what you
 * see, else to the end (you are at the divider, or past it). Rows not shown yet only have a
 * guessed height, so how much comes after the divider is not asked here: a scroll to a
 * divider with less than a screen after it stops at the end on its own.
 */
export function jumpTarget({ dividerTop = null, scrollTop = 0, clientHeight }) {
  if (dividerTop === null || !Number.isFinite(dividerTop)) return "end";
  return dividerTop >= scrollTop + clientHeight ? "divider" : "end";
}

/** Whether a row (its `start` and `size` in the list) shows in the viewport. */
export function inView({ start, size }, { scrollTop, clientHeight }) {
  return start < scrollTop + clientHeight && start + size > scrollTop;
}
