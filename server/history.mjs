// Long conversations open with their latest messages and page backwards as you scroll up
// (T3 Code threadHistoryPaging: a bounded recent window plus a cursor to the older pages).
// A page is made of whole top-level messages: the thread replies and the «progress» lines a
// bot said while working come along with the messages they belong to, never on their own.

/** A 1:1 chat opens with its latest 75 messages; each page up brings 75 more. */
export const CHAT_PAGE = 75;
/** Rooms keep their latest 120 messages (and every step) as before. */
export const ROOM_PAGE = 120;
export const MAX_PAGE = 200;

const atOf = (m) => String(m?.at || "");
const isTop = (m) => !m.replyTo && m.kind !== "progress";

/**
 * The page of `all` (a mission's messages, oldest first) that ends right before the
 * top-level message `before` (or the latest page when `before` is null).
 * Returns { messages, olderCount, cursor, from, until } or null when `before` is unknown.
 * `cursor`: the id to ask for the page before this one (null at the very start).
 * `from`/`until`: the time span the page covers ("" / null when open-ended).
 */
export function historyPage(all = [], { before = null, limit = CHAT_PAGE } = {}) {
  const size = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit) || CHAT_PAGE));
  const top = all.filter(isTop);
  let end = top.length;
  if (before) {
    end = top.findIndex((m) => m.id === before);
    if (end < 0) return null;
  }
  const start = Math.max(0, end - size);
  const page = top.slice(start, end);
  const keep = new Set(page.map((m) => m.id));
  const from = start > 0 ? atOf(page[0]) : "";
  const until = end < top.length ? atOf(top[end]) : null;
  const inSpan = (m) => atOf(m) >= from && (until === null || atOf(m) < until);
  const messages = all.filter((m) => keep.has(m.id) || keep.has(m.replyTo) || (m.kind === "progress" && !m.replyTo && inSpan(m)));
  return { messages, olderCount: start, cursor: start > 0 ? page[0].id : null, from, until };
}

/**
 * The steps a page needs: the ones its messages point at, the ones that started within its
 * span (answers of older records without a stepId are matched by time) and, for the latest
 * page, every step that has not finished yet (the live work, what waits for you).
 */
/**
 * A chat page's step views without the answer text a message of the same page already carries
 * (T3 Code keeps result bodies off the wire): a finished step's `text` is its final message.
 */
export function withoutSaidText(views = [], messages = []) {
  const said = new Set(messages.filter((m) => m.stepId && m.role === "assistant" && (!m.kind || m.kind === "message") && m.text).map((m) => m.stepId));
  return views.map((s) => (s.status === "completed" && s.text && said.has(s.id) ? { ...s, text: "" } : s));
}

export function stepsForPage(steps = [], page) {
  if (!page) return [];
  const ids = new Set(page.messages.map((m) => m.stepId).filter(Boolean));
  const latest = page.until === null;
  return steps.filter((s) => {
    if (ids.has(s.id)) return true;
    const at = String(s.startedAt || s.createdAt || "");
    if (latest && (!at || !["completed", "done", "final"].includes(s.status))) return true;
    return !!at && at >= page.from && (page.until === null || at < page.until);
  });
}
