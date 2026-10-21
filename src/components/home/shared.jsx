import { BotPresence } from "../v2/Presence.jsx";
import { avatarStyle, faceOf, initial } from "../../lib/bots.js";
import { plain } from "../room/Markdown.jsx";

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

/** Overlapping avatars of the mission cards (Main): -4px overlap + white ring where the shape allows it. */
export function AvatarStack({ bots, size = 32 }) {
  return bots.map((b, i) => {
    const clipped = b?.shape === "hex" || b?.shape === "diamond";
    const extra = i === 0 ? {} : clipped ? { marginLeft: "-4px" } : { marginLeft: "-4px", border: "2px solid #FFFFFF" };
    return <Avatar key={b?.id || i} bot={b} size={size} style={extra} />;
  });
}

/** Tinted card colours for a bot (debate proposals). Exact values from the mockups where they exist. */
const TINTS = {
  "#FF5CA8": { bg: "#FFE6F1", border: "#F6BCD6", fg: "#8A1550" },
  "#7B4DFF": { bg: "#EEE8FF", border: "#CDBDFF", fg: "#3E1FA3" },
  "#FF7A1A": { bg: "#FFEBDC", border: "#FFC59B", fg: "#8A3A00" },
  "#0B8A5F": { bg: "#E1F4EC", border: "#A8DCC4", fg: "#0B5A3E" },
  "#2F6BFF": { bg: "#E6EEFF", border: "#B9CCFF", fg: "#1F4FD1" },
  "#FFC93C": { bg: "#FFF4D1", border: "#F2D27A", fg: "#6B4A00" },
};
export function tint(bot) {
  const c = (bot?.color || "#C9CCD6").toUpperCase();
  return TINTS[c] || { bg: `color-mix(in srgb, ${c} 14%, #FFFFFF)`, border: `color-mix(in srgb, ${c} 40%, #FFFFFF)`, fg: `color-mix(in srgb, ${c} 70%, #12131A)` };
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

/** «A, B y C» */
export function joinNames(names) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " y " + names[names.length - 1];
}

/**
 * Renders `text` putting `strong` in bold where it appears (the mockups bold the key phrase).
 * When the phrase is not inside the text, it goes first in bold.
 */
export function Emph({ text, strong }) {
  const t = plain(text);
  const s = plain(strong);
  if (!s) return t;
  if (!t) return <strong>{s}</strong>;
  const i = t.indexOf(s);
  if (i >= 0) return <>{t.slice(0, i)}<strong>{s}</strong>{t.slice(i + s.length)}</>;
  const sep = /[.:!?…]$/.test(s) ? " " : ". ";
  return <><strong>{s}</strong>{sep}{t}</>;
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

export const isToday = (value) => Boolean(value) && new Date(value).toDateString() === new Date().toDateString();

/** Bot list popover used by the composer @-autocomplete (palette look: 2px ink border + honey shadow). */
export function BotPopover({ id, bots, active, onPick, onHover, style = {} }) {
  return (
    <div id={id} role="listbox" aria-label="Elegir bot" style={{ position: "absolute", zIndex: 30, width: "min(360px, 100%)", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "16px", boxShadow: "6px 6px 0 #FFC93C", padding: "8px", display: "flex", flexDirection: "column", gap: "2px", ...style }}>
      <span style={{ padding: "6px 12px 6px", font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>Llamar a un bot</span>
      {bots.map((b, i) => {
        const on = i === active;
        return (
          <div key={b.id} id={`${id}-${b.id}`} role="option" aria-selected={on ? "true" : "false"} onMouseDown={(e) => { e.preventDefault(); onPick(b); }} onMouseEnter={() => onHover?.(i)} style={on
            ? { display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "0 12px", background: "#FFF4D1", border: "1.5px solid #12131A", borderRadius: "12px", cursor: "pointer" }
            : { display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "0 12px", borderRadius: "12px", cursor: "pointer" }}>
            <Avatar bot={b} size={28} />
            <span style={{ flex: "1", fontSize: "15px" }}><strong>{b.name}</strong> <span style={{ color: "#4A4F5C" }}>· {b.role}</span></span>
            {on ? <span style={{ font: "500 12px/1 'Geist Mono', monospace", padding: "5px 7px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "6px" }}>↵</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Opens the global command palette (src/screens/CommandPalette.jsx). */
export function openPalette(text) {
  window.dispatchEvent(new CustomEvent("colmena:palette", { detail: text ? { text } : {} }));
}

/** Pending approvals in the order the inbox shows them: what blocks more first, then oldest. */
export function sortPending(approvals) {
  return approvals
    .filter((a) => a.status === "pending")
    .sort((a, b) => (b.blocks || 0) - (a.blocks || 0) || Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
}

export const KIND_LABEL = { send: "Envío", question: "Pregunta", permission: "Permiso", write: "Escritura", memory: "Memoria", plan: "Plan", skill: "Habilidad", soul: "Instrucciones", secret: "Clave" };
