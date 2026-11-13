// Pure rules of the reworked «Código» (shared with the tests): which part of the list a task goes in,
// what its one next action is, its CI in words, and the model of moving through a diff with the keys.
// No React, no theme: the components turn the tones into colours.

/** The list of tasks, in this order. Honey marks only «needs». */
export const LIST_GROUPS = [
  ["needs", "Te necesitan"], ["running", "Trabajando"], ["ready", "Listas para guardar"], ["done", "Hechas"], ["snoozed", "Pospuestas"], ["archived", "Archivadas"],
];

const prOpen = (t) => !!t.pr?.number && t.pr.state === "OPEN";
/** The newest review still speaks for the current changes and found something serious. */
const reviewHolds = (t) => !!t.review && t.review.turns === t.turns && t.review.serious > 0;

/** Why a task needs the person, or null: {text, tone}. tone: honey (a decision), error (it broke), warn (it collides). */
export function needOf(t) {
  if (t.archived || t.snoozed) return null;
  if (t.running || t.status === "working") return null;
  if (t.status === "planned") return { text: "Plan para aprobar", tone: "honey" };
  if (t.status === "waiting") return { text: "Te pregunta", tone: "honey" };
  if (t.goal && ["blocked", "limited"].includes(t.goal.status)) return { text: "Objetivo parado", tone: "honey" };
  if (t.status === "error") return { text: "Atascada", tone: "error" };
  if (t.merging) return { text: "Conflictos con " + (t.merging.base || t.base || "main"), tone: "warn" };
  if (prOpen(t) && t.pr.checks === "failing") return { text: "Falla el CI", tone: "error" };
  if (prOpen(t) && t.pr.mergeable === "CONFLICTING") return { text: "Conflictos en la PR", tone: "warn" };
  if (prOpen(t) && t.pr.reviewDecision === "CHANGES_REQUESTED") return { text: "Piden cambios", tone: "honey" };
  if (reviewHolds(t)) return { text: t.review.serious === 1 ? "1 problema importante" : t.review.serious + " problemas importantes", tone: "error" };
  return null;
}

/** needs | running | ready | done | snoozed | archived. */
export function listGroupOf(t) {
  if (t.archived) return "archived";
  if (t.snoozed) return "snoozed";
  if (t.running || t.status === "working") return "running";
  if (needOf(t)) return "needs";
  if (t.saved || t.merged || t.pr?.state === "MERGED") return "done";
  if (t.turns && !(t.add || t.del) && !prOpen(t)) return "done"; // it answered, nothing to save
  return "ready";
}

/** What the row says after the title when nothing needs the person. */
export function stateText(t) {
  const need = needOf(t);
  if (need) return need.text;
  if (t.archived) return "Archivada";
  if (t.running || t.status === "working") return "Trabajando";
  if (t.pr?.state === "MERGED") return "PR fusionada";
  if (t.saved || t.merged) return "Guardada en " + (t.base || "main");
  if (prOpen(t)) return t.pr.isDraft ? "PR en borrador" : t.pr.reviewDecision === "APPROVED" ? "PR aprobada" : "PR abierta";
  if (!t.turns) return "Sin empezar";
  if (!(t.add || t.del)) return "Respondida";
  return "Lista para guardar";
}

/** The CI of the task's PR: {state: passing|failing|pending, text} or null. */
export function ciOf(t) {
  if (!t.pr?.number || t.pr.state !== "OPEN") return null; // merged or closed: the CI no longer matters
  const c = t.pr.checks;
  if (c === "failing") return { state: "failing", text: "CI falla" };
  if (c === "passing") return { state: "passing", text: "CI pasa" };
  if (c === "pending") return { state: "pending", text: "CI en curso" };
  return null;
}

/** The list in its groups: [{key, title, tasks}] (empty groups out), pinned first, newest next. */
export function listSections(tasks) {
  const order = (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  return LIST_GROUPS.map(([key, title]) => ({ key, title, tasks: tasks.filter((t) => listGroupOf(t) === key).sort(order) })).filter((g) => g.tasks.length);
}

/**
 * The ONE primary action of an open task, or null: {id, label, why?}.
 * `ctx`: {pendingAsk, openPlan, findings, canSave, githubOff}.
 * ids: answer, implement, fix, catchup, write, merge-pr, pr-ready, open-pr, save.
 */
export function nextAction(t, { pendingAsk = null, openPlan = null, findings = [], canSave = false } = {}) {
  if (!t || t.running || t.status === "working") return null;
  if (pendingAsk) return { id: "answer", label: pendingAsk.ask === "redline" ? "Decidir la línea roja" : pendingAsk.ask === "question" ? "Responder" : "Revisar el permiso" };
  if (openPlan) return { id: "implement", label: "Implementar el plan" };
  if (t.status === "error") return { id: "write", label: "Decirle qué hacer" };
  const open = prOpen(t) ? t.pr : null;
  const reviewed = t.review && t.review.turns === t.turns;
  if ((reviewed && findings.length) || open?.checks === "failing") return { id: "fix", label: "Que Bruno lo arregle" };
  if (t.merging) return { id: "save", label: "Volver a fusionar en " + (t.base || "main") };
  if (open?.mergeable === "CONFLICTING") return { id: "catchup", label: "Resolver conflictos con " + (t.base || "main") };
  if (open?.isDraft) return { id: "pr-ready", label: "Marcar la PR como lista" };
  if (open?.reviewDecision === "APPROVED" && open.checks !== "pending") return { id: "merge-pr", label: "Fusionar la PR #" + open.number };
  if (open) return { id: "open-pr", label: "Ver la PR #" + open.number };
  if (t.saved || t.merged || t.pr?.state === "MERGED") return null;
  if (canSave && (t.add || t.del || t.lastChanged)) return { id: "save", label: t.isolated ? "Fusionar en " + (t.base || "main") : "Guardar" };
  return null;
}

// ------------------------------------------------------------------ the diff

/** «A» new, «D» deleted, «R» renamed, «M» changed: {letter, label, tone}. */
export function fileStatusOf(f) {
  if (f.status === "A") return { letter: "A", label: "Nuevo", tone: "ok" };
  if (f.status === "D") return { letter: "D", label: "Borrado", tone: "error" };
  if (f.status === "R" || f.from) return { letter: "R", label: "Renombrado", tone: "accent" };
  return { letter: "M", label: "Cambiado", tone: "quiet" };
}

/** «src/api/client.js» → {dir: "src/api/", name: "client.js"}. */
export function splitPath(p) {
  const s = String(p || "");
  const i = s.lastIndexOf("/");
  return { dir: i < 0 ? "" : s.slice(0, i + 1), name: i < 0 ? s : s.slice(i + 1) };
}

/** Files → the tree on the left: folders in order, each with its files ([{dir, files}]). */
export function fileTree(files) {
  const map = new Map();
  for (const f of files) {
    const { dir } = splitPath(f.path);
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir).push(f);
  }
  return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b))).map(([dir, list]) => ({ dir, files: list.sort((x, y) => x.path.localeCompare(y.path)) }));
}

/** The row indexes where each hunk starts in a parsed patch (parsePatch rows). */
export function hunkStarts(rows) {
  const out = [];
  rows.forEach((r, k) => { if (r.type === "hunk") out.push(k); });
  if (!out.length && rows.some((r) => r.type === "add" || r.type === "del" || r.type === "ctx")) out.push(0);
  return out;
}

/**
 * The next place for «j/k» (hunks) across files: `counts[i]` hunks in file i, `at` {file, hunk}
 * (null: before the first). Files without hunks are skipped. Stays put at the ends.
 */
export function stepHunk(counts, at, dir) {
  const places = [];
  counts.forEach((n, file) => { for (let hunk = 0; hunk < n; hunk++) places.push({ file, hunk }); });
  if (!places.length) return null;
  if (!at) return dir > 0 ? places[0] : places.at(-1);
  const i = places.findIndex((p) => p.file === at.file && p.hunk === at.hunk);
  if (i < 0) return places.find((p) => (dir > 0 ? p.file > at.file : p.file < at.file)) || (dir > 0 ? places.at(-1) : places[0]);
  return places[Math.max(0, Math.min(places.length - 1, i + dir))];
}

/** The next file for «n/p» (wraps around). */
export function stepFile(count, current, dir) {
  if (!count) return null;
  if (current == null || current < 0) return dir > 0 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/** Review findings for one file of the diff, by the new line they point at ({line → [findings]}). */
export function findingsByLine(findings, file) {
  const out = new Map();
  for (const f of findings || []) {
    if (!f.file || !f.line) continue;
    const a = String(f.file).replace(/^\.?\//, ""), b = String(file).replace(/^\.?\//, "");
    if (a !== b && !b.endsWith("/" + a) && !a.endsWith("/" + b)) continue;
    if (!out.has(f.line)) out.set(f.line, []);
    out.get(f.line).push(f);
  }
  return out;
}
