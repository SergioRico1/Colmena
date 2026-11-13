// What a mission is to the person (docs/ROOMS-CONTRACT.md): the chat with one bot, a room
// («sala») or a task of Trabajo. It is stored as `mission.kind`, with `kindBy` saying who decided:
//   "created"  the code that made the mission (what was asked for, or what the shape says then);
//   "person"   the person moved it («Mover a Salas» / «Mover a Trabajo»);
//   "inferred" worked out here for a mission made before kinds existed (server/room.mjs sweep),
//              with `kindRule` = the version of the rule that did it.
// A kind with no `kindBy` was written by a build that had kinds but not this flag (never
// released): it is treated as inferred. Only inferred kinds are ever worked out again, and only
// when KIND_RULE changes; one that was created or chosen by the person is never touched.
import { titleFromPrompt } from "./runtime/helpers.mjs";

export const MISSION_KINDS = Object.freeze(["chat", "sala", "tarea"]);
/** Bump when inferKind changes: inferred kinds are worked out again on the next start. */
export const KIND_RULE = 2;

/** True when this kind was decided by the code that made the mission or by the person. */
export const kindIsExplicit = (m) => !!m && MISSION_KINDS.includes(m.kind) && (m.kindBy === "created" || m.kindBy === "person");
/** An inferred kind that the current rule has not looked at yet. */
export const kindNeedsInference = (m) => !!m && !kindIsExplicit(m) && !(MISSION_KINDS.includes(m.kind) && m.kindBy === "inferred" && m.kindRule === KIND_RULE);

const words = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The person named it: a title that is not the one made from the request, or a #slug with a
 * word its title does not have (a slug made from the title only takes the title's words, plus
 * «-2» when taken; a renamed one, like #informe-q3, says something else).
 */
export function namedByPerson(m) {
  if (m.titled) return true;
  const title = String(m.title || "");
  if (title && title !== titleFromPrompt(String(m.prompt || ""))) return true;
  if (!m.room) return false;
  const own = new Set([...words(title), "sala"]);
  return words(String(m.room).replace(/-\d+$/, "")).some((w) => !own.has(w));
}

/**
 * The one rule for a mission with no explicit kind. `signals` comes from the store
 * (kindSignals): `userMessages` (the person's messages in it, the first request included) and
 * `goal` (a goal's milestone points at it). Returns { kind, why } so every decision can be read.
 *
 * In order:
 *  1. a conversation with one bot (its thread, a private chat, «Tus novedades») is a chat;
 *  2. a run of a routine is a task;
 *  3. a conversation with several bots is a room (a chat someone added bots to);
 *  4. used as a conversation: the person wrote again after the first request, so it is a room;
 *  5. team work the person named (a title of their own, or a #slug they renamed) is a room:
 *     that is what «Nueva sala» made, a due date or a plan in it notwithstanding;
 *  6. task markers: a due date, a goal's milestone, work for one bot, a title made from the
 *     request (what «Nueva tarea», Inicio and Ctrl+K sent) are a task;
 *  7. in doubt, a room: a task listed as a room is how it was before, a room missing is not.
 */
export function inferKind(m, signals = {}) {
  if (!m) return { kind: "tarea", why: "no mission" };
  const bots = Array.isArray(m.botIds) ? m.botIds.length : 0;
  if (m.incognito || m.watch || (m.conversation && bots <= 1)) return { kind: "chat", why: "a conversation with one bot" };
  if (m.automationId) return { kind: "tarea", why: "a run of a routine" };
  if (m.conversation) return { kind: "sala", why: "a conversation with several bots" };
  if ((signals.userMessages || 0) > 1) return { kind: "sala", why: "the person wrote in it after the first request" };
  const team = (m.mode && m.mode !== "solo") || bots > 1;
  if (team && namedByPerson(m)) return { kind: "sala", why: "team work the person named" };
  if (m.dueAt) return { kind: "tarea", why: "it has a due date" };
  if (signals.goal) return { kind: "tarea", why: "a goal's milestone points at it" };
  if (!team) return { kind: "tarea", why: "work for one bot" };
  if (String(m.title || "") === titleFromPrompt(String(m.prompt || ""))) return { kind: "tarea", why: "titled from the request" };
  return { kind: "sala", why: "in doubt" };
}

/** What the store knows about how a mission was used (for inferKind). */
export function kindSignals(store, m, goalMissions = null) {
  let userMessages = 0;
  for (const x of store.where("messages", "missionId", m.id)) if (x.role === "user" && (x.kind || "message") === "message" && !x.copied) userMessages++;
  const goal = goalMissions ? goalMissions.has(m.id) : store.list("goals").some((g) => (g.milestones || []).some((x) => (x.missionIds || []).includes(m.id)));
  return { userMessages, goal };
}
/** The ids of missions a goal's milestone points at. */
export const goalMissionIds = (store) => new Set(store.list("goals").flatMap((g) => (g.milestones || []).flatMap((x) => x.missionIds || [])));

/**
 * "chat" | "sala" | "tarea". A stored kind wins; without one (a mission an older Colmena wrote
 * after the sweep) the rule above, on the record alone.
 */
export function missionKind(m) {
  if (!m) return "tarea";
  if (MISSION_KINDS.includes(m.kind)) return m.kind;
  return inferKind(m).kind;
}

/** A mission that is a room of yours: never a private chat, a routine's run or a task. */
export const isRoomMission = (m) => !!m && !m.incognito && !m.automationId && missionKind(m) === "sala";

/** Where a mission opens: a chat at its bot, a task at its page, a room at /sala/:id. */
export function missionHref(m) {
  if (!m) return "/";
  const kind = missionKind(m);
  if (m.conversation && kind === "chat") return "/chat/" + (m.botIds?.[0] || "nora") + "?c=" + m.id;
  if (kind === "tarea") return "/encargo/" + m.id;
  if (m.mode === "debate" && m.status === "awaiting_choice") return "/sala/" + m.id + "/debate";
  return "/sala/" + m.id;
}
/** How a mission is named where it is cited: «#slug» only for a room. */
export function placeName(m) {
  if (!m) return "";
  if (missionKind(m) === "sala") return "#" + (m.room || m.title || "sala");
  return m.title || (m.conversation ? "Conversación" : "Tarea");
}
