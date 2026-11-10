// A step's provider conversation (what the model was sent and what it answered, tool outputs
// included) lives in a record of its own — kind "histories", id = the step's id — and is read
// only where the conversation itself is needed: running the step, resuming it, the learning
// reviews. The step record keeps two small things about it: `historyItems` (how many items;
// absent until the step starts) and `cards` (its latest tool calls as the room shows them,
// state.mjs toolDigest), so listing a mission's steps, /api/state and opening a chat never
// parse a conversation.
//
// Records written before this carry it inline (`step.history`): every read falls back to it,
// the first write moves it, and migrateHistories moves the rest in small batches at startup.
import { now } from "./store.mjs";
import { toolDigest } from "./state.mjs";

export const HISTORIES = "histories";

/** The conversation of a step (its id or its record): an array, or null before it starts. */
export function stepHistory(store, step) {
  const stepId = typeof step === "string" ? step : step?.id;
  if (!stepId) return null;
  const record = store.get(HISTORIES, stepId);
  if (Array.isArray(record?.items)) return record.items;
  const inline = (typeof step === "string" ? store.get("steps", stepId) : step)?.history;
  return Array.isArray(inline) ? inline : null;
}

/** How many items the step's conversation has, without reading it (0 before it starts). */
export const historySize = (step) => (Array.isArray(step?.history) ? step.history.length : step?.historyItems || 0);
/** Whether the step already has a conversation (it started at least once). */
export const hasHistory = (step) => Array.isArray(step?.history) || Number.isInteger(step?.historyItems);

const botsOf = (store) => ({ get: (id) => store.get("bots", id) });
const derived = (store, items) => ({ historyItems: items.length, cards: toolDigest(items, { bots: botsOf(store) }) });

/**
 * Writes the conversation of a step and, in the same transaction, `changes` to the step
 * record with its derived fields. Returns the step record (without the conversation).
 */
export function setStepHistory(store, stepId, items, changes = {}) {
  if (!Array.isArray(items)) throw Error("La conversación de un paso es una lista.");
  return store.tx(() => {
    const step = store.get("steps", stepId);
    if (!step) throw Error("No existe el registro.");
    store.put(HISTORIES, { id: stepId, missionId: step.missionId, items, updatedAt: now() }, { silent: true });
    // `history: undefined` drops the inline copy of an older record.
    return store.patch("steps", stepId, { ...changes, history: undefined, ...derived(store, items) });
  });
}

/** Removes the conversation of a step (the step itself is the caller's). */
export function removeStepHistory(store, stepId) {
  return store.remove(HISTORIES, stepId);
}

/**
 * One batch of the move of inline conversations (`step.history`) to their own records: steps
 * after the id `after`, for at most `ms` milliseconds or `max` steps, in one transaction (a
 * close half-way loses nothing: the batch either happened or it did not, and a step already
 * moved is skipped the next time). Nobody is notified. Returns { moved, after, done }.
 */
export function migrateHistories(store, { after = "", ms = 20, max = 200 } = {}) {
  const started = Date.now();
  const next = store.sql("SELECT id, data FROM records WHERE kind='steps' AND id > ? ORDER BY id LIMIT 1");
  let moved = 0, seen = 0, done = false;
  store.tx(() => {
    for (;;) {
      const row = next.get(after);
      if (!row) { done = true; break; }
      after = row.id;
      seen++;
      const step = store.decode("steps", row.id, row.data);
      if (Array.isArray(step.history)) {
        const { history, ...rest } = step;
        // A record of its own already there is the newer one.
        const kept = store.get(HISTORIES, step.id)?.items;
        if (!Array.isArray(kept))
          store.put(HISTORIES, { id: step.id, missionId: step.missionId, items: history, updatedAt: step.updatedAt || step.completedAt || step.createdAt || now() }, { silent: true });
        store.put("steps", { ...rest, ...derived(store, Array.isArray(kept) ? kept : history) }, { silent: true });
        moved++;
      }
      if (seen >= max || Date.now() - started >= ms) break;
    }
  });
  return { moved, after, done };
}

/**
 * Moves every inline conversation in the background: a short batch, a pause, the next one,
 * so the server keeps answering. Resolves with how many steps it moved (also if the store
 * closes meanwhile). Safe to run at every start: with nothing left it only walks the steps.
 */
export function startHistoryMigration(store, { pause = 40, ...options } = {}) {
  let after = "", total = 0;
  return new Promise((resolve) => {
    const tick = () => {
      let batch;
      try {
        batch = migrateHistories(store, { ...options, after });
      } catch (error) {
        if (!/closed|not open/i.test(String(error?.message))) console.warn("Colmena: no se pudieron mover las conversaciones de los pasos: " + error.message);
        return resolve(total);
      }
      after = batch.after;
      total += batch.moved;
      if (batch.done) return resolve(total);
      setTimeout(tick, pause).unref?.();
    };
    setTimeout(tick, pause).unref?.();
  });
}
