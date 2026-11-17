// Handing a channel's message to a bot: drag it onto the bot in the sidebar (components/v3/
// Sidebar.jsx) or «Pedírselo a un bot…» in its menu (Message.jsx). Both end in the dialog the open
// conversation shows (AskBot.jsx), through one window event, so the sidebar never imports the chat.

export const MESSAGE_MIME = "application/x-colmena-message";
const EVENT = "colmena:ask-bot";

/** What a dragged message carries: enough to ask about it and to quote it. */
export function dragMessage(e, m) {
  const data = JSON.stringify({ id: m.id, channel: m.channel || null, room: m.room || null, threadId: m.threadId || null, author: m.author, text: String(m.text || "").slice(0, 600), files: (m.files || []).map((f) => f.name).slice(0, 5) });
  e.dataTransfer.setData(MESSAGE_MIME, data);
  e.dataTransfer.setData("text/plain", String(m.text || ""));
  e.dataTransfer.effectAllowed = "copy";
}

/** Asks the open conversation to show «Pedir a <bot>» for this message. `botId`: "nora" or "bot:nora"; null lets you choose. */
export function askBotAbout(botId, message) {
  let m = message;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch { return; } }
  // A channel's message (hosted Colmena) or a desktop room's (room/RoomLive.jsx › AskBotHere).
  if (!m?.id) return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { botId: botId ? (String(botId).startsWith("bot:") ? botId : "bot:" + botId) : null, message: m } }));
}

/** Listens for those requests; returns the unsubscribe. */
export function onAskBot(fn) {
  const on = (e) => fn(e.detail);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
