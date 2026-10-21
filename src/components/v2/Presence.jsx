// Colmena 2.0 presences (design/V2Principios.dc.html, idea 03): a bot is a shape and a colour
// with a soft gloss — no letters, no labels. It breathes while it works, stays still while it
// rests and glows honey when it waits for you. People are neutral circles with initials.
import { portraitOf } from "../../lib/bots.js";

export const SHAPES = {
  hex: { clip: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", radius: "0" },
  diamond: { clip: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)", radius: "0" },
  circle: { clip: "none", radius: "50%" },
  square: { clip: "none", radius: "24%" },
  leaf: { clip: "none", radius: "50% 12% 50% 12%" },
  arch: { clip: "none", radius: "50% 50% 14% 14%" },
};
export const shapeOf = (bot) => SHAPES[bot?.shape] || SHAPES.circle;
export const gloss = (color) => `radial-gradient(circle at 32% 26%, rgba(255,255,255,.62), rgba(255,255,255,0) 54%), ${color || "#C9CBD1"}`;

/** «trabaja» → work, «espera» → wait, everything else rests. */
export function presenceState(bot) {
  if (!bot) return "rest";
  if (bot.status === "trabaja") return "work";
  if (bot.status === "espera") return "wait";
  return "rest";
}

// Shadow sizes the boards use at each size (rest) and the coloured halo while breathing.
function restShadow(size) {
  if (size >= 60) return "drop-shadow(0 4px 8px rgba(18,19,26,.16))";
  if (size >= 44) return "drop-shadow(0 3px 6px rgba(18,19,26,.16))";
  if (size >= 30) return "drop-shadow(0 2px 4px rgba(18,19,26,.16))";
  return "drop-shadow(0 2px 3px rgba(18,19,26,.18))";
}
function workShadow(size, color) {
  if (size >= 44) return `drop-shadow(0 5px 13px ${color}88)`;
  return `drop-shadow(0 3px 8px ${color}88)`;
}

/** A bot as a presence. `state`: rest | work | wait (defaults to the bot's live status). */
export function BotPresence({ bot, size = 30, state = null, style = null, title = null }) {
  const s = state || presenceState(bot);
  const shape = shapeOf(bot);
  const color = bot?.color || "#C9CBD1";
  const portrait = portraitOf(bot);
  const outer = s === "work"
    ? { filter: workShadow(size, color), animation: "breathe 2.8s ease-in-out infinite" }
    : s === "wait"
      ? { animation: "beckon 1.8s ease-out infinite" }
      : { filter: restShadow(size) };
  return (
    <span aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined} aria-label={title || undefined} title={title || undefined}
      style={{ display: "inline-grid", flex: "none", ...outer, ...style }}>
      <span style={{ display: "block", width: size + "px", height: size + "px", background: portrait ? `${color} url("${portrait}") center / cover no-repeat` : gloss(color), clipPath: shape.clip, borderRadius: shape.radius }} />
    </span>
  );
}

const initials = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
// Warm neutral tints for people, picked by name (the boards use #EFE2D3, #DCE6F2, #E3EEDF…).
const PEOPLE = ["#EFE2D3", "#DCE6F2", "#E3EEDF", "#EEE0EC", "#E9E6DA"];
const tintOf = (name) => PEOPLE[[...String(name || "")].reduce((n, c) => n + c.charCodeAt(0), 0) % PEOPLE.length];

/** A person: a neutral circle with initials. `me` is you («TÚ» in ink). */
export function PersonPresence({ name, size = 32, me = false, style = null }) {
  return (
    <span aria-hidden="true" style={{ width: size + "px", height: size + "px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: me ? "#12131A" : tintOf(name), color: me ? "#FFFFFF" : "#12131A", font: `600 ${Math.max(10, Math.round(size / 3))}px/1 'Geist', sans-serif`, letterSpacing: "0.02em", ...style }}>
      {me ? "TÚ" : initials(name)}
    </span>
  );
}
