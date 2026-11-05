// What every in-flight step has streamed so far (DeepSeek Harness web client §Reconnection):
// the live text pieces are only ever sent once, so a browser whose /api/events stream drops
// for a moment would miss the ones sent during the gap until the step ends. The app keeps
// one copy of each live step's text here; a (re)connecting stream starts with it, and the
// client replaces its own copy before later pieces append.

export const LIVE_SNAPSHOT_MAX_STEPS = 64;

/** Returns { apply(event), snapshot(), clear() } over the runtime's live events. */
export function createLiveSnapshot({ maxSteps = LIVE_SNAPSHOT_MAX_STEPS } = {}) {
  const steps = new Map(); // stepId → { stepId, botId, mission, text }, oldest first
  const dropWhere = (fn) => {
    for (const [key, entry] of steps) if (fn(entry)) steps.delete(key);
  };
  const apply = (event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "delta" && event.stepId) {
      const prev = steps.get(event.stepId);
      // A reset (a retry, or a part already said in the room) starts the step's text again.
      const text = event.reset ? String(event.text || "") : (prev?.text || "") + String(event.text || "");
      steps.delete(event.stepId);
      steps.set(event.stepId, { stepId: event.stepId, botId: event.botId ?? prev?.botId ?? null, mission: event.mission ?? prev?.mission ?? null, text });
      while (steps.size > maxSteps) steps.delete(steps.keys().next().value);
      return;
    }
    // The bot stopped (paused, interrupted, failed): its half-written text goes, as in the room.
    if (event.type === "activity" && !event.verb && event.botId) return dropWhere((s) => s.botId === event.botId && s.mission === event.mission);
    if (event.type === "step_done") {
      steps.delete(event.stepId);
      return;
    }
    if (event.type === "completed" && event.mission) dropWhere((s) => s.mission === event.mission);
  };
  const snapshot = () => [...steps.values()].map((s) => ({ ...s }));
  return { apply, snapshot, clear: () => steps.clear() };
}
