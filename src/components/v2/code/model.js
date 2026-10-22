// Pure helpers of the «Código» screen (shared with the tests): the timeline rows and the
// unified diff parser.

/** Items → rows: consecutive tool calls become one work log; reads/searches in a row merge. */
export function buildRows(items) {
  const rows = [];
  for (const item of items) {
    if (item.kind === "tool") {
      const last = rows.at(-1);
      const log = last?.kind === "log" ? last : (rows.push({ kind: "log", id: "log-" + item.id, entries: [] }), rows.at(-1));
      const prev = log.entries.at(-1);
      const groupable = item.verb === "read" || item.verb === "search";
      if (groupable && prev?.group === item.verb) prev.items.push(item);
      else log.entries.push({ id: item.id, group: groupable ? item.verb : null, items: [item] });
      continue;
    }
    rows.push({ kind: item.kind, id: item.id, item });
  }
  return rows;
}

/** A unified patch → rows {type:'hunk'|'add'|'del'|'ctx'|'note', a, b, text}. */
export function parsePatch(patch) {
  const rows = [];
  let a = 0, b = 0, inHunk = false;
  for (const line of String(patch || "").split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (h) { a = Number(h[1]); b = Number(h[2]); inHunk = true; rows.push({ type: "hunk", text: h[3].trim(), a: null, b: null, start: b }); continue; }
    if (!inHunk) {
      if (/^Binary files /.test(line)) rows.push({ type: "note", text: "Archivo binario" });
      continue;
    }
    if (line.startsWith("+")) rows.push({ type: "add", a: null, b: b++, text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ type: "del", a: a++, b: null, text: line.slice(1) });
    else if (line.startsWith(" ")) rows.push({ type: "ctx", a: a++, b: b++, text: line.slice(1) });
    else if (line.startsWith("diff --git")) inHunk = false;
  }
  return rows;
}

/** Picked rows of a file's diff → a context chip: «a.js:12-14», the lines with their signs. */
export function diffContext(file, rows, from, to, note) {
  const picked = rows.slice(from, to + 1).filter((r) => ["add", "del", "ctx"].includes(r.type));
  const nums = picked.map((r) => r.b ?? r.a).filter((n) => n != null);
  const lines = nums.length ? [Math.min(...nums), Math.max(...nums)] : [];
  const where = lines.length ? (lines[0] === lines[1] ? ":" + lines[0] : ":" + lines[0] + "-" + lines[1]) : "";
  return { kind: "diff", label: file.split("/").pop() + where, file, lines, note, text: picked.map((r) => ({ add: "+", del: "-", ctx: " " })[r.type] + r.text).join("\n") };
}

/** A review finding → a context chip for the composer. */
export function findingContext(f) {
  return { kind: "diff", label: f.severity + " · " + f.title, file: f.file || undefined, lines: f.line ? [f.line, f.line] : undefined, note: f.title + ". " + (f.detail || ""), text: "" };
}
/** Review findings → one message for Bruno, most severe first. */
export function findingsText(findings) {
  return "Arregla esto que ha encontrado la revisión y comprueba que funciona:\n" + findings.map((f) => `- [${f.severity}] ${f.title}${f.file ? ` (${f.file}${f.line ? ":" + f.line : ""})` : ""}: ${f.detail || ""}`.trim()).join("\n");
}

/** The «/», «$» or «@» word being typed at the caret, or null. */
export function triggerAt(text, caret) {
  const before = String(text).slice(0, caret);
  const m = /(^|\s)([/$@])([^\s]*)$/.exec(before);
  if (!m) return null;
  if (m[2] === "/" && before.slice(0, m.index + m[1].length).trim()) return null; // «/» only starts a message
  return { kind: m[2], query: m[3], start: m.index + m[1].length, end: caret };
}
