// One chat per bot (server/threads.mjs): which of a bot's chats is its thread, and its others.

const ownChat = (m, botId) => m.conversation && m.botIds?.length === 1 && m.botIds[0] === botId && !m.incognito && !m.automationId && !m.archived && m.status !== "cancelled";
const lastAt = (m) => Date.parse(m.updatedAt || m.completedAt || m.createdAt || 0) || 0;

/** The bot's thread: the one the server marked, else its most recent chat. */
export function threadOf(missions = [], botId) {
  const own = missions.filter((m) => ownChat(m, botId)).sort((a, b) => lastAt(b) - lastAt(a));
  return own.find((m) => m.thread) || own[0] || null;
}

/** Its other chats, newest first. */
export function olderOf(missions = [], botId, threadId) {
  return missions.filter((m) => ownChat(m, botId) && m.id !== threadId).sort((a, b) => lastAt(b) - lastAt(a));
}

/** The chats list: each bot's thread once (newest activity of any of its chats) and rooms. Private chats stay out, like ChatGPT's, except the one open now. */
export function listRows(missions = [], current = null) {
  const rows = [];
  const seen = new Set();
  for (const m of missions) {
    if (m.archived || m.status === "cancelled" || m.automationId) continue;
    if (m.incognito && m.id !== current) continue;
    const solo = m.conversation && m.botIds?.length === 1 && !m.incognito;
    if (!solo) { rows.push(m); continue; }
    const bot = m.botIds[0];
    if (seen.has(bot)) continue;
    seen.add(bot);
    const thread = threadOf(missions, bot);
    if (!thread) continue;
    // The row moves up with the latest activity of any of the bot's chats.
    const latest = missions.filter((x) => ownChat(x, bot)).reduce((a, x) => Math.max(a, lastAt(x)), 0);
    rows.push({ ...thread, rowAt: new Date(latest).toISOString() });
  }
  return rows.sort((a, b) => Date.parse(b.rowAt || b.updatedAt || b.createdAt || 0) - Date.parse(a.rowAt || a.updatedAt || a.createdAt || 0));
}
