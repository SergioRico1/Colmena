import { useEffect, useRef } from "react";

// «Close when you press outside, or on Escape», in one place: every menu, popover and the
// app's select used to carry its own copy of this effect.
//
//   useClickAway(open, ref, () => setOpen(false));
//   useClickAway(open, (target) => target.closest("[data-row-menu]"), close, { escape: false });
//
// `inside` is a ref (or a list of refs) to what counts as inside, or a function that says
// whether a pressed element is inside. Escape closes too unless `escape: false` (for menus
// that handle their own keys).

/** Whether `target` is inside: pure, so it can be tested without a document. */
export function isInside(inside, target) {
  if (!target) return false;
  if (typeof inside === "function") return !!inside(target);
  const refs = Array.isArray(inside) ? inside : [inside];
  return refs.some((r) => { const el = r && "current" in r ? r.current : r; return !!el && typeof el.contains === "function" && el.contains(target); });
}

export function useClickAway(active, inside, onAway, { escape = true, event = "mousedown" } = {}) {
  const latest = useRef({ inside, onAway });
  latest.current = { inside, onAway };
  useEffect(() => {
    if (!active) return undefined;
    const press = (e) => { if (!isInside(latest.current.inside, e.target)) latest.current.onAway(e); };
    const key = (e) => { if (e.key === "Escape") latest.current.onAway(e); };
    document.addEventListener(event, press);
    if (escape) document.addEventListener("keydown", key);
    return () => { document.removeEventListener(event, press); if (escape) document.removeEventListener("keydown", key); };
  }, [active, escape, event]);
}
