import { useEffect, useMemo, useState } from "react";
import { Search, Columns2, Undo2, SquareArrowOutUpRight } from "../../Icon.js";
import { get, post } from "../../../lib/api.js";
import { C, MONO, Seg, SR } from "./parts.jsx";
import { parsePatch, diffContext, sideBySide } from "./model.js";
import { addContext } from "./Extras.jsx";

// «Cambios» (design/V3CodigoTarea.dc.html; T3 Code's diff panel): the files on the left, the one
// you pick on the right, one turn or the whole task against where it started, and a search
// across every file (Enter jumps to the next hit). Click a line number (Shift+click: several) to
// comment those lines: the comment goes into your next message as a chip.

const STYLE = {
  add: { bg: "#EAF7F0", fg: "#0B6B4A", sign: "+" },
  del: { bg: "#FBEDEE", fg: "#B4232A", sign: "−" },
  ctx: { bg: "transparent", fg: "#3D404A", sign: " " },
};

/** The comment box under selected diff lines (T3 Code AnnotatableCodeView): it becomes a chip. */
function CommentBox({ label, onAdd, onCancel, onEditor = null }) {
  const [note, setNote] = useState("");
  return (
    <form className="c-ring" onSubmit={(e) => { e.preventDefault(); if (note.trim()) onAdd(note.trim()); }} style={{ display: "flex", gap: "10px", margin: "6px 12px 10px 60px", padding: "10px 12px", borderRadius: "var(--r-md)", background: C.card, fontFamily: "'Geist', sans-serif", fontSize: "var(--t-meta)", lineHeight: 1.45, whiteSpace: "normal", animation: "rise .2s ease-out" }}>
      <span aria-hidden="true" style={{ flex: "none", width: "20px", height: "20px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: C.ink, color: C.white, fontSize: "var(--t-micro)", fontWeight: 600 }}>TÚ</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={{ font: `500 var(--t-micro)/1 ${MONO}`, color: C.faint }}>{label}</span>
        <textarea className="c-bare" autoFocus rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué le dirías a Bruno de estas líneas?" aria-label="Comentario"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (note.trim()) onAdd(note.trim()); } if (e.key === "Escape") onCancel(); }}
          style={{ border: 0, resize: "none", background: "transparent", fontSize: "var(--t-meta)", lineHeight: 1.45 }} />
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
          <span style={{ flex: 1, fontSize: "var(--t-caption)", color: C.muted }}>Bruno lo verá en su siguiente paso</span>
          {onEditor ? <button type="button" onClick={onEditor} style={{ height: "28px", padding: "0 10px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", cursor: "pointer", fontSize: "var(--t-caption)", fontWeight: 500, color: C.blue }}>Abrir en el editor</button> : null}
          <button type="button" onClick={onCancel} style={{ height: "28px", padding: "0 10px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", cursor: "pointer", fontSize: "var(--t-caption)", fontWeight: 500, color: C.muted }}>Cancelar</button>
          <button type="submit" disabled={!note.trim()} style={{ height: "28px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: C.ink, color: C.white, cursor: note.trim() ? "pointer" : "default", opacity: note.trim() ? 1 : 0.45, fontSize: "var(--t-caption)", fontWeight: 600 }}>Añadir al mensaje</button>
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
    parts.push(<mark key={at} style={{ background: active ? "rgba(31,79,209,.32)" : "rgba(31,79,209,.16)", color: "inherit", borderRadius: "var(--r-xs)" }}>{text.slice(at, at + query.length)}</mark>);
    i = at + query.length;
  }
  if (!parts.length) return text;
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

function Line({ row, query, active, picked = false, onPick = null }) {
  const s = STYLE[row.type];
  return (
    <div data-active={active ? "" : undefined} style={{ display: "flex", background: picked ? "rgba(255,201,60,.28)" : s.bg, boxShadow: picked ? "inset 3px 0 0 #FFC93C" : "none", whiteSpace: "pre" }}>
      <span onMouseDown={onPick} title={onPick ? "Selecciona la línea para comentarla (Mayús: varias)" : undefined} style={{ flex: "none", width: "44px", paddingRight: "10px", textAlign: "right", color: picked ? C.honeyText : C.faint, userSelect: "none", cursor: onPick ? "pointer" : "default" }}>{row.b ?? row.a ?? ""}</span>
      <span aria-hidden="true" style={{ flex: "none", width: "16px", color: s.fg, userSelect: "none" }}>{s.sign}</span>
      <span style={{ color: s.fg, paddingRight: "14px" }}>{highlight(row.text, query, active)}</span>
    </div>
  );
}

/** One half of a side-by-side row: its number (click to pick) and its text. */
function Half({ row, side, picked, onPick }) {
  if (!row) return <span style={{ gridColumn: "span 2", background: "rgb(var(--c-ink-rgb) / .025)" }} />;
  const s = STYLE[row.type];
  const num = side === "left" ? row.a : row.b;
  const bg = picked ? "rgba(255,201,60,.28)" : row.type === "ctx" ? "transparent" : s.bg;
  return (
    <>
      <span onMouseDown={onPick} title="Selecciona la línea para comentarla (Mayús: varias)" style={{ paddingRight: "8px", textAlign: "right", color: picked ? C.honeyText : C.faint, background: bg, cursor: "pointer", userSelect: "none" }}>{num ?? ""}</span>
      <span style={{ minWidth: 0, padding: "0 10px 0 4px", whiteSpace: "pre-wrap", wordBreak: "break-all", color: s.fg, background: bg }}>{row.text}</span>
    </>
  );
}

function FileDiff({ file, query, activeKey, pick = null, onPick = null, onComment = null, split = false, onRevert = null, onEditor = null }) {
  const rows = useMemo(() => parsePatch(file.patch), [file.patch]);
  const pairs = useMemo(() => (split ? sideBySide(rows) : null), [rows, split]);
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const name = file.path.split("/").pop();
  const firstLine = rows.find((r) => r.type === "add" || r.type === "del")?.b ?? rows.find((r) => r.type === "hunk")?.start ?? 1;
  const isPicked = (k) => !!pick && k >= pick.from && k <= pick.to;
  const pickAt = (k) => (onPick ? (e) => { e.preventDefault(); onPick(k, e.shiftKey); } : null);
  const comment = (k) => (pick && k === pick.to && onComment ? (
    <CommentBox label={diffContext(file.path, rows, pick.from, pick.to, "").label} onCancel={() => onPick(null)} onAdd={(note) => onComment(diffContext(file.path, rows, pick.from, pick.to, note))}
      onEditor={onEditor ? () => onEditor(diffContext(file.path, rows, pick.from, pick.to, "").lines[0] || firstLine) : null} />
  ) : null);
  const tool = { width: "28px", height: "28px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "transparent", cursor: "pointer", color: C.muted };
  const hunk = { padding: "4px 12px 4px 60px", font: `400 var(--t-caption)/1.5 ${MONO}`, color: C.faint, background: "rgb(var(--c-ink-rgb) / .03)", whiteSpace: "normal" };
  return (
    <>
      <div className="code-turn" style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "28px", font: `500 var(--t-meta)/1 ${MONO}` }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.path}>
          {file.path}{file.status === "A" ? <span style={{ color: C.greenText }}> · nuevo</span> : file.status === "D" ? <span style={{ color: C.red }}> · borrado</span> : file.from ? <span style={{ color: C.faint }}> · antes {file.from}</span> : null}
        </span>
        {onEditor && file.status !== "D" ? <button type="button" className="code-tools" onClick={() => onEditor(firstLine)} aria-label={"Abrir " + name + " en el editor"} title={"Abrir en el editor (línea " + firstLine + ")"} style={tool}><SquareArrowOutUpRight size={14} strokeWidth={2.2} aria-hidden="true" /></button> : null}
        {onRevert ? (
          <button type="button" className={armed ? undefined : "code-tools"} onClick={() => { if (!armed) { setArmed(true); return; } setArmed(false); onRevert(); }} aria-label={armed ? "Pulsa otra vez para deshacer este archivo" : "Deshacer este archivo"} title={armed ? "Pulsa otra vez: vuelve como estaba (luego puedes «Deshacer»)" : "Deshacer los cambios de este archivo"}
            style={armed ? { height: "28px", padding: "0 10px", border: 0, borderRadius: "var(--r-pill)", background: C.ink, color: C.white, cursor: "pointer", fontSize: "var(--t-micro)", fontWeight: 600, whiteSpace: "nowrap" } : tool}>
            {armed ? "Deshacer archivo" : <Undo2 size={14} strokeWidth={2.2} aria-hidden="true" />}
          </button>
        ) : null}
        <span style={{ whiteSpace: "nowrap" }}>{file.add ? <span style={{ color: C.greenText }}>+{file.add}</span> : null}{file.add && file.del ? " " : ""}{file.del ? <span style={{ color: C.red }}>−{file.del}</span> : null}</span>
      </div>
      <div style={{ borderRadius: "var(--r-lg)", background: C.white, border: "1px solid rgb(var(--c-ink-rgb) / .08)", overflowX: "auto", font: `400 var(--t-meta)/1.75 ${MONO}` }}>
        {file.binary ? <p style={{ margin: 0, padding: "12px 16px", fontFamily: "'Geist', sans-serif", fontSize: "var(--t-meta)", color: C.faint }}>Archivo binario: no se puede mostrar el cambio línea a línea.</p> : null}
        {split ? pairs.map((p) => p.type === "hunk"
          ? <div key={"h" + p.k} style={hunk}>línea {p.start}{p.text ? " · " + p.text : ""}</div>
          : (
            <div key={"p" + p.k}>
              <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) 44px minmax(0, 1fr)", alignItems: "stretch" }}>
                <Half row={p.left} side="left" picked={p.left ? isPicked(p.left.k) : false} onPick={p.left ? pickAt(p.left.k) : null} />
                <Half row={p.right} side="right" picked={p.right ? isPicked(p.right.k) : false} onPick={p.right ? pickAt(p.right.k) : null} />
              </div>
              {comment(p.right?.k ?? p.left?.k) || (p.left && p.right && p.left.k !== p.right.k ? comment(p.left.k) : null)}
            </div>
          ))
          : rows.map((row, k) => row.type === "hunk"
            ? (k ? <div key={k} style={hunk}>línea {row.start}{row.text ? " · " + row.text : ""}</div> : null)
            : row.type === "note" ? null
              : (
                <div key={k}>
                  <Line row={row} query={query} active={activeKey === file.path + ":" + k} picked={isPicked(k)} onPick={pickAt(k)} />
                  {comment(k)}
                </div>
              ))}
      </div>
    </>
  );
}

/** `onCount(n)`: how many files the shown changes touch (the «Cambios · N» tab). */
export default function Changes({ task, turn, onTurn, onCount = null }) {
  const [scope, setScope] = useState("task");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [hit, setHit] = useState(0);
  const [file, setFile] = useState(null); // the path on screen
  const [sel, setSel] = useState(null); // lines picked to comment: {path, from, to, anchor}
  const [split, setSplitState] = useState(() => { try { return localStorage.getItem("colmena:code-diff-split") === "1"; } catch { return false; } });
  const setSplit = (v) => { setSplitState(v); try { localStorage.setItem("colmena:code-diff-split", v ? "1" : "0"); } catch {} };
  const [note, setNote] = useState(null);
  const turns = task?.turns || 0;
  const n = turn || task?.lastChanged || null;
  const effective = scope === "turn" && n ? "turn" : "task";
  const revert = (f) => post("/code/tasks/" + task.id + "/revert-file", { path: f.path, turn: effective === "turn" ? n : null }).then(() => setNote(null), (e) => setNote(e.message));
  const editor = (f, line) => post("/code/tasks/" + task.id + "/open-editor", { path: f.path, line }).then((r) => setNote(r.editor ? null : "No encuentro VS Code, Cursor ni Windsurf: se abre con el programa de ese tipo de archivo."), (e) => setNote(e.message));
  useEffect(() => { setSel(null); }, [task?.id, turn, scope, file]);
  useEffect(() => { if (turn) setScope("turn"); }, [turn]);
  useEffect(() => {
    if (!task) return undefined;
    let alive = true;
    setError(null);
    get("/code/tasks/" + task.id + "/diff" + (effective === "turn" ? "?turn=" + n : "")).then((d) => alive && setData(d), (e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [task?.id, effective, n, task?.turns, task?.running]);
  const files = data?.files || [];
  useEffect(() => { if (data) onCount?.(files.length); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!query || !data) return [];
    const out = [];
    for (const f of data.files) parsePatch(f.patch).forEach((row, k) => { if (row.type !== "hunk" && row.text?.toLowerCase().includes(query)) out.push(f.path + ":" + k); });
    return out;
  }, [query, data]);
  useEffect(() => { setHit(0); }, [query]);
  const activeKey = hits[hit];
  // A search hit in another file brings that file on screen.
  useEffect(() => { if (activeKey) setFile(activeKey.slice(0, activeKey.lastIndexOf(":"))); }, [activeKey]);
  useEffect(() => { document.querySelector("[data-codediff] [data-active]")?.scrollIntoView({ block: "center" }); }, [hit, hits, file]);
  const shown = files.find((f) => f.path === file) || files[0] || null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", animation: "fade .25s ease-out" }}>
      <div style={{ flex: "0 1 220px", minWidth: "160px", display: "flex", flexDirection: "column", gap: "2px", padding: "14px 10px", borderRight: "1px solid rgb(var(--c-ink-rgb) / .06)", overflowY: "auto" }}>
        {turns > 1 || turn ? (
          <div style={{ display: "flex", marginBottom: "8px" }}>
            <Seg small label="Qué cambios" value={effective} onChange={(v) => { setScope(v); if (v === "turn" && onTurn) onTurn(null); }} options={[["task", "Toda la tarea"], ["turn", n && n !== turns ? "Punto " + n : "Último turno"]]} />
          </div>
        ) : null}
        {files.map((f) => (
          <button key={f.path} type="button" onClick={() => setFile(f.path)} aria-pressed={shown?.path === f.path} title={f.path}
            style={{ minHeight: "36px", display: "flex", alignItems: "center", gap: "8px", padding: "0 10px", border: 0, borderRadius: "var(--r-sm)", background: shown?.path === f.path ? C.track : "transparent", textAlign: "left", cursor: "pointer" }}>
            <span style={{ flex: 1, minWidth: 0, font: `400 var(--t-meta)/1.2 ${MONO}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
            <span style={{ font: `500 var(--t-caption)/1 ${MONO}`, color: f.add ? C.greenText : C.red }}>{f.add ? "+" + f.add : f.del ? "−" + f.del : ""}</span>
          </button>
        ))}
      </div>
      <div data-codediff="" style={{ flex: "999 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px", padding: "14px 18px", overflowY: "auto" }}>
        {files.length ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px", height: "32px", padding: "0 12px", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .045)", color: C.muted }}>
              <Search size={13} strokeWidth={2.2} aria-hidden="true" />
              <span style={SR}>Buscar en los cambios</span>
              <input className="c-bare" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && hits.length) { e.preventDefault(); setHit((h) => (h + (e.shiftKey ? hits.length - 1 : 1)) % hits.length); } }} placeholder="Buscar en los cambios" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "var(--t-meta)" }} />
              {query ? <span style={{ font: `500 var(--t-micro)/1 ${MONO}`, color: C.quiet }}>{hits.length ? hit + 1 + "/" + hits.length : "0"}</span> : null}
            </label>
            <button type="button" onClick={() => setSplit(!split)} aria-pressed={split} aria-label="Ver lado a lado" title={split ? "Ver unificado" : "Ver lado a lado: antes a la izquierda, después a la derecha"}
              style={{ width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: split ? C.ink : "transparent", color: split ? C.white : C.muted, cursor: "pointer" }}>
              <Columns2 size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {error ? <p style={{ margin: 0, fontSize: "var(--t-ui)", color: C.red }}>{error}</p> : null}
        {note ? <p role="status" onClick={() => setNote(null)} style={{ margin: 0, fontSize: "var(--t-meta)", color: C.honeyText }}>{note}</p> : null}
        {data && !files.length && !error ? (
          <div style={{ padding: "48px 28px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
            <strong style={{ fontSize: "var(--t-body)" }}>{effective === "turn" ? (n ? "Este turno no cambió archivos" : "Aún no hay cambios") : "La tarea aún no ha cambiado nada"}</strong>
            <span style={{ fontSize: "var(--t-meta)", color: C.faint, maxWidth: "300px", lineHeight: 1.5 }}>Cuando Bruno edite, verás aquí cada línea que añade o quita.</span>
          </div>
        ) : null}
        {shown ? (
          <FileDiff key={shown.path} file={shown} query={query} activeKey={activeKey}
            pick={sel?.path === shown.path ? sel : null}
            onPick={(k, extend) => setSel((s) => (k === null ? null : extend && s?.path === shown.path ? { path: shown.path, from: Math.min(s.anchor, k), to: Math.max(s.anchor, k), anchor: s.anchor } : { path: shown.path, from: k, to: k, anchor: k }))}
            onComment={(context) => { addContext(task.id, context); setSel(null); }}
            split={split} onRevert={task.running ? null : () => revert(shown)} onEditor={(line) => editor(shown, line)} />
        ) : null}
        {data?.truncated ? <p style={{ margin: 0, fontSize: "var(--t-caption)", color: C.faint }}>El cambio es muy grande: solo se muestra una parte.</p> : null}
      </div>
    </div>
  );
}
