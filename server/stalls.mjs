// Event-loop stall monitor (T3 Code's EventLoopMonitor): samples the loop's delay and writes a
// line when the server stood still for STALL_MS or more — a synchronous parse, a big write, a
// regex gone wrong. Nothing else changes; it only makes the slow spots visible (/api/health).
import { monitorEventLoopDelay } from "node:perf_hooks";

export const STALL_MS = 2000;
const EVERY_MS = 30000;

export function watchStalls({ log = (line) => console.warn(line), every = EVERY_MS, threshold = STALL_MS } = {}) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const state = { last: null, count: 0, worstMs: 0 };
  let tick = performance.now();
  const timer = setInterval(() => {
    // The histogram's own sample of a pause may land after this tick (and the reset would lose
    // it): how late this tick came is the same pause, seen from here.
    const now = performance.now(), late = now - tick - every;
    tick = now;
    const maxMs = Math.round(Math.max(histogram.max / 1e6, late));
    histogram.reset();
    if (maxMs < threshold) return;
    state.count++;
    state.worstMs = Math.max(state.worstMs, maxMs);
    state.last = { at: new Date().toISOString(), ms: maxMs };
    log(`Colmena: el servidor estuvo parado ${maxMs} ms (bloqueo del bucle de eventos).`);
  }, every);
  timer.unref?.();
  return { state, stop: () => { clearInterval(timer); histogram.disable(); } };
}
