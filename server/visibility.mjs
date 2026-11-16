// Who may see which conversation. On the desktop there is one person and everything is theirs.
// The hosted app plugs its rule into its store (server/cloud/host.mjs › store.missionVisible: a
// direct message, a private room and a chat with a bot are only for their people), and every
// place that reads across conversations (search, deliverables, notifications, the bots' history
// and memory tools, @-references) asks here. The rule lives on the store, not in this module:
// several companies can share one process.
import path from "node:path";
import { currentPerson, isPerson } from "./identity.mjs";
import { memoryTarget } from "./memory.mjs";

/** Whether the person acting may see this conversation (a mission record or its id). */
export function canSeeMission(store, mission, person = currentPerson()) {
  if (!mission || typeof store?.missionVisible !== "function") return true;
  return store.missionVisible(mission, person);
}
/** A filter for records that belong to a conversation (`missionId`): only the visible ones. */
export const visibleRecord = (store, person = currentPerson()) => (r) => !r?.missionId || canSeeMission(store, r.missionId, person);

// ------------------------------------------------------------------ what is learned about a person
// On the desktop there is one person. Hosted, what a bot learns about someone («Lo que sabes de
// la persona», USER.md) is that person's alone: it carries their id (personId), only their bots'
// turns for them read it, and their USER.md lives in a folder of their own. What a bot learns
// about work («Lo que sabe el equipo», its own memory) stays shared, except what was learned in
// a conversation the person may not see.

/**
 * A record of what is learned about the person acting: {personId} hosted, {} on the desktop.
 * Background work (a review after the turn) learns for the person of its conversation.
 */
export function personalTag(person = currentPerson(), mission = null) {
  if (isPerson(person)) return { personId: person.id };
  if (person?.system && mission) return { personId: (mission.audience?.length === 1 ? mission.audience[0] : null) || mission.askedBy || mission.createdBy || null };
  return {};
}
/** Whether this memory may be shown to, or used for, the person acting. */
export function canUseMemory(store, m, person = currentPerson()) {
  if (!m) return false;
  if (person?.desktop) return true;
  if (m.missionId && !canSeeMission(store, m.missionId, person)) return false;
  if (memoryTarget(m) !== "user") return true;
  return isPerson(person) && m.personId === person.id;
}
export const usableMemory = (store, person = currentPerson()) => (m) => canUseMemory(store, m, person);
/** Where the person's USER.md lives: the data folder on the desktop, people/<id> hosted; null for background work. */
export function profileDirectory(store, person = currentPerson()) {
  if (person?.desktop) return store?.directory || null;
  if (!isPerson(person) || !store?.directory) return null;
  return path.join(store.directory, "people", person.id.replace(/[^A-Za-z0-9_-]/g, ""));
}
/** The key its USER.md versions carry (doc-history.mjs keys a document by botId): null on the desktop. */
export function profileKey(person = currentPerson()) {
  return person?.desktop || !isPerson(person) ? null : "persona:" + person.id;
}
