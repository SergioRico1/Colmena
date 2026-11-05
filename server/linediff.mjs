// Line diff of two texts (Myers' O(ND) algorithm after trimming the common start and end),
// written as a unified patch — the same text `git diff` prints, so the chat's before/after
// view and «Código» read it with one parser (src/components/v2/code/model.js parsePatch).
// Bounded: beyond `maxEdits` differences the middle is shown as replaced whole.

export const DIFF_LIMITS = Object.freeze({ lines: 20000, maxEdits: 2000, context: 3 });

/** Lines of a text, without their line endings (a final newline adds no empty line). */
export function splitLines(text) {
  const s = String(text ?? "");
  if (!s) return [];
  const lines = s.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Edit script of a → b: ["eq"|"del"|"add", …] (null when more than maxD edits). */
function myers(a, b, maxD) {
  const n = a.length, m = b.length, max = n + m;
  if (!n) return b.map(() => "add");
  if (!m) return a.map(() => "del");
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    if (d > maxD) return null;
    trace.push(v.slice(off - d - 1, off + d + 2)); // k in [-(d+1), d+1] before this round
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  const ops = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const at = (k) => prev[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk), py = px - pk;
    while (x > px && y > py) { ops.push("eq"); x--; y--; }
    if (down) { ops.push("add"); y--; } else { ops.push("del"); x--; }
  }
  while (x > 0 && y > 0) { ops.push("eq"); x--; y--; }
  return ops.reverse();
}

/**
 * Two texts → {patch, added, removed, same, truncated}. `patch` holds only the hunks
 * («@@ -a,n +b,m @@» and the lines), «Binary files differ»-free.
 */
export function diffText(before, after, { context = DIFF_LIMITS.context, maxEdits = DIFF_LIMITS.maxEdits, maxLines = DIFF_LIMITS.lines } = {}) {
  let a = splitLines(before), b = splitLines(after);
  let truncated = false;
  if (a.length > maxLines || b.length > maxLines) { a = a.slice(0, maxLines); b = b.slice(0, maxLines); truncated = true; }
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const mid = myers(midA, midB, maxEdits) || [...midA.map(() => "del"), ...midB.map(() => "add")];
  const ops = [...Array(start).fill("eq"), ...mid, ...Array(a.length - endA).fill("eq")];
  // Rows with their line numbers (1-based) in each side.
  const rows = [];
  let i = 0, j = 0;
  for (const op of ops) {
    if (op === "eq") rows.push({ op, a: ++i, b: ++j, text: a[i - 1] });
    else if (op === "del") rows.push({ op, a: ++i, b: null, text: a[i - 1] });
    else rows.push({ op, a: null, b: ++j, text: b[j - 1] });
  }
  const added = rows.filter((r) => r.op === "add").length;
  const removed = rows.filter((r) => r.op === "del").length;
  if (!added && !removed) return { patch: "", added, removed, same: true, truncated };
  // Hunks: each change with `context` lines around; close changes share a hunk.
  const out = [];
  let k = 0;
  while (k < rows.length) {
    if (rows[k].op === "eq") { k++; continue; }
    let from = Math.max(0, k - context);
    let to = k;
    for (;;) {
      while (to < rows.length && rows[to].op !== "eq") to++;
      let next = to;
      while (next < rows.length && rows[next].op === "eq") next++;
      if (next < rows.length && next - to <= context * 2) { to = next; continue; }
      to = Math.min(rows.length, to + context);
      break;
    }
    const hunk = rows.slice(from, to);
    const aLines = hunk.filter((r) => r.op !== "add"), bLines = hunk.filter((r) => r.op !== "del");
    const aStart = aLines.length ? aLines[0].a : (rows.slice(0, from).filter((r) => r.a != null).at(-1)?.a ?? 0);
    const bStart = bLines.length ? bLines[0].b : (rows.slice(0, from).filter((r) => r.b != null).at(-1)?.b ?? 0);
    out.push(`@@ -${aStart},${aLines.length} +${bStart},${bLines.length} @@`);
    for (const r of hunk) out.push((r.op === "eq" ? " " : r.op === "del" ? "-" : "+") + r.text);
    k = to;
  }
  return { patch: out.join("\n") + "\n", added, removed, same: false, truncated };
}

/** Added and removed line counts only (the changed-files card). */
export function lineDelta(before, after) {
  const { added, removed } = diffText(before, after, { context: 0 });
  return { added, removed };
}
