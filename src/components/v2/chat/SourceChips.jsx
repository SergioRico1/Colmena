import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, FileText, Globe, Mail } from "lucide-react";
import { normUrl } from "../../../lib/citations.js";

// Sources of an answer as quiet chips, and the links inside it as inline citations (after
// assistant-ui sources, inline-citation and link-preview): hovering or focusing one shows a
// preview — title, site, the excerpt the bot read or who sent the mail — and «Abrir».

const ICON = { web: Globe, mail: Mail, file: FileText };

/** url → source of the answer being shown; Markdown's links read it (inline citations). */
export const CitationContext = createContext(null);
export const useCitation = (href) => {
  const map = useContext(CitationContext);
  if (!map || !href) return null;
  const u = normUrl(href);
  return u ? map.get(u) || null : null;
};

/** The preview of a source, next to the element `anchor`, in the page (never clipped). */
function Preview({ source, anchor, onEnter, onLeave }) {
  const [place, setPlace] = useState(null);
  useEffect(() => {
    const r = anchor?.getBoundingClientRect?.();
    if (!r) return;
    const width = Math.min(340, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    const below = r.bottom + 220 < window.innerHeight;
    setPlace({ left, width, ...(below ? { top: r.bottom + 8 } : { bottom: window.innerHeight - r.top + 8 }) });
  }, [anchor]);
  if (!place) return null;
  const Icon = ICON[source.kind] || Globe;
  return createPortal((
    <div role="tooltip" onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ position: "fixed", zIndex: 70, ...place, padding: "14px 16px", borderRadius: "var(--r-xl)", background: "var(--c-card)", boxShadow: "0 0 0 1px rgba(18,19,26,.06), 0 20px 44px -18px rgba(18,19,26,.4)", display: "flex", flexDirection: "column", gap: "8px", animation: "rise .18s ease-out" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-caption)", color: "var(--c-text-3)", minWidth: 0 }}>
        <Icon size={13} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.site}</span>
      </span>
      <strong style={{ fontSize: "var(--t-ui)", lineHeight: "1.35", color: "var(--c-text)", overflowWrap: "anywhere" }}>{source.title}</strong>
      {source.meta ? <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{source.meta}</span> : null}
      {source.excerpt ? <p style={{ margin: 0, fontSize: "var(--t-meta)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{source.excerpt}</p> : null}
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 14px", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-meta)", fontWeight: 600, textDecoration: "none" }}>
          {source.kind === "mail" ? "Abrir el correo" : "Abrir"}<ArrowUpRight size={13} strokeWidth={2.4} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  ), document.body);
}

/** Hover or focus shows the preview (a short delay, kept while the pointer is on it). */
function useHoverPreview() {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const show = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 220); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return { open, show, hide, close: () => { clearTimeout(timer.current); setOpen(false); } };
}

function Chip({ source }) {
  const ref = useRef(null);
  const h = useHoverPreview();
  const Icon = ICON[source.kind] || Globe;
  const label = source.kind === "web" ? source.site : source.title;
  const body = (
    <>
      <Icon size={13} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "var(--c-text-3)" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </>
  );
  const style = { display: "inline-flex", alignItems: "center", gap: "6px", maxWidth: "240px", height: "30px", padding: "0 12px 0 10px", borderRadius: "var(--r-pill)", background: "var(--c-card)", boxShadow: "0 0 0 1px rgba(18,19,26,.08)", fontSize: "var(--t-meta)", color: "var(--c-text)", textDecoration: "none", cursor: source.url ? "pointer" : "default" };
  const events = { onMouseEnter: h.show, onMouseLeave: h.hide, onFocus: h.show, onBlur: h.hide, onKeyDown: (e) => { if (e.key === "Escape") h.close(); } };
  return (
    <>
      {source.url
        ? <a ref={ref} href={source.url} target="_blank" rel="noopener noreferrer" className="rm-focus" aria-label={`${source.title} · ${source.site}`} style={style} {...events}>{body}</a>
        : <span ref={ref} tabIndex={0} className="rm-focus" aria-label={`${source.title}${source.meta ? " · " + source.meta : ""}`} style={style} {...events}>{body}</span>}
      {h.open ? <Preview source={source} anchor={ref.current} onEnter={h.show} onLeave={h.hide} /> : null}
    </>
  );
}

/** «Fuentes» under an answer: one chip per source. */
export default function SourceChips({ sources = [] }) {
  if (!sources.length) return null;
  return (
    <div role="group" aria-label={`Fuentes · ${sources.length}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
      <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", marginRight: "2px" }}>{"Fuentes"}</span>
      {sources.map((s) => <Chip key={s.key} source={s} />)}
    </div>
  );
}

/** A link of the answer that is one of its sources: a small chip with the same preview. */
export function InlineCitation({ source, children }) {
  const ref = useRef(null);
  const h = useHoverPreview();
  const Icon = ICON[source.kind] || Globe;
  return (
    <>
      <a ref={ref} href={source.url} target="_blank" rel="noopener noreferrer" className="rm-focus" data-citation={source.kind}
        onMouseEnter={h.show} onMouseLeave={h.hide} onFocus={h.show} onBlur={h.hide}
        style={{ display: "inline-flex", alignItems: "center", gap: "4px", maxWidth: "100%", padding: "1px 8px 1px 6px", margin: "0 1px", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)", fontSize: "0.82em", fontWeight: 500, lineHeight: "1.5", textDecoration: "none", verticalAlign: "baseline", whiteSpace: "nowrap" }}>
        <Icon size={11} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      </a>
      {h.open ? <Preview source={source} anchor={ref.current} onEnter={h.show} onLeave={h.hide} /> : null}
    </>
  );
}
