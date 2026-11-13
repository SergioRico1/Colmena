import { fitInitials, stepOf } from "../../../lib/type.js";
import BotFace from "../../BotFace.jsx";
import { avatarColors } from "../../../lib/personColor.js";
import "../../../styles/conversation.css";

// Marks. Colmena 4: a bot is its pixel character (components/BotFace.jsx) with a face for its
// state, no letters. People are neutral circles with initials; you are «TÚ» in ink. A room is
// «#» on a tile.
export const initialsOf = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/**
 * A bot: its pixel character (BotFace) with the face of `state` (rest | work | wait | pause).
 * `owner` ({name, color, you}): whose it is; on someone else's bot a round chip with their
 * initials sits in the corner (circles are people), cut out of the surface (`ring`, else the
 * theme's --c-cut). The mark stays decorative: whoever draws it names it in words
 * (identity.js › botA11yName).
 */
export function BotMark({ bot, size = 20, state = "rest", style = null, owner = null, ring = null }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", display: "inline-grid", placeItems: "center", width: size + "px", height: size + "px", ...(ring ? { "--c-cut": ring } : null), ...style }}>
      <BotFace bot={bot} size={size} state={state} owner={owner} decorative />
    </span>
  );
}

/** A person: a circle with initials in a tint of their family colour (you in ink). */
export function PersonMark({ name, size = 32, me = false, tint = null, ring = null, style = null }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size + "px", height: size + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", ...(me ? { background: "var(--c-btn)", color: "var(--c-btn-text)" } : avatarColors(tint)), font: `600 ${stepOf(Math.round(size * 0.33))}px/1 'Geist', sans-serif`, boxShadow: ring ? `0 0 0 2px ${ring}` : "none", ...style }}>
      {fitInitials(me ? "TÚ" : initialsOf(name), size)}
    </span>
  );
}

/** The 36 px tile of a row in «Chats»: the bot's shape, «#» for a room, initials for a person. */
export function RowTile({ bot = null, state = "rest", person = null, room = false }) {
  const tile = { flex: "none", width: "36px", height: "36px", display: "grid", placeItems: "center", borderRadius: "var(--r-md)" };
  if (bot) return <span aria-hidden="true" style={{ ...tile, background: "var(--c-hover)" }}><BotMark bot={bot} size={20} state={state} /></span>;
  if (person) return <span aria-hidden="true" style={{ ...tile, borderRadius: "var(--r-circle)", background: "var(--c-chip)", fontSize: "var(--t-caption)", fontWeight: 600, color: "var(--c-text)" }}>{initialsOf(person)}</span>;
  return <span aria-hidden="true" style={{ ...tile, background: "var(--c-chip)", fontSize: "var(--t-caption)", fontWeight: 600, color: "var(--c-text)" }}>{room ? "#" : ""}</span>;
}
