// Visual identity of bots: shape + colour + initial (never colour alone).
import { botShape } from "./identity.js";

const LIGHT_INK = new Set(["#FFC93C", "#FF5CA8", "#FF7A1A", "#FFE08A", "#3DDC97"]);

/** Inline style fragment for a bot avatar of `size` px (matches the mockups' radii). */
export function avatarStyle(bot, size = 24) {
  const color = bot?.color || "#C9CCD6";
  // A portrait (server/portraits.mjs) fills the bot's shape; the initial stays for screen readers only.
  const portrait = portraitOf(bot);
  const base = portrait
    ? { background: `${color} url("${portrait}") center / cover no-repeat`, color: "transparent" }
    : { background: color, color: LIGHT_INK.has(color.toUpperCase()) ? "#12131A" : "#FFFFFF" };
  // Circles are people: a circle is drawn as the capsule, no shape as a rounded square (lib/identity.js).
  switch (botShape(bot?.shape)) {
    case "hex":
      return { ...base, clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" };
    case "diamond":
      return { ...base, clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" };
    case "arch": {
      const r = Math.round(size * 0.2) + "px";
      return { ...base, borderRadius: `50% 50% ${r} ${r}` };
    }
    case "capsule":
      return { ...base, clipPath: "inset(0 17% round 999px)" };
    case "leaf": {
      const r = Math.round(size * 0.16) + "px";
      return { ...base, borderRadius: `50% ${r} 50% ${r}` };
    }
    default:
      return { ...base, borderRadius: Math.round(size * 0.23) + "px" };
  }
}

/** The bot's chosen portrait, only from Colmena's own address. */
export function portraitOf(bot) {
  const p = bot?.portrait;
  return typeof p === "string" && /^\/api\/bots\/[\w%-]+\/portrait\?v=\d+$/.test(p) ? p : null;
}

export const initial = (bot) => (bot?.name || "?").trim().charAt(0).toUpperCase();

export function botById(bots, id) {
  return bots.find((b) => b.id === id) || null;
}


/**
 * Atlas is Colmena's hexagon: his avatar is a face (public/faces/hex/) that follows what he
 * does — «neutral» by default, «pensando» while he works, «duda» when he asks, «feliz» when
 * he delivers, «plano» when he is stuck. Other bots keep their shape and initial.
 */
export const FACES = ["feliz", "neutral", "guino", "plano", "alerta", "risa", "enamorado", "gafas", "pensando", "duda", "dormido", "cargando", "estrellas", "relajado", "enfadado"];
export function faceOf(bot, mood = null) {
  if (bot?.id !== "atlas" || portraitOf(bot)) return null;
  return "/faces/hex/" + (FACES.includes(mood) ? mood : "neutral") + ".png";
}

/** The name of the bot that coordinates (id «atlas»): each person names theirs (server/bot-looks.mjs). */
export const coordinatorOf = (bots) => (bots || []).find((b) => b?.id === "atlas")?.name || "Atlas";
