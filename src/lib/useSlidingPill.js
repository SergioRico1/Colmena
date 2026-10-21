import { useLayoutEffect, useRef, useState } from "react";

/**
 * Sliding indicator for segmented controls and tabs: the container gets `ref` and the
 * active child `data-seg-active="true"`; the returned box ({left, top, width, height})
 * positions a `.c-seg-pill` element that glides to the new option (styles/base.css).
 */
export function useSlidingPill(active) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const measure = () => {
      const el = root.querySelector('[data-seg-active="true"]');
      setBox(el ? { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight } : null);
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    return () => ro?.disconnect();
  }, [active]);
  return [ref, box];
}
