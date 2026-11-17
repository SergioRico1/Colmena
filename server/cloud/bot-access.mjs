// «Quién puede hablarle» of a hosted company's bot (its card in the channels, src/chat/BotCard.jsx):
// everyone in the company (the default), or only some people. The person who made the bot can
// always talk to it. Asked when a bot is named in a channel, when a chat or a room starts with it,
// and when a message reaches it (server/cloud/bots-host.mjs, channel-bots.mjs).

/** Who may talk to it: null for everyone, else the list of people's ids. */
export function talkList(bot) {
  return Array.isArray(bot?.talkTo) && bot.talkTo.length ? bot.talkTo : null;
}
export function mayTalk(bot, personId) {
  if (!bot) return false;
  const list = talkList(bot);
  return !list || (!!personId && (list.includes(personId) || bot.createdBy === personId));
}
/** «Nora solo habla con Ana y Beto.» */
export function talkRefusal(bot, nameOf = (id) => id) {
  const names = (talkList(bot) || []).map(nameOf).filter(Boolean);
  const who = names.length > 1 ? names.slice(0, -1).join(", ") + " y " + names.at(-1) : names[0] || "algunas personas";
  return `${bot?.name || "Este bot"} solo habla con ${who}. Pídeselo a quien lo creó si lo necesitas.`;
}
