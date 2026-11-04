import { useEffect, useRef, useState } from "react";

// Live text that flows instead of jumping (after assistant-ui utils/smooth/useSmooth.ts, MIT):
// each burst that arrives from the model is revealed over ~250 ms, a character at a time
// (never slower than one every 5 ms), so 50 ms windows of text read as writing, not as
// blocks. With «reduce motion» it shows everything at once; when the answer finishes before
// anything was painted it shows whole; a new step or another chat starts from its own text.

export const DRAIN_MS = 250;
export const MAX_CHAR_MS = 5;

/** The reveal, without React: `tick(now)` advances it; `onText(text)` gets each new prefix. */
export class TextReveal {
  constructor(onText, { drainMs = DRAIN_MS, maxCharMs = MAX_CHAR_MS } = {}) {
    this.onText = onText;
    this.drainMs = drainMs;
    this.maxCharMs = maxCharMs;
    this.shown = "";
    this.target = "";
    this.last = 0;
  }

  /** New text from the model. Returns true while there is something left to reveal. */
  setTarget(text, now) {
    if (!text.startsWith(this.shown)) {
      // Not a continuation (a reset, a retry): start again from nothing.
      this.shown = "";
      this.onText("");
    }
    if (this.target.length <= this.shown.length) this.last = now;
    this.target = text;
    return this.shown.length < this.target.length;
  }

  /** Shows all of it now. */
  finish() {
    this.shown = this.target;
    this.onText(this.shown);
  }

  /** One frame. Returns true while there is more to reveal. */
  tick(now) {
    const left = this.target.length - this.shown.length;
    if (left <= 0) return false;
    let time = now - this.last;
    const perChar = Math.min(this.maxCharMs, this.drainMs / left);
    let add = 0;
    while (time >= perChar && add < left) { add++; time -= perChar; }
    if (!add) return true;
    this.shown = this.target.slice(0, this.shown.length + add);
    this.last = now - time;
    this.onText(this.shown);
    return add < left;
  }
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * `text` revealed smoothly while `running`. `streamKey` (the step) restarts it for another
 * answer; once `running` is false the whole text shows.
 */
export function useSmoothText(text, { running = true, streamKey = null } = {}) {
  const value = String(text || "");
  const enabled = running && !reducedMotion();
  const [shown, setShown] = useState(enabled ? "" : value);
  const reveal = useRef(null);
  const key = useRef(streamKey);
  const frame = useRef(0);
  // Another step, or a chat switch: never paint the previous answer's text, not even once.
  if (key.current !== streamKey) {
    key.current = streamKey;
    if (shown !== (enabled ? "" : value)) setShown(enabled ? "" : value);
  }
  useEffect(() => {
    const stop = () => { cancelAnimationFrame(frame.current); frame.current = 0; };
    if (!enabled) {
      stop();
      reveal.current = null;
      setShown(value);
      return;
    }
    if (!reveal.current || reveal.current.key !== streamKey) {
      stop();
      reveal.current = Object.assign(new TextReveal(setShown), { key: streamKey });
    }
    const r = reveal.current;
    if (!r.setTarget(value, performance.now()) || frame.current) return;
    const step = (now) => {
      frame.current = r.tick(now) ? requestAnimationFrame(step) : 0;
    };
    frame.current = requestAnimationFrame(step);
  }, [value, enabled, streamKey]);
  // A hidden window gets no frames: catch up when it shows again.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisible = () => { if (document.visibilityState === "visible" && reveal.current) reveal.current.finish(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, []);
  return enabled ? shown : value;
}
