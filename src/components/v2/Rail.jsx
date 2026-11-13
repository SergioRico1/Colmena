import { useEffect, useState } from "react";
import { useStore } from "../../lib/store.jsx";
import { needsCount } from "./needs.js";
import { Archive as ArchiveIcon, CodeXml, Hexagon, MessageSquare, Minus, Plus, Repeat, Sun, X } from "../Icon.js";

// The narrow rail of Colmena 2.0 (design/V2Hoy.dc.html and every v2 board): five places with
// their icon and name, the current one as a white piece; your avatar (Ajustes) at the bottom.
// Asking lives in Hoy, and anywhere with Ctrl+K («Buscar o pedir»), so it has no place here. It never scrolls with the content. Icons are Phosphor's (../Icon.js).
// In the desktop app the three dots at the top are the window buttons (close, minimise,
// maximise); elsewhere they are only the drawn placeholder.
export const PLACES = [
  { id: "hoy", href: "/", label: ["Hoy"], icon: Sun },
  { id: "conversaciones", href: "/conversaciones", label: ["Chats"], icon: MessageSquare },
  { id: "codigo", href: "/codigo", label: ["Código"], icon: CodeXml },
  { id: "colmena", href: "/colmena", label: ["Colmena"], icon: Hexagon },
  { id: "rutinas", href: "/rutinas", label: ["Rutinas"], icon: Repeat },
  { id: "archivo", href: "/archivo", label: ["Archivo"], icon: ArchiveIcon },
];

const piece = { position: "relative", width: "72px", display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", padding: "8px 0 7px", borderRadius: "var(--r-lg)" };
const on = { background: "var(--c-card)", color: "var(--c-text)", boxShadow: "0 1px 2px rgba(18,19,26,.08), 0 6px 14px -8px rgba(18,19,26,.3)" };
const off = { background: "transparent", color: "var(--c-text-2)" };

/** Close · minimise · maximise as the three drawn dots; a glyph shows on hover. */
/** The window buttons (close, minimise, maximise); `dark` on the dark welcome screens. */
export function WindowDots({ dark = false, inline = false, compact = false }) {
  const api = typeof window !== "undefined" ? window.colmenaWindow : null;
  const [hover, setHover] = useState(false);
  const [keys, setKeys] = useState(false);
  const [state, setState] = useState({ focused: true, maximized: false });
  useEffect(() => api?.onState?.(setState), [api]);
  // 14 px dots inside 20 px buttons: easy to see and to hit, 8 px apart. `compact` (the
  // folded sidebar, 44 px of room): 12 px dots in 14 px buttons.
  const size = compact ? 12 : 14, box = (compact ? 14 : 20) + "px";
  const dot = { width: size + "px", height: size + "px", borderRadius: "var(--r-circle)", background: dark ? "rgba(255,255,255,.16)" : "rgb(var(--c-ink-rgb) / .14)" };
  const row = { display: "flex", alignItems: "center", gap: "2px", height: box, margin: compact ? "0 -1px" : "0 -3px", marginBottom: inline ? "0" : "10px" };
  if (!api) {
    return (
      <span aria-hidden="true" title="Zona de los botones de la ventana" style={row}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: box, height: box, display: "grid", placeItems: "center" }}><span style={dot} /></span>)}
      </span>
    );
  }
  // The glyphs show on hover and while one of the buttons has keyboard focus (a click does not keep them on).
  const shown = hover || keys;
  const glyph = { color: "#12131A", opacity: shown ? 0.7 : 0, transition: "opacity .12s ease" };
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
      {button("Cerrar", "Cerrar Colmena", () => api.close(), "#E5484D", X)}
      {button("Minimizar", "Minimizar la ventana", () => api.minimize(), "rgba(18,19,26,.28)", Minus)}
      {button(state.maximized ? "Restaurar" : "Maximizar", state.maximized ? "Restaurar la ventana" : "Maximizar la ventana", () => api.toggleMaximize(), "rgba(18,19,26,.28)", Plus)}
    </span>
  );
}

export default function Rail({ active = "hoy" }) {
  const store = useStore();
  const needs = needsCount(store);
  const mentioned = (store.notifications || []).some((n) => !n.read && n.missionId && (n.kind === "mention" || n.kind === "message"));
  return (
    <nav aria-label="Lugares de Colmena" style={{ position: "relative", zIndex: "40", flex: "none", width: "84px", height: "100%", minHeight: "560px", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "14px 0 16px", background: "var(--c-chip)", borderRight: "1px solid rgb(var(--c-ink-rgb) / .07)", WebkitAppRegion: "drag" }}>
      <WindowDots />
      <a href="/" aria-label="Colmena" style={{ width: "48px", height: "48px", marginBottom: "12px", display: "grid", placeItems: "center", WebkitAppRegion: "no-drag" }}>
        <img src="/colmena-icon-128.png" alt="" width="38" height="38" style={{ display: "block", width: "38px", height: "38px", filter: "drop-shadow(0 3px 6px rgba(201,120,0,.35))" }} />
      </a>
      {PLACES.map((p) => {
        const current = p.id === active;
        return (
          <a key={p.id} href={p.href} aria-current={current ? "page" : undefined} style={{ ...piece, ...(current ? on : off), WebkitAppRegion: "no-drag" }}>
            <p.icon size={22} active={current} />
            <span style={{ fontSize: "var(--t-micro)", lineHeight: "1.15", fontWeight: current ? "600" : "500", textAlign: "center", letterSpacing: "0.01em" }}>
              {p.label.map((l, i) => <span key={i}>{i ? <br /> : null}{l}</span>)}
            </span>
            {p.id === "hoy" && needs > 0 ? (
              <span aria-label={needs === 1 ? "1 cosa te espera" : `${needs} cosas te esperan`} style={{ position: "absolute", top: "2px", right: "8px", minWidth: "18px", height: "18px", padding: "0 5px", borderRadius: "var(--r-pill)", background: "var(--c-honey)", color: "var(--c-honey-ink)", font: "600 var(--t-micro)/18px 'Geist', sans-serif", textAlign: "center", boxShadow: "0 0 0 2px #EBEBE6" }}>{needs}</span>
            ) : null}
            {p.id === "conversaciones" && mentioned && !current ? (
              <span aria-label="Te han escrito" style={{ position: "absolute", top: "6px", right: "16px", width: "9px", height: "9px", borderRadius: "var(--r-circle)", background: "#12131A", boxShadow: "0 0 0 2px #EBEBE6" }} />
            ) : null}
          </a>
        );
      })}
      <span style={{ flex: "1" }} />
      <a href="/ajustes" aria-label="Tu cuenta y ajustes" aria-current={active === "ajustes" ? "page" : undefined} style={{ width: "72px", display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", padding: "8px 0 2px", borderRadius: "var(--r-lg)", color: "var(--c-text-2)", WebkitAppRegion: "no-drag", ...(active === "ajustes" ? on : {}) }}>
        <span aria-hidden="true" style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "var(--c-btn)", color: "var(--c-btn-text)", font: "600 var(--t-micro)/1 'Geist', sans-serif" }}>{"TÚ"}</span>
        <span style={{ fontSize: "var(--t-micro)", fontWeight: "500" }}>{"Ajustes"}</span>
      </a>
    </nav>
  );
}
