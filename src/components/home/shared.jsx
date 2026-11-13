import { BotPresence } from "../v2/Presence.jsx";

/** A bot's avatar: its pixel character (BotPresence → BotFace), no letters. */
export function Avatar({ bot, size = 28, style = {} }) {
  return <BotPresence bot={bot} size={size} state="rest" style={style} />;
}

export const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Bots mentioned with @Nombre (or @id) in a text, in order of appearance. */
export function mentionedBots(text, bots) {
  const out = [];
  for (const m of (text || "").matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const key = norm(m[1]);
    // Its current name first, then a name it had before («@Vera» after a rename), then its id.
    const bot = bots.find((b) => norm(b.name) === key) || bots.find((b) => (b.previousNames || []).some((n) => norm(n) === key)) || bots.find((b) => norm(b.id) === key);
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
