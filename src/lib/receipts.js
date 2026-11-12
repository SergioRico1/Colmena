// What became of a message you sent while a bot was working (Slack-style receipts, in
// Colmena's terms): it waits for a pause, the bot read it, or it is held behind something
// that needs your OK. Derived from what the room already has — the steps (when they ran and
// which messages they answer: `acks`) and the bots' reactions on the message — so nothing is
// asked of the server for it.

// The bot's marks on a message it took in (server/reactions.mjs ACK_*).
const READ_MARKS = new Set(["👍", "👀", "✅"]);

/** A step was at work when the message was written, and the message was not what started it. */
const duringWork = (message, steps) => steps.some((s) => s.startedAt && s.startedAt < message.at
  && (!s.completedAt || s.completedAt > message.at) && !(s.acks || []).includes(message.id));

/**
 * `{ state: "wait" | "read" | "hold", botId? }` for a message of the person, or null when
 * it was not sent mid-work (or nothing is pending on it any more).
 * - read: a bot took it in at its next step (its reaction), or the turn that answers it has started;
 * - hold: not read yet and the conversation waits for your OK (`held`);
 * - wait: not read yet and the bots are at work (`working`).
 */
export function receiptOf(message, { steps = [], working = false, held = false } = {}) {
  if (!message || message.role !== "user" || message.optimistic || message.failed || !message.at) return null;
  if (!duringWork(message, steps)) return null;
  const reaction = (message.reactions || []).find((r) => r.by && r.by !== "user" && READ_MARKS.has(r.emoji));
  if (reaction) return { state: "read", botId: reaction.by };
  const turn = steps.find((s) => (s.acks || []).includes(message.id) && !s.skipped && s.startedAt);
  if (turn) return { state: "read", botId: turn.botId || null };
  if (held) return { state: "hold" };
  return working ? { state: "wait" } : null;
}

/** The receipt as one stable string for a row record («read:nora», «wait», «hold»), or null. */
export const receiptKey = (r) => (r ? (r.state === "read" ? "read:" + (r.botId || "") : r.state) : null);
