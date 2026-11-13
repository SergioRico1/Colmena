import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "./Icon.js";
import { LogoMark, LOGO_FONT } from "./Logo.jsx";
import "../styles/conversation.css";

/** The app's ground from the theme (what shows when nothing else has a colour). */
const appGround = () => getComputedStyle(document.documentElement).getPropertyValue("--c-app").trim() || "transparent";

// Colmena's own title bar for the frameless desktop window: a draggable strip that
// takes, column by column, the colour of whatever sits right below it (dark sidebar,
// each screen's background, the green bot header…) plus the window buttons drawn
// with Colmena's style sheet. Only rendered inside the desktop app (window.colmenaWindow).
export const TITLEBAR_HEIGHT = 36;

const transparent = (c) => !c || c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
function colorAt(x, y) {
  let el = document.elementFromPoint(x, y);
  while (el && el !== document.documentElement) {
    if (!el.closest?.("[data-window-chrome]")) {
      const bg = getComputedStyle(el).backgroundColor;
      if (!transparent(bg)) return bg;
    }
    el = el.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor || appGround();
}

/** Background of an element, looking up through transparent ancestors. */
function backgroundOf(el) {
  while (el && el !== document.documentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (!transparent(bg)) return bg;
    el = el.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor || appGround();
}
const scrollable = (el) => el && el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);

/**
 * The bar copies the screen's own column layout (same flex rules, gaps and padding),
 * so the browser places every edge on exactly the same device pixel as the columns
 * below, at any display scaling. Each cell takes its column's colour: what sits under
 * it while the column is at the top, its own background (plus a shadow) once scrolled.
 */
function layout() {
  const y = TITLEBAR_HEIGHT + 2;
  // The screen itself, never a floating layer (the right-click menu, a dialog, a toast)
  // that may sit before it under #root: those would paint the whole bar one colour.
  const root = [...document.querySelectorAll("#root > div")].find((el) => !el.hasAttribute("data-window-chrome") && getComputedStyle(el).position !== "fixed");
  if (!root) return { row: null, cells: [] };
  const rs = getComputedStyle(root);
  const isRow = rs.display.includes("flex") && rs.flexDirection.startsWith("row");
  const columns = isRow ? [...root.children].filter((c) => c.tagName !== "STYLE" && getComputedStyle(c).position !== "fixed" && getComputedStyle(c).display !== "none") : [root];
  const cells = columns.map((col) => {
    const cs = getComputedStyle(col);
    const r = col.getBoundingClientRect();
    const firstLine = r.top <= TITLEBAR_HEIGHT + 1 && r.bottom > TITLEBAR_HEIGHT;
    // The column itself, or (chats) its body, or the page root: whichever scrolls.
    let scroller = scrollable(col) ? col : null;
    if (!scroller) { const inner = scrollerUnder(r.left + r.width / 2, y); if (inner && col.contains(inner) && inner.getBoundingClientRect().top <= TITLEBAR_HEIGHT + 1) scroller = inner; }
    if (!scroller && !isRow && scrollable(root)) scroller = root;
    const scrolled = !!scroller && scroller.scrollTop > 0;
    const cx = Math.min(innerWidth - 2, Math.max(1, r.left + r.width / 2));
    // A sticky bar (a profile's tabs) stays under the title bar: take its colour. Plain
    // scrolled content does not (its colour changes as it moves): the column's background.
    const color = !scrolled || pinnedAt(cx, y) ? colorAt(cx, y) : backgroundOf(scroller);
    return {
      flex: isRow ? cs.flexGrow + " " + cs.flexShrink + " " + cs.flexBasis : "1 1 auto",
      minWidth: isRow && cs.minWidth !== "auto" ? cs.minWidth : "0px",
      maxWidth: isRow ? cs.maxWidth : "none",
      boxSizing: cs.boxSizing,
      fixedWidth: isRow && cs.flexBasis === "auto" ? r.width : null,
      hidden: !firstLine,
      color,
      scrolled,
    };
  });
  return {
    row: isRow ? { gap: rs.columnGap === "normal" ? "0px" : rs.columnGap, paddingLeft: rs.paddingLeft, paddingRight: rs.paddingRight, flexWrap: rs.flexWrap } : null,
    cells,
  };
}
function pinnedAt(x, y) {
  let el = document.elementFromPoint(x, y);
  while (el && el !== document.documentElement) {
    if (el.closest?.("[data-window-chrome]")) return false;
    const pos = getComputedStyle(el).position;
    if (pos === "sticky" || pos === "fixed") return true;
    el = el.parentElement;
  }
  return false;
}
function scrollerUnder(x, y) {
  let el = document.elementFromPoint(x, y);
  while (el && el !== document.documentElement) {
    if (!el.closest?.("[data-window-chrome]") && scrollable(el)) return el;
    el = el.parentElement;
  }
  return null;
}
/** The screen already shows the Colmena mark near the top (sidebar, Bienvenida…). */
const logoVisible = () =>
  [...document.querySelectorAll('#root img[src^="/logo-mark"]')].some((p) => {
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.top < TITLEBAR_HEIGHT + 120;
  });

export default function WindowChrome() {
  const api = typeof window !== "undefined" ? window.colmenaWindow : null;
  const [state, setState] = useState({ maximized: false, fullscreen: false, focused: true });
  const [paint, setPaint] = useState({ row: null, cells: [], brand: false });

  useEffect(() => {
    if (!api) return undefined;
    document.documentElement.classList.add("colmena-desktop");
    const off = api.onState?.(setState);
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPaint(document.documentElement.dataset.v2 === "1" ? { row: null, cells: [], brand: false, v2: true } : { ...layout(), brand: !logoVisible() }));
    };
    measure();
    const late = setInterval(measure, 1500); // lazy screens and images settle a bit later
    const observer = new MutationObserver(measure);
    observer.observe(document.getElementById("root"), { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    addEventListener("resize", measure);
    addEventListener("scroll", measure, { passive: true, capture: true }); // inner columns too
    addEventListener("colmena:navigate", measure);
    addEventListener("popstate", measure);
    return () => {
      off?.();
      clearInterval(late);
      observer.disconnect();
      removeEventListener("resize", measure);
      removeEventListener("scroll", measure, { capture: true });
      removeEventListener("colmena:navigate", measure);
      removeEventListener("popstate", measure);
      document.documentElement.classList.remove("colmena-desktop");
    };
  }, [api]);

  // Screens with the sidebar draw the window buttons there, as Colmena's three dots
  // (components/v2/Rail.jsx › WindowDots, in the sidebar's title strip, which never scrolls).
  if (!api || state.fullscreen || paint.v2) return null;
  const visible = paint.cells.filter((c) => !c.hidden);
  const first = visible[0]?.color || appGround();
  // Colmena's style sheet, from the theme's tokens: transparent icon buttons; hover like a
  // raised card; close lights up red, as the system's does (honey only ever means «te necesita»).
  const rest = { background: "transparent", borderColor: "transparent", color: "var(--c-text-2)" };
  const over = { background: "var(--c-raised)", borderColor: "var(--c-line)", color: "var(--c-text)" };
  const overClose = { background: "var(--c-close)", borderColor: "var(--c-close)", color: "var(--c-badge-text)" };
  const button = { width: "36px", height: "28px", display: "grid", placeItems: "center", margin: "0", padding: "0", border: "1px solid transparent", borderRadius: "var(--r-md)", cursor: "pointer", WebkitAppRegion: "no-drag", opacity: state.focused ? 1 : 0.6, transition: "background .12s ease, border-color .12s ease, color .12s ease", ...rest };
  const paintTo = (el, look) => Object.assign(el.style, look);
  const enter = (close) => (e) => paintTo(e.currentTarget, close ? overClose : over);
  const leave = (e) => paintTo(e.currentTarget, rest);

  return (
    <div data-window-chrome="" onDoubleClick={(e) => { if (!e.target.closest("button")) api.toggleMaximize(); }} style={{ position: "fixed", top: "0", left: "0", right: "0", height: TITLEBAR_HEIGHT + "px", zIndex: 2147483000, background: first, WebkitAppRegion: "drag", userSelect: "none" }}>
      <div aria-hidden="true" style={paint.row ? { position: "absolute", inset: "0", display: "flex", flexWrap: paint.row.flexWrap, alignItems: "stretch", columnGap: paint.row.gap, paddingLeft: paint.row.paddingLeft, paddingRight: paint.row.paddingRight, overflow: "hidden" } : { position: "absolute", inset: "0", display: "flex" }}>
        {paint.cells.map((c, i) => (
          <span key={i} style={{ position: "relative", display: "block", height: "100%", flex: c.flex, minWidth: c.minWidth, maxWidth: c.maxWidth, boxSizing: c.boxSizing, ...(c.fixedWidth != null ? { width: c.fixedWidth + "px" } : {}), visibility: c.hidden ? "hidden" : "visible", background: c.color }}>
            {/* Shadow drawn as its own strip (no clip-path: a clipped edge antialiases off the pixel grid). */}
            <span style={{ position: "absolute", left: "0", right: "0", top: "100%", height: "1px", pointerEvents: "none", opacity: c.scrolled ? 1 : 0, transition: "opacity .15s ease", boxShadow: "var(--c-shadow-lift)" }} />
          </span>
        ))}
      </div>
      <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "0 6px 0 14px" }}>
        {paint.brand ? (
          <span style={{ display: "flex", alignItems: "center", gap: "8px", pointerEvents: "none" }}>
            <LogoMark size={20} />
            <span style={{ font: `800 var(--t-ui)/1 ${LOGO_FONT}`, letterSpacing: "-0.02em", color: "var(--c-text)" }}>Colmena</span>
          </span>
        ) : <span />}
        <div role="group" aria-label="Ventana" style={{ display: "flex", alignItems: "center", gap: "4px", WebkitAppRegion: "no-drag" }}>
          <button type="button" aria-label="Minimizar la ventana" title="Minimizar" onClick={() => api.minimize()} onMouseEnter={enter(false)} onMouseLeave={leave} style={button}>
            <Minus size={15} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button type="button" aria-label={state.maximized ? "Restaurar la ventana" : "Maximizar la ventana"} title={state.maximized ? "Restaurar" : "Maximizar"} aria-pressed={state.maximized ? "true" : "false"} onClick={() => api.toggleMaximize()} onMouseEnter={enter(false)} onMouseLeave={leave} style={button}>
            {state.maximized
              ? <Copy size={14} strokeWidth={2.2} aria-hidden="true" />
              : <Square size={13} strokeWidth={2.2} aria-hidden="true" />}
          </button>
          <button type="button" aria-label="Cerrar Colmena" title="Cerrar" onClick={() => api.close()} onMouseEnter={enter(true)} onMouseLeave={leave} style={button}>
            <X size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
