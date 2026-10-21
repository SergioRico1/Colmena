// Micro-animations: only for what arrives while you look (never for the history already on
// screen when a room opens), 120–240 ms, transform/opacity only. The keyframes live in
// styles/base.css (c-*), and «reduce motion» in Windows switches them all off.

const FIRST = new Map(); // key (room) → Map(id → first seen at; 0 = was there when it opened)

/**
 * Returns isNew(id): true for ids that appeared after the room was first shown, during the
 * first moments they are on screen (so the entrance plays once and is not cut by re-renders).
 */
export function freshness(key, ids) {
  let seen = FIRST.get(key);
  const now = Date.now();
  if (!seen) {
    // Still loading (nothing to show yet): what arrives first is the history, not news.
    if (!ids.some(Boolean)) return () => false;
    seen = new Map(ids.filter(Boolean).map((id) => [id, 0]));
    FIRST.set(key, seen);
  }
  for (const id of ids) if (id && !seen.has(id)) seen.set(id, now);
  return (id) => {
    const at = seen.get(id);
    return !!at && now - at < 700;
  };
}

/** Inline animation for elements that are created on demand (menus, pickers). */
export const popIn = (origin = "top") => ({ animation: "c-pop-in 120ms cubic-bezier(.2,.8,.2,1) both", transformOrigin: origin });

const LAST = new Map(); // key → { value, at }
/** «c-bump» for a counter whose value just changed (not on first sight, not on every visit). */
export function bump(key, value) {
  const now = Date.now();
  const prev = LAST.get(key);
  if (!prev) {
    LAST.set(key, { value, at: 0 });
    return "";
  }
  if (prev.value !== value) LAST.set(key, { value, at: now });
  const cur = LAST.get(key);
  return cur.at && now - cur.at < 400 ? "c-bump" : "";
}

/**
 * Folds an element away (height → 0, fades and slides right), then runs `then`. If `then`
 * fails, the element comes back. Used when you decide something and it leaves the list.
 */
export async function leave(el, then) {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!el || reduce) return then();
  el.style.height = el.offsetHeight + "px";
  void el.offsetHeight; // the start height must apply before the class
  el.classList.add("c-leaving");
  el.style.height = "0px";
  try {
    const [result] = await Promise.all([then(), new Promise((r) => setTimeout(r, 230))]);
    return result;
  } catch (error) {
    el.classList.remove("c-leaving");
    el.style.height = "";
    throw error;
  }
}
