import { forwardRef } from "react";
import { gloss, shapeOf } from "./Presence.jsx";
import { useStore } from "../../lib/store.jsx";

// «@Vera» as a pill: the bot's own small shape and its name on a tint of its colour, the
// same in a message and while you write it. Bots never show letters (BotPresence rule).

const tint = (color) => (/^#[0-9a-f]{6}$/i.test(String(color || "")) ? color + "24" : "rgba(31,79,209,.12)");

function Shape({ bot, size }) {
  const s = shapeOf(bot);
  return <span aria-hidden="true" style={{ width: size, height: size, flex: "none", background: gloss(bot?.color), clipPath: s.clip, borderRadius: s.radius }} />;
}

/** In a message: a real pill (its padding may take room). */
export function MentionPill({ bot, name }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", verticalAlign: "baseline", padding: "0 8px 0 4px", borderRadius: "999px", background: tint(bot?.color), color: "#12131A", fontWeight: 600, lineHeight: "1.45", whiteSpace: "nowrap" }}>
      <Shape bot={bot} size="0.85em" />
      {name || bot?.name}
    </span>
  );
}

/** Mentions found in a text: [{start, end, bot}] for «@Name» of a known bot (or «@sala»). */
export function findMentions(text, bots = []) {
  const out = [];
  const byName = new Map(bots.map((b) => [String(b.name || "").toLowerCase(), b]));
  const re = /(^|[^\p{L}\d_])@([\p{L}\d_-]+)/gu;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const bot = byName.get(m[2].toLowerCase());
    if (!bot) continue;
    const start = m.index + m[1].length;
    out.push({ start, end: start + 1 + m[2].length, bot });
  }
  return out;
}

/**
 * Behind the composer's textarea (same font, padding and wrapping), the text drawn again with
 * each mention as a pill. The pill never changes the width of the text, so the caret stays
 * where it is: the «@» gives its place to the bot's shape and the tint is a soft outline.
 * The textarea on top keeps the text (transparent), the caret and the selection.
 */
export const MentionMirror = forwardRef(function MentionMirror({ value, bots, style }, ref) {
  const found = findMentions(value, bots);
  const parts = [];
  let at = 0;
  found.forEach((f, i) => {
    if (f.start > at) parts.push(value.slice(at, f.start));
    parts.push(
      <span key={i} style={{ position: "relative", borderRadius: "999px", background: tint(f.bot.color), boxShadow: `0 0 0 3px ${tint(f.bot.color)}`, color: "#12131A" }}>
        <span style={{ color: "transparent" }}>{"@"}</span>
        <span aria-hidden="true" style={{ position: "absolute", left: "0.05em", top: "50%", transform: "translateY(-50%)", display: "flex" }}><Shape bot={f.bot} size="0.8em" /></span>
        {value.slice(f.start + 1, f.end)}
      </span>,
    );
    at = f.end;
  });
  parts.push(value.slice(at) + "​");
  return (
    <div ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", color: "#12131A", ...style }}>
      {parts}
    </div>
  );
});

/** Plain text (your messages) with each «@Bot» as its pill. */
export function PillText({ text }) {
  const { bots = [] } = useStore() || {};
  const value = String(text || "");
  const found = findMentions(value, bots);
  if (!found.length) return value;
  const parts = [];
  let at = 0;
  found.forEach((f, i) => {
    if (f.start > at) parts.push(value.slice(at, f.start));
    parts.push(<MentionPill key={i} bot={f.bot} name={value.slice(f.start + 1, f.end)} />);
    at = f.end;
  });
  if (at < value.length) parts.push(value.slice(at));
  return parts;
}

/** «@Vera» link made by Markdown (href «#@Vera») → its pill. */
export function MentionLink({ href, children }) {
  const { bots = [] } = useStore() || {};
  const name = decodeURIComponent(String(href || "").slice(2));
  const bot = bots.find((b) => String(b.name || "").toLowerCase() === name.toLowerCase());
  return bot ? <MentionPill bot={bot} name={bot.name} /> : <span style={{ color: "#1F4FD1", fontWeight: 600 }}>{children}</span>;
}
