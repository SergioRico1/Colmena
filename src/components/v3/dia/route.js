import { mentionedBots } from "../../home/shared.jsx";
import { C } from "../../../lib/theme.js";

// Who takes something you ask (Inicio's box and «Buscar o pedir»): a bot you mention, a bot
// whose kind of work it clearly is, or Atlas, who decides and shares it out.
const ROLE_WORDS = [
  [/diapositiva|portada|diseñ|imagen|logo|cartel|presentaci/i, ["iris"]],
  [/hoja|cifra|dato|excel|ventas|gasto|compara|presupuesto|factura|tesorer/i, ["tomas"]],
  [/correo|resum|texto|escrib|redact|carta|post/i, ["vera"]],
  [/busca|investiga|estudio|competencia|fuente|noticia|lee /i, ["nora"]],
  [/script|código|codigo|programa|automatiza|macro/i, ["bruno"]],
];

export const ATLAS_FALLBACK = { id: "atlas", name: "Atlas", color: C.text, shape: "hex" };

/** The bot that probably fits a request (null when nothing clearly points at one). */
export function likelyBot(text, bots) {
  const t = String(text || "").trim();
  if (!t) return null;
  for (const [re, ids] of ROLE_WORDS) {
    if (!re.test(t)) continue;
    const bot = bots.find((b) => b.enabled !== false && ids.includes(b.id));
    if (bot) return bot;
  }
  return null;
}

/** {bot, solo, ids?, text}: who will take `text`. `picked` is a bot you chose by hand. */
export function routeOf(text, bots, picked = null) {
  const on = bots.filter((b) => b.enabled !== false);
  const atlas = on.find((b) => b.id === "atlas") || ATLAS_FALLBACK;
  if (picked) return { bot: picked, solo: picked.id !== "atlas", text: picked.id === "atlas" ? `${picked.name} decide quién lo hace` : `Se lo pides a ${picked.name}` };
  const t = String(text || "").trim();
  const named = mentionedBots(t, on).filter((b) => b.id !== "atlas");
  if (named.length === 1) return { bot: named[0], solo: true, text: `${named[0].name} se encargará` };
  if (named.length > 1) return { bot: atlas, solo: false, ids: named.map((b) => b.id), text: atlas.name + " lo repartirá entre " + named.map((b) => b.name).join(" y ") };
  const likely = likelyBot(t, on);
  if (likely) return { bot: likely, solo: true, text: `${likely.name} se encargará` };
  return { bot: atlas, solo: false, text: atlas.name + " decide quién lo hace" };
}
