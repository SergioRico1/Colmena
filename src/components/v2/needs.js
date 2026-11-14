import { splitSnoozed } from "../../lib/snooze.js";

// «Te necesitan» (honey only means «we need you»): what waits for your decision. There is ONE
// definition, on the server: `waitingItems` (server/waiting.mjs), which travels in /api/state
// as `waiting`: pending approvals and questions that are not put off nor expired, rooms that
// wait for you to choose a proposal or a plan and have no such request, open notes of the bot
// that watches your apps, and what other people ask of your bots. Every count in the app is
// the length of that list or a filter of it: the Inicio badge, the sidebar, Trabajo, Equipo
// and Actividad all read it through this file.
const DECIDE = new Set(["awaiting_choice", "awaiting_plan"]);
const stamp = (iso) => Date.parse(iso || 0) || 0;

/**
 * The same list, from a state that does not carry `waiting` (a snapshot kept by an older
 * version, shown for a moment while the fresh state loads). It mirrors server/waiting.mjs;
 * the approvals of a state already come without the expired ones marked as pending.
 */
function localWaiting({ approvals = [], missions = [], watchNotes = [] } = {}, now = Date.now()) {
  const pending = approvals.filter((a) => a.status === "pending");
  const covered = new Set(pending.map((a) => a.missionId));
  const { waiting } = splitSnoozed(pending, now);
  const chat = (id) => missions.find((m) => m.id === id && m.conversation && m.botIds?.length === 1);
  return [
    ...waiting.map((a) => ({ kind: "approval", id: a.id, missionId: a.missionId ?? null, roomId: a.missionId ?? null, botId: a.kind === "plan" && !chat(a.missionId) ? null : a.botId ?? null, what: a.kind || "permission", at: a.createdAt ?? null })),
    ...missions.filter((m) => DECIDE.has(m.status) && !covered.has(m.id) && !m.archived).map((m) => ({ kind: "mission", id: m.id, missionId: m.id, roomId: m.id, botId: m.conversation && m.botIds?.length === 1 ? m.botIds[0] : null, what: m.status, at: m.updatedAt ?? m.createdAt ?? null })),
    ...(watchNotes || []).map((n) => ({ kind: "note", id: n.id, missionId: n.missionId ?? null, roomId: n.missionId ?? null, botId: n.botId ?? null, what: "note", at: n.createdAt ?? null })),
  ].sort((x, y) => stamp(x.at) - stamp(y.at));
}

/**
 * What waits for you now, the oldest first: [{kind, id, missionId, roomId, botId, what, at}].
 * A request you have just decided is hidden at once (its record leaves the store while its
 * undo notice is up), so it leaves this list with it.
 */
export function waitingOf(store = {}, now = Date.now()) {
  if (!Array.isArray(store.waiting)) return localWaiting(store, now);
  const pending = new Set((store.approvals || []).filter((a) => a.status === "pending").map((a) => a.id));
  const rooms = new Set((store.missions || []).map((m) => m.id));
  return store.waiting.filter((item) => (item.kind === "approval" ? pending.has(item.id) : item.kind === "mission" ? rooms.has(item.id) : true));
}

/** The one number: how many things wait for you. */
export function needsCount(store, now = Date.now()) {
  return waitingOf(store, now).length;
}

/**
 * The list with its records, for the screens that draw them:
 *   asks: approvals and questions · choices: rooms waiting for a choice or a plan · notes: the
 *   watching bot's questions · errands: what other people ask of your bots · snoozed: what you
 *   put off («Recordar después»), which is not in the list until its time · items: the list.
 */
export function needsOf(store = {}, now = Date.now()) {
  const { approvals = [], missions = [], watchNotes = [] } = store;
  const items = waitingOf(store, now);
  const ids = (kind) => new Set(items.filter((i) => i.kind === kind).map((i) => i.id));
  const asking = ids("approval"), choosing = ids("mission"), noted = ids("note");
  const { snoozed } = splitSnoozed(approvals.filter((a) => a.status === "pending"), now);
  return {
    items,
    asks: approvals.filter((a) => asking.has(a.id)),
    choices: missions.filter((m) => choosing.has(m.id)),
    notes: (watchNotes || []).filter((n) => noted.has(n.id)),
    errands: items.filter((i) => i.kind === "errand"),
    // Another person asks you to decide a red line of their routine (server/peers/delegation.mjs).
    delegated: items.filter((i) => i.kind === "delegated"),
    snoozed,
  };
}

/**
 * A surface that lists only some rooms (Trabajo lists tasks): its number is the cards it shows,
 * exactly, and when the whole list holds more it links to it: «2 en Trabajo · ver las 5».
 * {here: cards, total, more, text, link, label}.
 */
export function countIn(missions = [], total = 0) {
  const here = missions.length;
  const items = missions.reduce((n, m) => n + (m.waiting || 0), 0);
  const more = total > here;
  return {
    here, total, more, text: String(here),
    link: more ? `ver las ${total}` : null,
    label: (here === 1 ? "1 tarea te espera" : `${here} tareas te esperan`) + (more ? `; en total te esperan ${total} cosas` : items > here ? ` (${items} cosas)` : ""),
  };
}

/** How many of those things wait in each room and for each bot: {rooms: Map, bots: Map}. */
export function waitingBy(items = []) {
  const rooms = new Map(), bots = new Map();
  const add = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
  for (const item of items) { add(rooms, item.roomId || item.missionId); add(bots, item.botId); }
  return { rooms, bots };
}
