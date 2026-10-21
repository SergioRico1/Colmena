import { useEffect, useRef, useState } from "react";

/**
 * Three dots for someone typing, exactly as V2Sala draws them: 5 px, #5C606C, the v2 «dots»
 * keyframes at 1.2 s, 0.15 s apart. (A bot at work is its own breathing shape instead.)
 * The phase comes from the clock, not from when the element appeared, so a line that
 * re-renders or remounts with every bit of activity keeps moving smoothly.
 */
const CYCLE = 1200;
export default function WorkingDots({ style }) {
  // Fixed at mount: then the dots sit at «now modulo the cycle» through re-renders too.
  const [offset] = useState(() => -(Date.now() % CYCLE));
  const dot = (delay) => ({ width: "5px", height: "5px", borderRadius: "50%", background: "currentColor", animation: `dots ${CYCLE}ms ${offset + delay}ms infinite` });
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#5C606C", ...style }}>
      <span style={dot(0)} /><span style={dot(150)} /><span style={dot(300)} />
    </span>
  );
}

/**
 * Keeps each value on screen at least `ms` so a fast series of actions stays readable
 * (OpenClaw holds the current operation's title briefly).
 */
export function useHeld(value, ms = 1200) {
  const [shown, setShown] = useState(value);
  const since = useRef(Date.now());
  useEffect(() => {
    if (value === shown) return undefined;
    const wait = Math.max(0, ms - (Date.now() - since.current));
    const t = setTimeout(() => { since.current = Date.now(); setShown(value); }, wait);
    return () => clearTimeout(t);
  }, [value, shown, ms]);
  return shown;
}

/** Seconds left until `at + wait` (null when none), ticking every second. */
export function useCountdown(until) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : null;
}
