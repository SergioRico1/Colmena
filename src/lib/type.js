// The one type scale of the app. The same steps live in styles/base.css as custom
// properties (--t-<name> and --lh-<name>); tests/type-scale.test.mjs keeps the two in step.
//
//   inline styles   fontSize: "var(--t-ui)"   ·   font: "600 var(--t-heading)/1.2 'Bricolage Grotesque', sans-serif"
//   where a number is needed (a component's `size`, a canvas, a terminal)   TYPE.ui · stepOf(n)
//
// Steps are named for what they are used for, smallest to largest. Nothing is set under
// 11 px, and there are no half pixels: where two sizes half a pixel apart used to mark a
// difference, weight or colour marks it now.

/** name → [size in px, line-height]. */
export const SCALE = {
  micro: [11, 1.35], //     keyboard hints, counts in a badge, the smallest labels
  caption: [12, 1.4], //    captions, timestamps, chips
  meta: [13, 1.45], //      secondary lines under a title, table cells
  ui: [14, 1.45], //        controls, menus, list rows: the default of the interface
  body: [15, 1.5], //       running text in cards and room messages
  read: [16, 1.55], //      text you read or write at length: answers, composers, page leads
  lead: [18, 1.3], //       small titles: a card, a panel, a room
  title: [20, 1.25], //     titles of dialogs' sections and empty states
  heading: [24, 1.2], //    section headings of a page, dialog titles
  headline: [28, 1.15], //  the headline of a narrow page or a sheet
  "display-s": [34, 1.05], // big figures
  "display-m": [44, 1], //    the title of a place («Trabajo», «Biblioteca», a bot's name)
  "display-l": [64, 1.02], // the greeting on Inicio at its largest
  "display-xl": [80, 0.98], // «Bienvenida»
};

/** name → size in px (a number). */
export const TYPE = Object.fromEntries(Object.entries(SCALE).map(([name, [size]]) => [name, size]));
/** name → line-height. */
export const LEADING = Object.fromEntries(Object.entries(SCALE).map(([name, [, lh]]) => [name, lh]));
/** name → the custom property, for inline styles: T.ui === "var(--t-ui)". */
export const T = Object.fromEntries(Object.keys(SCALE).map((name) => [name, `var(--t-${name})`]));

const STEPS = Object.entries(TYPE).sort((a, b) => a[1] - b[1]);

// A size goes to the nearest step, and to the larger one when it sits exactly between two
// (13.5 → 14, 17 → 18, 22 → 24). One exception decided by hand: dialog titles were 26 and are
// «heading» like the section headings, not «headline».
const BETWEEN = { 26: 24 };

/** The step a size belongs to: its name. Any size in px, legacy ones included. */
export function tokenOf(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return "ui";
  const target = BETWEEN[n] ?? n;
  let best = STEPS[0];
  for (const step of STEPS) {
    const d = Math.abs(step[1] - target), b = Math.abs(best[1] - target);
    if (d < b || (d === b && step[1] > best[1])) best = step;
  }
  return best[0];
}

/** The size, in px, of the step a size belongs to: stepOf(13.5) === 14, stepOf(9) === 11. */
export const stepOf = (px) => TYPE[tokenOf(px)];

/**
 * Initials inside a round mark of `size` px. They are set at a step of the scale (never
 * under 11 px), so a mark too small for two letters at that size shows the first one.
 */
export const fitInitials = (text, size) => (size < 22 ? [...String(text || "")].slice(0, 1).join("") : text);

/** Every size the app used before there was a scale (the census of 2026-11-13). */
export const LEGACY_SIZES = [7, 8, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48, 52, 54, 64, 80];
