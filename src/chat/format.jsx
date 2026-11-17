// Message text of team messaging (docs/CLOUD.md › Phase 2). The stored format is Slack's: `&lt;`
// `&gt;` `&amp;` escaped, `<@persona>`, `<#canal>`, `<!channel>` / `<!here>`, links as `<url|texto>`,
// and *negrita*, _cursiva_, ~tachado~, `código` and ``` bloques ```. It is drawn as React nodes
// (never as HTML), and links only ever open http(s) and mailto.
import { Fragment } from "react";
import { channelTitle, chatState, nameOf } from "./store.js";
import { onlyEmoji, withEmoji } from "./emoji/index.jsx";
import { familyInk } from "../lib/personColor.js";

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const safeHref = (url) => (/^(https?:\/\/|mailto:)/i.test(url) ? url : null);

function Link({ href, children }) {
  const safe = safeHref(href);
  if (!safe) return <>{children}</>;
  const inside = safe.startsWith(location.origin + "/");
  return <a className="ch-link" href={inside ? safe.slice(location.origin.length) : safe} {...(inside ? {} : { target: "_blank", rel: "noopener noreferrer nofollow" })}>{children}</a>;
}

/** Bold, italic, strike and bare links inside a plain run of text; its emojis drawn with Blobmoji. */
function emphasis(text, key, size = 20) {
  const out = [];
  const em = (t, k) => withEmoji(decode(t), k, size);
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let at = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(em(text.slice(at, m.index), key + "p" + i));
    const t = m[0];
    // Only at word edges: «a*b*c» stays as typed.
    const before = text[m.index - 1], after = text[m.index + t.length];
    const edge = (!before || /[\s(«"'¡¿]/.test(before)) && (!after || /[\s).,;:!?»"']/.test(after));
    if (t.startsWith("http")) out.push(<Link key={key + "l" + i++} href={decode(t)}>{decode(t)}</Link>);
    else if (!edge) out.push(em(t, key + "n" + i++));
    else if (t[0] === "*") out.push(<strong key={key + "b" + i}>{em(t.slice(1, -1), key + "B" + i++)}</strong>);
    else if (t[0] === "_") out.push(<em key={key + "i" + i}>{em(t.slice(1, -1), key + "I" + i++)}</em>);
    else out.push(<s key={key + "s" + i}>{em(t.slice(1, -1), key + "S" + i++)}</s>);
    at = m.index + t.length;
  }
  if (at < text.length) out.push(em(text.slice(at), key + "z"));
  return out.flat();
}

/** One line-level run: markup tokens, inline code, then emphasis. */
function inline(text, key, me, size) {
  const out = [];
  const re = /`([^`\n]+)`|<@([^>]+)>|<#([^>|]+)(?:\|([^>]*))?>|<!(channel|everyone|here)>|<((?:https?|mailto):[^|>]+)(?:\|([^>]*))?>/g;
  let at = 0, m, i = 0;
  const s = chatState();
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(...emphasis(text.slice(at, m.index), key + "e" + i, size));
    const k = key + "t" + i++;
    if (m[1] != null) out.push(<code key={k} className="ch-code">{decode(m[1])}</code>);
    else if (m[2]) {
      // A bot is named in its own colour (its ink readable on the tint: lib/personColor.js).
      const bot = m[2].startsWith("bot:") ? s.bots?.get(m[2]) : null;
      const tone = bot?.color ? { "--bot-color": bot.color, "--bot-ink": familyInk(bot.color) } : undefined;
      out.push(<span key={k} className={"ch-mention" + (m[2] === me ? " is-me" : "") + (bot ? " is-bot" : "")} data-person={m[2]} style={tone}>{"@" + nameOf(m[2])}</span>);
    }
    else if (m[3]) {
      const ch = s.channels.get(m[3]);
      out.push(<a key={k} className="ch-mention" href={"/canal/" + m[3]}>{"#" + (ch ? channelTitle(ch) : m[4] || "canal")}</a>);
    } else if (m[5]) out.push(<span key={k} className="ch-mention is-me">{m[5] === "here" ? "@aquí" : "@canal"}</span>);
    else if (m[6]) out.push(<Link key={k} href={decode(m[6])}>{decode(m[7] || m[6])}</Link>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(...emphasis(text.slice(at), key + "z", size));
  return out;
}

/** A stored message text as React nodes. */
export function MessageText({ text }) {
  const me = chatState().me?.id;
  // Only emojis: drawn large (Slack's «jumbomoji»).
  const size = onlyEmoji(decode(String(text || ""))) ? 32 : 20;
  const parts = String(text || "").split(/```/);
  return (
    <>
      {parts.map((part, i) => i % 2
        ? <pre key={i} className="ch-pre"><code>{decode(part.replace(/^\n/, ""))}</code></pre>
        : <Fragment key={i}>{part.split("\n").map((line, j, all) => <Fragment key={j}>{inline(line, i + "-" + j, me, size)}{j < all.length - 1 ? <br /> : null}</Fragment>)}</Fragment>)}
    </>
  );
}

/** Plain words of a stored text (notifications, the reply preview, titles). */
export function plain(text) {
  return decode(String(text || "")
    .replace(/<@([^>]+)>/g, (_, id) => "@" + nameOf(id))
    .replace(/<#([^>|]+)(?:\|([^>]*))?>/g, (_, id, label) => "#" + (chatState().channels.get(id)?.name || label || "canal"))
    .replace(/<!(?:channel|everyone)>/g, "@canal").replace(/<!here>/g, "@aquí")
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]*)>/g, "$2").replace(/<((?:https?|mailto):[^>]+)>/g, "$1"));
}

// ---- the composer: what you type ⇄ the stored format
const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * What the composer holds → the stored text. `mentions`: [{label: "@Ana", id}] chosen from the
 * list while typing; «@canal» and «@aquí» are always understood.
 */
export function encode(text, mentions = []) {
  let s = escapeText(String(text || ""));
  const known = [...mentions].sort((a, b) => b.label.length - a.label.length);
  for (const m of known) s = s.split(escapeText(m.label)).join(m.id === "channel" ? "<!channel>" : m.id === "here" ? "<!here>" : "<@" + m.id + ">");
  s = s.replace(/(^|\s)@canal\b/g, "$1<!channel>").replace(/(^|\s)@aquí(?=\s|$|[.,;:!?])/g, "$1<!here>");
  return s;
}
/** A stored text back into the composer (for editing), with the mentions it holds. */
export function decodeForEdit(text) {
  const mentions = [];
  const s = String(text || "")
    .replace(/<@([^>]+)>/g, (_, id) => { const label = "@" + nameOf(id); mentions.push({ label, id }); return label; })
    .replace(/<!(?:channel|everyone)>/g, "@canal").replace(/<!here>/g, "@aquí")
    .replace(/<#([^>|]+)(?:\|([^>]*))?>/g, (_, id, label) => "#" + (chatState().channels.get(id)?.name || label || "canal"));
  return { text: decode(s), mentions };
}
