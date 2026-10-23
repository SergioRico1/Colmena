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

// «Por estado» (T3 Code sidebar): pinned on top, what needs you, what is stuck, runs, is ready
// to review; saved and new after; the snoozed and archived shelves at the end.
export const GROUPS = [
  ["pinned", "Fijadas"], ["wait", "Te espera"], ["stuck", "Atascadas"], ["work", "Trabajando"], ["review", "Para revisar"], ["saved", "Guardadas"], ["new", "Nuevas"],
  ["snoozed", "Pospuestas"], ["archived", "Archivadas"],
];
export function groupOf(t) {
  if (t.archived) return "archived";
  if (t.snoozed) return "snoozed";
  if (t.pinned) return "pinned";
  if (["waiting", "planned"].includes(t.status) || ((t.merging || (t.goal && ["blocked", "limited"].includes(t.goal.status))) && t.status !== "working")) return "wait";
  if (t.status === "error") return "stuck";
  if (t.status === "working" || t.running) return "work";
  if (t.merged || t.saved) return "saved";
  return t.turns ? "review" : "new";
}

/**
 * «Posponer» choices (T3 Code snooze presets): later today (18:00, or in three hours when it is
 * almost evening), tomorrow at 9:00 and next Monday at 9:00 (unless tomorrow is Monday).
 */
export function snoozePresets(now = new Date()) {
  const at = (days, hour) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  const evening = at(0, 18);
  const today = evening - now > 3600000 ? evening : new Date(now.getTime() + 3 * 3600000);
  const tomorrow = at(1, 9);
  const out = [
    { id: "hoy", label: today === evening ? "Más tarde hoy" : "En 3 horas", until: today.toISOString() },
    { id: "manana", label: "Mañana", until: tomorrow.toISOString() },
  ];
  const monday = at((1 - now.getDay() + 7) % 7 || 7, 9);
  if (monday.getTime() !== tomorrow.getTime()) out.push({ id: "semana", label: "La semana que viene", until: monday.toISOString() });
  return out;
}

/** Diff rows → side by side pairs: each run of deletions faces the additions after it. */
export function sideBySide(rows) {
  const out = [];
  let dels = [], adds = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ type: "pair", left: dels[i] || null, right: adds[i] || null, k: (dels[i] || adds[i]).k });
    dels = []; adds = [];
  };
  rows.forEach((row, k) => {
    const r = { ...row, k };
    if (row.type === "del") { if (adds.length) flush(); dels.push(r); }
    else if (row.type === "add") adds.push(r);
    else { flush(); if (row.type === "hunk") out.push(r); else if (row.type === "ctx") out.push({ type: "pair", left: r, right: r, k }); }
  });
  flush();
  return out;
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
