import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, CornerDownLeft, Search, X } from "lucide-react";
import Shell from "../Shell.jsx";
import { navigate } from "../../../lib/router.jsx";
import { SECTIONS, SECTION_OF, searchSettings } from "./sections.js";
import { INK, MUTED, FAINT } from "./rows.jsx";

// Ajustes by sections (design/V2AjustesSecciones.dc.html): on the left, «Ajustes», a search
// box and the nine sections; on the right, the chosen one. In a narrow window it is one
// column, like the Settings of a phone: /ajustes is the list and a section opens on its own,
// with «‹ Ajustes» to go back. Detail pages (/ajustes/ia, /ajustes/conexiones…) live inside
// their section: the section stays marked and «‹ <sección>» goes back to it.

const NARROW = 940; // px of window: below it the list and the section take turns
const STYLE = `
.st-nav-item{transition:background .15s ease}
.st-nav-item:hover{background:rgba(18,19,26,.04)}
.st-nav-item[aria-current="page"]{background:#FFFFFF;box-shadow:0 1px 2px rgba(18,19,26,.05),0 8px 20px -10px rgba(18,19,26,.18)}
.st-result[data-on="1"]{background:#FFFFFF;box-shadow:0 1px 2px rgba(18,19,26,.05),0 8px 20px -10px rgba(18,19,26,.18)}
[data-setting]{transition:background .6s ease}
[data-setting][data-lit="1"]{background:rgba(18,19,26,.045)!important}
.st-back{display:none}
@media (max-width:${NARROW}px){
  .st-wrap{flex-direction:column!important}
  .st-nav{position:static!important;width:auto!important;height:auto!important;max-height:none!important;padding:40px clamp(16px,4vw,28px) 24px!important;border:0!important}
  .st-wrap[data-open="1"] .st-nav{display:none!important}
  .st-wrap[data-open="0"] .st-body{display:none!important}
  .st-wrap[data-open="0"] .st-nav-item[aria-current="page"]{background:transparent;box-shadow:none;font-weight:500!important}
  .st-back{display:inline-flex}
  .st-body{padding-top:28px!important}
}
${"@media (prefers-reduced-motion: reduce){[data-setting]{transition:none}}"}
`;

/** Scrolls to /ajustes/…#anchor and lights the setting up for a moment. */
function useAnchor(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    let timer;
    const go = () => {
      const anchor = decodeURIComponent(location.hash.slice(1));
      if (!anchor) return;
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-setting="${window.CSS?.escape ? window.CSS.escape(anchor) : anchor}"]`);
        if (!el) return;
        el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        el.dataset.lit = "1";
        clearTimeout(timer);
        timer = setTimeout(() => { delete el.dataset.lit; }, 1600);
      });
    };
    go();
    window.addEventListener("colmena:navigate", go);
    window.addEventListener("hashchange", go);
    return () => { clearTimeout(timer); window.removeEventListener("colmena:navigate", go); window.removeEventListener("hashchange", go); };
  }, [ready]);
}

function Nav({ active, dots }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef(null);
  const results = useMemo(() => searchSettings(q), [q]);
  useEffect(() => setAt(0), [q]);
  // «/» or Ctrl+F searches the settings (T3 Code), when you are not typing somewhere.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if ((e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f")) {
        e.preventDefault();
        box.current?.focus();
        box.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const open = (item) => { setQ(""); navigate(item.href); };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { if (q) { e.preventDefault(); e.stopPropagation(); setQ(""); } return; }
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => (i + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); open(results[at] || results[0]); }
  };
  return (
    <nav className="st-nav" aria-label="Secciones de Ajustes" style={{ position: "sticky", top: 0, flex: "none", width: "272px", height: "100vh", overflowY: "auto", padding: "56px 16px 24px 24px", display: "flex", flexDirection: "column", gap: "18px" }}>
      <h1 style={{ margin: "0 0 0 8px", font: "600 40px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>Ajustes</h1>
      <label style={{ display: "flex", alignItems: "center", gap: "10px", height: "44px", padding: "0 14px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.06)" }}>
        <Search size={16} strokeWidth={2.2} color={FAINT} aria-hidden="true" />
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar en Ajustes</span>
        <input ref={box} type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Buscar un ajuste" role="combobox" aria-expanded={!!q} aria-controls="st-results" aria-activedescendant={q && results[at] ? "st-r-" + at : undefined} autoComplete="off" spellCheck={false}
          style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: "15px", color: INK }} />
        {q ? (
          <button type="button" aria-label="Borrar la búsqueda" onClick={() => { setQ(""); box.current?.focus(); }} style={{ width: "24px", height: "24px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.06)", cursor: "pointer", color: MUTED }}>
            <X size={13} strokeWidth={2.4} aria-hidden="true" />
          </button>
        ) : <kbd aria-hidden="true" style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#9A9DA6", padding: "4px 7px", borderRadius: "6px", background: "rgba(18,19,26,.05)" }}>/</kbd>}
      </label>
      {q ? (
        <div id="st-results" role="listbox" aria-label="Ajustes encontrados" style={{ display: "flex", flexDirection: "column", gap: "2px", animation: "fade .2s ease-out" }}>
          {results.map((r, i) => {
            const s = SECTION_OF[r.section];
            const Icon = s.icon;
            return (
              <a key={r.key} id={"st-r-" + i} role="option" aria-selected={i === at} className="st-result st-nav-item" data-on={i === at ? "1" : "0"} href={r.href} onMouseEnter={() => setAt(i)} onClick={(e) => { e.preventDefault(); open(r); }}
                style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "8px 12px", borderRadius: "14px", color: INK, textDecoration: "none" }}>
                <Icon size={17} strokeWidth={2} color={MUTED} aria-hidden="true" style={{ flex: "none" }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "15px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                  <span style={{ fontSize: "12px", color: FAINT }}>{r.isSection ? "Sección" : s.label}</span>
                </span>
                {i === at ? <CornerDownLeft size={14} strokeWidth={2.2} color="#9A9DA6" aria-hidden="true" /> : null}
              </a>
            );
          })}
          {!results.length ? <p role="status" style={{ margin: "8px 12px", fontSize: "14px", lineHeight: 1.5, color: FAINT }}>Ningún ajuste se llama así. Prueba con otra palabra: «sonido», «modelo», «contraseña»…</p> : null}
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const on = s.id === active;
            return (
              <li key={s.id}>
                <a className="st-nav-item" href={"/ajustes/" + s.id} aria-current={on ? "page" : undefined} onClick={(e) => { e.preventDefault(); navigate("/ajustes/" + s.id); }}
                  style={{ display: "flex", alignItems: "center", gap: "12px", height: "44px", padding: "0 12px", borderRadius: "14px", color: INK, textDecoration: "none", fontSize: "15px", fontWeight: on ? 600 : 500 }}>
                  <Icon size={18} strokeWidth={on ? 2.2 : 1.9} aria-hidden="true" style={{ flex: "none", color: on ? INK : MUTED }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  {dots?.[s.id] ? <span role="img" aria-label={dots[s.id].label} title={dots[s.id].label} style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: dots[s.id].color }} /> : null}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

/**
 * The Ajustes frame. `active` is the section (marked in the list); `open` says a section is
 * on screen (a narrow window shows only it); `back` turns the title into a detail page of
 * that section, with «‹ <sección>» above it.
 */
export default function SettingsLayout({ active, open = true, back = null, dots = null, title = null, lead = null, wide = false, extraCss = "", children }) {
  useAnchor(open);
  const section = SECTION_OF[active];
  const parent = back ? SECTION_OF[back] : null;
  const head = title ?? section?.label;
  const sub = lead ?? (back ? null : section?.lead);
  return (
    <Shell active="ajustes" extraCss={STYLE + extraCss}>
      <div className="st-wrap" data-open={open ? "1" : "0"} style={{ display: "flex", minHeight: "100%" }}>
        <Nav active={active} dots={dots} />
        <main className="st-body" style={{ flex: 1, minWidth: 0, padding: "56px clamp(16px, 4vw, 48px) 64px" }}>
          <div style={{ maxWidth: wide ? "1040px" : "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "34px" }}>
            <header style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {parent ? (
                <a href={"/ajustes/" + parent.id} onClick={(e) => { e.preventDefault(); navigate("/ajustes/" + parent.id); }} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "4px", height: "36px", padding: "0 14px 0 8px", borderRadius: "999px", background: "rgba(18,19,26,.05)", color: INK, fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
                  <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />{parent.label}
                </a>
              ) : (
                <a className="st-back" href="/ajustes" onClick={(e) => { e.preventDefault(); navigate("/ajustes"); }} style={{ alignSelf: "flex-start", alignItems: "center", gap: "4px", height: "36px", padding: "0 14px 0 8px", borderRadius: "999px", background: "rgba(18,19,26,.05)", color: INK, fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
                  <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />Ajustes
                </a>
              )}
              {head ? <h2 style={{ margin: 0, font: "600 clamp(34px, 4.4vw, 44px)/1.02 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>{head}</h2> : null}
              {sub ? <p style={{ margin: 0, maxWidth: "620px", fontSize: "16px", lineHeight: 1.5, color: MUTED }}>{sub}</p> : null}
            </header>
            {children}
          </div>
        </main>
      </div>
    </Shell>
  );
}
