// Pure helpers of the store's live text (stepId → { botId, mission, text }), kept apart so
// the tests can import them without JSX.

/** One more delta for a step, merged with what already waits for the next frame. */
export function queueDelta(prev, event) {
  return {
    botId: event.botId, mission: event.mission,
    reset: event.reset || prev?.reset || false,
    text: event.reset ? event.text || "" : (prev?.text || "") + (event.text || ""),
  };
}

/** The deltas waiting for a frame ([stepId, queued] pairs) applied to the live text. */
export function applyDeltas(all, batch) {
  const next = { ...all };
  for (const [stepId, d] of batch) next[stepId] = { botId: d.botId, mission: d.mission, text: (d.reset ? "" : all[stepId]?.text || "") + d.text };
  return next;
}

/**
 * The server's snapshot of every step still writing (first frame of each /api/events
 * stream) replaces the browser's copy: what the gap lost comes back, and a step that
 * ended while the stream was down goes. Same text everywhere → the same object.
 */
export function applyLiveSnapshot(all, steps) {
  const next = {};
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s?.stepId) continue;
    next[s.stepId] = { botId: s.botId ?? null, mission: s.mission ?? null, text: String(s.text || "") };
  }
  const before = Object.keys(all || {});
  const same = before.length === Object.keys(next).length
    && before.every((k) => next[k] && next[k].text === all[k].text && next[k].botId === all[k].botId && next[k].mission === all[k].mission);
  return same ? all : next;
}
