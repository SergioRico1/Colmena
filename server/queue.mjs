// What you write while a bot works waits in a visible queue (T3 Code queued runs): editable,
// reorderable, removable, kept in the conversation's record so it survives a restart, and
// sent by the server one at a time when the bot finishes («Cuando acabe»). «Pasárselo ya»
// takes a message out of the queue and gives it to the bot at its next step (steer).
import { id, now } from "./store.mjs";

export const QUEUE_MAX = 20;
export const QUEUE_TEXT_MAX = 20000;

export const queueOf = (mission) => (Array.isArray(mission?.queue) ? mission.queue : []);

/** The queue as the screens see it. */
export function queueView(mission) {
  const list = queueOf(mission);
  return { queue: list.map((q) => ({ id: q.id, text: q.text, at: q.at ?? null })), queuePaused: list.length ? mission.queuePaused ?? null : null };
}

function save(store, mission, queue, extra = {}) {
  return store.patch("missions", mission.id, { queue, ...(queue.length ? {} : { queuePaused: null }), ...extra });
}

export function enqueue(store, mission, text) {
  const body = String(text || "").trim().slice(0, QUEUE_TEXT_MAX);
  if (!body) throw Error("El mensaje está vacío.");
  const list = queueOf(mission);
  if (list.length >= QUEUE_MAX) throw Error(`La cola admite ${QUEUE_MAX} mensajes. Espera a que salga alguno.`);
  const item = { id: "q-" + id(), text: body, at: now() };
  save(store, mission, [...list, item]);
  return item;
}

export function editQueued(store, mission, itemId, text) {
  const body = String(text || "").trim().slice(0, QUEUE_TEXT_MAX);
  const list = queueOf(mission);
  if (!list.some((q) => q.id === itemId)) throw Object.assign(Error("Ese mensaje ya no está en la cola."), { status: 409 });
  // Emptied while editing: it leaves the queue.
  save(store, mission, body ? list.map((q) => (q.id === itemId ? { ...q, text: body } : q)) : list.filter((q) => q.id !== itemId));
}

/** Moves a message before `before` (null: to the end). */
export function moveQueued(store, mission, itemId, before = null) {
  const list = queueOf(mission);
  const item = list.find((q) => q.id === itemId);
  if (!item) throw Object.assign(Error("Ese mensaje ya no está en la cola."), { status: 409 });
  const rest = list.filter((q) => q.id !== itemId);
  const at = before ? rest.findIndex((q) => q.id === before) : rest.length;
  save(store, mission, [...rest.slice(0, at < 0 ? rest.length : at), item, ...rest.slice(at < 0 ? rest.length : at)]);
}

/** Takes one message out (to send it now, or because you removed it). */
export function takeQueued(store, mission, itemId) {
  const list = queueOf(mission);
  const item = list.find((q) => q.id === itemId);
  if (!item) throw Object.assign(Error("Ese mensaje ya no está en la cola."), { status: 409 });
  save(store, mission, list.filter((q) => q.id !== itemId));
  return item;
}

/** The bot has finished its turn and nothing waits for you: the next message can go. */
export function readyToDeliver(mission, runtime) {
  if (!mission || !queueOf(mission).length || mission.queuePaused) return false;
  if (runtime?.active?.has?.(mission.id)) return false;
  return mission.status === "completed";
}

/**
 * Sends the first queued message of `missionId` when the bot is free (one at a time: the
 * next one goes when that turn ends). A refused send puts it back first and pauses the
 * queue: it never resends on its own.
 */
export async function deliverNext(store, runtime, missionId, send) {
  const mission = store.get("missions", missionId);
  if (!readyToDeliver(mission, runtime)) return null;
  const [first, ...rest] = queueOf(mission);
  save(store, mission, rest);
  try {
    return await send(missionId, first.text);
  } catch (error) {
    const fresh = store.get("missions", missionId);
    store.patch("missions", missionId, { queue: [first, ...queueOf(fresh).filter((q) => q.id !== first.id)], queuePaused: String(error?.message || "No se pudo enviar.").slice(0, 300) });
    return null;
  }
}

/**
 * Watches the store: when a conversation with a queue finishes its turn, its next message
 * goes (after a short pause, so a turn that chains into another is not cut in).
 */
export function watchQueues(store, runtime, send, { delayMs = 600 } = {}) {
  const timers = new Map();
  const check = (missionId) => {
    clearTimeout(timers.get(missionId));
    const t = setTimeout(() => { timers.delete(missionId); void deliverNext(store, runtime, missionId, send).catch(() => {}); }, delayMs);
    t.unref?.();
    timers.set(missionId, t);
  };
  const listener = (event) => {
    if (event?.type === "record" && event.kind === "missions" && event.op !== "remove") {
      const m = store.get("missions", event.id);
      if (queueOf(m).length) check(event.id);
    } else if (event?.type === "completed" && event.mission) check(event.mission);
  };
  store.listeners.add(listener);
  // After a restart: what was waiting goes once the bots are free.
  for (const m of store.list("missions")) if (queueOf(m).length) check(m.id);
  return () => { store.listeners.delete(listener); for (const t of timers.values()) clearTimeout(t); };
}
