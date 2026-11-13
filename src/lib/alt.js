// Text alternatives for what the interface says with a shape, a colour or a dot. A bot is
// known by its shape and colour and a person by a circle: a screen reader gets the name, the
// word «bot» (and whose it is when it is not yours) and the state as a word.

import { firstName, listNames as list } from "./identity.js";

/** What a bot is doing, as a word. `work`, `wait`… are the states the marks draw. */
export const STATE_WORDS = { work: "trabajando", working: "trabajando", thinking: "pensando", wait: "te espera", waiting: "te espera", rest: "", free: "libre", off: "apagado", paused: "en pausa" };

/** «Vera, bot» · «Vera, bot de Lucía» · «Vera, bot, trabajando». */
export function botAlt(bot, { owner = null, state = null } = {}) {
  const name = bot?.name || "Bot";
  const whose = owner && !owner.you && owner.name ? "bot de " + firstName(owner.name) : "bot";
  const word = state ? STATE_WORDS[state] ?? state : "";
  return [name, whose, word].filter(Boolean).join(", ");
}

/**
 * A stack of bot marks: «Bots: Nora y Tomás» or, when some are at work, «Bots: Nora
 * (trabajando) y Tomás». `entries`: bots, or { bot, state, owner }.
 */
export function botsAlt(entries = []) {
  const names = entries.filter(Boolean).map((e) => {
    const bot = e.bot || e.b || e, state = e.state || (e.work ? "work" : null), owner = e.owner || null;
    const notes = [owner && !owner.you && owner.name ? "de " + firstName(owner.name) : "", state ? STATE_WORDS[state] ?? state : ""].filter(Boolean);
    return (bot?.name || "Bot") + (notes.length ? ` (${notes.join(", ")})` : "");
  });
  if (!names.length) return "";
  return (names.length === 1 ? "Bot: " : "Bots: ") + list(names);
}

/** Hidden from sight, read by a screen reader. */
export const srOnly = { position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };
