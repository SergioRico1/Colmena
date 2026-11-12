// «Mantén pulsado para aprobar»: a red line (it sends, buys, publishes or pays) is not approved
// by a stray click. The approve button fills while you hold it (HOLD_MS); let go early and
// nothing happens. With «reduce motion», for a short key press and for assistive clicks it is
// a plain two-step instead: «Aprobar» turns into «Confirmar». Pure: the component
// (components/HoldButton.jsx) feeds it events and timers.

export const HOLD_MS = 800;
/** A second press this soon after «Confirmar» appeared is the same double click: ignored. */
export const CONFIRM_GUARD_MS = 350;
/** «Confirmar» and the «Mantén pulsado» hint go back to the button after this long. */
export const CONFIRM_MS = 6000;
export const HINT_MS = 1600;

/** Approvals that ask for the hold: sends and whatever the server marks as a red line. */
export const needsHold = (a) => !!a && (a.kind === "send" || !!a.redLine);

export const HOLD_IDLE = Object.freeze({ phase: "idle" });

/**
 * The next state of the button and whether the approval fires now.
 * phases: idle → holding → (fires) | hint | confirm → (fires).
 * events: {type: "press", via: "pointer" | "key", at, reduced} · {type: "release", at} ·
 *   {type: "complete", at} (the hold timer ended) · {type: "click", at} (a click with no press:
 *   assistive technology) · {type: "cancel"} (pointer left, blur, Escape) · {type: "timeout"}.
 */
export function holdNext(state = HOLD_IDLE, event = {}) {
  const at = event.at ?? 0;
  const keep = { state, fire: false };
  const confirmStep = () => (state.phase === "confirm"
    ? (at - state.since < CONFIRM_GUARD_MS ? keep : { state: HOLD_IDLE, fire: true })
    : { state: { phase: "confirm", since: at }, fire: false });
  switch (event.type) {
    case "press":
      if (state.phase === "holding") return keep;
      if (state.phase === "confirm" || event.reduced) return confirmStep();
      return { state: { phase: "holding", since: at, via: event.via === "key" ? "key" : "pointer" }, fire: false };
    case "release":
      if (state.phase !== "holding") return keep;
      if (at - state.since >= HOLD_MS) return { state: HOLD_IDLE, fire: true };
      // Let go early. From the keyboard a short press is the first of two steps; with the
      // pointer it only says how it works.
      return state.via === "key" ? { state: { phase: "confirm", since: at }, fire: false } : { state: { phase: "hint", since: at }, fire: false };
    case "complete":
      return state.phase === "holding" && at - state.since >= HOLD_MS ? { state: HOLD_IDLE, fire: true } : keep;
    case "click":
      return state.phase === "holding" ? keep : confirmStep();
    case "cancel":
    case "timeout":
      return state.phase === "idle" ? keep : { state: HOLD_IDLE, fire: false };
    default:
      return keep;
  }
}

/** What the button shows in each phase (`label`: its usual text). */
export function holdLabel(state, label) {
  return state.phase === "confirm" ? "Confirmar" : state.phase === "hint" ? "Mantén pulsado" : label;
}
