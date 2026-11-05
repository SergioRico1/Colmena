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

/** «mañana 9:00», «hoy 18:00», «lun 9:00», «24 oct 9:00». */
export function whenLabel(iso, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return "hoy " + time;
  if (diff === 1) return "mañana " + time;
  if (diff > 1 && diff < 7) return d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "") + " " + time;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") + " " + time;
}

// Colmena 3 · Código (design/V3Codigo.dc.html): each task says where it is in words, and the
// list has three parts: what waits for you, what is moving, and what is put off or done.
const TONE = {
  honey: { bg: "#FFC93C", ink: "#12131A" }, run: { bg: "#EEF0F4", ink: "#1F4FD1" }, red: { bg: "#FBE9EA", ink: "#B4232A" },
  done: { bg: "#E3F4EC", ink: "#0B6B4A" }, quiet: { bg: "#F1F1EC", ink: "#4A4D57" },
};
/** The status pill of a task: {text, tone, bg, ink}. Honey only when it needs you. */
export function pillOf(t, now = new Date()) {
  const pill = (text, tone) => ({ text, tone, ...TONE[tone] });
  if (t.archived) return pill("Archivada", "quiet");
  if (t.snoozed) return pill("Vuelve " + whenLabel(t.snoozed.until, now).replace(/ \d{1,2}:\d{2}$/, ""), "quiet");
  if (t.running || t.status === "working") return pill("Trabajando", "run");
  if (t.status === "waiting") return pill("Te espera", "honey");
  if (t.status === "planned") return pill("Plan para revisar", "honey");
  if (t.status === "error") return pill("Atascada", "red");
  if (t.merging) return pill("Conflictos con " + (t.base || "main"), "honey");
  if (t.goal && ["blocked", "limited"].includes(t.goal.status)) return pill("Te espera", "honey");
  if (t.pr?.state === "MERGED") return pill("Fusionada", "done");
  if (t.merged || t.saved) return pill("Guardada", "done");
  if (t.pr?.state !== "CLOSED" && t.pr?.checks === "failing") return pill("Falla el CI", "red");
  if (t.pr?.state !== "CLOSED" && t.pr?.mergeable === "CONFLICTING") return pill("Conflictos", "honey");
  if (t.turns) return pill("Revisar", "honey");
  return pill("Nueva", "quiet");
}

/** Which part of the list a task goes in: wait | work | later | archived. */
export function sectionOf(t) {
  if (t.archived) return "archived";
  if (t.snoozed || t.saved || t.merged || t.pr?.state === "MERGED") return "later";
  const p = pillOf(t);
  if (p.tone === "run" || p.tone === "quiet") return "work";
  return "wait";
}

export const SECTIONS = [["wait", "Te esperan"], ["work", "En marcha"], ["later", "Pospuestas y hechas"], ["archived", "Archivadas"]];

/**
 * Tasks → the three parts of the list (and the archived shelf). Tasks started together with
 * several engines become one row that opens the comparison while two or more are still open.
 * Rows: {kind: 'task', task} | {kind: 'compare', group, title, tasks}. Pinned first, newest next.
 */
export function homeSections(tasks) {
  const open = tasks.filter((t) => t.group && !t.archived);
  const groups = new Map();
  for (const t of open) groups.set(t.group, [...(groups.get(t.group) || []), t]);
  const rows = [];
  const done = new Set();
  for (const t of tasks) {
    const many = t.group && !t.archived && groups.get(t.group).length > 1;
    if (!many) { rows.push({ kind: "task", task: t, section: sectionOf(t), at: t.updatedAt, pinned: !!t.pinned }); continue; }
    if (done.has(t.group)) continue;
    done.add(t.group);
    const list = groups.get(t.group);
    const working = list.some((x) => x.running || x.status === "working");
    rows.push({ kind: "compare", group: t.group, title: String(list[0].title).replace(/ · [^·]+(?: · [^·]+)?$/, ""), tasks: list, section: working ? "work" : "wait",
      at: list.map((x) => x.updatedAt).sort().at(-1), pinned: list.some((x) => x.pinned) });
  }
  return SECTIONS.map(([key, title]) => ({
    key, title,
    rows: rows.filter((r) => r.section === key).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.at).localeCompare(String(a.at))),
  })).filter((s) => s.rows.length);
}

/** Bruno's steps: the newest TodoWrite list of the task, or null. */
export function stepsOf(items) {
  return [...items].reverse().find((i) => i.kind === "tool" && Array.isArray(i.todos) && i.todos.length)?.todos || null;
}

/** «6 min», «45 s», «1 h 20 min». */
export function durationLabel(ms) {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return s + " s";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
}

/**
 * Which of the engines compared to keep, by what can be checked: the only one whose tests pass,
 * or, when several pass, the smallest change. Null while one works or nothing was tested.
 */
export function recommendOf(tasks) {
  if (!tasks.length || tasks.some((t) => t.running || t.status === "working")) return null;
  if (!tasks.some((t) => t.tests && ["passed", "failed"].includes(t.tests.status))) return null;
  const passing = tasks.filter((t) => t.tests?.status === "passed" && (t.files?.length ?? 1));
  if (!passing.length) return null;
  if (passing.length === 1) return { id: passing[0].id, why: tasks.length === 2 ? "es el que tiene los tests en verde." : "es el único con los tests en verde." };
  const size = (t) => (t.add || 0) + (t.del || 0);
  const best = [...passing].sort((a, b) => size(a) - size(b))[0];
  return { id: best.id, why: "pasan los tests con el cambio más pequeño (" + size(best) + " líneas)." };
}

/** «850 tokens», «12 k tokens», «1,4 M tokens». */
export function tokensLabel(n) {
  if (!(n > 0)) return null;
  const one = (x) => (x < 10 ? x.toFixed(1).replace(".", ",").replace(",0", "") : String(Math.round(x)));
  return (n < 1000 ? String(n) : n < 1e6 ? one(n / 1000) + " k" : one(n / 1e6) + " M") + " tokens";
}

/**
 * The quiet line under one of Bruno's turns: how long it took, what it changed (`files`: the
 * card above already says it) and, in expert mode, the tokens and cost its engine reported.
 */
export function turnStatsLine(stats, { files = true, expert = false } = {}) {
  if (!stats) return "";
  const parts = [durationLabel(stats.durationMs)];
  if (files && stats.files) parts.push((stats.files === 1 ? "1 archivo" : stats.files + " archivos") + (stats.add || stats.del ? ` +${stats.add || 0} −${stats.del || 0}` : ""));
  if (expert) {
    parts.push(tokensLabel(stats.tokens));
    if (stats.cost > 0) parts.push(stats.cost < 0.01 ? "< 0,01 $" : stats.cost.toFixed(2).replace(".", ",") + " $");
  }
  return parts.filter(Boolean).join(" · ");
}

/** The «/», «$» or «@» word being typed at the caret, or null. */
export function triggerAt(text, caret) {
  const before = String(text).slice(0, caret);
  const m = /(^|\s)([/$@])([^\s]*)$/.exec(before);
  if (!m) return null;
  if (m[2] === "/" && before.slice(0, m.index + m[1].length).trim()) return null; // «/» only starts a message
  return { kind: m[2], query: m[3], start: m.index + m[1].length, end: caret };
}
