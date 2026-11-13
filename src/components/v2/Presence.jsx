// Presences. Colmena 4: a bot is its pixel character (components/BotFace.jsx), shape by role and
// colour by person, with a face for each state; no letters. People are circles with initials.
// SHAPES and shapeOf remain for the few places that clip something else to a bot's shape (a
// portrait, NewBot's shape picker).
import { fitInitials, stepOf } from "../../lib/type.js";
import { botShape } from "../../lib/identity.js";
import { useStore } from "../../lib/store.jsx";
import BotFace from "../BotFace.jsx";

export const SHAPES = {
  hex: { clip: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", radius: "0" },
  diamond: { clip: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)", radius: "0" },
  circle: { clip: "none", radius: "50%" },
  // Investigación's silhouette: an upright capsule (circles are people). Old «circle» bots draw so.
  capsule: { clip: "inset(0 17% round 999px)", radius: "0" },
  square: { clip: "none", radius: "24%" },
  leaf: { clip: "none", radius: "50% 12% 50% 12%" },
  arch: { clip: "none", radius: "50% 50% 14% 14%" },
};
// Circles are people: a bot whose shape is a circle is the capsule, an unknown one a rounded square (lib/identity.js).
export const shapeOf = (bot) => SHAPES[botShape(bot?.shape)];
export const gloss = (color) => `radial-gradient(circle at 32% 26%, rgba(255,255,255,.62), rgba(255,255,255,0) 54%), ${color || "#C9CBD1"}`;

/** «trabaja» → work, «espera» → wait, paused or switched off → pause, everything else rests. */
export function presenceState(bot) {
  if (!bot) return "rest";
  if (bot.status === "trabaja") return "work";
  if (bot.status === "espera") return "wait";
  if (bot.status === "pausado" || bot.enabled === false) return "pause";
  return "rest";
}

/**
 * A bot as a presence: its pixel character (Colmena 4, components/BotFace.jsx), whose mood follows
 * `state`: rest | work | wait | pause (defaults to the bot's live status). `owner` ({name, color,
 * you}) puts their round chip on someone else's bot. Decorative unless it gets a `title`.
 */
export function BotPresence({ bot, size = 30, state = null, style = null, title = null, owner = null }) {
  const s = state || presenceState(bot);
  return (
    <span title={title || undefined} style={{ display: "inline-grid", flex: "none", ...style }}>
      <BotFace bot={bot} size={size} state={s} owner={owner} decorative={!title} label={title} />
    </span>
  );
}

const initials = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
// Warm neutral tints for people, picked by name (the boards use #EFE2D3, #DCE6F2, #E3EEDF…).
const PEOPLE = ["#EFE2D3", "#DCE6F2", "#E3EEDF", "#EEE0EC", "#E9E6DA"];
const tintOf = (name) => PEOPLE[[...String(name || "")].reduce((n, c) => n + c.charCodeAt(0), 0) % PEOPLE.length];

/**
 * A person: a circle with initials (circles are people). `me` is you («TÚ»), tinted with your
 * family's light tone (server/bot-looks.mjs: your bots' colour family) when you have one, else ink.
 */
export function PersonPresence({ name, size = 32, me = false, style = null }) {
  const family = useStore()?.settings?.botLooks?.family?.tint || null;
  const mine = me && family;
  return (
    <span aria-hidden="true" style={{ width: size + "px", height: size + "px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: mine ? family : me ? "var(--c-btn)" : tintOf(name), color: me && !mine ? "var(--c-btn-text)" : "#12131A", font: `600 ${stepOf(Math.round(size / 3))}px/1 'Geist', sans-serif`, letterSpacing: "0.02em", ...style }}>
      {fitInitials(me ? "TÚ" : initials(name), size)}
    </span>
  );
}
