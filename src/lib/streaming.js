// Pure helpers of LiveMarkdown (kept apart so the tests can import them without JSX).

/** [stable, tail]: the cut is the last blank line outside a fenced block. */
export function splitStable(text) {
  const s = String(text || "");
  let fence = null, pos = 0, cut = 0;
  const lines = s.split("\n");
  // The last line may still be arriving: never a cut on its own.
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    pos += line.length + 1;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1][0].repeat(marker[1].length);
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (!fence && line.trim() === "" && i > 0 && !/^\s/.test(lines[i + 1] || "")) cut = pos;
  }
  return [s.slice(0, cut), s.slice(cut)];
}

/** Closes what the tail leaves open, so it renders as it will look once finished. */
export function repairTail(tail) {
  let t = String(tail || "");
  // An open code block.
  const fences = t.match(/^\s{0,3}(`{3,}|~{3,})/gm) || [];
  if (fences.length % 2) return t + "\n" + fences.at(-1).trim().replace(/[^`~]/g, "");
  // A link whose address is still arriving: show its text for now.
  t = t.replace(/\[([^\]\n]*)\]\([^)\s]*$/, "$1").replace(/!\[([^\]\n]*)$/, "$1");
  const outsideCode = t.replace(/`[^`\n]*`/g, "");
  if ((outsideCode.match(/\*\*/g) || []).length % 2) t += "**";
  if ((t.match(/`/g) || []).length % 2) t += "`";
  // A table row or a list marker alone at the end renders as text until it is complete.
  return t.replace(/(^|\n)\s*([-*+]|\d+[.)])\s*$/, "$1");
}
