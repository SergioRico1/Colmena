// One conversation per bot (as Dots, ChatGPT's assistants): writing to Vera from anywhere — her
// chat, Hoy, Ctrl+K, the quick ask — continues the same thread, and her own notes («Tus
// novedades») land there too. Older separate chats stay reachable from the thread. Private
// (incognito) chats and rooms keep their own place.

const isOwnChat = (m, botId) =>
  m.conversation && Array.isArray(m.botIds) && m.botIds.length === 1 && m.botIds[0] === botId &&
  !m.incognito && !m.automationId && !m.archived && m.status !== "cancelled";
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
