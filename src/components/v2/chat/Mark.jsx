import { shapeOf } from "../Presence.jsx";
import { portraitOf } from "../../../lib/bots.js";

// Colmena 3 marks (design/V3Sistema.dc.html «Presencias»): a bot is its flat shape and colour,
// no letters; it breathes while it works and wears a honey ring (still) when it waits for you.
// People are neutral circles with initials; you are «TÚ» in ink. A room is «#» on a tile.
export const initialsOf = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/** A bot as a flat shape. `state`: rest | work | wait. */
export function BotMark({ bot, size = 20, state = "rest", style = null }) {
  const shape = shapeOf(bot);
  const portrait = portraitOf(bot);
  const color = bot?.color || "#C9CBD1";
  return (
    <span aria-hidden="true" style={{ flex: "none", display: "inline-grid", placeItems: "center", width: size + "px", height: size + "px", borderRadius: state === "wait" ? "50%" : undefined, boxShadow: state === "wait" ? "0 0 0 2px #FFFFFF, 0 0 0 4px #FFC93C" : "none", ...style }}>
      <span style={{ display: "block", width: size + "px", height: size + "px", background: portrait ? `${color} url("${portrait}") center / cover no-repeat` : color, clipPath: shape.clip, borderRadius: shape.radius, animation: state === "work" ? "breathe 2.4s ease-in-out infinite" : "none" }} />
    </span>
  );
}

/** A person: a neutral circle with initials (you in ink). */
export function PersonMark({ name, size = 32, me = false, tint = "#E6E7EC", ring = null, style = null }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size + "px", height: size + "px", display: "grid", placeItems: "center", borderRadius: "50%", background: me ? "#12131A" : tint, color: me ? "#FFFFFF" : "#12131A", font: `600 ${Math.max(8, Math.round(size * 0.33))}px/1 'Geist', sans-serif`, boxShadow: ring ? `0 0 0 2px ${ring}` : "none", ...style }}>
      {me ? "TÚ" : initialsOf(name)}
    </span>
  );
}

/** The 36 px tile of a row in «Chats»: the bot's shape, «#» for a room, initials for a person. */
export function RowTile({ bot = null, state = "rest", person = null, room = false }) {
  const tile = { flex: "none", width: "36px", height: "36px", display: "grid", placeItems: "center", borderRadius: "12px" };
  if (bot) return <span aria-hidden="true" style={{ ...tile, background: "#F6F6F3" }}><BotMark bot={bot} size={20} state={state} /></span>;
  if (person) return <span aria-hidden="true" style={{ ...tile, background: "#E6E7EC", fontSize: "12px", fontWeight: 600, color: "#12131A" }}>{initialsOf(person)}</span>;
  return <span aria-hidden="true" style={{ ...tile, background: "#F1F1EC", fontSize: "12px", fontWeight: 600, color: "#12131A" }}>{room ? "#" : ""}</span>;
}
