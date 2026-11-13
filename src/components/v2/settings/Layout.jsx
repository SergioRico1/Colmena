import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, CornerDownLeft, X, Search } from "../../Icon.js";
import Shell from "../Shell.jsx";
import { navigate } from "../../../lib/router.jsx";
import { useExpert } from "../../../lib/expert.js";
import { SECTIONS, SECTION_OF, searchSettings, settingsIndex } from "./sections.js";
import { srOnly } from "./v3.jsx";
import { C } from "../../../lib/theme.js";

// Ajustes (Colmena 3, design/V3Ajustes.dc.html): on the left «Ajustes», a search box and the
// eight sections (Avanzado too, in expert mode); on the right the chosen one, with what it is
// for under its title. In a narrow window it is one column, like the Settings of a phone:
// /ajustes is the list and a section opens on its own, with «‹ Ajustes» to go back. Detail
// pages (/ajustes/ordenador, /ajustes/seguridad…) live inside their section: the section stays
// marked and «‹ <sección>» goes back to it.

const NARROW = 940; // px of window: below it the list and the section take turns
const STYLE = `
.st-nav-item{transition:background .15s ease}
.st-nav-item:hover{background:rgb(var(--c-ink-rgb) / .04)}
.st-nav-item[aria-current="page"],.st-result[data-on="1"]{background:var(--c-card);box-shadow:0 1px 2px rgb(var(--c-ink-rgb) / .08)}
[data-setting]{transition:background .6s ease}
[data-setting][data-lit="1"]{background:rgb(var(--c-ink-rgb) / .045)!important}
.st-back{display:none}
@media (max-width:${NARROW}px){
  .st-wrap{flex-direction:column!important}
  .st-nav{position:static!important;width:auto!important;flex:none!important;height:auto!important;min-height:0!important;padding:32px clamp(16px,4vw,28px) 20px!important}
  .st-wrap[data-open="1"] .st-nav{display:none!important}
  .st-wrap[data-open="0"] .st-body{display:none!important}
  .st-wrap[data-open="0"] .st-nav-item[aria-current="page"]{background:transparent;box-shadow:none;font-weight:500!important}
  .st-back{display:inline-flex}
  .st-body{padding-top:24px!important;max-width:none!important}
}
@media (prefers-reduced-motion: reduce){[data-setting]{transition:none}}
`;

/** Scrolls to /ajustes/…#anchor and lights the setting up for a moment. */
function useAnchor(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    let timer;
    let settle;
    let tries = 0;
    const find = (anchor) => document.querySelector(`[data-setting="${window.CSS?.escape ? window.CSS.escape(anchor) : anchor}"]`);
    const go = (smooth) => {
      const anchor = decodeURIComponent(location.hash.slice(1));
      if (!anchor) return;
      requestAnimationFrame(() => {
        const el = find(anchor);
        // Some rows arrive with their data (backups, the catalogue): look again for a moment.
        if (!el) { if (tries++ < 10) timer = setTimeout(() => go(smooth), 150); return; }
        tries = 0;
        const calm = !smooth || matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
        // Cards above it may still grow with their data: put it back in view once they settle.
        clearTimeout(settle);
        settle = setTimeout(() => find(anchor)?.scrollIntoView({ block: "center", behavior: "auto" }), calm ? 500 : 900);
        el.dataset.lit = "1";
        clearTimeout(timer);
        timer = setTimeout(() => { delete el.dataset.lit; }, 1600);
      });
    };
    go(false);
    const again = () => { tries = 0; go(true); };
    window.addEventListener("colmena:navigate", again);
    window.addEventListener("hashchange", again);
    return () => { clearTimeout(timer); clearTimeout(settle); window.removeEventListener("colmena:navigate", again); window.removeEventListener("hashchange", again); };
  }, [ready]);
}

const itemStyle = (on) => ({ minHeight: "40px", display: "flex", alignItems: "center", gap: "10px", padding: "0 10px", borderRadius: "var(--r-md)", fontSize: "var(--t-body)", fontWeight: on ? 600 : 500, color: "var(--c-text)", textDecoration: "none" });

function Nav({ active, tags }) {
  const [expert] = useExpert();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef(null);
  const results = useMemo(() => searchSettings(q, settingsIndex(expert)), [q, expert]);
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
  const shown = SECTIONS.filter((s) => !s.hidden && (!s.expert || expert));
  return (
    <nav className="st-nav" aria-label="Secciones de Ajustes" style={{ flex: "0 0 264px", position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: "4px", minHeight: "100vh", padding: "40px 14px 24px 22px", boxSizing: "border-box" }}>
      <h1 style={{ margin: "0 0 14px 8px", font: "700 var(--t-headline)/1.15 'Bricolage Grotesque', 'Geist', sans-serif", letterSpacing: "-0.015em" }}>Ajustes</h1>
      <label style={{ flex: "none", display: "flex", alignItems: "center", gap: "8px", height: "40px", marginBottom: "10px", padding: "0 12px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid rgb(var(--c-ink-rgb) / .08)" }}>
        <Search size={15} color={C.text3} />
        <span style={srOnly}>Buscar un ajuste</span>
        <input className="c-bare" ref={box} type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Buscar un ajuste" role="combobox" aria-expanded={!!q} aria-controls="st-results" aria-activedescendant={q && results[at] ? "st-r-" + at : undefined} autoComplete="off" spellCheck={false}
          style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "var(--t-ui)", color: "var(--c-text)" }} />
        {q ? (
          <button type="button" aria-label="Borrar la búsqueda" onClick={() => { setQ(""); box.current?.focus(); }} style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "rgb(var(--c-ink-rgb) / .06)", cursor: "pointer", color: "var(--c-text-3)" }}>
            <X size={12} strokeWidth={2.4} aria-hidden="true" />
          </button>
        ) : null}
      </label>
      {q ? (
        <div id="st-results" role="listbox" aria-label="Ajustes encontrados" style={{ display: "flex", flexDirection: "column", gap: "2px", animation: "fade .2s ease-out" }}>
          {results.map((r, i) => {
            const s = SECTION_OF[r.section];
            const Icon = s.icon;
            return (
              <a key={r.key} id={"st-r-" + i} role="option" aria-selected={i === at} className="st-result st-nav-item" data-on={i === at ? "1" : "0"} href={r.href} onMouseEnter={() => setAt(i)} onClick={(e) => { e.preventDefault(); open(r); }}
                style={{ ...itemStyle(false), minHeight: "48px", padding: "6px 10px" }}>
                <Icon size={17} style={{ flex: "none", color: "var(--c-text-2)" }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                  <span style={{ fontSize: "var(--t-ui)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                  <span style={{ fontSize: "var(--t-caption)", fontWeight: 500, color: "var(--c-text-3)" }}>{r.isSection ? "Sección" : s.label}</span>
                </span>
                {i === at ? <CornerDownLeft size={13} strokeWidth={2.2} color={C.text4} aria-hidden="true" /> : null}
              </a>
            );
          })}
          {!results.length ? <p role="status" style={{ margin: "8px 10px", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-3)" }}>Ningún ajuste se llama así. Prueba con otra palabra: «sonido», «modelo», «contraseña»…</p> : null}
        </div>
      ) : shown.map((s) => {
        const on = s.id === active;
        const tag = tags?.[s.id] || (s.tag ? { text: s.tag } : null);
        return (
          <a key={s.id} className="st-nav-item" href={"/ajustes/" + s.id} aria-current={on ? "page" : undefined} onClick={(e) => { e.preventDefault(); navigate("/ajustes/" + s.id); }} style={itemStyle(on)}>
            <s.icon size={17} style={{ flex: "none", color: "var(--c-text-2)" }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
            {tag ? <span title={tag.label} aria-label={tag.label} style={{ fontSize: "var(--t-micro)", fontWeight: 600, color: tag.color || "var(--c-text-3)" }}>{tag.text}</span> : null}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * The Ajustes frame. `active` is the section (marked in the list); `open` says a section is
 * on screen (a narrow window shows only it); `back` turns the title into a detail page of
 * that section, with «‹ <sección>» above it; `aside` sits right of the title (a button, a
 * choice of unit); `width` is the column's widest (820–860 px on the boards).
 */
export default function SettingsLayout({ active, open = true, back = null, tags = null, title = null, lead = null, aside = null, width = 820, extraCss = "", children }) {
  useAnchor(open);
  const section = SECTION_OF[active];
  const parent = back ? SECTION_OF[back] : null;
  const head = title ?? section?.label;
  const sub = lead ?? (back ? null : section?.lead);
  return (
    <Shell active="ajustes" background="var(--c-app)" extraCss={STYLE + extraCss}>
      <div className="st-wrap" data-open={open ? "1" : "0"} style={{ display: "flex", alignItems: "flex-start", minHeight: "100%" }}>
        <Nav active={active} tags={tags} />
        <main className="st-body" style={{ flex: "999 1 480px", minWidth: 0, maxWidth: width + "px", padding: "40px clamp(20px, 3vw, 40px) 64px", display: "flex", flexDirection: "column", gap: "18px", boxSizing: "border-box" }}>
          {parent ? (
            <a href={"/ajustes/" + parent.id} onClick={(e) => { e.preventDefault(); navigate("/ajustes/" + parent.id); }} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "4px", height: "32px", padding: "0 12px 0 6px", borderRadius: "var(--r-sm)", background: "rgb(var(--c-ink-rgb) / .05)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 600, textDecoration: "none" }}>
              <ChevronLeft size={15} strokeWidth={2.2} aria-hidden="true" />{parent.label}
            </a>
          ) : (
            <a className="st-back" href="/ajustes" onClick={(e) => { e.preventDefault(); navigate("/ajustes"); }} style={{ alignSelf: "flex-start", alignItems: "center", gap: "4px", height: "32px", padding: "0 12px 0 6px", borderRadius: "var(--r-sm)", background: "rgb(var(--c-ink-rgb) / .05)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 600, textDecoration: "none" }}>
              <ChevronLeft size={15} strokeWidth={2.2} aria-hidden="true" />Ajustes
            </a>
          )}
          {head || sub ? (
            <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {head ? <h2 style={{ margin: 0, font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}>{head}</h2> : null}
                {sub ? <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-2)" }}>{sub}</p> : null}
              </div>
              {aside}
            </header>
          ) : null}
          {children}
        </main>
      </div>
    </Shell>
  );
}
