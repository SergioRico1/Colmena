// The one radius scale of the app. The same steps live in styles/base.css as custom
// properties (--r-<name>); tests/radius-scale.test.mjs keeps the two in step.
//
//   inline styles   borderRadius: "var(--r-md)"   ·   borderRadius: "var(--r-pill)"
//   a radius computed from a size (a portrait tile)   radiusOf(n) + "px"
//
// Seven corner sizes on a 4 px grid, plus the two shapes that are not a size: a pill (as
// round as its height allows) and a circle. A box whose radius is half its height is a pill.
// Bot shapes keep their own geometry (lib/bots.js, components/v2/Presence.jsx): they are
// identity, not corners.

/** name → radius in px. */
export const RADIUS = {
  xs: 4, //    ticks, swatches, bars, the smallest marks
  sm: 8, //    chips, keys, rows of a menu, small buttons
  md: 12, //   fields, buttons, menus
  lg: 16, //   small cards, bubbles, popovers
  xl: 20, //   cards
  "2xl": 24, // panels, large cards
  "3xl": 32, // sheets and dialogs
};
export const PILL = "999px";
export const CIRCLE = "50%";

/** name → the custom property, for inline styles: R.md === "var(--r-md)". */
export const R = { ...Object.fromEntries(Object.keys(RADIUS).map((name) => [name, `var(--r-${name})`])), pill: "var(--r-pill)", circle: "var(--r-circle)" };

const STEPS = Object.entries(RADIUS).sort((a, b) => a[1] - b[1]);

/** The step a radius belongs to: its name. The nearest, and the larger one on a tie (10 → 12). */
export function radiusToken(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return "md";
  let best = STEPS[0];
  for (const step of STEPS) {
    const d = Math.abs(step[1] - n), b = Math.abs(best[1] - n);
    if (d < b || (d === b && step[1] > best[1])) best = step;
  }
  return best[0];
}

/** The radius, in px, of the step a value belongs to: radiusOf(10) === 12, radiusOf(26) === 24. */
export const radiusOf = (px) => RADIUS[radiusToken(px)];

/** Every radius in px the app used before there was a scale (the census of 2026-11-13). */
export const LEGACY_RADII = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 31, 32];
