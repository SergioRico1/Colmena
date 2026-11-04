import { navigate } from "../../lib/router.jsx";
import { shapeOf } from "../v2/Presence.jsx";

// Colmena 3 · the head of «Trabajo» (design/V3Tareas, V3Rutinas, V3Objetivos): the place's
// title, the one sentence that explains it, the main action on the right and the three tabs
// ordered by time — once (Tareas), every so often (Rutinas), long term (Objetivos).

export const TRABAJO_TABS = [
  { id: "tareas", label: "Tareas", hint: "una vez", href: "/trabajo" },
  { id: "rutinas", label: "Rutinas", hint: "se repiten", href: "/trabajo/rutinas" },
  { id: "objetivos", label: "Objetivos", hint: "a largo plazo", href: "/trabajo/objetivos" },
];

/** The page column every Trabajo screen sits in (the boards' <main>). */
export const trabajoMain = (maxWidth = "1180px") => ({ maxWidth, margin: "0 auto", padding: "44px clamp(20px, 4vw, 48px) 64px", display: "flex", flexDirection: "column", gap: "24px" });

const go = (href) => (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  navigate(href);
};

/** `tab`: tareas | rutinas | objetivos. `action`: { label, onClick } for the ink button. `counts`: optional { tareas: n, … }. */
export default function TrabajoHeader({ tab, action = null, counts = null }) {
  return (
    <>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h1 style={{ margin: 0, font: "600 44px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>Trabajo</h1>
          <p style={{ margin: 0, fontSize: "16px", color: "#4A4D57" }}>Todo lo que hacen tus bots: una vez, cada cierto tiempo o a largo plazo.</p>
        </div>
        {action ? (
          <button type="button" onClick={action.onClick} style={{ height: "44px", padding: "0 20px", display: "inline-flex", alignItems: "center", gap: "8px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {action.label}
          </button>
        ) : null}
      </header>
      <nav aria-label="Partes de Trabajo" style={{ display: "flex", gap: "4px", borderBottom: "1px solid rgba(18,19,26,.1)", overflowX: "auto" }}>
        {TRABAJO_TABS.map((t) => {
          const on = t.id === tab;
          const n = counts?.[t.id];
          return (
            <a key={t.id} href={t.href} onClick={go(t.href)} aria-current={on ? "page" : undefined}
              style={{ flex: "none", height: "44px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", ...(on ? { borderBottom: "2px solid #12131A", marginBottom: "-1px" } : {}), color: on ? "#12131A" : "#4A4D57", fontSize: "15px", fontWeight: on ? 600 : 500 }}>
              {t.label}
              <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{t.hint}</span>
              {n ? <span style={{ minWidth: "20px", height: "20px", padding: "0 6px", display: "grid", placeItems: "center", borderRadius: "10px", background: "#EBEBE6", fontSize: "11.5px", fontWeight: 600, color: "#12131A", fontVariantNumeric: "tabular-nums" }}>{n}</span> : null}
            </a>
          );
        })}
      </nav>
    </>
  );
}

/** A bot as the boards draw it at small sizes: its flat shape, breathing while it works. */
export function BotDot({ bot, size = 14, work = false, style = null }) {
  const { clip, radius } = shapeOf(bot);
  return <span aria-hidden="true" style={{ flex: "none", display: "inline-block", width: size + "px", height: size + "px", background: bot?.color || "#C9CBD1", clipPath: clip, borderRadius: radius, ...(work ? { animation: "breathe 2.4s ease-in-out infinite" } : {}), ...style }} />;
}
