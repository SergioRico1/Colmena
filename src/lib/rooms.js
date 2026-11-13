// Is this a room? One answer for every screen (docs/ROOMS-CONTRACT.md). The server stores a
// `kind` on each mission ("chat" with one bot, "sala" a room, "tarea" a task of Trabajo:
// server/mission-kind.mjs) and /api/state says it only when the shape does not give it away:
// a conversation with one bot is a chat, a routine's run a task, anything else a room.
export const missionKind = (m) => (m?.kind ? m.kind : m?.conversation && m.botIds?.length === 1 ? "chat" : m?.automationId ? "tarea" : "sala");
export const isBotChat = (m) => missionKind(m) === "chat";
export const isSala = (m) => missionKind(m) === "sala";
export const isTask = (m) => missionKind(m) === "tarea";
/** What Trabajo lists: the tasks, by their stored kind. Rooms and chats live in the sidebar. */
export const tasksOf = (missions = []) => missions.filter((m) => isTask(m) && !m.conversation && m.status !== "cancelled");

/**
 * The links of a room of /api/state (`rooms`, server/room.mjs): its sala (`missionId`), its
 * conversation with people (`shareId`), its name and where it opens: every room at /sala/:id. The state
 * is lean: a private room leaves `missionId` out when it is the room's own id, and its
 * `title`, which is its sala's name (`missions`: the snapshot's missions).
 */
export function roomLinks(room, missions = []) {
  const shareId = room?.shareId || null;
  const missionId = room?.missionId ?? (shareId ? null : room?.id ?? null);
  const sala = room?.title || !missionId ? null : missions.find((m) => m.id === missionId);
  return { missionId, shareId, title: room?.title || sala?.room || sala?.title || "sala", href: shareId ? `/sala/${room?.id || shareId}` : `/sala/${missionId}` };
}
