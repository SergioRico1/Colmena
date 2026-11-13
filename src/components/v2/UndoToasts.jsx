import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Undo2, X } from "../Icon.js";
import { dismiss, setPaused, undoLast, useToasts } from "../../lib/undoToast.js";

// The quiet notices (src/lib/undoToast.js), the v2 «Todo se puede deshacer» pill
// (design/V2Principios.dc.html, idea 05), stacked like sonner: the newest in front and the
// older ones peeking behind; the pointer on them spreads the stack and stops every
// countdown, as a hidden window does. A notice changes in place: waiting with «Deshacer» and
// a line that runs out, then on its way, then done or failed. Swipe one aside to let it go.
// Ctrl+Z outside a text field undoes the newest one.
const INK = "var(--c-text)";
const STEP = 62; // height of a notice plus the gap, when the stack is spread
const SWIPE_PX = 90;

function Lead({ kind }) {
  if (kind === "working") return <span aria-hidden="true" style={{ width: "16px", height: "16px", flex: "none", borderRadius: "var(--r-circle)", border: "2px solid rgb(var(--c-ink-rgb) / .15)", borderTopColor: "var(--c-text)", animation: "spin .8s linear infinite" }} />;
  if (kind === "success") return <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "var(--c-ok)", color: "var(--c-on-accent)", animation: "pop .35s ease-out" }}><Check size={12} strokeWidth={3.2} /></span>;
  if (kind === "error") return <CircleAlert size={18} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none", color: "var(--c-error)", animation: "pop .35s ease-out" }} />;
  return null;
}

function Toast({ toast, depth, spread, paused }) {
  const [dx, setDx] = useState(0);
  const drag = useRef(null);
  const error = toast.kind === "error";
  const front = depth === 0;
  // The stack: the newest in front; older ones lifted a little and smaller, or spread out.
  const y = spread ? -depth * STEP : -depth * 10;
  const scale = spread ? 1 : 1 - depth * 0.05;
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => { if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x); };
  const onPointerUp = (e) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (Math.abs(dx) > SWIPE_PX) dismiss(toast.id);
    else setDx(0);
  };
  return (
    <div role={error ? "alert" : "status"} data-toast={toast.kind}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setDx(0); }}
      style={{
        // Centred by margins, so the entrance animation (which sets transform) never moves it aside.
        pointerEvents: "auto", position: "absolute", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "fit-content", maxWidth: "min(560px, calc(100vw - 32px))",
        transform: `translateX(${dx}px) translateY(${y}px) scale(${scale})`, transformOrigin: "bottom center",
        opacity: Math.max(0, 1 - Math.abs(dx) / 220) * (spread || depth < 3 ? 1 : 0), zIndex: 10 - depth,
        transition: drag.current ? "none" : "transform .3s cubic-bezier(.2,.8,.2,1), opacity .3s ease",
        overflow: "hidden", display: "flex", alignItems: "center", gap: "12px", minHeight: "52px",
        padding: toast.undo ? "6px 6px 6px 20px" : "6px 8px 6px 18px", borderRadius: "var(--r-pill)", background: "var(--c-card)",
        boxShadow: "var(--c-shadow-pop), 0 0 0 1px rgb(var(--c-ink-rgb) / .06)", animation: "rise .25s ease-out",
        color: error ? "var(--c-error)" : "var(--c-text)", touchAction: "pan-y", cursor: "grab",
      }}>
      <Lead kind={toast.kind} />
      <span aria-hidden={!front && !spread ? "true" : undefined} style={{ flex: 1, minWidth: 0, fontSize: "var(--t-body)", fontWeight: 500, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.35 }} title={toast.text}>{toast.text}</span>
      {toast.undo ? (
        <button type="button" onClick={toast.undo} style={{ flex: "none", display: "flex", alignItems: "center", gap: "7px", height: "40px", padding: "0 18px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600 }}>
          <Undo2 size={15} strokeWidth={2.2} aria-hidden="true" />Deshacer
        </button>
      ) : toast.kind !== "working" ? (
        <button type="button" aria-label="Cerrar el aviso" onClick={() => dismiss(toast.id)} style={{ flex: "none", width: "36px", height: "36px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "transparent", cursor: "pointer", color: "var(--c-text-3)" }}>
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
      {toast.kind === "later" ? (
        // The line that runs out with the five seconds, stopped while the countdowns are.
        <span aria-hidden="true" style={{ position: "absolute", left: "20px", right: "20px", bottom: 0, height: "2px", borderRadius: "var(--r-xs)", background: "rgb(var(--c-ink-rgb) / .08)", overflow: "hidden" }}>
          <span key={toast.at} style={{ display: "block", height: "100%", background: INK, transformOrigin: "left", animation: `grow ${toast.ms}ms linear reverse both`, animationPlayState: paused ? "paused" : "running" }} />
        </span>
      ) : null}
    </div>
  );
}

export default function UndoToasts() {
  const toasts = useToasts();
  const [over, setOver] = useState(false);
  const [hiddenWindow, setHiddenWindow] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (undoLast()) e.preventDefault();
    };
    const onVisible = () => setHiddenWindow(document.visibilityState === "hidden");
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("blur", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("blur", onVisible); window.removeEventListener("focus", onVisible); };
  }, []);
  // Nothing runs out while the window is hidden or you are reading the notices.
  const paused = hiddenWindow || over;
  useEffect(() => { setPaused(paused); }, [paused]);
  useEffect(() => { if (!toasts.length) setOver(false); }, [toasts.length]);
  if (!toasts.length) return null;
  const spread = over && toasts.length > 1;
  const height = spread ? 52 + (toasts.length - 1) * STEP : 52 + Math.min(2, toasts.length - 1) * 10;
  return (
    <div aria-live="polite" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)} onFocus={() => setOver(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "24px", zIndex: 90, width: "min(560px, calc(100vw - 32px))", height: height + "px", transition: "height .3s cubic-bezier(.2,.8,.2,1)", pointerEvents: "auto" }}>
      {toasts.map((t, i) => <Toast key={t.id} toast={t} depth={toasts.length - 1 - i} spread={spread} paused={paused} />)}
    </div>
  );
}
