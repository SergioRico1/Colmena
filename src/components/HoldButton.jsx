import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../lib/motion.js";
import { CONFIRM_MS, HINT_MS, HOLD_IDLE, HOLD_MS, holdLabel, holdNext } from "../lib/holdApprove.js";

// The approve button of a red line (lib/holdApprove.js): hold it ~0.8 s while it fills, with
// the pointer or with Space/Enter. Let go early and nothing is approved. With «reduce motion»,
// after a short key press or for an assistive click it is two steps: the button turns into
// «Confirmar». It looks like the button it replaces: pass that button's own `style`.

/**
 * `onConfirm` runs once the hold (or the second step) completes. `fill`: the colour that
 * grows inside while held — light on a dark button, dark on a light one.
 */
export default function HoldButton({ onConfirm, children, plainLabel = null, style, disabled = false, className, fill = "color-mix(in oklab, var(--c-btn-text) 26%, transparent)", ...rest }) {
  const [state, setState] = useState(HOLD_IDLE);
  const current = useRef(HOLD_IDLE);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;
  const keyAt = useRef(0);
  const send = (event) => {
    if (disabled) return;
    const next = holdNext(current.current, { at: Date.now(), ...event });
    if (next.state !== current.current) { current.current = next.state; setState(next.state); }
    if (next.fire) confirm.current?.();
  };
  // The hold completes by itself; «Confirmar» and the hint go back to the usual button.
  useEffect(() => {
    if (state.phase === "idle") return undefined;
    const ms = state.phase === "holding" ? HOLD_MS : state.phase === "confirm" ? CONFIRM_MS : HINT_MS;
    const timer = setTimeout(() => send(state.phase === "holding" ? { type: "complete", at: Math.max(Date.now(), state.since + HOLD_MS) } : { type: "timeout" }), ms);
    return () => clearTimeout(timer);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (disabled && current.current.phase !== "idle") { current.current = HOLD_IDLE; setState(HOLD_IDLE); }
  }, [disabled]);

  const holding = state.phase === "holding";
  // Its label says it must be held («Mantén para enviar», lib/approvalCard.js). Where the hold
  // is two steps instead («reduce motion») it shows `plainLabel` («Enviar»), then «Confirmar».
  const twoStep = reducedMotion();
  const label = twoStep && plainLabel ? plainLabel : children;
  const isKey = (e) => e.key === " " || e.key === "Enter";
  return (
    <button type="button" {...rest} className={className} disabled={disabled}
      title={state.phase === "confirm" ? "Pulsa otra vez para confirmar" : twoStep ? "Pulsa dos veces para confirmar" : "Mantén pulsado para confirmar"}
      aria-description={twoStep ? "Pulsa dos veces para confirmar." : "Mantén pulsado para confirmar, o pulsa dos veces."}
      onPointerDown={(e) => { if (e.button === 0) send({ type: "press", via: "pointer", reduced: reducedMotion() }); }}
      onPointerUp={() => send({ type: "release" })}
      onPointerLeave={() => { if (current.current.phase === "holding") send({ type: "cancel" }); }}
      onPointerCancel={() => send({ type: "cancel" })}
      onContextMenu={(e) => { if (current.current.phase === "holding") e.preventDefault(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && current.current.phase !== "idle") { e.stopPropagation(); send({ type: "cancel" }); return; }
        if (!isKey(e)) return;
        e.preventDefault(); // the hold decides, not the browser's own click
        keyAt.current = Date.now();
        if (!e.repeat) send({ type: "press", via: "key", reduced: reducedMotion() });
      }}
      onKeyUp={(e) => {
        if (!isKey(e)) return;
        e.preventDefault();
        keyAt.current = Date.now();
        send({ type: "release" });
      }}
      onBlur={() => send({ type: "cancel" })}
      // A click that came with no press (screen readers, voice control): the two steps.
      onClick={(e) => { if (e.detail === 0 && Date.now() - keyAt.current > 80) send({ type: "click" }); }}
      style={{ ...style, position: "relative", overflow: "hidden", userSelect: "none", touchAction: "none" }}>
      <span aria-hidden="true" style={{ position: "absolute", inset: "0", background: fill, transformOrigin: "left center", transform: holding ? "scaleX(1)" : "scaleX(0)", transition: holding ? `transform ${HOLD_MS}ms linear` : "transform 140ms ease-out", pointerEvents: "none" }} />
      <span aria-live="polite" style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "inherit" }}>{holdLabel(state, label)}</span>
    </button>
  );
}
