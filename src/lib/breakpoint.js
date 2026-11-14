import { useSyncExternalStore } from "react";

// Colmena's three widths (DESIGN.md › Breakpoints; styles/responsive.css says the same in CSS):
//   phone   < 640 px     one column, the sidebar is a drawer behind a top bar
//   tablet  640–1023 px  the sidebar is a folded rail, panels become overlays
//   laptop  ≥ 1024 px    the desktop layout, unchanged
// CSS cannot read custom properties inside a media query, so the numbers live here and in
// responsive.css (--bp-tablet, --bp-laptop document them on :root). Prefer CSS: use this hook
// only where a screen renders something different, not to restyle.
export const BREAKPOINTS = Object.freeze({ tablet: 640, laptop: 1024 });
export const QUERIES = Object.freeze({
  phone: `(max-width: ${BREAKPOINTS.tablet - 0.02}px)`,
  tablet: `(min-width: ${BREAKPOINTS.tablet}px) and (max-width: ${BREAKPOINTS.laptop - 0.02}px)`,
  laptop: `(min-width: ${BREAKPOINTS.laptop}px)`,
  // A finger, not a mouse: targets grow to 44 px (styles/responsive.css).
  coarse: "(pointer: coarse)",
});

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/** "phone" | "tablet" | "laptop" for the window as it is now (laptop where there is no window). */
export function currentBreakpoint() {
  if (!hasMatchMedia()) return "laptop";
  if (window.matchMedia(QUERIES.phone).matches) return "phone";
  if (window.matchMedia(QUERIES.tablet).matches) return "tablet";
  return "laptop";
}

const subscribe = (notify) => {
  if (!hasMatchMedia()) return () => {};
  const lists = [QUERIES.phone, QUERIES.tablet].map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener?.("change", notify);
  return () => { for (const l of lists) l.removeEventListener?.("change", notify); };
};

/** The current breakpoint, re-rendering when the window crosses one. */
export function useBreakpoint() {
  return useSyncExternalStore(subscribe, currentBreakpoint, () => "laptop");
}

/** Inside the desktop app (Electron's window bridge), not a plain browser. */
export const isDesktopApp = () => typeof window !== "undefined" && !!window.colmenaWindow;

/**
 * Marks <html> for the style sheets: `colmena-web` in a plain browser (Electron-only controls
 * hide, see [data-desktop-only]) and data-bp="phone|tablet|laptop" while the width changes.
 */
export function watchBreakpoint() {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  root.classList.toggle("colmena-web", !isDesktopApp());
  const set = () => { root.dataset.bp = currentBreakpoint(); };
  set();
  const off = subscribe(set);
  // The keyboard on a phone: Android resizes the page (index.html › interactive-widget), iOS only
  // shrinks the visual viewport. --app-h is the height you can see, so the frame (.c-shell) ends
  // above the keyboard and a conversation's composer stays on it.
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv || isDesktopApp()) return off;
  const fit = () => root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
  fit();
  vv.addEventListener("resize", fit);
  return () => { off(); vv.removeEventListener("resize", fit); };
}
