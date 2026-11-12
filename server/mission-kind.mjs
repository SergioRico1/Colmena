// What a mission is to the person (docs/ROOMS-CONTRACT.md): the chat with one bot, a room
// («sala») or a task of Trabajo. It is stored as `mission.kind` when the mission is made and
// backfilled for older ones (server/room.mjs sweep); until then it is worked out here, the same
// way every time, so the answer never depends on who asks.
import { titleFromPrompt } from "./runtime/helpers.mjs";

export const MISSION_KINDS = Object.freeze(["chat", "sala", "tarea"]);

/**
 * "chat" | "sala" | "tarea". A stored kind wins. Without one:
 *  - a conversation with one bot (its thread, a private chat, an errand, «Tus novedades») is a chat;
 *  - a run of a routine is a task;
 *  - a conversation with several bots is a room (a chat someone added bots to);
 *  - a piece of work for one bot, or with a delivery date, is a task;
 *  - work for the team is a room when the person named it («Nueva sala» gives a name; a task is
 *    titled from what was asked) and a task otherwise. In doubt it is a room: a task also
 *    listed as a room is how it was before, a room missing from the list is not.
 */
export function missionKind(m) {
  if (!m) return "tarea";
  if (MISSION_KINDS.includes(m.kind)) return m.kind;
  const bots = Array.isArray(m.botIds) ? m.botIds.length : 0;
  if (m.incognito || m.watch || (m.conversation && bots <= 1)) return "chat";
  if (m.automationId) return "tarea";
  if (m.conversation) return "sala";
  if ((m.mode || "solo") === "solo" || m.dueAt) return "tarea";
  const named = !!m.titled || String(m.title || "") !== titleFromPrompt(String(m.prompt || ""));
  return named ? "sala" : "tarea";
}

/** A mission that is a room of yours: never a private chat, a routine's run or a task. */
export const isRoomMission = (m) => !!m && !m.incognito && !m.automationId && missionKind(m) === "sala";
