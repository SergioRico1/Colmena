import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Search } from "lucide-react";
import { get } from "../../../lib/api.js";
import { C, MONO, Seg, Stat } from "./parts.jsx";
import { parsePatch, diffContext } from "./model.js";
import { addContext } from "./Extras.jsx";

// «Cambios» (T3 Code's diff panel): one turn or the whole task against where it started,
// files on top, the unified diff below, and a search across it (Enter jumps to the next hit).
// Click a line number (Shift+click: several) to comment those lines: the comment goes into
// your next message as a chip.

const STYLE = {
  add: { bg: "#EEF8F2", fg: "#0B4A33", sign: "+", signFg: "#0B8A5F" },
  del: { bg: "#FCEEEB", fg: "#7A2A1F", sign: "−", signFg: "#C2412D" },
  ctx: { bg: "transparent", fg: C.text, sign: " ", signFg: "#A9ACB6" },
};

/** The comment box under selected diff lines (T3 Code AnnotatableCodeView): it becomes a chip. */
function CommentBox({ label, onAdd, onCancel }) {
  const [note, setNote] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) onAdd(note.trim()); }} style={{ margin: "6px 14px 10px 100px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px", borderRadius: "14px", background: C.white, boxShadow: "0 0 0 1px rgba(18,19,26,.08), 0 14px 30px -18px rgba(18,19,26,.35)", animation: "rise .2s ease-out" }}>
      <span style={{ font: `500 11px/1 ${MONO}`, color: C.faint }}>{label}</span>
      <textarea autoFocus rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué le dirías a Bruno de estas líneas?"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (note.trim()) onAdd(note.trim()); } if (e.key === "Escape") onCancel(); }}
        style={{ border: 0, outline: "none", resize: "none", background: "transparent", fontSize: "13px", lineHeight: 1.5 }} />
      <span style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
        <button type="button" onClick={onCancel} style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: C.muted }}>Cancelar</button>
        <button type="submit" disabled={!note.trim()} style={{ height: "30px", padding: "0 14px", border: 0, borderRadius: "999px", background: note.trim() ? C.ink : "rgba(18,19,26,.12)", color: C.white, cursor: note.trim() ? "pointer" : "default", fontSize: "12px", fontWeight: 600 }}>Añadir al mensaje</button>
      </span>
    </form>
  );
}

function Line({ row, query, active, picked = false, onPick = null }) {
  const s = STYLE[row.type];
  let content = row.text;
  if (query) {
    const parts = [];
    const low = row.text.toLowerCase();
    let i = 0, at;
    while ((at = low.indexOf(query, i)) >= 0) {
      if (at > i) parts.push(row.text.slice(i, at));
      parts.push(<mark key={at} style={{ background: active ? "rgba(31,79,209,.32)" : "rgba(31,79,209,.16)", color: "inherit", borderRadius: "3px" }}>{row.text.slice(at, at + query.length)}</mark>);
      i = at + query.length;
    }
    if (parts.length) { if (i < row.text.length) parts.push(row.text.slice(i)); content = parts; }
  }
  return (
    <div data-active={active ? "" : undefined} style={{ display: "grid", gridTemplateColumns: "42px 42px 16px 1fr", alignItems: "baseline", minHeight: "21px", paddingRight: "14px", background: picked ? "rgba(255,201,60,.28)" : s.bg, boxShadow: picked ? "inset 3px 0 0 #FFC93C" : "none", font: `400 12.5px/21px ${MONO}` }}>
      <span onMouseDown={onPick} title={onPick ? "Selecciona la línea para comentarla (Mayús: varias)" : undefined} style={{ gridColumn: "1 / span 2", display: "grid", gridTemplateColumns: "42px 42px", cursor: onPick ? "pointer" : "default", userSelect: "none" }}>
        <span style={{ paddingRight: "8px", textAlign: "right", color: picked ? C.honeyText : "#A9ACB6" }}>{row.a ?? ""}</span>
        <span style={{ paddingRight: "8px", textAlign: "right", color: picked ? C.honeyText : "#A9ACB6" }}>{row.b ?? ""}</span>
      </span>
      <span style={{ color: s.signFg, userSelect: "none" }}>{s.sign}</span>
      <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: s.fg }}>{content}</span>
    </div>
  );
}

function FileDiff({ file, query, activeKey, open, onToggle, refFn, pick = null, onPick = null, onComment = null }) {
  const rows = useMemo(() => parsePatch(file.patch), [file.patch]);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
  const name = file.path.slice(dir.length);
  return (
    <section ref={refFn} style={{ borderBottom: "1px solid rgba(18,19,26,.05)" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ position: "sticky", top: 0, zIndex: 1, width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", border: 0, background: "rgba(255,255,255,.96)", cursor: "pointer", font: `500 12px/1 ${MONO}`, color: C.text, textAlign: "left" }}>
        {open ? <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" /> : <ChevronRight size={12} strokeWidth={2.4} aria-hidden="true" />}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: C.quiet }}>{dir}</span>{name}{file.status === "A" ? <span style={{ color: C.greenText }}> · nuevo</span> : file.status === "D" ? <span style={{ color: C.red }}> · borrado</span> : file.from ? <span style={{ color: C.quiet }}> · antes {file.from}</span> : null}</span>
        <Stat add={file.add} del={file.del} />
      </button>
      {open ? (
        <div style={{ paddingBottom: "8px" }}>
          {file.binary ? <p style={{ margin: "4px 16px 10px", fontSize: "13px", color: C.faint }}>Archivo binario: no se puede mostrar el cambio línea a línea.</p> : null}
          {rows.map((row, k) => row.type === "hunk"
            ? <div key={k} style={{ padding: "6px 16px 4px 100px", font: `400 11.5px/1.4 ${MONO}`, color: C.quiet, background: "rgba(18,19,26,.025)" }}>línea {row.start}{row.text ? " · " + row.text : ""}</div>
            : row.type === "note" ? null
              : (
                <div key={k}>
                  <Line row={row} query={query} active={activeKey === file.path + ":" + k} picked={!!pick && k >= pick.from && k <= pick.to} onPick={onPick ? (e) => { e.preventDefault(); onPick(k, e.shiftKey); } : null} />
                  {pick && k === pick.to && onComment ? <CommentBox label={diffContext(file.path, rows, pick.from, pick.to, "").label} onCancel={() => onPick(null)} onAdd={(note) => onComment(diffContext(file.path, rows, pick.from, pick.to, note))} /> : null}
                </div>
              ))}
        </div>
      ) : null}
    </section>
  );
}

export default function Changes({ task, turn, onTurn }) {
  const [scope, setScope] = useState("turn");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [hit, setHit] = useState(0);
  const [closed, setClosed] = useState(() => new Set());
  const [sel, setSel] = useState(null); // lines picked to comment: {path, from, to, anchor}
  useEffect(() => { setSel(null); }, [task?.id, turn, scope]);
  const refs = useRef(new Map());
  const body = useRef(null);
  const turns = task?.turns || 0;
  const n = turn || task?.lastChanged || null;
  const effective = scope === "turn" && n ? "turn" : "task";
  useEffect(() => { if (turn) setScope("turn"); }, [turn]);
  useEffect(() => {
    if (!task) return undefined;
    let alive = true;
    setError(null);
    get("/code/tasks/" + task.id + "/diff" + (effective === "turn" ? "?turn=" + n : "")).then((d) => alive && setData(d), (e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [task?.id, effective, n, task?.turns, task?.running]);
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!query || !data) return [];
    const out = [];
    for (const f of data.files) parsePatch(f.patch).forEach((row, k) => { if (row.type !== "hunk" && row.text?.toLowerCase().includes(query)) out.push(f.path + ":" + k); });
    return out;
  }, [query, data]);
  useEffect(() => { setHit(0); }, [query]);
  useEffect(() => { body.current?.querySelector("[data-active]")?.scrollIntoView({ block: "center" }); }, [hit, hits]);
  const files = data?.files || [];
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", animation: "fade .25s ease-out" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "8px", padding: "12px 14px 10px" }}>
        <Seg label="Qué cambios" value={effective} onChange={(v) => { setScope(v); if (v === "turn" && onTurn) onTurn(null); }} options={[["turn", n && n !== turns ? "Punto " + n : "Este turno"], ["task", "Toda la tarea"]]} />
        <label style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px", height: "34px", padding: "0 12px", borderRadius: "999px", background: "rgba(18,19,26,.045)", color: C.muted }}>
          <Search size={13} strokeWidth={2.2} aria-hidden="true" />
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar en los cambios</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && hits.length) { e.preventDefault(); setHit((h) => (h + (e.shiftKey ? hits.length - 1 : 1)) % hits.length); } }} placeholder="Buscar en los cambios" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: "13px" }} />
          {query ? <span style={{ font: `500 11px/1 ${MONO}`, color: C.quiet }}>{hits.length ? hit + 1 + "/" + hits.length : "0"}</span> : null}
        </label>
      </div>
      {files.length ? (
        <div style={{ flex: "none", maxHeight: "30%", overflowY: "auto", display: "flex", flexDirection: "column", padding: "0 8px 8px", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
          {files.map((f) => (
            <button key={f.path} type="button" className="code-hover" onClick={() => { setClosed((s) => { const x = new Set(s); x.delete(f.path); return x; }); setTimeout(() => refs.current.get(f.path)?.scrollIntoView({ block: "start" }), 0); }}
              style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "32px", padding: "0 8px", border: 0, borderRadius: "10px", background: "transparent", cursor: "pointer", textAlign: "left" }}>
              <FileCode2 size={13} strokeWidth={2} color={C.muted} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0, font: `400 12.5px/1.2 ${MONO}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ color: C.quiet }}>{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : ""}</span>{f.path.split("/").pop()}
              </span>
              <Stat add={f.add} del={f.del} size={11.5} />
            </button>
          ))}
        </div>
      ) : null}
      <div ref={body} style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {error ? <p style={{ margin: "18px", fontSize: "14px", color: C.red }}>{error}</p> : null}
        {data && !files.length && !error ? (
          <div style={{ padding: "48px 28px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
            <strong style={{ fontSize: "15px" }}>{effective === "turn" ? (n ? "Este turno no cambió archivos" : "Aún no hay cambios") : "La tarea aún no ha cambiado nada"}</strong>
            <span style={{ fontSize: "13px", color: C.faint, maxWidth: "300px", lineHeight: 1.5 }}>Cuando Bruno edite, verás aquí cada línea que añade o quita.</span>
          </div>
        ) : null}
        {files.map((f) => (
          <FileDiff key={f.path} file={f} query={query} activeKey={hits[hit]} open={!closed.has(f.path)} refFn={(el) => (el ? refs.current.set(f.path, el) : refs.current.delete(f.path))}
            onToggle={() => setClosed((s) => { const x = new Set(s); x.has(f.path) ? x.delete(f.path) : x.add(f.path); return x; })}
            pick={sel?.path === f.path ? sel : null}
            onPick={(k, extend) => setSel((s) => (k === null ? null : extend && s?.path === f.path ? { path: f.path, from: Math.min(s.anchor, k), to: Math.max(s.anchor, k), anchor: s.anchor } : { path: f.path, from: k, to: k, anchor: k }))}
            onComment={(context) => { addContext(task.id, context); setSel(null); }} />
        ))}
        {data?.truncated ? <p style={{ margin: "12px 16px", fontSize: "12px", color: C.faint }}>El cambio es muy grande: solo se muestra una parte.</p> : null}
      </div>
    </div>
  );
}
