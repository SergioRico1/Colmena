import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Expand, FileText, Presentation } from "lucide-react";

// A presentation the bots made (create_presentation): its slides as pictures (drawn by the
// desktop app) or, until there are pictures, as the slide's own page scaled down.

const enc = encodeURIComponent;
export const slideUrl = (id, n) => `/api/artifacts/${enc(id)}/slides/${n}`;
export const thumbUrl = (id, n) => `/api/artifacts/${enc(id)}/thumbs/${n}`;
export const pptxUrl = (id) => `/api/artifacts/${enc(id)}/file?download=1`;
export const pdfUrl = (id, download = true) => `/api/artifacts/${enc(id)}/pdf${download ? "?download=1" : ""}`;
export const isDeck = (a) => String(a?.format || "").toLowerCase() === "pptx" && Number(a?.slides) > 0;

/** One slide at any width, keeping 16:9. */
export function SlideImage({ artifact, n, radius = 14, eager = false }) {
  const box = useRef(null);
  const [width, setWidth] = useState(0);
  const pictures = (Array.isArray(artifact?.thumbs) ? artifact.thumbs.length : Number(artifact?.thumbs) || 0) >= n;
  useEffect(() => {
    if (pictures || !box.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [pictures]);
  return (
    <div ref={box} style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", overflow: "hidden", borderRadius: radius + "px", background: "#EDEBE5", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.06)" }}>
      {pictures ? (
        <img src={thumbUrl(artifact.id, n)} alt={`Diapositiva ${n}`} loading={eager ? "eager" : "lazy"} decoding="async" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
      ) : width ? (
        <iframe title={`Diapositiva ${n}`} src={slideUrl(artifact.id, n)} sandbox="" tabIndex={-1} loading={eager ? "eager" : "lazy"}
          style={{ position: "absolute", left: 0, top: 0, width: "1280px", height: "720px", border: 0, transformOrigin: "0 0", transform: `scale(${width / 1280})`, pointerEvents: "none" }} />
      ) : null}
    </div>
  );
}

const pill = { display: "inline-flex", alignItems: "center", gap: "7px", height: "40px", padding: "0 16px", borderRadius: "999px", fontSize: "14px", fontWeight: "600", textDecoration: "none", cursor: "pointer", border: 0 };
const dark = { ...pill, background: "#12131A", color: "#FFFFFF" };
const soft = { ...pill, background: "rgba(18,19,26,.06)", color: "#12131A" };

/** In the chat: the cover, what it is, «Abrir», PowerPoint and PDF. */
export function DeckCard({ artifact, onOpen }) {
  const n = Number(artifact?.slides) || 0;
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "14px 14px 20px", background: "#FFFFFF", borderRadius: "28px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 50px -28px rgba(18,19,26,.3)", animation: "rise .5s ease-out" }}>
      <button type="button" onClick={onOpen} aria-label={`Abrir «${artifact?.title || "presentación"}»`} style={{ padding: 0, border: 0, background: "transparent", cursor: "pointer", borderRadius: "18px" }}>
        <SlideImage artifact={artifact} n={1} radius={18} eager />
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 10px" }}>
        <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{`Presentación · ${n} ${n === 1 ? "diapositiva" : "diapositivas"}`}</span>
        <strong style={{ font: "600 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>{artifact?.title || "Presentación"}</strong>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "0 10px" }}>
        <button type="button" onClick={onOpen} style={dark}><Presentation size={16} strokeWidth={2.2} aria-hidden="true" />{"Abrir"}</button>
        <a href={pptxUrl(artifact.id)} download style={soft}><Download size={16} strokeWidth={2.2} aria-hidden="true" />{"PowerPoint"}</a>
        {artifact?.pdf ? <a href={pdfUrl(artifact.id)} download style={soft}><FileText size={16} strokeWidth={2.2} aria-hidden="true" />{"PDF"}</a> : null}
      </div>
    </article>
  );
}

/** In the side panel: the slide large, ← → and the strip of all of them; «Presentar» fills the screen. */
export function SlideViewer({ artifact }) {
  const count = Number(artifact?.slides) || 0;
  const [n, setN] = useState(1);
  const stage = useRef(null);
  const strip = useRef(null);
  const go = useCallback((to) => setN((cur) => Math.min(count, Math.max(1, typeof to === "function" ? to(cur) : to))), [count]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && document.fullscreenElement)) { e.preventDefault(); go((c) => c + 1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go((c) => c - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  useEffect(() => { strip.current?.querySelector(`[data-n="${n}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }, [n]);
  if (!count) return null;
  const arrow = (dir) => ({ ...soft, width: "40px", padding: 0, justifyContent: "center", opacity: (dir < 0 ? n === 1 : n === count) ? 0.35 : 1 });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div ref={stage} style={{ position: "relative", background: "#12131A", borderRadius: "16px", display: "grid", placeItems: "center" }}>
        <div style={{ width: "100%", maxWidth: "calc((100vh - 40px) * 16 / 9)" }}>
          <SlideImage key={n} artifact={artifact} n={n} radius={14} eager />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => go((c) => c - 1)} disabled={n === 1} aria-label="Diapositiva anterior" style={arrow(-1)}><ChevronLeft size={18} strokeWidth={2.4} aria-hidden="true" /></button>
        <span aria-live="polite" style={{ minWidth: "64px", textAlign: "center", font: "500 13px/1 'Geist Mono', monospace", color: "#5C606C" }}>{`${n} / ${count}`}</span>
        <button type="button" onClick={() => go((c) => c + 1)} disabled={n === count} aria-label="Diapositiva siguiente" style={arrow(1)}><ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" /></button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => stage.current?.requestFullscreen?.()} style={soft}><Expand size={16} strokeWidth={2.2} aria-hidden="true" />{"Presentar"}</button>
        <a href={pptxUrl(artifact.id)} download style={dark}><Download size={16} strokeWidth={2.2} aria-hidden="true" />{"PowerPoint"}</a>
        {artifact?.pdf ? <a href={pdfUrl(artifact.id)} download style={soft}><FileText size={16} strokeWidth={2.2} aria-hidden="true" />{"PDF"}</a> : null}
      </div>
      <div ref={strip} role="tablist" aria-label="Diapositivas" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: "10px" }}>
        {Array.from({ length: count }, (_, i) => i + 1).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === n} data-n={k} onClick={() => go(k)} aria-label={`Diapositiva ${k}`}
            style={{ position: "relative", padding: 0, border: 0, background: "transparent", cursor: "pointer", borderRadius: "10px", outline: k === n ? "2px solid #7B4DFF" : "none", outlineOffset: "2px" }}>
            <SlideImage artifact={artifact} n={k} radius={10} />
            <span style={{ position: "absolute", left: "6px", bottom: "6px", padding: "2px 7px", borderRadius: "999px", background: "rgba(18,19,26,.72)", color: "#FFFFFF", font: "500 11px/1.4 'Geist Mono', monospace" }}>{k}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
