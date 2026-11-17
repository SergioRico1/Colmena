// The marks people write in the desktop rooms (the formatting bar writes them: RoomFormatBar.jsx):
// **negrita**, *cursiva* or _cursiva_, ~~tachado~~, `código`, ``` bloques ```, [texto](url) and
// «- » lines as bullets. Drawn as React nodes, never HTML; links open only http(s) and mailto.
// Everything else goes to `render` (mention pills, emojis, hidden secrets).
import { Fragment } from "react";

const RE = /```\n?([\s\S]*?)\n?```|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|`([^`\n]+)`|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|(?<![\p{L}\d_])_([^_\n]+)_(?![\p{L}\d_])|(?<![\p{L}\d*])\*([^*\n]+)\*(?![\p{L}\d*])/gu;
const CODE = { padding: "1px 5px", borderRadius: "var(--r-xs)", background: "var(--c-sunken)", border: "1px solid var(--c-line)", font: "400 .9em/1.4 'Geist Mono', ui-monospace, monospace" };
const PRE = { margin: "4px 0", padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--c-sunken)", border: "1px solid var(--c-line)", font: "400 var(--t-meta)/1.5 'Geist Mono', ui-monospace, monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" };

/** True when a text has any of these marks (so a caller may skip the work). */
export const hasMarks = (text) => /\*|_|~~|`|\]\(|(^|\n)- /.test(String(text || ""));

export default function Emphasis({ text, render = (t) => t }) {
  const value = String(text || "").replace(/(^|\n)- /g, "$1• ");
  if (!hasMarks(text)) return render(value);
  const out = [];
  let at = 0, m, i = 0;
  RE.lastIndex = 0;
  while ((m = RE.exec(value))) {
    if (m.index > at) out.push(<Fragment key={"p" + i}>{render(value.slice(at, m.index))}</Fragment>);
    const k = "m" + i++;
    if (m[1] != null) out.push(<pre key={k} style={PRE}>{m[1]}</pre>);
    else if (m[2] != null) out.push(<strong key={k}>{render(m[2])}</strong>);
    else if (m[3] != null) out.push(<s key={k}>{render(m[3])}</s>);
    else if (m[4] != null) out.push(<code key={k} style={CODE}>{m[4]}</code>);
    else if (m[5] != null) out.push(<a key={k} href={m[6]} target="_blank" rel="noopener noreferrer nofollow" style={{ color: "var(--c-accent-ink)" }}>{m[5]}</a>);
    else out.push(<em key={k}>{render(m[7] ?? m[8])}</em>);
    at = m.index + m[0].length;
  }
  if (at < value.length) out.push(<Fragment key="z">{render(value.slice(at))}</Fragment>);
  return out;
}
