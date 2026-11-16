// Who may see which conversation. On the desktop there is one person and everything is theirs.
// The hosted app plugs its rule into its store (server/cloud/host.mjs › store.missionVisible: a
// direct message, a private room and a chat with a bot are only for their people), and every
// place that reads across conversations (search, deliverables, notifications, the bots' history
// and memory tools, @-references) asks here. The rule lives on the store, not in this module:
// several companies can share one process.
import { currentPerson } from "./identity.mjs";

/** Whether the person acting may see this conversation (a mission record or its id). */
export function canSeeMission(store, mission, person = currentPerson()) {
  if (!mission || typeof store?.missionVisible !== "function") return true;
  return store.missionVisible(mission, person);
}
/** A filter for records that belong to a conversation (`missionId`): only the visible ones. */
export const visibleRecord = (store, person = currentPerson()) => (r) => !r?.missionId || canSeeMission(store, r.missionId, person);
