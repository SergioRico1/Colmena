// Colmena 4 colour tokens for inline styles, and the light / dark switch (docs/SCREENS.md › v4).
//
// The values live in src/styles/base.css as CSS custom properties on :root (light) and
// [data-theme="dark"]; this map only names them, so `style={{ background: C.card, color: C.text }}`
// follows the theme without a re-render. Never concatenate an alpha suffix to a token
// (`${C.text}22` breaks): use `alpha("ink", .08)` or color-mix().
//
// The theme: settings.theme is "system" (default: follows prefers-color-scheme), "light" or "dark".
// public/theme-boot.js applies the last choice (mirrored in localStorage) before the first paint;
// useThemeSync() keeps <html data-theme> in step with the setting and the system, and tells the
// desktop window (window background, native theme) so a resize or a new window never flashes.

/** Every colour token, as the `var(--c-…)` string inline styles take. */
export const C = Object.freeze({
  // surfaces
  app: "var(--c-app)",
  sidebar: "var(--c-sidebar)",
  sidebarHover: "var(--c-sidebar-hover)",
  selected: "var(--c-selected)",
  panel: "var(--c-panel)",
  card: "var(--c-card)",
  raised: "var(--c-raised)",
  sunken: "var(--c-sunken)",
  hover: "var(--c-hover)",
  chip: "var(--c-chip)",
  mine: "var(--c-mine)",
  // the Colmena 3 paper ground (borderless white cards sit on it); v4 screens use `app`
  page: "var(--c-page)",
  // text
  text: "var(--c-text)",
  text2: "var(--c-text-2)",
  text3: "var(--c-text-3)",
  text4: "var(--c-text-4)",
  onAccent: "var(--c-on-accent)",
  // lines
  line: "var(--c-line)",
  lineStrong: "var(--c-line-strong)",
  // accent and focus
  accent: "var(--c-accent)",
  accentInk: "var(--c-accent-ink)",
  accentSoft: "var(--c-accent-soft)",
  focus: "var(--c-focus)",
  // honey: only «te necesita»
  honey: "var(--c-honey)",
  honeyRing: "var(--c-honey-ring)",
  honeySoft: "var(--c-honey-soft)",
  honeyInk: "var(--c-honey-ink)",
  honeyText: "var(--c-honey-text)",
  // neutral unread count
  unreadBg: "var(--c-unread-bg)",
  unreadFg: "var(--c-unread-fg)",
  // status
  ok: "var(--c-ok)",
  okInk: "var(--c-ok-ink)",
  okSoft: "var(--c-ok-soft)",
  error: "var(--c-error)",
  errorSoft: "var(--c-error-soft)",
  // the ink primary button
  btn: "var(--c-btn)",
  btnText: "var(--c-btn-text)",
  btnHover: "var(--c-btn-hover)",
  // shadows
  shadowPop: "var(--c-shadow-pop)",
  shadowLift: "var(--c-shadow-lift)",
  // misc
  scroll: "var(--c-scroll)",
  cut: "var(--c-cut)",
});

/** A translucent ink (hairlines, hovers on any surface): `alpha(.08)` → rgb(var(--c-ink-rgb) / .08). */
export const alpha = (a) => `rgb(var(--c-ink-rgb) / ${a})`;
/** A border in one go: `line()` → "1px solid var(--c-line)". */
export const line = (strong = false, width = 1) => `${width}px solid ${strong ? C.lineStrong : C.line}`;

/** The window background before the page paints (desktop/main.cjs keeps the same two values). */
export const WINDOW_BG = Object.freeze({ light: "#FFFFFF", dark: "#1A1B21" });

export const THEMES = ["system", "light", "dark"];
const KEY = "colmena.theme";
const valid = (mode) => (THEMES.includes(mode) ? mode : "system");

/** "light" | "dark" for a setting, given whether the system prefers dark. */
export const resolveTheme = (mode, systemDark = false) => {
  const m = valid(mode);
  return m === "system" ? (systemDark ? "dark" : "light") : m;
};

const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

/** Puts the theme on <html> now, remembers the choice for the next start and tells the desktop window. */
export function applyTheme(mode) {
  if (typeof document === "undefined") return "light";
  const m = valid(mode);
  const resolved = resolveTheme(m, systemDark());
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  if (root.dataset.themeMode !== m) root.dataset.themeMode = m;
  try { localStorage.setItem(KEY, m); } catch { /* private window: the setting still applies */ }
  try { window.colmenaWindow?.setTheme?.(m); } catch { /* not the desktop app */ }
  return resolved;
}

/** The choice remembered on this computer (what theme-boot.js read), for the first render. */
export function storedTheme() {
  try { return valid(localStorage.getItem(KEY)); } catch { return "system"; }
}

/**
 * Keeps <html data-theme> in step with `mode` (settings.theme) and, for "system", with the
 * operating system. Call once, high in the tree.
 */
export function watchTheme(mode) {
  applyTheme(mode);
  if (valid(mode) !== "system" || typeof matchMedia !== "function") return () => {};
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const on = () => applyTheme("system");
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
}
