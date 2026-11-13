// The palettes beyond the base tokens (src/styles/palette.css): the terminal, file kinds and
// «a medias». Inline styles use the names below (`style={{ background: TERM.bg }}`); xterm needs
// real colours, so xtermTheme() reads the current values and watchXtermTheme() re-applies them
// when the theme changes.

const v = (name) => `var(--c-${name})`;

/** The terminal: a light paper one in the light theme, a deep one in dark. */
export const TERM = Object.freeze({
  bg: v("term-bg"), fg: v("term-fg"), strong: v("term-strong"), dim: v("term-dim"),
  line: v("term-line"), hover: v("term-hover"), chip: v("term-chip"), sel: v("term-sel"),
  ok: v("term-ok"), error: v("term-error"), info: v("term-info"), wait: v("term-wait"),
});

/** File kinds: [ground, ink, mark] for a thumbnail or a chip. */
export const KIND = Object.freeze({
  doc: [v("kind-doc-bg"), v("kind-doc"), v("kind-doc")],
  xls: [v("kind-xls-bg"), v("kind-xls"), v("kind-xls-mark")],
  ppt: [v("kind-ppt-bg"), v("kind-ppt"), v("kind-ppt-mark")],
  img: [v("kind-img-bg"), v("kind-img"), v("kind-img-mark")],
  pdf: [v("kind-pdf-bg"), v("kind-pdf"), v("kind-pdf")],
  md: [v("kind-md-bg"), v("kind-md"), v("kind-md")],
  code: [v("kind-code-bg"), v("kind-code"), v("kind-code-mark")],
});

/** «A medias» (a P1 note, something slow): orange, never honey. */
export const WARN = Object.freeze({ soft: v("warn-soft"), ink: v("warn") });
/** The page of a document preview and its rules. */
export const PAPER = Object.freeze({ bg: v("paper"), line: v("paper-line") });

/** Translucent `token` (a C.* or var() string) at `pct` percent: color-mix, as tokens take no alpha suffix. */
export const tint = (token, pct) => `color-mix(in srgb, ${token} ${pct}%, transparent)`;

const XTERM = {
  background: "term-bg", foreground: "term-fg", cursor: "term-cursor", cursorAccent: "term-bg", selectionBackground: "term-sel",
  black: "ansi-black", red: "ansi-red", green: "ansi-green", yellow: "ansi-yellow", blue: "ansi-blue", magenta: "ansi-magenta", cyan: "ansi-cyan", white: "ansi-white",
  brightBlack: "ansi-bright-black", brightRed: "ansi-bright-red", brightGreen: "ansi-bright-green", brightYellow: "ansi-bright-yellow",
  brightBlue: "ansi-bright-blue", brightMagenta: "ansi-bright-magenta", brightCyan: "ansi-bright-cyan", brightWhite: "ansi-bright-white",
};

/** xterm's theme from the current CSS values (light or dark). */
export function xtermTheme() {
  if (typeof document === "undefined") return {};
  const s = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(XTERM).map(([k, name]) => [k, s.getPropertyValue("--c-" + name).trim()]));
}

/** Calls `apply(xtermTheme())` whenever <html data-theme> changes; returns the stop function. */
export function watchXtermTheme(apply) {
  if (typeof MutationObserver === "undefined") return () => {};
  const mo = new MutationObserver(() => apply(xtermTheme()));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** A person's round avatar: their colour mixed into the surface (and into the ink for the initials). */
export const personTint = (color = "#5B6680") => ({
  background: `color-mix(in oklab, ${color} var(--c-av-mix), var(--c-av-base))`,
  color: `color-mix(in oklab, ${color} var(--c-av-ink-mix), var(--c-av-ink))`,
});
