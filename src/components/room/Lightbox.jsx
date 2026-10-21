import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";

// Image viewer (OpenClaw image gallery/lightbox). Any <img data-lightbox> opens here on click;
// its gallery is the images of the same message ([data-message-id]) or of the closest
// [data-gallery]. Zoom with + − 0 or the wheel (up to 4×), drag to move when zoomed, ← → for
// the next one, Esc closes. Mounted once, next to the command palette.
const MAX = 4;
const STEP = 1.25;

export default function LightboxLayer() {
  const [view, setView] = useState(null); // {images: [{src, alt, name}], index}
  useEffect(() => {
    const onClick = (e) => {
      const img = e.target.closest?.("img[data-lightbox]");
      if (!img || e.button !== 0 || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const scope = img.closest("[data-gallery]") || img.closest("[data-message-id]");
      const all = scope ? [...scope.querySelectorAll("img[data-lightbox]")] : [img];
      const images = all.map((el) => ({ src: el.dataset.full || el.currentSrc || el.src, alt: el.alt || "", name: el.dataset.name || "" }));
      setView({ images, index: Math.max(0, all.indexOf(img)) });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  if (!view) return null;
  return <Lightbox images={view.images} index={view.index} onClose={() => setView(null)} />;
}

function Lightbox({ images, index: start, onClose }) {
  const dialog = useRef(null);
  const [index, setIndex] = useState(start);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const image = images[index];
  const many = images.length > 1;

  useEffect(() => {
    const el = dialog.current;
    // No close() on cleanup: it fires «close» (→ onClose) on StrictMode's re-run; removing
    // the element from the page closes it anyway.
    if (el && !el.open) el.showModal();
  }, []);
  const reset = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);
  const zoom = useCallback((factor) => setScale((s) => {
    const next = Math.min(MAX, Math.max(1, +(s * factor).toFixed(3)));
    if (next === 1) setOffset({ x: 0, y: 0 });
    return next;
  }), []);
  const go = useCallback((d) => { if (!many) return; setIndex((i) => (i + d + images.length) % images.length); reset(); }, [many, images.length, reset]);

  const onKeyDown = (e) => {
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(STEP); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoom(1 / STEP); }
    else if (e.key === "0") { e.preventDefault(); reset(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  };
  const onWheel = (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? STEP : 1 / STEP); };
  const onPointerDown = (e) => {
    if (scale === 1 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const onPointerMove = (e) => { if (drag.current) setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
  const onPointerUp = () => { drag.current = null; };

  const tool = { width: "40px", height: "40px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "10px", color: "#12131A", cursor: "pointer" };
  const side = (dir) => ({ position: "absolute", top: "50%", [dir]: "20px", transform: "translateY(-50%)", width: "48px", height: "48px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "50%", cursor: "pointer", color: "#12131A" });
  const name = image.name || image.alt || "imagen";
  return (
    <dialog ref={dialog} onClose={onClose} onKeyDown={onKeyDown} aria-label={many ? `Imagen ${index + 1} de ${images.length}` : "Imagen ampliada"}
      onClick={(e) => { if (e.target === e.currentTarget) dialog.current.close(); }}
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", maxWidth: "none", maxHeight: "none", margin: 0, padding: 0, border: 0, background: "rgba(18,19,26,.92)", overflow: "hidden" }}>
      <div onWheel={onWheel} onClick={(e) => { if (e.target === e.currentTarget) dialog.current.close(); }}
        style={{ position: "absolute", inset: "56px 84px 92px", display: "grid", placeItems: "center", overflow: "hidden" }}>
        <img key={image.src} src={image.src} alt={image.alt} draggable="false"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onDoubleClick={() => (scale === 1 ? zoom(2) : reset())}
          style={{ animation: "c-fade 160ms ease both", maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "8px", background: "#FFFFFF", transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transition: drag.current ? "none" : "transform .14s ease", cursor: scale > 1 ? (drag.current ? "grabbing" : "grab") : "zoom-in", userSelect: "none", touchAction: "none" }} />
      </div>
      <div style={{ position: "absolute", top: "14px", left: "20px", right: "20px", display: "flex", alignItems: "center", gap: "12px", color: "#FFFFFF" }}>
        <strong style={{ fontSize: "14px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</strong>
        {many ? <span style={{ fontSize: "13px", color: "#C9CCD6", flex: "none" }}>{`${index + 1} de ${images.length}`}</span> : null}
        <button type="button" className="rm-focus" aria-label="Cerrar (Esc)" title="Cerrar (Esc)" onClick={() => dialog.current.close()} style={{ ...tool, marginLeft: "auto", color: "#FFFFFF" }}>
          <X size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      {many ? (
        <>
          <button type="button" className="rm-focus c-press" aria-label="Anterior (←)" title="Anterior (←)" onClick={() => go(-1)} style={side("left")}><ChevronLeft size={22} strokeWidth={2.4} aria-hidden="true" /></button>
          <button type="button" className="rm-focus c-press" aria-label="Siguiente (→)" title="Siguiente (→)" onClick={() => go(1)} style={side("right")}><ChevronRight size={22} strokeWidth={2.4} aria-hidden="true" /></button>
        </>
      ) : null}
      <div role="toolbar" aria-label="Zoom" style={{ position: "absolute", bottom: "24px", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "2px", padding: "4px", background: "#FFFFFF", border: "0", borderRadius: "999px", boxShadow: "0 20px 40px -16px rgba(0,0,0,.5)" }}>
        <button type="button" className="rm-focus" aria-label="Alejar (−)" title="Alejar (−)" disabled={scale <= 1} onClick={() => zoom(1 / STEP)} style={{ ...tool, opacity: scale <= 1 ? 0.35 : 1 }}><ZoomOut size={18} strokeWidth={2.2} aria-hidden="true" /></button>
        <span aria-live="polite" style={{ minWidth: "52px", textAlign: "center", font: "600 13px/1 'Geist Mono', monospace" }}>{Math.round(scale * 100) + " %"}</span>
        <button type="button" className="rm-focus" aria-label="Acercar (+)" title="Acercar (+)" disabled={scale >= MAX} onClick={() => zoom(STEP)} style={{ ...tool, opacity: scale >= MAX ? 0.35 : 1 }}><ZoomIn size={18} strokeWidth={2.2} aria-hidden="true" /></button>
        <button type="button" className="rm-focus" aria-label="Tamaño ajustado (0)" title="Tamaño ajustado (0)" disabled={scale === 1} onClick={reset} style={{ ...tool, opacity: scale === 1 ? 0.35 : 1 }}><RotateCcw size={17} strokeWidth={2.2} aria-hidden="true" /></button>
        <span aria-hidden="true" style={{ width: "1px", height: "24px", background: "#DCE0E8", margin: "0 4px" }} />
        <a href={image.src} download={/\.\w{2,4}$/.test(name) ? name : name + ".png"} className="rm-focus" aria-label="Descargar" title="Descargar" style={{ ...tool, textDecoration: "none" }}><Download size={18} strokeWidth={2.2} aria-hidden="true" /></a>
      </div>
    </dialog>
  );
}
