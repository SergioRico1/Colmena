// A card that opens next to what you clicked (a bot's card, a person's quick card): placed under
// it or above it, kept on screen, closed by a click outside or Escape (focus goes back).
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** {box, place}: put `ref={box}` on the card and `place` ({left, top, w}) in its style. */
export function usePopover(anchor, onClose, { width = 340, again = null } = {}) {
  const box = useRef(null);
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    const at = () => {
      const r = anchor?.getBoundingClientRect?.();
      const w = Math.min(width, window.innerWidth - 16);
      const h = Math.min(box.current?.offsetHeight || 480, window.innerHeight - 16);
      if (!r) return setPlace({ left: (window.innerWidth - w) / 2, top: 8, w });
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      setPlace({ left, top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h), w });
    };
    at();
    // Once more after the first paint: the card's real height is known then.
    const raf = requestAnimationFrame(at);
    window.addEventListener("resize", at);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", at); };
  }, [anchor, width, again]);
  useEffect(() => {
    const down = (e) => { if (box.current && !box.current.contains(e.target) && !anchor?.contains?.(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); anchor?.focus?.(); } };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);
  return { box, place };
}

export const placeStyle = (place, w = true) => (place ? { left: place.left + "px", top: place.top + "px", ...(w ? { width: place.w + "px" } : {}) } : { visibility: "hidden" });
