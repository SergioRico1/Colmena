import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, FileText, Search, SquareArrowOutUpRight } from "lucide-react";
import { get, post } from "../../../lib/api.js";
import { C, MONO, SR } from "./parts.jsx";
import { noteOf, sizeLabel, visibleRows } from "./panels.js";

// «Archivos» (DeepSeek Harness file tree): the task copy's folder, read-only. Folders open one at a
// time (the server lists one directory; what Git ignores stays out, dependencies and .git come
// closed), the filter looks across every file, what the task changed is marked, and the file you
// pick shows on the right with «Abrir en el editor» and «Mostrar en el Explorador».

const MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
export const REVEAL_LABEL = MAC ? "Mostrar en el Finder" : "Mostrar en el Explorador";

/** Shows `rel` of the task in Explorer / Finder (`""`: opens the task folder). Desktop first. */
export async function revealInTask(taskId, rel = "") {
  const bridge = typeof window !== "undefined" ? window.colmenaWindow?.revealPath : null;
  if (bridge) {
    const r = await bridge(taskId, rel);
    if (!r?.ok) throw Error(r?.error || "No se puede mostrar.");
    return;
  }
  await post("/code/tasks/" + taskId + "/reveal", { path: rel });
}

const LINE = 20;
const enc = encodeURIComponent;

/** A text file with line numbers, only the lines on screen drawn (up to 400 KB of text). */
function CodeView({ text, line, onLine }) {
  const lines = useMemo(() => text.replace(/\r?\n$/, "").split(/\r?\n/), [text]);
  const box = useRef(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    let frame = null;
    const read = () => { frame = null; setView({ top: el.scrollTop, height: el.clientHeight }); };
    const onScroll = () => { frame ??= requestAnimationFrame(read); };
    const observer = new ResizeObserver(read);
    observer.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => { if (box.current) box.current.scrollTop = 0; }, [text]);
  const from = Math.max(0, Math.floor(view.top / LINE) - 30);
  const to = Math.min(lines.length, Math.ceil((view.top + view.height) / LINE) + 30);
  const gutter = String(lines.length).length * 8 + 22;
  return (
    <div ref={box} style={{ flex: 1, minHeight: 0, overflow: "auto", overscrollBehavior: "contain", font: `400 12.5px/${LINE}px ${MONO}`, color: C.text }}>
      <div style={{ position: "relative", height: lines.length * LINE + 12 + "px", minWidth: "100%" }}>
        <div style={{ position: "absolute", top: from * LINE + 6 + "px", left: 0, minWidth: "100%" }}>
          {lines.slice(from, to).map((t, k) => {
            const n = from + k + 1;
            const on = n === line;
            return (
              <div key={n} style={{ display: "flex", height: LINE + "px", whiteSpace: "pre", background: on ? "rgba(31,79,209,.08)" : "transparent" }}>
                <span onMouseDown={(e) => { e.preventDefault(); onLine(on ? null : n); }} title="Elige la línea para abrir el editor en ella"
                  style={{ flex: "none", width: gutter + "px", paddingRight: "12px", textAlign: "right", color: on ? C.blue : C.quiet, userSelect: "none", cursor: "pointer" }}>{n}</span>
                <span style={{ paddingRight: "16px" }}>{t || " "}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Viewer({ task, file, changed, onNote }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [line, setLine] = useState(null);
  useEffect(() => {
    let alive = true;
    setData(null); setError(null); setLine(null);
    get("/code/tasks/" + task.id + "/file?path=" + enc(file)).then((d) => alive && setData(d), (e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [task.id, file]);
  const editor = () => post("/code/tasks/" + task.id + "/open-editor", { path: file, line: line || 1 }).then((r) => onNote(r.editor ? null : { info: "No encuentro VS Code, Cursor ni Windsurf: se abre con el programa de ese tipo de archivo." }), (e) => onNote(e.message));
  const reveal = () => revealInTask(task.id, file).then(() => onNote(null), (e) => onNote(e.message));
  const tool = { height: "30px", padding: "0 12px", flex: "none", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: C.white, color: C.ink, cursor: "pointer", fontSize: "12.5px", fontWeight: 500, whiteSpace: "nowrap" };
  const status = changed.get(file);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", minHeight: "30px" }}>
        <span title={file} style={{ flex: "1 1 160px", minWidth: 0, font: `500 13px/1.3 ${MONO}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file}{status ? <span style={{ color: status === "A" ? C.greenText : C.blue }}>{status === "A" ? " · nuevo en la tarea" : " · cambiado en la tarea"}</span> : null}
          {data ? <span style={{ color: C.quiet, fontWeight: 400 }}> · {sizeLabel(data.size)}</span> : null}
        </span>
        <button type="button" onClick={editor} title={line ? "Abre el archivo en la línea " + line : "Abre el archivo en VS Code, Cursor o Windsurf"} style={tool}><SquareArrowOutUpRight size={13} strokeWidth={2.2} aria-hidden="true" />Abrir en el editor</button>
        <button type="button" onClick={reveal} style={tool}><FolderOpen size={13} strokeWidth={2.2} aria-hidden="true" />{REVEAL_LABEL}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderRadius: "14px", background: C.white, border: "1px solid rgba(18,19,26,.08)", overflow: "hidden" }}>
        {error ? <p style={{ margin: 0, padding: "14px 16px", fontSize: "13px", color: C.red }}>{error}</p>
          : !data ? <p style={{ margin: 0, padding: "14px 16px", fontSize: "13px", color: C.faint }}>Abriendo…</p>
            : data.kind === "image" ? (
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "grid", placeItems: "center", padding: "16px", background: C.card }}>
                <img src={data.dataUrl} alt={file} style={{ maxWidth: "100%", height: "auto", borderRadius: "6px", boxShadow: "0 1px 2px rgba(18,19,26,.08)" }} />
              </div>
            ) : data.kind === "binary" ? (
              <p style={{ margin: 0, padding: "14px 16px", fontSize: "13px", lineHeight: 1.5, color: C.faint }}>
                {data.reason === "big" ? "La imagen pasa de 4 MB: ábrela en el editor o en el Explorador." : "Es un archivo binario: no se puede mostrar aquí."}
              </p>
            ) : (
              <>
                {data.truncated ? <p style={{ margin: 0, padding: "8px 16px", borderBottom: "1px solid " + C.rule, fontSize: "12px", color: C.faint }}>Es muy grande: solo se muestran los primeros 400 KB.</p> : null}
                {data.text ? <CodeView text={data.text} line={line} onLine={setLine} /> : <p style={{ margin: 0, padding: "14px 16px", fontSize: "13px", color: C.faint }}>El archivo está vacío.</p>}
              </>
            )}
      </div>
    </>
  );
}

export default function Files({ task }) {
  const [dirs, setDirs] = useState({}); // rel → {entries, hidden, truncated} | {error}
  const [open, setOpen] = useState(() => new Set());
  const [file, setFile] = useState(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null);
  const [changed, setChanged] = useState(() => new Map()); // path → "A" | "M"
  const [note, setNote] = useState(null);
  const load = (dir) => get("/code/tasks/" + task.id + "/tree?dir=" + enc(dir)).then(
    (d) => setDirs((all) => ({ ...all, [dir]: d })),
    (e) => setDirs((all) => ({ ...all, [dir]: { error: e.message } })),
  );
  useEffect(() => { setDirs({}); setOpen(new Set()); setFile(null); load(""); }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // What the task changed (the «Cambios» list), again after each turn.
  useEffect(() => {
    if (task.running) return undefined;
    let alive = true;
    get("/code/tasks/" + task.id + "/diff").then((d) => { if (alive) setChanged(new Map((d.files || []).filter((f) => f.status !== "D").map((f) => [f.path, f.status === "A" ? "A" : "M"]))); }, () => {});
    return () => { alive = false; };
  }, [task.id, task.turns, task.running]);
  const changedDirs = useMemo(() => {
    const s = new Set();
    for (const p of changed.keys()) for (let i = p.indexOf("/"); i > 0; i = p.indexOf("/", i + 1)) s.add(p.slice(0, i));
    return s;
  }, [changed]);
  // The filter looks across every file of the task (the `@` list), not only the open folders.
  const query = q.trim();
  useEffect(() => {
    if (!query) { setFound(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => get("/code/tasks/" + task.id + "/files?limit=150&q=" + enc(query)).then((d) => alive && setFound(d.files || []), () => alive && setFound([])), 150);
    return () => { alive = false; clearTimeout(t); };
  }, [query, task.id]);
  const toggle = (dir) => {
    setOpen((s) => { const n = new Set(s); if (n.has(dir)) n.delete(dir); else n.add(dir); return n; });
    if (!dirs[dir]?.entries) load(dir);
  };
  const rows = useMemo(() => visibleRows(dirs, open), [dirs, open]);
  const root = dirs[""];
  const folderName = String(task.cwd || "").split(/[\\/]/).filter(Boolean).pop() || "carpeta";
  const rowStyle = (depth, on) => ({ width: "100%", minHeight: "30px", display: "flex", alignItems: "center", gap: "6px", padding: "0 8px 0 " + (8 + Math.min(depth, 12) * 14) + "px", border: 0, borderRadius: "8px", background: on ? C.track : "transparent", textAlign: "left", cursor: "pointer", color: C.text });
  const name = { flex: 1, minWidth: 0, font: `400 12.5px/1.2 ${MONO}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const mark = (status) => status ? <span style={{ flex: "none", font: `600 11px/1 ${MONO}`, color: status === "A" ? C.greenText : C.blue }} title={status === "A" ? "Nuevo en la tarea" : "Cambiado en la tarea"}>{status}</span> : null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", animation: "fade .25s ease-out" }}>
      <div style={{ flex: "0 1 270px", minWidth: "180px", display: "flex", flexDirection: "column", borderRight: "1px solid rgba(18,19,26,.06)" }}>
        <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: "8px", padding: "14px 10px 8px" }}>
          <div className="code-turn" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "0 4px" }}>
            <span title={task.cwd} style={{ flex: 1, minWidth: 0, fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folderName}</span>
            <button type="button" onClick={() => revealInTask(task.id, "").then(() => setNote(null), (e) => setNote(e.message))} aria-label={"Abrir la carpeta de la tarea"} title={"Abrir la carpeta de la tarea: " + task.cwd}
              style={{ width: "28px", height: "28px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: C.muted }}>
              <FolderOpen size={14} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "32px", padding: "0 12px", borderRadius: "999px", background: "rgba(18,19,26,.045)", color: C.muted }}>
            <Search size={13} strokeWidth={2.2} aria-hidden="true" />
            <span style={SR}>Filtrar archivos</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar archivos" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: "13px" }} />
          </label>
        </div>
        <div role="tree" aria-label="Archivos de la tarea" style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "0 10px 14px", display: "flex", flexDirection: "column", gap: "1px" }}>
          {query ? (
            found === null ? <p style={{ margin: "6px 8px", fontSize: "12.5px", color: C.faint }}>Buscando…</p>
              : !found.length ? <p style={{ margin: "6px 8px", fontSize: "12.5px", color: C.faint }}>Ningún archivo coincide.</p>
                : found.map((p) => (
                  <button key={p} type="button" role="treeitem" aria-selected={file === p} onClick={() => setFile(p)} title={p} style={rowStyle(0, file === p)}>
                    <FileText size={13} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: C.quiet }} />
                    <span style={name}>{p}</span>{mark(changed.get(p))}
                  </button>
                ))
          ) : root?.error ? <p style={{ margin: "6px 8px", fontSize: "13px", lineHeight: 1.45, color: C.red }}>{root.error}</p>
            : !root ? <p style={{ margin: "6px 8px", fontSize: "12.5px", color: C.faint }}>Cargando…</p>
              : !root.entries.length ? <p style={{ margin: "6px 8px", fontSize: "12.5px", color: C.faint }}>La carpeta está vacía.</p>
                : (
                  <>
                    {rows.map((r) => r.note ? (
                      <span key={r.path} style={{ padding: "4px 8px 4px " + (30 + Math.min(r.depth, 12) * 14) + "px", fontSize: "12px", color: r.error ? C.red : C.quiet }}>{r.note}</span>
                    ) : r.type === "dir" ? (
                      r.heavy ? (
                        <span key={r.path} role="treeitem" aria-expanded={false} title="Dependencias, Git o cachés: no se abre aquí (ábrela en el Explorador si la necesitas)" style={{ ...rowStyle(r.depth, false), cursor: "default", color: C.quiet }}>
                          <ChevronRight size={13} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", opacity: 0.4 }} />
                          <Folder size={13} strokeWidth={2} aria-hidden="true" style={{ flex: "none" }} />
                          <span style={name}>{r.name}</span><span style={{ flex: "none", fontSize: "11.5px" }}>sin abrir</span>
                        </span>
                      ) : (
                        <button key={r.path} type="button" role="treeitem" aria-expanded={open.has(r.path)} onClick={() => toggle(r.path)} title={r.path} style={rowStyle(r.depth, false)}>
                          <ChevronRight size={13} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: C.quiet, transform: open.has(r.path) ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
                          {open.has(r.path) ? <FolderOpen size={13} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: C.muted }} /> : <Folder size={13} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: C.muted }} />}
                          <span style={name}>{r.name}</span>
                          {changedDirs.has(r.path) ? <span aria-label="Tiene cambios" title="Tiene archivos cambiados en la tarea" style={{ flex: "none", width: "6px", height: "6px", borderRadius: "50%", background: C.blue }} /> : null}
                        </button>
                      )
                    ) : (
                      <button key={r.path} type="button" role="treeitem" aria-selected={file === r.path} disabled={r.link === "out"} onClick={() => setFile(r.path)}
                        title={r.link === "out" ? "Es un enlace que lleva fuera de la tarea: no se abre" : r.path + (r.size != null ? " · " + sizeLabel(r.size) : "")}
                        style={{ ...rowStyle(r.depth, file === r.path), ...(r.link === "out" ? { cursor: "default", color: C.quiet } : {}) }}>
                        <span aria-hidden="true" style={{ width: "13px", flex: "none" }} />
                        <FileText size={13} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: C.quiet }} />
                        <span style={name}>{r.name}</span>{mark(changed.get(r.path))}
                      </button>
                    ))}
                    {root.hidden || root.truncated ? <span style={{ padding: "6px 8px", fontSize: "12px", color: C.quiet }}>{noteOf(root)}</span> : null}
                  </>
                )}
        </div>
      </div>
      <div style={{ flex: "999 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px", padding: "14px 18px" }}>
        {note ? <p role="status" onClick={() => setNote(null)} style={{ margin: 0, fontSize: "13px", color: note.info ? C.faint : C.red }}>{note.info || note}</p> : null}
        {file ? <Viewer key={file} task={task} file={file} changed={changed} onNote={setNote} /> : (
          <div style={{ padding: "48px 28px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
            <strong style={{ fontSize: "15px" }}>Elige un archivo</strong>
            <span style={{ fontSize: "13px", color: C.faint, maxWidth: "320px", lineHeight: 1.5 }}>Lo verás aquí tal como está en la copia de la tarea, sin poder cambiarlo. Los que ha tocado la tarea llevan una M (cambiado) o una A (nuevo).</span>
          </div>
        )}
      </div>
    </div>
  );
}
