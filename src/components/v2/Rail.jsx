import { useEffect, useState } from "react";
import { useStore } from "../../lib/store.jsx";
import { needsCount } from "./needs.js";

// The narrow rail of Colmena 2.0 (design/V2Hoy.dc.html and every v2 board): five places with
// their icon and name, the current one as a white piece; your avatar (Ajustes) at the bottom.
// Asking lives in Hoy, and anywhere with Ctrl+K («Buscar o pedir»), so it has no place here. It never scrolls with the content. Icons are the ones drawn on the boards.
// In the desktop app the three dots at the top are the window buttons (close, minimise,
// maximise); elsewhere they are only the drawn placeholder.
export const PLACES = [
  { id: "hoy", href: "/", label: ["Hoy"], icon: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></> },
  { id: "conversaciones", href: "/conversaciones", label: ["Chats"], icon: <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6.5L6 19.5V16h0a2.5 2.5 0 0 1-1.5-2.3z" /> },
  // «Código» (design/V2Codigo.dc.html): Lucide code-xml.
  { id: "codigo", href: "/codigo", label: ["Código"], icon: <><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></> },
  { id: "colmena", href: "/colmena", label: ["Colmena"], icon: <path d="M8 3.8h8l4 8.2-4 8.2H8l-4-8.2z" /> },
  { id: "rutinas", href: "/rutinas", label: ["Rutinas"], icon: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.8 4.5v3.6h-3.6" /><path d="M12 8.2V12l2.6 1.6" /></> },
  { id: "archivo", href: "/archivo", label: ["Archivo"], icon: <><path d="M4 7.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" /><path d="M3 4h18v3.5H3z" /><path d="M9.5 11.5h5" /></> },
];

const piece = { position: "relative", width: "72px", display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", padding: "8px 0 7px", borderRadius: "16px" };
const on = { background: "#FFFFFF", color: "#12131A", boxShadow: "0 1px 2px rgba(18,19,26,.08), 0 6px 14px -8px rgba(18,19,26,.3)" };
const off = { background: "transparent", color: "#4A4D57" };

/** Close · minimise · maximise as the three drawn dots; a glyph shows on hover. */
/** The window buttons (close, minimise, maximise); `dark` on the dark welcome screens. */
export function WindowDots({ dark = false }) {
  const api = typeof window !== "undefined" ? window.colmenaWindow : null;
  const [hover, setHover] = useState(false);
  const [state, setState] = useState({ focused: true, maximized: false });
  useEffect(() => api?.onState?.(setState), [api]);
  const dot = { width: "11px", height: "11px", borderRadius: "50%", background: dark ? "rgba(255,255,255,.16)" : "rgba(18,19,26,.14)" };
  if (!api) {
    return (
      <span aria-hidden="true" title="Zona de los botones de la ventana" style={{ display: "flex", gap: "6px", height: "14px", marginBottom: "14px" }}>
        <span style={dot} /><span style={dot} /><span style={dot} />
      </span>
    );
  }
  const glyph = { width: "7px", height: "7px", fill: "none", stroke: "#12131A", strokeWidth: 3, strokeLinecap: "round", opacity: hover ? 0.7 : 0, transition: "opacity .12s ease" };
  const button = (label, onClick, color, path) => (
    <button type="button" tabIndex={-1} aria-label={label} title={label} onClick={onClick}
      style={{ ...dot, padding: 0, border: 0, display: "grid", placeItems: "center", cursor: "pointer", WebkitAppRegion: "no-drag", background: hover && state.focused ? color : dot.background, transition: "background .12s ease" }}>
      <svg viewBox="0 0 10 10" style={glyph} aria-hidden="true">{path}</svg>
    </button>
  );
  return (
    <span role="group" aria-label="Ventana" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: "flex", gap: "6px", height: "14px", marginBottom: "14px", WebkitAppRegion: "no-drag" }}>
      {button("Cerrar", () => api.close(), "#FFC93C", <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />)}
      {button("Minimizar", () => api.minimize(), "rgba(18,19,26,.28)", <path d="M2 5h6" />)}
      {button(state.maximized ? "Restaurar" : "Maximizar", () => api.toggleMaximize(), "rgba(18,19,26,.28)", <path d="M2.5 5h5M5 2.5v5" />)}
    </span>
  );
}

export default function Rail({ active = "hoy" }) {
  const store = useStore();
  const needs = needsCount(store);
  const mentioned = (store.notifications || []).some((n) => !n.read && n.missionId && (n.kind === "mention" || n.kind === "message"));
  return (
    <nav aria-label="Lugares de Colmena" style={{ position: "relative", zIndex: "40", flex: "none", width: "84px", height: "100%", minHeight: "560px", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "14px 0 16px", background: "#EBEBE6", borderRight: "1px solid rgba(18,19,26,.07)", WebkitAppRegion: "drag" }}>
      <WindowDots />
      <a href="/" aria-label="Colmena" style={{ width: "48px", height: "48px", marginBottom: "12px", display: "grid", placeItems: "center", WebkitAppRegion: "no-drag" }}>
        <img src="/colmena-icon-128.png" alt="" width="38" height="38" style={{ display: "block", width: "38px", height: "38px", filter: "drop-shadow(0 3px 6px rgba(201,120,0,.35))" }} />
      </a>
      {PLACES.map((p) => {
        const current = p.id === active;
        return (
          <a key={p.id} href={p.href} aria-current={current ? "page" : undefined} style={{ ...piece, ...(current ? on : off), WebkitAppRegion: "no-drag" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.icon}</svg>
            <span style={{ fontSize: "11px", lineHeight: "1.15", fontWeight: current ? "600" : "500", textAlign: "center", letterSpacing: "0.01em" }}>
              {p.label.map((l, i) => <span key={i}>{i ? <br /> : null}{l}</span>)}
            </span>
            {p.id === "hoy" && needs > 0 ? (
              <span aria-label={needs === 1 ? "1 cosa te espera" : `${needs} cosas te esperan`} style={{ position: "absolute", top: "2px", right: "8px", minWidth: "18px", height: "18px", padding: "0 5px", borderRadius: "9px", background: "#FFC93C", color: "#12131A", font: "600 10px/18px 'Geist', sans-serif", textAlign: "center", boxShadow: "0 0 0 2px #EBEBE6" }}>{needs}</span>
            ) : null}
            {p.id === "conversaciones" && mentioned && !current ? (
              <span aria-label="Te han escrito" style={{ position: "absolute", top: "6px", right: "16px", width: "9px", height: "9px", borderRadius: "50%", background: "#12131A", boxShadow: "0 0 0 2px #EBEBE6" }} />
            ) : null}
          </a>
        );
      })}
      <span style={{ flex: "1" }} />
      <a href="/ajustes" aria-label="Tu cuenta y ajustes" aria-current={active === "ajustes" ? "page" : undefined} style={{ width: "72px", display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", padding: "8px 0 2px", borderRadius: "16px", color: "#4A4D57", WebkitAppRegion: "no-drag", ...(active === "ajustes" ? on : {}) }}>
        <span aria-hidden="true" style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#12131A", color: "#FFFFFF", font: "600 11px/1 'Geist', sans-serif" }}>{"TÚ"}</span>
        <span style={{ fontSize: "11px", fontWeight: "500" }}>{"Ajustes"}</span>
      </a>
    </nav>
  );
}
