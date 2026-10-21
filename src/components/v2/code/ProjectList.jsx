import { useEffect, useState } from "react";
import { FolderGit2, Folder, FolderOpen, Plus, Search, X } from "lucide-react";
import { navigate } from "../../../lib/router.jsx";
import { del } from "../../../lib/api.js";
import { C, MONO, HEAD, BrunoMark, Stat, timeAgo } from "./parts.jsx";

// Left column of «Código»: each project with its tasks (design/V2Codigo.dc.html).

const STATUS = {
  working: { text: "Trabajando", dot: C.bruno, fg: C.faint, state: "work" },
  waiting: { text: "Te espera", dot: C.honey, fg: C.honeyText, state: "wait" },
  planned: { text: "Te espera · plan", dot: C.honey, fg: C.honeyText, state: "wait" },
  error: { text: "Se paró", dot: "#C2412D", fg: C.red, state: "rest" },
};

export function taskStatus(t) {
  if (STATUS[t.status]) return STATUS[t.status];
  if (t.turns) return { text: t.merged ? "Guardado" : t.isolated ? "Listo para revisar" : "Listo", dot: C.green, fg: C.faint, state: "rest" };
  return { text: "Nueva", dot: "#C9CBD1", fg: C.faint, state: "rest" };
}

function TaskRow({ task, current }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const s = taskStatus(task);
  const remove = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!armed) { setArmed(true); return; }
    await del("/code/tasks/" + task.id).catch(() => {});
    if (current) navigate("/codigo");
  };
  return (
    <a href={"/codigo/" + task.id} aria-current={current ? "page" : undefined} className="code-hover code-task"
      style={{ position: "relative", display: "flex", alignItems: "center", gap: "11px", marginLeft: "14px", padding: "9px 10px", borderRadius: "14px", background: current ? C.white : "transparent", boxShadow: current ? "0 1px 2px rgba(18,19,26,.05), 0 8px 20px -10px rgba(18,19,26,.18)" : "none" }}>
      <BrunoMark size={18} state={s.state} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ fontSize: "14px", fontWeight: current ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: s.fg, whiteSpace: "nowrap" }}>
          <span aria-hidden="true" style={{ width: "6px", height: "6px", flex: "none", borderRadius: "50%", background: s.dot }} />{s.text}{task.status === "idle" ? " · " + timeAgo(task.updatedAt) : ""}
        </span>
      </span>
      {armed ? null : <Stat add={task.add} del={task.del} size={11} />}
      <button type="button" className="code-x" onClick={remove} aria-label={armed ? "Pulsa otra vez para borrar la tarea" : "Borrar la tarea"} title={armed ? "Pulsa otra vez para borrar" : "Borrar la tarea"}
        style={{ position: armed ? "static" : "absolute", right: "6px", top: "6px", height: "22px", minWidth: "22px", padding: armed ? "0 8px" : 0, display: "grid", placeItems: "center", border: 0, borderRadius: "999px", background: armed ? C.ink : "rgba(18,19,26,.06)", color: armed ? C.white : C.muted, cursor: "pointer", fontSize: "11px", fontWeight: 600, opacity: armed ? 1 : undefined }}>
        {armed ? "Borrar" : <X size={12} strokeWidth={2.4} aria-hidden="true" />}
      </button>
    </a>
  );
}

export default function ProjectList({ projects = [], currentTask = null, onOpen }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = projects.map((p) => ({ ...p, tasks: query ? p.tasks.filter((t) => t.title.toLowerCase().includes(query)) : p.tasks })).filter((p) => !query || p.tasks.length || p.name.toLowerCase().includes(query));
  return (
    <aside data-projects="" aria-label="Proyectos y tareas" style={{ flex: "none", width: "272px", height: "100%", overflowY: "auto", overscrollBehavior: "contain", padding: "28px 12px 24px 16px", display: "flex", flexDirection: "column", gap: "14px", borderRight: "1px solid " + C.rule }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px" }}>
        <h2 style={{ margin: 0, font: `600 22px/1 ${HEAD}`, letterSpacing: "-0.02em" }}>Código</h2>
        <button type="button" onClick={() => navigate("/codigo")} title="Nueva tarea (Ctrl+N)" style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px 0 11px", background: C.ink, color: C.white, border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
          <Plus size={13} strokeWidth={2.8} aria-hidden="true" />Nueva
        </button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", margin: "0 4px", padding: "0 12px", background: "rgba(18,19,26,.045)", borderRadius: "12px", color: C.muted }}>
        <Search size={15} strokeWidth={2.2} aria-hidden="true" />
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar tareas</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tareas" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: "14px" }} />
      </label>
      {shown.map((p) => (
        <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: "2px", paddingTop: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 8px" }} title={p.root}>
            <span aria-hidden="true" style={{ width: "30px", height: "30px", flex: "none", display: "grid", placeItems: "center", borderRadius: "9px", background: "#E9E9E4", color: C.text }}>
              {p.repo ? <FolderGit2 size={15} strokeWidth={2} /> : <Folder size={15} strokeWidth={2} />}
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
              <strong style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</strong>
              <span style={{ font: `400 11px/1.3 ${MONO}`, color: C.quiet, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(p.repo ? (p.base || "git") : "sin git") + " · " + p.root}</span>
            </span>
            <button type="button" onClick={() => navigate("/codigo?proyecto=" + p.id)} aria-label={"Nueva tarea en " + p.name} title="Nueva tarea en este proyecto" style={{ width: "28px", height: "28px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", color: C.faint, cursor: "pointer" }}>
              <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
          {p.tasks.map((t) => <TaskRow key={t.id} task={t} current={t.id === currentTask} />)}
        </div>
      ))}
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: "10px", height: "42px", margin: "0 4px", padding: "0 12px", border: "1px dashed rgba(18,19,26,.18)", borderRadius: "14px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 500, color: C.text }}>
        <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />Abrir otro proyecto
      </button>
    </aside>
  );
}
