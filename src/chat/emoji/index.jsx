// Emojis drawn with Blobmoji (scripts/build-emoji.mjs builds public/emoji/*.webp and blobmoji.json)
// in messages, reactions and the picker. The data (≈160 KB) loads once, the first time a chat
// screen needs it; until then, and for the few emojis Blobmoji does not draw, the system's emoji
// show instead. A drawn emoji keeps its character as (transparent) text, so selecting and copying
// a message still copies the emoji.
import { useSyncExternalStore } from "react";
import "./emoji.css";

let data = null;
let loading = null;
const listeners = new Set();
const VS16 = /\uFE0F/g;
const keyOf = (char) => String(char).replace(VS16, "");

function build(raw) {
  const byKey = new Map();
  const picker = [];
  for (const item of raw.list) {
    const [char, sheet, cell, label = "", tags = "", skins = null] = item;
    const entry = { char, sheet, cell, label, tags, skins: skins ? skins.map(([c, s, n]) => ({ char: c, sheet: s, cell: n })) : null };
    byKey.set(keyOf(char), entry);
    for (const skin of entry.skins || []) byKey.set(keyOf(skin.char), { ...skin, label });
    if (label) picker.push(entry);
  }
  return { ...raw, byKey, picker };
}

/** Starts loading the emoji data (once); resolves with it. */
export function loadEmoji() {
  if (!loading) {
    loading = import("./blobmoji.json")
      .then((m) => { data = build(m.default || m); for (const fn of listeners) fn(); return data; })
      .catch(() => { loading = null; return null; });
  }
  return loading;
}
const subscribe = (fn) => { listeners.add(fn); loadEmoji(); return () => listeners.delete(fn); };
/** The emoji data, or null while it loads (the component re-renders when it arrives). */
export const useEmojiData = () => useSyncExternalStore(subscribe, () => data, () => null);
export const emojiData = () => data;

/** What Blobmoji has for this emoji: {char, sheet, cell, label}, or null. */
export const lookup = (char) => data?.byKey.get(keyOf(char)) || null;

/** The CSS that shows cell `cell` of sheet `sheet` at `size` px. */
export function spriteStyle(d, entry, size) {
  const sheet = d.sheets[entry.sheet];
  return {
    width: size + "px", height: size + "px",
    backgroundImage: `url(/emoji/${sheet.file})`,
    backgroundSize: `${d.cols * size}px ${sheet.rows * size}px`,
    backgroundPosition: `-${(entry.cell % d.cols) * size}px -${Math.floor(entry.cell / d.cols) * size}px`,
  };
}

/** One emoji: Blobmoji's drawing when there is one, else the character itself. */
export function Emoji({ char, size = 20, label = null, className = "" }) {
  const d = useEmojiData();
  const entry = d ? d.byKey.get(keyOf(char)) : null;
  if (!entry) return <span className={"emo-text " + className} style={{ fontSize: Math.round(size * 0.9) + "px" }} {...(label ? { role: "img", "aria-label": label } : {})}>{char}</span>;
  return <span className={"emo " + className} role="img" aria-label={label || entry.label || char} style={{ ...spriteStyle(d, entry, size), fontSize: Math.round(size * 0.8) + "px" }}>{char}</span>;
}

// Every RGI emoji (sequences, flags, keycaps, tones); older engines get a close approximation.
const EMOJI_RE = (() => {
  try { return new RegExp("\\p{RGI_Emoji}", "gv"); }
  catch { return /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?)*)/gu; }
})();

/** A plain run of text with its emojis drawn; returns the string itself when there are none. */
export function withEmoji(text, key = "e", size = 20) {
  if (!text || !/[\u00A9\u00AE\u203C-\u3299\u{1F000}-\u{1FAFF}#*0-9]/u.test(text)) return text;
  EMOJI_RE.lastIndex = 0;
  const out = [];
  let at = 0, m, i = 0;
  while ((m = EMOJI_RE.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(<Emoji key={key + "-" + i++} char={m[0]} size={size} />);
    at = m.index + m[0].length;
  }
  if (!out.length) return text;
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** True when a text is only emojis (at most `max`) and spaces: shown large, as in Slack. */
export function onlyEmoji(text, max = 23) {
  const t = String(text || "").trim();
  if (!t || t.length > max * 12) return false;
  EMOJI_RE.lastIndex = 0;
  const found = t.match(EMOJI_RE) || [];
  return found.length > 0 && found.length <= max && t.replace(EMOJI_RE, "").trim() === "";
}
