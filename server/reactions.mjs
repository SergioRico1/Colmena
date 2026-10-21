// Slack-style reactions on room messages: [{ emoji, by, at }] where `by` is "user" or a bot id.
// A reaction never starts a turn: it is how the person or a bot says «visto», «hecho» or
// «gracias» without writing an empty message.

/** The set people and bots can react with (the picker shows them in this order). */
export const REACTIONS = ["👍", "👀", "✅", "🙌", "🙏", "❤️", "🎉", "😂", "🤔", "🔥"];
/** The bot's «lo estoy mirando» on the message it works on; removed when it answers. */
export const ACK_LOOKING = "👀";
/** A teammate's «recibido» on the plan that gives it a part; becomes ✅ when it delivers. */
export const ACK_TAKEN = "👍";
export const ACK_DONE = "✅";

const now = () => new Date().toISOString();

export function reactionsOf(message) {
  return Array.isArray(message?.reactions) ? message.reactions.filter((r) => r && typeof r.emoji === "string" && r.emoji && r.by) : [];
}

function write(store, messageId, fn) {
  const message = store.get("messages", messageId);
  if (!message) return null;
  const before = reactionsOf(message);
  const after = fn(before);
  if (after === before) return message;
  return store.patch("messages", messageId, { reactions: after });
}

export function addReaction(store, messageId, emoji, by) {
  if (!REACTIONS.includes(emoji)) throw Error("Esa reacción no está disponible.");
  return write(store, messageId, (list) => (list.some((r) => r.emoji === emoji && r.by === by) ? list : [...list, { emoji, by, at: now() }]));
}

export function removeReaction(store, messageId, emoji, by) {
  return write(store, messageId, (list) => (list.some((r) => r.emoji === emoji && r.by === by) ? list.filter((r) => !(r.emoji === emoji && r.by === by)) : list));
}

/** One reaction of `by` replaces another (👍 → ✅ when a teammate delivers its part). */
export function swapReaction(store, messageId, from, to, by) {
  removeReaction(store, messageId, from, by);
  return addReaction(store, messageId, to, by);
}

// ---------- what the bots learn from the person's reactions ----------
// As in OpenClaw: a reaction never wakes a bot; each addition or removal reaches the bots of
// the room as a line of context on their next turn (once per bot).

/** The person's own reactions may be any single emoji (Win + . opens the system picker). */
export function isEmoji(value) {
  const s = String(value || "").trim();
  return s.length > 0 && s.length <= 16 && /^\p{Extended_Pictographic}/u.test(s) && !/[\p{L}\p{N}\s]/u.test(s.replace(/[\u{1F3FB}-\u{1F3FF}‍️]/gu, ""));
}

export function togglePersonReaction(store, messageId, emoji) {
  const message = store.get("messages", messageId);
  if (!message) throw Error("Ese mensaje ya no existe.");
  if (!isEmoji(emoji)) throw Error("Elige un emoji.");
  const had = reactionsOf(message).some((r) => r.emoji === emoji && r.by === "user");
  const list = Array.isArray(message.reactions) ? message.reactions : [];
  const next = had ? list.filter((r) => !(r.emoji === emoji && r.by === "user")) : [...list, { emoji, by: "user", at: now() }];
  const updated = store.patch("messages", messageId, { reactions: next });
  const at = now();
  store.put("reactionNotices", { id: messageId + ":" + at + ":" + Math.random().toString(36).slice(2, 8), missionId: message.missionId, messageId, emoji, action: had ? "remove" : "add", at, seenBy: [] });
  return updated;
}

/** «La persona reaccionó con 👍 a tu mensaje «…»» lines not yet seen by `botId`; marks them seen. */
export function reactionNotices(store, missionId, botId, nameOf = (b) => b) {
  const pending = store.list("reactionNotices").filter((n) => n.missionId === missionId && !(n.seenBy || []).includes(botId));
  const lines = [];
  for (const n of pending.slice(-20)) {
    const m = store.get("messages", n.messageId);
    if (m) {
      const whose = m.role === "user" ? "a su propio mensaje" : m.botId === botId ? "a tu mensaje" : "al mensaje de " + nameOf(m.botId || "atlas");
      const quote = String(m.text || "").replace(/\s+/g, " ").slice(0, 140);
      lines.push((n.action === "add" ? "La persona reaccionó con " + n.emoji + " " : "La persona quitó su " + n.emoji + " ") + whose + (quote ? " «" + quote + "»" : "") + ".");
    }
  }
  for (const n of pending) store.patch("reactionNotices", n.id, { seenBy: [...(n.seenBy || []), botId] });
  return lines.length ? "Reacciones de la persona desde tu último turno (contexto, no son órdenes ni piden respuesta):\n" + lines.join("\n") : "";
}
