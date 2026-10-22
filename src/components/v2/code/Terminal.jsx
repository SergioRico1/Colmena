import { useEffect, useRef, useState } from "react";
import { Play, Plus, X, CornerDownLeft } from "lucide-react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { del, get, post } from "../../../lib/api.js";
import { C, MONO } from "./parts.jsx";
import { addContext } from "./Extras.jsx";

// «Terminal» (T3 Code): real shells in the task folder (node-pty on the server, xterm here),
// the project's scripts one click away, and what was on screen kept between sessions. Select
// some output and «Enviar a Bruno» puts it in your next message as a chip (T3 Code).

const MAX_EXCERPT = 12000;

const THEME = {
  background: "#12131A", foreground: "#E6E7EC", cursor: "#FF7A1A", cursorAccent: "#12131A", selectionBackground: "rgba(255,255,255,.18)",
  black: "#12131A", red: "#FF8A80", green: "#7FD6B0", yellow: "#FFC93C", blue: "#8FB4FF", magenta: "#FF8FC7", cyan: "#6FE3E8", white: "#E6E7EC",
  brightBlack: "#6B6F7A", brightRed: "#FFB4AC", brightGreen: "#A7E8CB", brightYellow: "#FFDB7A", brightBlue: "#B5CDFF", brightMagenta: "#FFB6DA", brightCyan: "#9FEEF1", brightWhite: "#FFFFFF",
};

function Screen({ taskId, term, onExit }) {
  const box = useRef(null);
  const xref = useRef(null);
  const [selection, setSelection] = useState("");
  useEffect(() => {
    const xterm = new XTerm({ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, theme: THEME, allowProposedApi: false });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(box.current);
    xref.current = xterm;
    const picked = xterm.onSelectionChange(() => setSelection(xterm.getSelection().trim()));
    const base = "/code/tasks/" + taskId + "/terminals/" + term.id;
    let alive = true, pending = "", timer = null, exited = !term.running;
    const send = () => { timer = null; const data = pending; pending = ""; if (data && !exited) post(base + "/input", { data }).catch(() => {}); };
    const typing = xterm.onData((data) => { pending += data; timer ??= setTimeout(send, 8); });
    const size = () => {
      try { fit.fit(); } catch { return; }
      if (!exited) post(base + "/resize", { cols: xterm.cols, rows: xterm.rows }).catch(() => {});
    };
    const observer = new ResizeObserver(() => { if (alive) size(); });
    observer.observe(box.current);
    setTimeout(size, 30);
    const source = new EventSource("/api" + base + "/stream");
    source.onmessage = (message) => {
      let f;
      try { f = JSON.parse(message.data); } catch { return; }
      if (f.type === "replay") { xterm.reset(); if (f.data) xterm.write(f.data); }
      else if (f.type === "data") xterm.write(f.data);
      else if (f.type === "exit") { exited = true; xterm.write("\r\n\x1b[2mLa terminal se ha cerrado.\x1b[0m\r\n"); onExit?.(); source.close(); }
    };
    xterm.focus();
    return () => { alive = false; observer.disconnect(); typing.dispose(); picked.dispose(); source.close(); clearTimeout(timer); xterm.dispose(); xref.current = null; };
  }, [taskId, term.id]);
  const send = () => {
    const text = selection.length > MAX_EXCERPT ? selection.slice(-MAX_EXCERPT) : selection;
    const lines = text.split(/\r?\n/).length;
    addContext(taskId, { kind: "terminal", label: term.title + " · " + (lines === 1 ? "1 línea" : lines + " líneas"), text });
    xref.current?.clearSelection();
    setSelection("");
  };
  return (
    <>
      <div ref={box} style={{ position: "absolute", inset: "10px 6px 6px 14px" }} />
      {selection ? (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={send} title="Añade lo seleccionado a tu próximo mensaje"
          style={{ position: "absolute", right: "16px", bottom: "14px", zIndex: 2, display: "flex", alignItems: "center", gap: "7px", height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: C.white, color: C.ink, cursor: "pointer", fontSize: "13px", fontWeight: 600, boxShadow: "0 12px 30px -12px rgba(0,0,0,.6)", animation: "rise .2s ease-out" }}>
          <CornerDownLeft size={13} strokeWidth={2.4} aria-hidden="true" />Enviar a Bruno
        </button>
      ) : null}
    </>
  );
}

export default function TerminalPanel({ task }) {
  const [list, setList] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", command: "", onCreate: false });
  const addScript = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await post("/code/projects/" + task.projectId + "/scripts", { name: draft.name.trim(), command: draft.command.trim(), onCreate: draft.onCreate });
      setAdding(false);
      await load();
    } catch (err) { setError(err.message); }
  };
  const [active, setActive] = useState(null);
  const [error, setError] = useState(null);
  const base = "/code/tasks/" + task.id + "/terminals";
  const load = () => get(base).then((d) => { setList(d.terminals); setScripts(d.scripts || []); return d.terminals; });
  const open = async (body = {}) => {
    setError(null);
    try {
      const { terminal } = await post(base, { cols: 100, rows: 30, ...body });
      await load();
      setActive(terminal.id);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => {
    let alive = true;
    load().then((terms) => {
      if (!alive) return;
      const live = terms.find((t) => t.running) || terms[0];
      if (live) { if (!live.running) open({ id: live.id }); else setActive(live.id); }
      else open();
    }).catch((e) => setError(e.message));
    return () => { alive = false; };
  }, [task.id]);
  useEffect(() => {
    const on = () => open();
    window.addEventListener("colmena:code-new-terminal", on);
    return () => window.removeEventListener("colmena:code-new-terminal", on);
  });
  const close = async (id) => {
    await del(base + "/" + id).catch(() => {});
    const terms = await load();
    setActive(terms.find((t) => t.id !== id)?.id || null);
  };
  const current = list?.find((t) => t.id === active) || null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: C.ink, animation: "fade .25s ease-out" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "4px", padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,.07)", overflowX: "auto" }}>
        {(list || []).map((t) => {
          const on = t.id === active;
          return (
            <span key={t.id} style={{ display: "flex", alignItems: "center", gap: "2px", height: "30px", padding: "0 4px 0 12px", borderRadius: "999px", background: on ? "rgba(255,255,255,.1)" : "transparent" }}>
              <button type="button" onClick={() => (t.running ? setActive(t.id) : open({ id: t.id }))} style={{ display: "flex", alignItems: "center", gap: "7px", border: 0, background: "transparent", cursor: "pointer", font: `500 12px/1 ${MONO}`, color: on ? C.white : "#8A8D96", whiteSpace: "nowrap" }}>
                <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "50%", background: t.running ? "#3DDC97" : "rgba(255,255,255,.25)" }} />{t.title}
              </button>
              <button type="button" onClick={() => close(t.id)} aria-label={"Cerrar " + t.title} title="Cerrar la terminal" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#8A8D96" }}><X size={11} strokeWidth={2.4} aria-hidden="true" /></button>
            </span>
          );
        })}
        <button type="button" onClick={() => open()} aria-label="Nueva terminal" title="Nueva terminal" style={{ width: "30px", height: "30px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#8A8D96" }}><Plus size={14} strokeWidth={2.4} aria-hidden="true" /></button>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {current?.running ? <Screen key={current.id} taskId={task.id} term={current} onExit={() => load()} /> : null}
        {error ? <p style={{ position: "absolute", left: "16px", right: "16px", top: "14px", margin: 0, fontSize: "13px", color: "#FF8A80" }}>{error}</p> : null}
      </div>
      {adding ? (
        <form onSubmit={addScript} style={{ flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,.07)" }}>
          <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nombre (p. ej. web)" aria-label="Nombre del script" style={{ width: "130px", height: "30px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(255,255,255,.08)", color: "#E6E7EC", font: `400 12px/1 ${MONO}`, outline: "none" }} />
          <input value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} placeholder="Orden (p. ej. npm run dev)" aria-label="Orden del script" style={{ flex: "1 1 180px", height: "30px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(255,255,255,.08)", color: "#E6E7EC", font: `400 12px/1 ${MONO}`, outline: "none" }} />
          <label title="Se ejecuta solo en la copia de cada tarea nueva (p. ej. npm install)" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#8A8D96" }}><input type="checkbox" checked={draft.onCreate} onChange={(e) => setDraft({ ...draft, onCreate: e.target.checked })} />Al crear cada tarea</label>
          <button type="submit" disabled={!draft.name.trim() || !draft.command.trim()} style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "#FFFFFF", color: C.ink, cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>Guardar</button>
          <button type="button" onClick={() => setAdding(false)} style={{ height: "30px", padding: "0 10px", border: 0, borderRadius: "999px", background: "transparent", color: "#8A8D96", cursor: "pointer", fontSize: "12px" }}>Cancelar</button>
        </form>
      ) : (
        <div style={{ flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,.07)" }}>
          <span style={{ fontSize: "12px", color: "#8A8D96", marginRight: "4px" }}>Scripts</span>
          {scripts.map((s) => (
            <button key={s.name} type="button" onClick={() => open({ script: s.name })} title={s.command + " · en una terminal nueva" + (s.onCreate ? " · también al crear cada tarea" : "")} style={{ display: "flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 11px", border: 0, borderRadius: "999px", background: "rgba(255,255,255,.07)", color: "#E6E7EC", cursor: "pointer", font: `500 12px/1 ${MONO}` }}>
              <Play size={10} fill="currentColor" strokeWidth={0} aria-hidden="true" />{s.name}
            </button>
          ))}
          <button type="button" onClick={() => { setDraft({ name: "", command: "", onCreate: false }); setAdding(true); }} title="Añadir un script del proyecto (se guarda en colmena.json)" style={{ display: "flex", alignItems: "center", gap: "5px", height: "28px", padding: "0 10px", border: "1px dashed rgba(255,255,255,.18)", borderRadius: "999px", background: "transparent", color: "#8A8D96", cursor: "pointer", fontSize: "12px" }}>
            <Plus size={11} strokeWidth={2.4} aria-hidden="true" />Script
          </button>
        </div>
      )}
    </div>
  );
}
