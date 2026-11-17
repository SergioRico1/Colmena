// The message box's formatting (Composer.jsx): the marks the messages already read (format.jsx):
// *negrita*, _cursiva_, ~tachado~, `código`, ``` bloques ```, «> » quotes, «- » and «1. » lists
// and [texto](url) links. Pure, so tests read it without a browser. The rooms of the desktop app
// write Markdown instead (`flavor: "md"`: **negrita**, ~~tachado~~), which their bots read as is.

/**
 * One formatting step on the box's text: wraps the selection in a mark (or puts the caret between
 * two), or adds a prefix to each line it covers (and takes it off if they all have it already).
 * Returns {text, start, end}: the new text and what to select.
 */
export function formatText(text, start, end, kind, { flavor = "slack" } = {}) {
  const md = flavor === "md";
  const sel = text.slice(start, end);
  const wrap = (a, b = a) => (sel
    ? { text: text.slice(0, start) + a + sel + b + text.slice(end), start: start + a.length, end: end + a.length }
    : { text: text.slice(0, start) + a + b + text.slice(end), start: start + a.length, end: start + a.length });
  if (kind === "bold") return wrap(md ? "**" : "*");
  if (kind === "italic") return wrap("_");
  if (kind === "strike") return wrap(md ? "~~" : "~");
  if (kind === "code") return sel.includes("\n") ? wrap("```\n", "\n```") : wrap("`");
  if (kind === "block") return wrap("```\n", "\n```");
  if (kind === "link") {
    // A selected address becomes the link and «texto» is selected to be typed over; otherwise the
    // selection is the text and the address is selected.
    if (/^(https?:\/\/|mailto:)\S+$/i.test(sel.trim())) {
      return { text: text.slice(0, start) + "[texto](" + sel.trim() + ")" + text.slice(end), start: start + 1, end: start + 6 };
    }
    const label = sel || "texto";
    const at = start + label.length + 3;
    return { text: text.slice(0, start) + "[" + label + "](https://)" + text.slice(end), start: at, end: at + 8 };
  }
  // Line prefixes: every whole line the selection touches.
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  const to = nl < 0 ? text.length : nl;
  const lines = text.slice(from, to).split("\n");
  const re = kind === "quote" ? /^> / : kind === "bullets" ? /^[-•] / : /^\d+\. /;
  const off = lines.every((l) => re.test(l));
  const prefix = (i) => (kind === "quote" ? "> " : kind === "bullets" ? "- " : i + 1 + ". ");
  const body = lines.map((l, i) => (off ? l.replace(re, "") : prefix(i) + l.replace(/^(> |[-•] |\d+\. )/, ""))).join("\n");
  const caret = start === end;
  return { text: text.slice(0, from) + body + text.slice(to), start: caret ? from + body.length : from, end: from + body.length };
}
