// Visual identity of bots: shape + colour + initial (never colour alone).
const LIGHT_INK = new Set(["#FFC93C", "#FF5CA8", "#FF7A1A", "#FFE08A", "#3DDC97"]);

export const SHAPES = ["hex", "circle", "square", "diamond", "arch", "leaf"];
export const SHAPE_LABEL = { hex: "hexágono", circle: "círculo", square: "cuadrado", diamond: "rombo", arch: "arco", leaf: "hoja" };

/** Inline style fragment for a bot avatar of `size` px (matches the mockups' radii). */
export function avatarStyle(bot, size = 24) {
  const color = bot?.color || "#C9CCD6";
  // A portrait (server/portraits.mjs) fills the bot's shape; the initial stays for screen readers only.
  const portrait = portraitOf(bot);
  const base = portrait
    ? { background: `${color} url("${portrait}") center / cover no-repeat`, color: "transparent" }
    : { background: color, color: LIGHT_INK.has(color.toUpperCase()) ? "#12131A" : "#FFFFFF" };
  switch (bot?.shape) {
    case "hex":
      return { ...base, clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" };
    case "diamond":
      return { ...base, clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" };
    case "circle":
      return { ...base, borderRadius: "50%" };
    case "square":
      return { ...base, borderRadius: Math.round(size * 0.23) + "px" };
    case "arch": {
      const r = Math.round(size * 0.2) + "px";
      return { ...base, borderRadius: `50% 50% ${r} ${r}` };
    }
    case "leaf": {
      const r = Math.round(size * 0.16) + "px";
      return { ...base, borderRadius: `50% ${r} 50% ${r}` };
    }
    default:
      return { ...base, borderRadius: "50%" };
  }
}

/** The bot's chosen portrait, only from Colmena's own address. */
export function portraitOf(bot) {
  const p = bot?.portrait;
  return typeof p === "string" && /^\/api\/bots\/[\w%-]+\/portrait\?v=\d+$/.test(p) ? p : null;
}

export const initial = (bot) => (bot?.name || "?").trim().charAt(0).toUpperCase();

export const USER = { id: "user", name: "Tú", color: "#12131A", shape: "circle" };

export function botById(bots, id) {
  return bots.find((b) => b.id === id) || null;
}

/** Status dot used by the compact sidebar and lists. */
export function statusDot(status) {
  if (status === "trabaja") return { width: "7px", height: "7px", borderRadius: "50%", background: "#3DDC97" };
  if (status === "espera") return { width: "7px", height: "7px", borderRadius: "2px", background: "#FFC93C" };
  if (status === "bloqueado") return { width: "7px", height: "7px", borderRadius: "2px", background: "#E5484D" };
  return null; // libre / pausado: no dot in the compact variant
}

export const STATUS_LABEL = { trabaja: "Trabaja", espera: "Te espera", libre: "Libre", pausado: "En pausa", bloqueado: "Bloqueado" };


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
