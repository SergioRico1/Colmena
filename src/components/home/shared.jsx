import { BotPresence } from "../v2/Presence.jsx";
import { avatarStyle, faceOf, initial } from "../../lib/bots.js";

// Font sizes the mockups use for the bot initial at each avatar size.
const INITIAL_FONT = { 20: 9, 22: 11, 24: 12, 28: 13, 30: 12, 32: 14, 40: 17 };

/** Bot avatar exactly as drawn in the mockups (shape + colour + initial). */
export function Avatar({ bot, size = 28, style = {}, mood = null }) {
  // Colmena 2.0: bots are presences (shape + colour, no letters) everywhere.
  return <BotPresence bot={bot} size={size} state="rest" style={style} />;
}
function AvatarV1({ bot, size = 28, style = {}, mood = null }) {
  const face = faceOf(bot, mood);
  if (face) return <img src={face} alt="" aria-hidden="true" draggable="false" width={size} height={size} style={{ width: size + "px", height: size + "px", flex: "none", objectFit: "contain", ...style }} />;
  const base = INITIAL_FONT[size] || Math.round(size * 0.45);
  const font = bot?.shape === "diamond" ? base - (size >= 32 ? 2 : 1) : base;
  return (
    <BotPresence bot={bot} size={size} />
  );
}

export const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Bots mentioned with @Nombre (or @id) in a text, in order of appearance. */
export function mentionedBots(text, bots) {
  const out = [];
  for (const m of (text || "").matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const key = norm(m[1]);
    const bot = bots.find((b) => norm(b.name) === key || norm(b.id) === key);
    if (bot && !out.includes(bot)) out.push(bot);
  }
  return out;
}

/** «@par» being typed right before the caret → { query, start } or null. */
export function mentionAt(text, caret) {
  const before = (text || "").slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before);
  return m ? { query: m[2], start: before.length - m[2].length - 1 } : null;
}

export function matchBots(bots, query) {
  const q = norm(query);
  const on = bots.filter((b) => b.enabled !== false);
  if (!q) return on;
  const byName = on.filter((b) => norm(b.name).startsWith(q) || norm(b.id).startsWith(q));
  const byRole = on.filter((b) => !byName.includes(b) && norm(b.role).split(/\s+/).some((w) => w.startsWith(q)));
  return [...byName, ...byRole];
}

/** Text with the matched query wrapped in the palette's <mark>. */
export function Highlight({ text, query }) {
  const t = text || "";
  const q = norm(query).trim();
  if (!q) return t;
  const i = norm(t).indexOf(q);
  if (i < 0) return t;
  return <>{t.slice(0, i)}<mark style={{ background: "#FFE08A", color: "inherit", padding: "0 1px" }}>{t.slice(i, i + q.length)}</mark>{t.slice(i + q.length)}</>;
}
