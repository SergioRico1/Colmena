import { useEffect, useState } from "react";
import { Minus, Plus, X } from "../Icon.js";
import "../../styles/conversation.css";

// The window buttons of the frameless desktop window, drawn as Colmena's three dots (design/v4
// � .dots): close, minimise, maximise; a glyph shows on hover or keyboard focus. Outside the
// desktop app they are only the drawn placeholder. (The Colmena 2 rail that lived here is gone:
// every screen has the sidebar, components/v3/Sidebar.jsx.)
export function WindowDots({ dark = false, inline = false, compact = false }) {
  const api = typeof window !== "undefined" ? window.colmenaWindow : null;
  const [hover, setHover] = useState(false);
  const [keys, setKeys] = useState(false);
  const [state, setState] = useState({ focused: true, maximized: false });
  useEffect(() => api?.onState?.(setState), [api]);
  // Colmena 4 (design/v4 › .dots): 12 px dots, 8 px apart, each in a 20 px button so it is easy to
  // hit. `compact` (the folded sidebar, 44 px of room): the same dots, 2 px apart. The dot's
  // colour follows the theme (--c-dot, styles/conversation.css); `dark`: on the dark welcome.
  const size = 12, box = (compact ? 14 : 20) + "px";
  const dot = { width: size + "px", height: size + "px", borderRadius: "var(--r-circle)", background: dark ? "rgb(var(--c-dot-on-dark-rgb, 255 255 255) / .16)" : "var(--c-dot, rgb(var(--c-ink-rgb) / .15))" };
  const row = { display: "flex", alignItems: "center", gap: "0", height: box, margin: compact ? "0" : "0 -4px", marginBottom: inline ? "0" : "10px" };
  if (!api) {
    return (
      <span aria-hidden="true" title="Zona de los botones de la ventana" style={row}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: box, height: box, display: "grid", placeItems: "center" }}><span style={dot} /></span>)}
      </span>
    );
  }
  // The glyphs show on hover and while one of the buttons has keyboard focus (a click does not keep them on).
  const shown = hover || keys;
  const glyph = { color: "var(--c-dot-glyph)", opacity: shown ? 0.7 : 0, transition: "opacity .12s ease" };
  const button = (label, name, onClick, color, Glyph) => (
    <button type="button" aria-label={name} title={label} onClick={onClick}
      style={{ width: box, height: box, padding: 0, border: 0, background: "transparent", display: "grid", placeItems: "center", cursor: "pointer", WebkitAppRegion: "no-drag" }}>
      <span style={{ ...dot, display: "grid", placeItems: "center", background: shown && state.focused ? color : dot.background, transition: "background .12s ease" }}>
        <Glyph size={10} weight="bold" style={glyph} />
      </span>
    </button>
  );
  return (
    <span role="group" aria-label="Ventana" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={(e) => setKeys(!!e.target.matches?.(":focus-visible"))} onBlur={() => setKeys(false)} style={{ ...row, WebkitAppRegion: "no-drag" }}>
      {button("Cerrar", "Cerrar Colmena", () => api.close(), "var(--c-close)", X)}
      {button("Minimizar", "Minimizar la ventana", () => api.minimize(), "var(--c-dot-hover)", Minus)}
      {button(state.maximized ? "Restaurar" : "Maximizar", state.maximized ? "Restaurar la ventana" : "Maximizar la ventana", () => api.toggleMaximize(), "var(--c-dot-hover)", Plus)}
    </span>
  );
}
