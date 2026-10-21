// Live events reach the browser in ~50 ms windows (T3 Code ThreadLiveEventCoalescer and
// ProviderTextDeltaCoalescer): the tiny text pieces a model streams for one step travel as
// one delta per window, and a bot's activity only as its latest state. Anything else first
// sends what was waiting, so the order the room sees never changes.

export const LIVE_WINDOW_MS = 50;

/**
 * `write(event)` sends one event. Returns { push(event), flush(), close() }: `push` takes a
 * live event (delta, activity, step_done, notify…), `flush` sends what waits right away.
 */
export function createLiveCoalescer(write, { windowMs = LIVE_WINDOW_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const waiting = new Map(); // key → event, in first-seen order
  let timer = null;
  const flush = () => {
    if (timer) clearTimer(timer);
    timer = null;
    if (!waiting.size) return;
    const batch = [...waiting.values()];
    waiting.clear();
    for (const event of batch) write(event);
  };
  const later = () => {
    timer ??= setTimer(flush, windowMs);
    timer?.unref?.();
  };
  const push = (event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "delta" && event.stepId && !event.reset) {
      const key = "delta:" + event.stepId;
      const prev = waiting.get(key);
      waiting.set(key, prev ? { ...prev, text: (prev.text || "") + (event.text || "") } : { ...event, text: event.text || "" });
      return later();
    }
    if (event.type === "activity" && event.verb && event.botId) {
      // Only the latest state counts; it moves to the end so it lands after what came before.
      const key = "activity:" + event.mission + ":" + event.botId;
      waiting.delete(key);
      waiting.set(key, event);
      return later();
    }
    // A reset (a retry, or text already said in the room: it follows that message at once),
    // a stop (activity without a verb), a finished step or a notification: in order, now.
    flush();
    write(event);
  };
  const close = () => {
    if (timer) clearTimer(timer);
    timer = null;
    waiting.clear();
  };
  return { push, flush, close };
}
