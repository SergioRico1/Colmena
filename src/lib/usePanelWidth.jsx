import { useCallback, useRef, useState } from "react";

// Right-hand side panels that you widen or narrow by dragging their left edge (or with the
// arrow keys on the handle); a double click goes back to the default width. The width is
// remembered per kind of panel. While dragging, frames inside the panel ignore the pointer.
const KEY = (name) => "colmena:panel-width:" + name;
const read = (name) => { try { return Number(localStorage.getItem(KEY(name))) || null; } catch { return null; } };

export function usePanelWidth(name, { min = 320, maxShare = 0.72, side = "right" } = {}) {
  // A panel docked on the left grows to the right: its handle is on its right edge.
  const dir = side === "left" ? -1 : 1;
  const [width, setWidth] = useState(() => read(name));
  const latest = useRef(width);
  const clamp = (w) => Math.round(Math.min(Math.max(w, min), Math.max(min, window.innerWidth * maxShare)));
  const save = (w) => { try { if (w) localStorage.setItem(KEY(name), String(w)); else localStorage.removeItem(KEY(name)); } catch {} };
  const set = (w) => { latest.current = w; setWidth(w); };

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const aside = e.currentTarget.parentElement;
    const startX = e.clientX;
    const startW = aside.getBoundingClientRect().width;
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    document.body.classList.add("c-resizing");
    const move = (ev) => set(clamp(startW + dir * (startX - ev.clientX)));
    const up = () => {
      document.body.classList.remove("c-resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      save(latest.current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const current = latest.current || e.currentTarget.parentElement.getBoundingClientRect().width;
    const w = clamp(current + dir * (e.key === "ArrowLeft" ? 32 : -32));
    set(w);
    save(w);
  };
  const reset = () => { set(null); save(null); };

  const handle = (
    <div role="separator" aria-orientation="vertical" aria-label="Ancho del panel: arrastra o usa las flechas" title="Arrastra para cambiar el ancho · doble clic para volver al tamaño normal"
      tabIndex={0} className={"c-panel-resize" + (side === "left" ? " c-panel-resize--end" : "")} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={reset} aria-valuenow={width || undefined} />
  );
  return { width, handle, style: width ? { flex: `0 0 ${width}px`, width: width + "px", maxWidth: "72vw", position: "relative" } : { position: "relative" } };
}
