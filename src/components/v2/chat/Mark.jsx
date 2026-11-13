import { fitInitials, stepOf } from "../../../lib/type.js";
import { shapeOf } from "../Presence.jsx";
import { portraitOf } from "../../../lib/bots.js";
import { ownerBadgeText, personTint } from "../../../lib/identity.js";

// Colmena 3 marks (design/V3Sistema.dc.html «Presencias»): a bot is its flat shape and colour,
// no letters; it breathes while it works and wears a honey ring (still) when it waits for you.
// People are neutral circles with initials; you are «TÚ» in ink. A room is «#» on a tile.
export const initialsOf = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/**
 * A bot as a flat shape. `state`: rest | work | wait. `owner` ({name, color, you}): whose it is;
 * on someone else's bot a small round person-chip with their initials sits in the corner (circles
 * are people), from 16 px up. The mark stays decorative: whoever draws it names it in words
 * (identity.js › botA11yName).
 */
export function BotMark({ bot, size = 20, state = "rest", style = null, owner = null, ring = "#FFFFFF" }) {
  const shape = shapeOf(bot);
  const portrait = portraitOf(bot);
  const color = bot?.color || "#C9CBD1";
  const badge = badgeSize(owner, size);
  return (
    <span aria-hidden="true" style={{ position: badge ? "relative" : undefined, flex: "none", display: "inline-grid", placeItems: "center", width: size + "px", height: size + "px", borderRadius: state === "wait" ? "var(--r-circle)" : undefined, boxShadow: state === "wait" ? "0 0 0 2px #FFFFFF, 0 0 0 4px #FFC93C" : "none", ...style }}>
      <span style={{ display: "block", width: size + "px", height: size + "px", background: portrait ? `${color} url("${portrait}") center / cover no-repeat` : color, clipPath: shape.clip, borderRadius: shape.radius, animation: state === "work" ? "breathe 2.4s ease-in-out infinite" : "none" }} />
      {badge ? <OwnerBadge owner={owner} size={size} ring={ring} /> : null}
    </span>
  );
}

/** The size of the owner's chip on a bot of `size`, or 0 when it is too small to carry one. */
export const badgeSize = (owner, size) => (owner && !owner.you && size >= 16 ? Math.max(11, Math.round(size * 0.52)) : 0);

/** The round person-chip in a bot's corner: whose bot it is (decorative; said in words elsewhere). */
export function OwnerBadge({ owner, size = 20, ring = "#FFFFFF" }) {
  const badge = badgeSize(owner, size);
  if (!badge) return null;
  return (
    <span aria-hidden="true" data-owner-badge="" style={{ position: "absolute", right: -Math.round(badge * 0.3) + "px", bottom: -Math.round(badge * 0.3) + "px", width: badge + "px", height: badge + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: owner.color || personTint(owner.name), color: "#12131A", boxShadow: `0 0 0 1.5px ${ring}`, font: `700 ${Math.max(7, Math.round(badge * 0.5))}px/1 'Geist', sans-serif`, letterSpacing: 0 }}>
      {ownerBadgeText(owner, size)}
    </span>
  );
}

/** A person: a neutral circle with initials (you in ink). */
export function PersonMark({ name, size = 32, me = false, tint = "#E6E7EC", ring = null, style = null }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size + "px", height: size + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: me ? "#12131A" : tint, color: me ? "#FFFFFF" : "#12131A", font: `600 ${stepOf(Math.round(size * 0.33))}px/1 'Geist', sans-serif`, boxShadow: ring ? `0 0 0 2px ${ring}` : "none", ...style }}>
      {fitInitials(me ? "TÚ" : initialsOf(name), size)}
    </span>
  );
}

/** The 36 px tile of a row in «Chats»: the bot's shape, «#» for a room, initials for a person. */
export function RowTile({ bot = null, state = "rest", person = null, room = false }) {
  const tile = { flex: "none", width: "36px", height: "36px", display: "grid", placeItems: "center", borderRadius: "var(--r-md)" };
  if (bot) return <span aria-hidden="true" style={{ ...tile, background: "#F6F6F3" }}><BotMark bot={bot} size={20} state={state} /></span>;
  if (person) return <span aria-hidden="true" style={{ ...tile, borderRadius: "var(--r-circle)", background: "#E6E7EC", fontSize: "var(--t-caption)", fontWeight: 600, color: "#12131A" }}>{initialsOf(person)}</span>;
  return <span aria-hidden="true" style={{ ...tile, background: "#F1F1EC", fontSize: "var(--t-caption)", fontWeight: 600, color: "#12131A" }}>{room ? "#" : ""}</span>;
}
