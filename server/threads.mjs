// One conversation per bot (as Dots, ChatGPT's assistants): writing to Vera from anywhere — her
// chat, Hoy, Ctrl+K, the quick ask — continues the same thread, and her own notes («Tus
// novedades») land there too. Older separate chats stay reachable from the thread. Private
// (incognito) chats and rooms keep their own place.
//
// Hosted (docs/CLOUD.md), a chat with a bot is one person's: each person has their own thread
// with each bot, and nobody else sees it (server/cloud/host.mjs › canSee).
import { currentPerson } from "./identity.mjs";

/** A chat with one bot that belongs to one person: not a room, a direct message or a channel's thread. */
export const personalChat = (m) => !!m?.conversation && Array.isArray(m.botIds) && m.botIds.length === 1 && !m.people && !m.dm && !m.channelThread;
/** Whose that chat is (hosted): its audience, else whoever started it; null when nobody's. */
export const chatOwner = (m) => (Array.isArray(m?.audience) && m.audience.length === 1 ? m.audience[0] : m?.createdBy || null);
/** On the desktop every chat is yours; hosted, only the ones you started (background work: nobody's). */
const yours = (m) => {
  const p = currentPerson();
  if (p.desktop) return true;
  return chatOwner(m) === (p.system ? null : p.id);
};

/** Whether you may read or continue this chat (hosted: someone else's chat with a bot is not). */
export function mayUseChat(m) {
  const p = currentPerson();
  return !personalChat(m) || p.desktop || !chatOwner(m) || chatOwner(m) === p.id;
}

const isOwnChat = (m, botId) =>
  m.conversation && Array.isArray(m.botIds) && m.botIds.length === 1 && m.botIds[0] === botId &&
  !m.incognito && !m.automationId && !m.archived && m.status !== "cancelled" && !m.people && !m.dm && !m.channelThread && yours(m);
const lastAt = (m) => Date.parse(m.updatedAt || m.completedAt || m.createdAt || 0) || 0;

/** The bot's thread: the one marked as such, else its most recent chat (marked from then on). */
export function botThread(store, botId, { mark = true } = {}) {
  const own = store.list("missions").filter((m) => isOwnChat(m, botId));
  const marked = own.filter((m) => m.thread).sort((a, b) => lastAt(b) - lastAt(a))[0];
  if (marked) return marked;
  const latest = own.sort((a, b) => lastAt(b) - lastAt(a))[0] || null;
  return latest && mark ? store.patch("missions", latest.id, { thread: true }) : latest;
}

/** The bot's other chats, newest first (the «Conversaciones anteriores» of its thread). */
export function olderChats(store, botId, threadId) {
  return store.list("missions").filter((m) => isOwnChat(m, botId) && m.id !== threadId).sort((a, b) => lastAt(b) - lastAt(a));
}
