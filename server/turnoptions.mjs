// What you chose for one message in the «+» menu of the composer (as Codex's «Añadir» and
// its plugins): think harder, or use the browser, the terminal, the web or one connected
// app. The bot gets it as a short note next to your message; nothing else changes.
import { appLabel } from "./appactions.mjs";

export const TURN_TOOLS = ["navegador", "terminal", "web"];
const SLUG = /^[a-z0-9_]{2,40}$/;

const LABEL = {
  navegador: "el navegador de su ordenador (browser_open, browser_read, browser_act…)",
  terminal: "la terminal: comandos en su ordenador con run_command (cada comando le pide permiso)",
  web: "la búsqueda en la web",
};

/** Valid, unique choices: the three tools and connected apps by their slug (gmail, slack…). */
export function cleanUse(use) {
  if (!Array.isArray(use)) return [];
  return [...new Set(use.map((x) => String(x || "").trim().toLowerCase()).filter((x) => TURN_TOOLS.includes(x) || SLUG.test(x)))].slice(0, 8);
}

/** The note the bot reads with the message («» when nothing was chosen). */
export function turnNote(use = [], { deep = false } = {}) {
  const parts = cleanUse(use).map((x) => LABEL[x] || `su app conectada ${appLabel(x)} (herramientas ${x}_…)`);
  const lines = [];
  if (parts.length) lines.push("Para este mensaje la persona ha elegido usar " + parts.join("; ") + ". Úsalo para hacerlo.");
  if (deep) lines.push("Ha pedido que lo pienses a fondo: tómate el tiempo de razonarlo bien.");
  return lines.length ? "\n\n[" + lines.join(" ") + "]" : "";
}
