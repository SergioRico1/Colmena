import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Undo2, SquareArrowOutUpRight, Copy, ChevronDown, ChevronRight, ChevronUp, FoldVertical, UnfoldVertical, History, FolderOpen, Sidebar } from "../../Icon.js";
import { get, post } from "../../../lib/api.js";
import { C, MONO, Seg, SR, MenuChip, MenuItem } from "./parts.jsx";
import { parsePatch, diffContext, sideBySide } from "./model.js";
import { fileStatusOf, fileTree, splitPath, hunkStarts, stepHunk, stepFile, findingsByLine } from "./flow.js";
import { addContext } from "./Extras.jsx";

// «Cambios» (T3 Code's diff panel, GitHub's files view): the files as a tree on the left with their
// state; every file on the right, one under the other, each folding on its header; unified (two
// gutters: before and after) or side by side; the review's findings on the lines they point at;
// one turn («punto») or the whole task. Keys, when no field has the focus: j/k next and previous
// change, n/p next and previous file, u unified or side by side, x fold the file, c copy its path,
// e open it in the editor, / search. Click a line number (Shift+click: several) to comment those
// lines: the comment goes into your next message as a chip.

const STYLE = {
  add: { bg: "var(--c-ok-soft)", fg: "var(--c-ok-ink)", sign: "+" },
  del: { bg: "var(--c-error-soft)", fg: "var(--c-error)", sign: "−" },
  ctx: { bg: "transparent", fg: "var(--c-text-2)", sign: " " },
};
const SEVERITY = {
  P0: { bg: "var(--c-error-soft)", fg: "var(--c-error)", text: "Rompe algo" }, P1: { bg: "var(--c-error-soft)", fg: "var(--c-error)", text: "Fallo real" },
  P2: { bg: "var(--c-warn-soft)", fg: "var(--c-warn)", text: "Conviene arreglar" }, P3: { bg: "var(--c-chip)", fg: "var(--c-text-2)", text: "Detalle" },
};
const STATUS_TONE = { ok: ["var(--c-ok-soft)", "var(--c-ok-ink)"], error: ["var(--c-error-soft)", "var(--c-error)"], accent: ["var(--c-accent-soft)", "var(--c-accent-ink)"], quiet: ["var(--c-chip)", "var(--c-text-2)"] };
/** A file shows its first rows; the rest on request (a huge generated file never freezes the panel). */
const ROWS_AT_ONCE = 400;
const SPLIT_KEY = "colmena:code-diff-split";
const TREE_KEY = "colmena:code-diff-tree";
const GUTTER = "40px";

/** The comment box under selected diff lines (T3 Code AnnotatableCodeView): it becomes a chip. */
function CommentBox({ label, onAdd, onCancel, onEditor = null }) {
  const [note, setNote] = useState("");
  return (
    <form className="c-ring" onSubmit={(e) => { e.preventDefault(); if (note.trim()) onAdd(note.trim()); }} style={{ display: "flex", gap: "10px", margin: "6px 12px 10px 92px", padding: "10px 12px", borderRadius: "var(--r-md)", background: C.card, fontFamily: "'Geist', sans-serif", fontSize: "var(--t-meta)", lineHeight: 1.45, whiteSpace: "normal", animation: "rise .2s ease-out" }}>
      <span aria-hidden="true" style={{ flex: "none", width: "20px", height: "20px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: C.ink, color: C.white, fontSize: "var(--t-micro)", fontWeight: 600 }}>TÚ</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={{ font: `500 var(--t-caption)/1 ${MONO}`, color: C.faint }}>{label}</span>
        <textarea className="c-bare" autoFocus rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué le dirías a Bruno de estas líneas?" aria-label="Comentario"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (note.trim()) onAdd(note.trim()); } if (e.key === "Escape") onCancel(); }}
          style={{ border: 0, resize: "none", background: "transparent", fontSize: "var(--t-meta)", lineHeight: 1.45 }} />
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
          <span style={{ flex: 1, fontSize: "var(--t-caption)", color: C.muted }}>Bruno lo verá en su siguiente paso</span>
          {onEditor ? <button type="button" onClick={onEditor} style={{ height: "28px", padding: "0 10px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", fontSize: "var(--t-caption)", fontWeight: 500, color: C.blue }}>Abrir en el editor</button> : null}
          <button type="button" onClick={onCancel} style={{ height: "28px", padding: "0 10px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", fontSize: "var(--t-caption)", fontWeight: 500, color: C.muted }}>Cancelar</button>
          <button type="submit" disabled={!note.trim()} style={{ height: "28px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: note.trim() ? "pointer" : "default", opacity: note.trim() ? 1 : 0.45, fontSize: "var(--t-caption)", fontWeight: 600 }}>Añadir al mensaje</button>
        </span>
      </span>
    </form>
  );
}

function highlight(text, query, active) {
  if (!query) return text;
  const parts = [];
  const low = text.toLowerCase();
  let i = 0, at;
  while ((at = low.indexOf(query, i)) >= 0) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at} style={{ background: active ? "color-mix(in srgb, var(--c-accent-ink) 32%, transparent)" : "color-mix(in srgb, var(--c-accent-ink) 16%, transparent)", color: "inherit", borderRadius: "var(--r-xs)" }}>{text.slice(at, at + query.length)}</mark>);
    i = at + query.length;
  }
  if (!parts.length) return text;
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

const PICKED = "color-mix(in srgb, var(--c-accent) 18%, transparent)";
const num = (picked) => ({ flex: "none", width: GUTTER, paddingRight: "8px", textAlign: "right", color: picked ? C.blue : C.faint, userSelect: "none", cursor: "pointer", fontVariantNumeric: "tabular-nums" });

/** A unified row: before and after numbers (click to pick), the sign, the text. */
function Line({ row, query, active, picked = false, onPick = null }) {
  const s = STYLE[row.type];
  return (
    <div data-active={active ? "" : undefined} style={{ display: "flex", minWidth: "max-content", background: picked ? PICKED : s.bg, boxShadow: picked ? "inset 2px 0 0 var(--c-accent)" : "none", whiteSpace: "pre" }}>
      <span onMouseDown={onPick} title="Selecciona la línea para comentarla (Mayús: varias)" style={num(picked)}>{row.a ?? ""}</span>
      <span onMouseDown={onPick} style={num(picked)}>{row.b ?? ""}</span>
      <span aria-hidden="true" style={{ flex: "none", width: "18px", color: s.fg, userSelect: "none" }}>{s.sign}</span>
      <span style={{ color: s.fg, paddingRight: "16px" }}>{highlight(row.text, query, active)}</span>
    </div>
  );
}

/** One half of a side-by-side row: its number (click to pick) and its text. */
function Half({ row, side, picked, onPick, query, active }) {
  if (!row) return <span style={{ gridColumn: "span 2", background: "rgb(var(--c-ink-rgb) / .03)" }} />;
  const s = STYLE[row.type];
  const n = side === "left" ? row.a : row.b;
  const bg = picked ? PICKED : row.type === "ctx" ? "transparent" : s.bg;
  return (
    <>
      <span onMouseDown={onPick} title="Selecciona la línea para comentarla (Mayús: varias)" style={{ ...num(picked), width: "auto", background: bg }}>{n ?? ""}</span>
      <span data-active={active ? "" : undefined} style={{ minWidth: 0, padding: "0 10px 0 4px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: s.fg, background: bg }}>{highlight(row.text, query, active)}</span>
    </>
  );
}

/** A review finding under the line it points at. */
function Finding({ f, onFinding }) {
  const s = SEVERITY[f.severity] || SEVERITY.P2;
  return (
    <div className="code-turn" data-finding={f.file + ":" + f.line} style={{ display: "flex", alignItems: "flex-start", gap: "10px", margin: "4px 12px 6px 92px", padding: "8px 10px", border: "1px solid var(--c-line)", borderRadius: "var(--r-sm)", background: "var(--c-raised)", fontFamily: "'Geist', sans-serif", fontSize: "var(--t-meta)", lineHeight: 1.45, whiteSpace: "normal" }}>
      <span title={s.text} style={{ flex: "none", height: "20px", padding: "0 7px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-xs)", background: s.bg, color: s.fg, font: `600 var(--t-micro)/1 ${MONO}` }}>{f.severity}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontWeight: 600, color: C.ink }}>{f.title}</strong>
        {f.detail ? <span style={{ display: "block", color: C.text2 }}>{f.detail}</span> : null}
      </span>
      {onFinding ? <button type="button" onClick={() => onFinding(f)} title="Añádelo a tu próximo mensaje" style={{ flex: "none", height: "26px", padding: "0 9px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-raised)", cursor: "pointer", fontSize: "var(--t-caption)", whiteSpace: "nowrap", color: C.ink }}>Pasar a Bruno</button> : null}
    </div>
  );
}

function StatusBadge({ file }) {
  const st = fileStatusOf(file);
  const [bg, fg] = STATUS_TONE[st.tone];
  return <span title={st.label} aria-label={st.label} style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center", borderRadius: "var(--r-xs)", background: bg, color: fg, font: `600 var(--t-micro)/1 ${MONO}` }}>{st.letter}</span>;
}

const TOOL = { width: "28px", height: "28px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", color: C.muted };

function FileBlock({ file, idx, rows, folded, onFold, split, query, activeKey, pick, onPick, onComment, onRevert, onEditor, onCopy, findings, onFinding, current, hunkOn }) {
  const [armed, setArmed] = useState(false);
  const [all, setAll] = useState(false);
  const [closedHunks, setClosedHunks] = useState(() => new Set());
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const { dir, name } = splitPath(file.path);
  const firstLine = rows.find((r) => r.type === "add" || r.type === "del")?.b ?? rows.find((r) => r.type === "hunk")?.start ?? 1;
  const isPicked = (k) => !!pick && k >= pick.from && k <= pick.to;
  const pickAt = (k) => (e) => { e.preventDefault(); onPick(k, e.shiftKey); };
  const comment = (k) => (pick && k === pick.to ? (
    <CommentBox label={diffContext(file.path, rows, pick.from, pick.to, "").label} onCancel={() => onPick(null)} onAdd={(note) => onComment(diffContext(file.path, rows, pick.from, pick.to, note))}
      onEditor={onEditor ? () => onEditor(diffContext(file.path, rows, pick.from, pick.to, "").lines[0] || firstLine) : null} />
  ) : null);
  const notes = (row) => (row.b != null && row.type !== "del" && findings.get(row.b) ? findings.get(row.b).map((f, k) => <Finding key={k} f={f} onFinding={onFinding} />) : null);
  const hunkRow = (row, h) => {
    const closed = closedHunks.has(h);
    const on = hunkOn === h;
    return (
      <button key={"h" + h} type="button" data-hunk={idx + ":" + h} className={on ? "code-hunk-on" : undefined} aria-expanded={!closed}
        onClick={() => setClosedHunks((s) => { const n = new Set(s); if (n.has(h)) n.delete(h); else n.add(h); return n; })}
        title={closed ? "Desplegar este cambio" : "Plegar este cambio"}
        style={{ position: "sticky", left: 0, width: "100%", display: "flex", alignItems: "center", gap: "8px", minHeight: "28px", padding: "0 12px 0 10px", border: 0, borderTop: h ? "1px solid var(--c-line)" : 0, background: "var(--c-sunken)", cursor: "pointer", textAlign: "left", font: `400 var(--t-caption)/1.5 ${MONO}`, color: C.muted, scrollMarginTop: "48px" }}>
        {closed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>línea {row.start}{row.text ? " · " + row.text : ""}</span>
      </button>
    );
  };
  // Rows grouped under their hunk, so a hunk folds as one; the first ROWS_AT_ONCE drawn.
  const limit = all ? Infinity : ROWS_AT_ONCE;
  const body = [];
  let h = -1, shown = 0;
  const starts = hunkStarts(rows);
  const implicit = starts[0] === 0 && rows[0]?.type !== "hunk";
  if (implicit) h = 0;
  const units = split ? sideBySide(rows) : rows.map((row, k) => ({ ...row, k }));
  for (const u of units) {
    if (shown >= limit) break;
    if (u.type === "hunk") { h += 1; body.push(hunkRow(u, h)); continue; }
    if (u.type === "note") continue;
    if (closedHunks.has(h)) continue;
    shown += 1;
    if (split) {
      const k = u.right?.k ?? u.left?.k;
      body.push(
        <div key={"p" + u.k}>
          <div style={{ display: "grid", gridTemplateColumns: `${GUTTER} minmax(0, 1fr) ${GUTTER} minmax(0, 1fr)`, alignItems: "stretch" }}>
            <Half row={u.left} side="left" picked={u.left ? isPicked(u.left.k) : false} onPick={u.left ? pickAt(u.left.k) : null} query={query} active={u.left && activeKey === file.path + ":" + u.left.k} />
            <Half row={u.right} side="right" picked={u.right ? isPicked(u.right.k) : false} onPick={u.right ? pickAt(u.right.k) : null} query={query} active={u.right && u.right !== u.left && activeKey === file.path + ":" + u.right.k} />
          </div>
          {u.right ? notes(u.right) : null}
          {comment(k) || (u.left && u.right && u.left.k !== u.right.k ? comment(u.left.k) : null)}
        </div>,
      );
    } else {
      body.push(
        <div key={u.k}>
          <Line row={u} query={query} active={activeKey === file.path + ":" + u.k} picked={isPicked(u.k)} onPick={pickAt(u.k)} />
          {notes(u)}
          {comment(u.k)}
        </div>,
      );
    }
  }
  const total = rows.filter((r) => r.type !== "hunk" && r.type !== "note").length;
  const label = name + (file.status === "D" ? " (borrado)" : "");
  return (
    <section data-file={idx} aria-label={file.path} style={{ border: "1px solid " + (current ? "var(--c-line-strong)" : "var(--c-line)"), borderRadius: "var(--r-md)", background: "var(--c-card)", scrollMarginTop: "8px" }}>
      <header className="code-turn" style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", padding: "0 8px 0 6px", borderBottom: folded ? 0 : "1px solid var(--c-line)", borderRadius: folded ? "var(--r-md)" : "var(--r-md) var(--r-md) 0 0", background: "var(--c-card)" }}>
        <button type="button" onClick={onFold} aria-expanded={!folded} aria-label={(folded ? "Desplegar " : "Plegar ") + file.path} style={TOOL}>{folded ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</button>
        <StatusBadge file={file} />
        <span title={file.path} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: `400 var(--t-meta)/1.2 ${MONO}` }}>
          <span style={{ color: C.muted }}>{dir}</span><span style={{ fontWeight: 600, color: C.ink }}>{label}</span>
          {file.from ? <span style={{ color: C.faint }}> ← {file.from}</span> : null}
        </span>
        <span style={{ display: "inline-flex", gap: "2px" }}>
          <button type="button" className="code-tools" onClick={onCopy} aria-label={"Copiar la ruta de " + name} title="Copiar la ruta (c)" style={TOOL}><Copy size={16} aria-hidden="true" /></button>
          {onEditor && file.status !== "D" ? <button type="button" className="code-tools" onClick={() => onEditor(firstLine)} aria-label={"Abrir " + name + " en el editor"} title={"Abrir en el editor, línea " + firstLine + " (e)"} style={TOOL}><SquareArrowOutUpRight size={16} aria-hidden="true" /></button> : null}
          {onRevert ? (
            <button type="button" className={armed ? undefined : "code-tools"} onClick={() => { if (!armed) { setArmed(true); return; } setArmed(false); onRevert(); }} aria-label={armed ? "Pulsa otra vez para deshacer este archivo" : "Deshacer los cambios de " + name} title={armed ? "Pulsa otra vez: vuelve como estaba (luego puedes «Deshacer»)" : "Deshacer los cambios de este archivo"}
              style={armed ? { height: "28px", padding: "0 10px", border: 0, borderRadius: "var(--r-sm)", background: "var(--c-error-soft)", color: "var(--c-error)", cursor: "pointer", fontSize: "var(--t-caption)", fontWeight: 600, whiteSpace: "nowrap" } : TOOL}>
              {armed ? "Deshacer archivo" : <Undo2 size={16} aria-hidden="true" />}
            </button>
          ) : null}
        </span>
        <span style={{ font: `500 var(--t-caption)/1 ${MONO}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{file.add ? <span style={{ color: C.greenText }}>+{file.add}</span> : null}{file.add && file.del ? " " : ""}{file.del ? <span style={{ color: C.red }}>−{file.del}</span> : null}</span>
      </header>
      {folded ? null : (
        <div style={{ overflowX: "auto", font: `400 var(--t-meta)/1.7 ${MONO}`, contentVisibility: "auto", containIntrinsicSize: `auto ${Math.min(total, ROWS_AT_ONCE) * 22 + 30}px`, borderRadius: "0 0 var(--r-md) var(--r-md)" }}>
          {file.binary ? <p style={{ margin: 0, padding: "12px 16px", fontFamily: "'Geist', sans-serif", fontSize: "var(--t-meta)", color: C.faint }}>Archivo binario: no se puede mostrar el cambio línea a línea.</p> : null}
          {body}
          {total > shown && !all && shown >= ROWS_AT_ONCE ? (
            <button type="button" onClick={() => setAll(true)} style={{ width: "100%", height: "34px", border: 0, borderTop: "1px solid var(--c-line)", background: "var(--c-sunken)", cursor: "pointer", fontSize: "var(--t-caption)", color: C.blue }}>Mostrar {total - shown} líneas más</button>
          ) : null}
        </div>
      )}
    </section>
  );
}

const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;

/**
 * `onCount(n)`: how many files the shown changes touch (the «Cambios · N» tab). `points`: the turns
 * that changed files ([{n, add, del, files}]); `findings` (the current review) and `onFinding`;
 * `onRestore(n)` puts the folder back at a point.
 */
export default function Changes({ task, turn, onTurn, onCount = null, points = [], findings = [], onFinding = null, onRestore = null }) {
  const [scope, setScope] = useState("task");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [hit, setHit] = useState(0);
  const [filter, setFilter] = useState("");
  const [current, setCurrent] = useState(0); // the file the keys act on
  const [at, setAt] = useState(null); // {file, hunk}: where j/k are
  const [folded, setFolded] = useState(() => new Set());
  const [sel, setSel] = useState(null); // lines picked to comment: {path, from, to, anchor}
  const [split, setSplitState] = useState(() => { try { return localStorage.getItem(SPLIT_KEY) === "1"; } catch { return false; } });
  const setSplit = (v) => { setSplitState(v); try { localStorage.setItem(SPLIT_KEY, v ? "1" : "0"); } catch {} };
  const [tree, setTreeState] = useState(() => { try { return localStorage.getItem(TREE_KEY) !== "0"; } catch { return true; } });
  const setTree = (v) => { setTreeState(v); try { localStorage.setItem(TREE_KEY, v ? "1" : "0"); } catch {} };
  const [note, setNote] = useState(null);
  const root = useRef(null);
  const scroller = useRef(null);
  const searchRef = useRef(null);
  const turns = task?.turns || 0;
  const n = turn || task?.lastChanged || null;
  const effective = scope === "turn" && n ? "turn" : "task";
  const revert = (f) => post("/code/tasks/" + task.id + "/revert-file", { path: f.path, turn: effective === "turn" ? n : null }).then(() => setNote(null), (e) => setNote(e.message));
  const editor = (f, line) => post("/code/tasks/" + task.id + "/open-editor", { path: f.path, line }).then((r) => setNote(r.editor ? null : "No encuentro VS Code, Cursor ni Windsurf: se abre con el programa de ese tipo de archivo."), (e) => setNote(e.message));
  const copy = (f) => navigator.clipboard?.writeText(f.path).then(() => setNote("Ruta copiada: " + f.path), () => setNote("No se pudo copiar la ruta."));
  useEffect(() => { setSel(null); }, [task?.id, turn, scope]);
  useEffect(() => { if (turn) setScope("turn"); }, [turn]);
  useEffect(() => {
    if (!task) return undefined;
    let alive = true;
    setError(null);
    get("/code/tasks/" + task.id + "/diff" + (effective === "turn" ? "?turn=" + n : "")).then((d) => alive && setData(d), (e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [task?.id, effective, n, task?.turns, task?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const files = useMemo(() => data?.files || [], [data]);
  useEffect(() => { if (data) onCount?.(files.length); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => files.map((f) => parsePatch(f.patch)), [files]);
  const counts = useMemo(() => parsed.map((rows) => hunkStarts(rows).length), [parsed]);
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!query) return [];
    const out = [];
    files.forEach((f, i) => parsed[i].forEach((row, k) => { if (row.type !== "hunk" && row.text?.toLowerCase().includes(query)) out.push(f.path + ":" + k); }));
    return out;
  }, [query, files, parsed]);
  useEffect(() => { setHit(0); }, [query]);
  const activeKey = hits[hit];
  // A search hit in a folded file opens it; then the hit comes on screen.
  useEffect(() => {
    if (!activeKey) return;
    const i = files.findIndex((f) => activeKey.startsWith(f.path + ":"));
    if (i >= 0) { setCurrent(i); setFolded((s) => { if (!s.has(i)) return s; const next = new Set(s); next.delete(i); return next; }); }
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { root.current?.querySelector("[data-active]")?.scrollIntoView({ block: "center" }); }, [hit, hits]);
  const byFile = useMemo(() => files.map((f) => findingsByLine(findings, f.path)), [files, findings]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return files.map((file, i) => ({ file, i })).filter((x) => !f || x.file.path.toLowerCase().includes(f));
  }, [files, filter]);
  const goFile = (i) => {
    if (i == null) return;
    setCurrent(i);
    setFolded((s) => { if (!s.has(i)) return s; const next = new Set(s); next.delete(i); return next; });
    requestAnimationFrame(() => root.current?.querySelector(`[data-file="${i}"]`)?.scrollIntoView({ block: "start" }));
  };
  const goHunk = (dir) => {
    const next = stepHunk(counts.map((c, i) => (folded.has(i) ? 0 : c)), at, dir);
    if (!next) return;
    setAt(next); setCurrent(next.file);
    requestAnimationFrame(() => root.current?.querySelector(`[data-hunk="${next.file}:${next.hunk}"]`)?.scrollIntoView({ block: "start" }));
  };
  const toggleFold = (i) => setFolded((s) => { const next = new Set(s); if (next.has(i)) next.delete(i); else next.add(i); return next; });
  const foldAll = folded.size < files.length;
  // The keys of the diff (only while it is on screen and no field has the focus).
  const keys = useRef(() => {});
  keys.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing() || !root.current?.offsetParent) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return;
    const f = files[current];
    const run = { j: () => goHunk(1), k: () => goHunk(-1), n: () => goFile(stepFile(files.length, current, 1)), p: () => goFile(stepFile(files.length, current, -1)), u: () => setSplit(!split), x: () => toggleFold(current), c: () => f && copy(f), e: () => f && f.status !== "D" && editor(f, 1), "/": () => searchRef.current?.focus() }[e.key];
    if (!run || !files.length) return;
    e.preventDefault();
    run();
  };
  useEffect(() => {
    const on = (e) => keys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const groups = useMemo(() => fileTree(shown.map((x) => x.file)), [shown]);
  const indexOf = (f) => files.indexOf(f);
  const point = points.find((p) => p.n === n);
  const scopeLabel = effective === "turn" ? "Punto " + n + " de " + turns : "Toda la tarea";
  const total = { add: data?.add ?? files.reduce((s, f) => s + (f.add || 0), 0), del: data?.del ?? files.reduce((s, f) => s + (f.del || 0), 0) };
  const iconBtn = { ...TOOL, width: "32px", height: "32px" };
  return (
    <div ref={root} style={{ flex: 1, minHeight: 0, display: "flex", animation: "fade .2s ease-out" }}>
      {tree && files.length ? <nav aria-label="Archivos cambiados" style={{ flex: "0 0 216px", minWidth: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--c-line)" }}>
        <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: "8px", padding: "12px 10px 8px" }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: "8px", padding: "0 4px", fontSize: "var(--t-meta)", fontWeight: 600 }}>
            {files.length === 1 ? "1 archivo" : files.length + " archivos"}
            <span style={{ font: `500 var(--t-caption)/1 ${MONO}`, fontVariantNumeric: "tabular-nums" }}><span style={{ color: C.greenText }}>+{total.add}</span> <span style={{ color: C.red }}>−{total.del}</span></span>
          </span>
          {files.length > 6 ? (
            <label style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 8px", borderRadius: "var(--r-sm)", background: "var(--c-sunken)", color: C.muted }}>
              <Search size={14} aria-hidden="true" /><span style={SR}>Filtrar archivos</span>
              <input className="c-bare" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar archivos" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "var(--t-meta)" }} />
            </label>
          ) : null}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 6px 12px" }}>
          {groups.map((g) => (
            <div key={g.dir || "."} role="group" aria-label={g.dir || "raíz"}>
              {g.dir ? <span style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 6px 2px", font: `400 var(--t-caption)/1.3 ${MONO}`, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.dir}><FolderOpen size={14} aria-hidden="true" style={{ flex: "none" }} />{g.dir.replace(/\/$/, "")}</span> : null}
              {g.files.map((f) => {
                const i = indexOf(f);
                const on = i === current;
                return (
                  <button key={f.path} type="button" onClick={() => goFile(i)} aria-current={on ? "true" : undefined} title={f.path}
                    style={{ width: "100%", minHeight: "30px", display: "flex", alignItems: "center", gap: "8px", padding: g.dir ? "0 6px 0 18px" : "0 6px", border: 0, borderRadius: "var(--r-sm)", background: on ? "var(--c-selected)" : "transparent", textAlign: "left", cursor: "pointer" }} className={on ? undefined : "code-hover"}>
                    <StatusBadge file={f} />
                    <span style={{ flex: 1, minWidth: 0, font: `${on ? 600 : 400} var(--t-meta)/1.2 ${MONO}`, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: f.status === "D" ? "line-through" : "none" }}>{splitPath(f.path).name}</span>
                    <span style={{ font: `500 var(--t-caption)/1 ${MONO}`, color: f.add ? C.greenText : C.red, fontVariantNumeric: "tabular-nums" }}>{f.add ? "+" + f.add : f.del ? "−" + f.del : ""}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav> : null}
      <div style={{ flex: "999 1 380px", minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div role="toolbar" aria-label="Opciones de los cambios" style={{ flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "10px 14px", borderBottom: "1px solid var(--c-line)" }}>
          {files.length ? <button type="button" onClick={() => setTree(!tree)} aria-pressed={tree} aria-label="Lista de archivos" title={tree ? "Ocultar la lista de archivos" : "Ver la lista de archivos"} style={{ ...iconBtn, background: tree ? C.track : "transparent", color: tree ? C.ink : C.muted }}><Sidebar size={16} aria-hidden="true" /></button> : null}
          {turns > 1 || turn || points.length > 1 ? (
            <MenuChip title="Qué cambios ver" up={false} width={300} label={<><History size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: "6px" }} />{scopeLabel}</>} look={{ height: "32px", border: "1px solid var(--c-line)", background: "var(--c-card)", color: C.ink }}>
              {(close) => (
                <>
                  <MenuItem icon={<FolderOpen size={16} />} title="Toda la tarea" text="Desde donde empezó la copia" on={effective === "task"} onClick={() => { setScope("task"); onTurn?.(null); close(); }} />
                  {[...points].reverse().map((p) => (
                    <MenuItem key={p.n} icon={<History size={16} />} title={"Punto " + p.n} text={(p.files === 1 ? "1 archivo" : p.files + " archivos") + " · +" + (p.add || 0) + " −" + (p.del || 0)} on={effective === "turn" && n === p.n}
                      onClick={() => { setScope("turn"); onTurn?.(p.n); close(); }} />
                  ))}
                </>
              )}
            </MenuChip>
          ) : null}
          <label style={{ flex: "1 1 180px", display: "flex", alignItems: "center", gap: "8px", height: "32px", padding: "0 10px", borderRadius: "var(--r-sm)", background: "var(--c-sunken)", color: C.muted }}>
            <Search size={14} aria-hidden="true" />
            <span style={SR}>Buscar en los cambios</span>
            <input ref={searchRef} className="c-bare" type="search" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && hits.length) { e.preventDefault(); setHit((x) => (x + (e.shiftKey ? hits.length - 1 : 1)) % hits.length); } if (e.key === "Escape") { e.preventDefault(); if (q) setQ(""); else e.currentTarget.blur(); } }}
              placeholder="Buscar en los cambios  /" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "var(--t-meta)" }} />
            {query ? <span style={{ font: `500 var(--t-caption)/1 ${MONO}`, color: C.quiet }}>{hits.length ? hit + 1 + "/" + hits.length : "0"}</span> : null}
          </label>
          <Seg small label="Cómo ver los cambios" value={split ? "split" : "unified"} onChange={(v) => setSplit(v === "split")} options={[["unified", "Unificado"], ["split", "Lado a lado"]]} />
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            <button type="button" onClick={() => goHunk(-1)} disabled={!files.length} aria-label="Cambio anterior" title="Cambio anterior (k)" style={iconBtn}><ChevronUp size={16} aria-hidden="true" /></button>
            <button type="button" onClick={() => goHunk(1)} disabled={!files.length} aria-label="Cambio siguiente" title="Cambio siguiente (j)" style={iconBtn}><ChevronDown size={16} aria-hidden="true" /></button>
            <button type="button" onClick={() => setFolded(foldAll ? new Set(files.map((_, i) => i)) : new Set())} disabled={!files.length} aria-label={foldAll ? "Plegar todos los archivos" : "Desplegar todos los archivos"} title={foldAll ? "Plegar todos" : "Desplegar todos"} style={iconBtn}>
              {foldAll ? <FoldVertical size={16} aria-hidden="true" /> : <UnfoldVertical size={16} aria-hidden="true" />}
            </button>
          </span>
        </div>
        {effective === "turn" && point && onRestore ? (
          <div role="status" style={{ flex: "none", display: "flex", alignItems: "center", gap: "10px", padding: "8px 14px", borderBottom: "1px solid var(--c-line)", background: "var(--c-sunken)", fontSize: "var(--t-meta)", color: C.text2 }}>
            <History size={16} aria-hidden="true" />
            <span style={{ flex: 1 }}>Lo que cambió en el punto {point.n}. Puedes dejar la copia como quedó justo después.</span>
            <button type="button" disabled={task.running} onClick={() => onRestore(point.n)} title={task.running ? "Bruno está trabajando: páralo antes" : "Deja la copia como estaba justo después de este punto (luego puedes «Deshacer»)"}
              style={{ height: "28px", padding: "0 10px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-raised)", cursor: task.running ? "default" : "pointer", fontSize: "var(--t-caption)", fontWeight: 600, color: task.running ? C.quiet : C.ink }}>Volver a este punto</button>
          </div>
        ) : null}
        <div ref={scroller} data-codediff="" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", padding: "12px 14px 24px" }}>
          {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: C.red }}>{error}</p> : null}
          {note ? <p role="status" onClick={() => setNote(null)} style={{ margin: 0, fontSize: "var(--t-meta)", color: C.text2 }}>{note}</p> : null}
          {!data && !error ? <div aria-hidden="true" style={{ height: "160px", borderRadius: "var(--r-md)", background: "var(--c-sunken)", animation: "colmena-pulse 1.4s ease-in-out infinite" }} /> : null}
          {data && !files.length && !error ? (
            <div style={{ padding: "48px 28px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
              <strong style={{ fontSize: "var(--t-body)" }}>{effective === "turn" ? (n ? "Este punto no cambió archivos" : "Aún no hay cambios") : "La tarea aún no ha cambiado nada"}</strong>
              <span style={{ fontSize: "var(--t-meta)", color: C.faint, maxWidth: "320px", lineHeight: 1.5 }}>Cuando Bruno edite, verás aquí cada línea que añade o quita, archivo por archivo.</span>
            </div>
          ) : null}
          {shown.map(({ file, i }) => (
            <FileBlock key={file.path} file={file} idx={i} rows={parsed[i]} folded={folded.has(i)} onFold={() => { setCurrent(i); toggleFold(i); }} split={split} query={query} activeKey={activeKey}
              pick={sel?.path === file.path ? sel : null}
              onPick={(k, extend) => { setCurrent(i); setSel((s) => (k === null ? null : extend && s?.path === file.path ? { path: file.path, from: Math.min(s.anchor, k), to: Math.max(s.anchor, k), anchor: s.anchor } : { path: file.path, from: k, to: k, anchor: k })); }}
              onComment={(context) => { addContext(task.id, context); setSel(null); }}
              onRevert={task.running ? null : () => revert(file)} onEditor={(line) => editor(file, line)} onCopy={() => copy(file)}
              findings={byFile[i]} onFinding={onFinding} current={i === current} hunkOn={at?.file === i ? at.hunk : null} />
          ))}
          {data?.truncated ? <p style={{ margin: 0, fontSize: "var(--t-caption)", color: C.faint }}>El cambio es muy grande: solo se muestra una parte.</p> : null}
        </div>
      </div>
    </div>
  );
}
