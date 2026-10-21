import { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, GitMerge, GitCommitHorizontal, ChevronDown, FileDiff, Globe, ExternalLink, PanelRight, SquareTerminal, Maximize2, Minimize2 } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import ProjectList, { taskStatus } from "../components/v2/code/ProjectList.jsx";
import CodeHome, { pickProjectFolder } from "../components/v2/code/CodeHome.jsx";
import Composer from "../components/v2/code/Composer.jsx";
import Changes from "../components/v2/code/Changes.jsx";
import Preview from "../components/v2/code/Preview.jsx";
import TerminalPanel from "../components/v2/code/Terminal.jsx";
import { buildRows, TimelineRow } from "../components/v2/code/Timeline.jsx";
import { useCodeProjects, useCodeTask } from "../components/v2/code/useCode.js";
import { C, HEAD, MONO, SHEET, FRAME, CODE_CSS, BrunoMark, MenuItem } from "../components/v2/code/parts.jsx";
import { del, patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { usePanelWidth } from "../lib/usePanelWidth.jsx";
import ShortcutsSheet, { useCodeKeys } from "../components/v2/code/Shortcuts.jsx";

/** Commands for the open task from shortcuts and the palette (TaskView listens). */
const command = (name) => window.dispatchEvent(new CustomEvent("colmena:code-command", { detail: name }));

const WIDE_KEY = "colmena:code-panel-wide";
const readWide = () => { try { return localStorage.getItem(WIDE_KEY) === "1"; } catch { return false; } };

// Colmena 2.0 · Código (design/V2Codigo.dc.html): projects and their tasks on the left, the
// open task with Bruno in the middle, its changes, preview and terminal on the right. Bruno
// works with Claude Code or Codex of this computer (server/code/), in a copy of the project
// when it uses Git.

const TABS = [["cambios", "Cambios", FileDiff], ["vista", "Vista previa", Globe], ["terminal", "Terminal", SquareTerminal]];

function SaveButton({ task, project, onDone, compact = false }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!task?.isolated && !project?.repo) return null;
  const base = task.base || "main";
  const save = async (to) => {
    setOpen(false); setBusy(to); setError(null);
    try {
      const r = await post("/code/tasks/" + task.id + "/save", { to });
      if (r?.url) window.open(r.url, "_blank", "noopener");
      onDone?.();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  // The person pressing «subir» is the OK for publishing: no second question.
  const items = [
    ...(task.isolated ? [["base", "Guardar en " + base, "Commit en " + task.branch + " y merge en tu carpeta."]] : []),
    ["branch", task.isolated ? "Guardar solo en su rama" : "Guardar", "Commit con el mensaje que escribe Bruno."],
    ["push", "Guardar y subir", "Commit y push a GitHub" + (task.branch ? " en " + task.branch : "") + "."],
    ["pr", "Guardar, subir y abrir PR", "Bruno escribe el título y la descripción; tú lo creas en GitHub."],
  ];
  const [primary] = items;
  const disabled = !!busy || task.running;
  const label = { base: "Guardando…", branch: "Guardando…", push: "Subiendo…", pr: "Preparando PR…" }[busy];
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button type="button" disabled={disabled} onClick={() => save(primary[0])} title={primary[2]}
        style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px", border: 0, borderRadius: "999px 0 0 999px", background: C.ink, color: C.white, cursor: disabled ? "default" : "pointer", fontSize: "14px", fontWeight: 600, opacity: disabled ? 0.55 : 1, whiteSpace: "nowrap" }}>
        {task.isolated ? <GitMerge size={15} strokeWidth={2.2} aria-hidden="true" /> : <GitCommitHorizontal size={15} strokeWidth={2.2} aria-hidden="true" />}{compact && !label ? <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{primary[1]}</span> : label || primary[1]}
      </button>
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-label="Más formas de guardar" aria-expanded={open}
        style={{ width: "34px", height: "40px", display: "grid", placeItems: "center", border: 0, borderLeft: "1px solid rgba(255,255,255,.18)", borderRadius: "0 999px 999px 0", background: C.ink, color: C.white, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}>
        <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" style={{ position: "absolute", zIndex: 30, top: "48px", right: 0, width: "330px", padding: "8px", borderRadius: "22px", background: C.white, boxShadow: SHEET, animation: "rise .2s ease-out" }}>
          {items.map(([to, title, text]) => <MenuItem key={to} title={title} text={text} onClick={() => save(to)} />)}
        </div>
      ) : null}
      {error ? <p role="alert" style={{ position: "absolute", top: "48px", right: 0, width: "340px", margin: 0, padding: "12px 14px", borderRadius: "16px", background: C.white, boxShadow: SHEET, fontSize: "13px", lineHeight: 1.45, color: C.red, zIndex: 30 }} onClick={() => setError(null)}>{error}</p> : null}
    </div>
  );
}

/** The engine's usage limit, when it gets close (T3 Code usage limits). */
function LimitLine({ task }) {
  const l = task?.limit;
  if (!l || (l.status === "allowed" && !(l.utilization >= 0.75))) return null;
  const engine = task.engine === "codex" ? "ChatGPT" : "Claude";
  const span = l.type === "seven_day" ? "semanal" : l.type === "five_hour" ? "de 5 horas" : "";
  const when = l.resetsAt ? new Date(l.resetsAt).toLocaleString("es-ES", { weekday: new Date(l.resetsAt).toDateString() === new Date().toDateString() ? undefined : "long", hour: "2-digit", minute: "2-digit" }) : null;
  const stop = l.status !== "allowed";
  return (
    <p role="status" style={{ margin: "0 14px 8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: stop ? C.honeyText : C.faint }}>
      <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: stop ? C.honey : "#C9CBD1" }} />
      {stop ? `Has llegado a tu límite ${span} de ${engine}` : `Has usado el ${Math.round(l.utilization * 100)} % de tu límite ${span} de ${engine}`}{when ? ` · se renueva ${when.includes(",") ? "el " + when : "a las " + when}` : ""}.
    </p>
  );
}

function TaskView({ taskId, narrow = false, panelOpen, onTogglePanel, onShowTurn }) {
  const { task, project, items, live, models, commands, error, reload } = useCodeTask(taskId);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [problem, setProblem] = useState(null);
  const [mode, setMode] = useState("build");
  useEffect(() => { setMode("build"); }, [taskId]);
  // A narrow column (wide side panel) keeps the title and drops the branch details.
  const sectionRef = useRef(null);
  const commandRef = useRef(() => {});
  useEffect(() => {
    const on = (e) => commandRef.current(e.detail);
    window.addEventListener("colmena:code-command", on);
    return () => window.removeEventListener("colmena:code-command", on);
  }, []);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!sectionRef.current) return undefined;
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.width < 660));
    ro.observe(sectionRef.current);
    return () => ro.disconnect();
  }, [!!task]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => buildRows(items), [items]);
  const running = !!task?.running || task?.status === "working";
  const editable = useMemo(() => new Set(items.filter((i) => i.kind === "user" && !i.steer).map((i) => i.id)), [items]);
  const lastNotice = items.at(-1)?.kind === "notice" ? items.at(-1).id : null;
  if (error && !task) return <section style={{ flex: 1, display: "grid", placeItems: "center", color: C.faint }}>{error}</section>;
  if (!task) return <section style={{ flex: 1 }} />;
  const act = async (fn) => { setProblem(null); try { return await fn(); } catch (e) { setProblem(e.message); return false; } };
  const ctx = {
    busy: running, turns: task.turns, editable, lastNotice,
    onDiff: (n) => onShowTurn(n),
    onRestore: (n) => act(() => post("/code/tasks/" + task.id + "/restore", { turn: n })),
    onUndoRestore: (item) => act(() => post("/code/tasks/" + task.id + "/restore", { undo: item.undo })),
    onAnswer: (item, body) => act(() => post("/code/tasks/" + task.id + "/asks/" + item.id, body)),
    onEditFrom: (item) => act(async () => { const r = await post("/code/tasks/" + task.id + "/edit-from", { item: item.id }); setDraft({ text: r.text }); }),
    onPlan: (item, action) => {
      if (action === "refine") { setMode("plan"); setDraft({ text: "" }); return; }
      return act(async () => {
        setMode("build");
        const r = await post("/code/tasks/" + task.id + "/plans/" + item.id, { action });
        if (r?.task?.id) navigate("/codigo/" + r.task.id);
      });
    },
  };
  const openPlan = [...items].reverse().find((i) => i.kind === "plan" && i.status === "open");
  commandRef.current = (name) => {
    if (name === "plan-toggle") setMode((m) => (m === "plan" ? "build" : "plan"));
    else if (name === "parar") act(() => post("/code/tasks/" + task.id + "/stop", {}));
    else if (name === "compactar") act(() => post("/code/tasks/" + task.id + "/compact", {}));
    else if (name === "guardar" && (task.isolated || project?.repo)) act(() => post("/code/tasks/" + task.id + "/save", { to: task.isolated ? "base" : "branch" }).then(reload));
  };
  const s = taskStatus(task);
  const waiting = task.status === "waiting";
  const aura = running && !waiting ? { line: "rgba(255,122,26,.25)", text: C.ink } : waiting ? { line: "rgba(255,201,60,.6)", text: C.honeyText } : { line: task.turns ? "rgba(11,138,95,.35)" : "rgba(18,19,26,.06)", text: C.greenText };
  const send = (text, when, how = "build", files = []) => act(async () => {
    setBusy(true);
    try {
      // A plan-mode message while a plan waits refines it (T3 Code «Refine»).
      if (how === "plan" && openPlan && !running && !files.length) await post("/code/tasks/" + task.id + "/plans/" + openPlan.id, { action: "refine", text });
      else await post("/code/tasks/" + task.id + "/messages", { text, when, mode: how, attachments: files });
    } finally { setBusy(false); }
    return true;
  });
  return (
    <section ref={sectionRef} aria-label={"Tarea: " + task.title} style={{ flex: narrow ? "0 0 520px" : 1, minWidth: narrow ? 0 : "440px", height: "100%", display: "flex", flexDirection: "column" }}>
      <header style={{ flex: "none", background: C.paper }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "20px clamp(18px, 3vw, 32px) 14px" }}>
          <BrunoMark size={38} state={s.state} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "5px" }}>
            <h1 style={{ margin: 0, font: `600 22px/1.05 ${HEAD}`, letterSpacing: "-0.025em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.title}>{task.title}</h1>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", fontSize: "13px", color: C.muted }}>
              <span role="status" style={{ fontWeight: 500, color: aura.text }}>{waiting ? "Te espera" : running ? "Trabajando" : s.text}</span>
              {compact ? null : task.isolated ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span title={task.branch} style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0, maxWidth: "260px", fontFamily: MONO, fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><GitBranch size={13} strokeWidth={2} aria-hidden="true" />{task.branch}</span>
                  <span title={"Bruno trabaja en una copia aparte (git worktree). " + (task.base || "main") + " no cambia hasta que lo guardes."} style={{ padding: "3px 9px", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "12px" }}>Copia aparte de {task.base || "main"}</span>
                </>
              ) : project ? (
                <><span aria-hidden="true">·</span><span style={{ fontFamily: MONO, fontSize: "12px" }}>{project.root}</span></>
              ) : null}
            </span>
          </div>
          <SaveButton task={task} project={project} onDone={reload} compact={compact} />
          <button type="button" onClick={onTogglePanel} aria-pressed={panelOpen} aria-label="Panel de cambios y vista previa" title="Cambios y vista previa" style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: panelOpen ? "rgba(18,19,26,.06)" : "transparent", cursor: "pointer", color: C.text }}>
            <PanelRight size={17} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div aria-hidden="true" style={{ position: "relative", height: "2px", overflow: "hidden", background: "rgba(18,19,26,.06)" }}>
          <span style={{ position: "absolute", inset: 0, transition: "background .4s ease", background: aura.line }} />
          {running && !waiting ? <span style={{ position: "absolute", top: 0, bottom: 0, width: "35%", background: `linear-gradient(90deg, transparent, ${C.bruno}, transparent)`, animation: "sweep 1.8s ease-in-out infinite" }} /> : null}
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", display: "flex", flexDirection: "column-reverse" }}>
        <div style={{ width: "100%", maxWidth: "760px", margin: "0 auto", padding: "22px clamp(18px, 3vw, 32px) 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {rows.map((row) => <TimelineRow key={row.id} row={row} ctx={ctx} />)}
          {live ? <div style={{ color: C.body, fontSize: "16px", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{live}<span aria-hidden="true" style={{ display: "inline-block", width: "7px", height: "16px", marginLeft: "2px", verticalAlign: "-2px", background: C.bruno, animation: "caret 1s steps(1) infinite" }} /></div> : null}
          {running && !waiting && !live ? (
            <span style={{ alignSelf: "flex-start", fontSize: "16px", fontWeight: 500, background: "linear-gradient(90deg, #8A8D96 0%, #8A8D96 35%, #12131A 50%, #8A8D96 65%, #8A8D96 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" }}>Bruno está trabajando…</span>
          ) : null}
          {problem ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: C.red }}>{problem}</p> : null}
        </div>
      </div>
      <Composer task={task} models={models} busy={busy} running={running} draft={draft} mode={mode} onMode={setMode}
        projectId={task.projectId} commands={task.engine === "codex" ? [] : commands} status={<LimitLine task={task} />}
        onCommand={(name) => {
          if (name === "plan") setMode("plan");
          else if (name === "construir") setMode("build");
          else if (name === "compactar") act(() => post("/code/tasks/" + task.id + "/compact", {}));
          else if (name === "parar") act(() => post("/code/tasks/" + task.id + "/stop", {}));
          else if (name === "nueva") navigate("/codigo?proyecto=" + task.projectId);
          else if (name === "atajos") window.dispatchEvent(new Event("colmena:code-shortcuts"));
        }}
        placeholder={running ? "Escribe a Bruno mientras trabaja…" : mode === "plan" ? (openPlan ? "¿Qué cambiarías del plan?" : "Describe qué quieres: Bruno te propone un plan antes de tocar nada…") : "Pide un cambio a Bruno…"}
        onSend={send}
        onStop={() => act(() => post("/code/tasks/" + task.id + "/stop", {}))}
        onChange={(body) => act(() => patch("/code/tasks/" + task.id, body))}
        onUnqueue={(id) => act(() => del("/code/tasks/" + task.id + "/queue/" + id))} />
    </section>
  );
}

function SidePanel({ taskId, turn, onTurn, tab, setTab, wide, onWide }) {
  const { task, project } = useCodeTask(taskId);
  // Drag its left edge to widen it (double click: back to normal), or open it wide.
  const { width, handle } = usePanelWidth("codigo", { min: 380, maxShare: 0.78 });
  if (!task) return null;
  // A dragged width gives way before the conversation gets narrower than its minimum.
  const size = wide ? { flex: "1 1 auto", width: "auto", minWidth: 0 } : width ? { flex: `0 1 ${width}px`, width: width + "px", minWidth: "380px", maxWidth: "78vw" } : { flex: "none", width: "min(520px, 40vw)" };
  const ask = (text) => post("/code/tasks/" + task.id + "/messages", { text, when: "queue" }).catch(() => {});
  const openFolder = () => { window.open?.("file:///" + String(task.cwd).replace(/\\/g, "/"), "_blank", "noopener"); };
  return (
    <aside data-codepanel="" aria-label="Cambios, vista previa y terminal" style={{ position: "relative", ...size, height: "100%", padding: "14px 14px 14px 0", display: "flex", flexDirection: "column" }}>
      {wide ? null : handle}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderRadius: "22px", background: C.white, overflow: "hidden", boxShadow: FRAME }}>
        <div role="tablist" aria-label="Panel" style={{ flex: "none", display: "flex", alignItems: "center", gap: "4px", height: "54px", padding: "0 10px", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
          {TABS.map(([id, label, Icon]) => {
            const on = tab === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTab(id)} style={{ display: "flex", alignItems: "center", gap: "7px", height: "36px", padding: "0 13px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, background: on ? C.ink : "transparent", color: on ? C.white : C.text }}>
                <Icon size={15} strokeWidth={2} aria-hidden="true" />{label}
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => onWide(!wide)} aria-pressed={wide} aria-label={wide ? "Volver al tamaño normal" : "Ampliar el panel"} title={wide ? "Volver al tamaño normal" : "Ampliar el panel"} style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: wide ? "rgba(18,19,26,.06)" : "transparent", cursor: "pointer", color: C.muted }}>
            {wide ? <Minimize2 size={15} strokeWidth={2} aria-hidden="true" /> : <Maximize2 size={15} strokeWidth={2} aria-hidden="true" />}
          </button>
          <button type="button" onClick={openFolder} aria-label="Abrir la carpeta" title={"Abrir la carpeta: " + task.cwd} style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: C.muted }}><ExternalLink size={15} strokeWidth={2} aria-hidden="true" /></button>
        </div>
        {tab === "vista" ? <Preview task={task} project={project} onAsk={ask} /> : tab === "terminal" ? <TerminalPanel task={task} /> : <Changes task={task} turn={turn} onTurn={onTurn} />}
      </div>
    </aside>
  );
}

export default function CodigoV2({ params = {}, query = {} }) {
  const taskId = params.task || null;
  const { data, reload } = useCodeProjects();
  const projects = data?.projects || [];
  const [selected, setSelected] = useState(query.proyecto || null);
  const [panel, setPanel] = useState(true);
  const [tab, setTab] = useState("cambios");
  const [turn, setTurn] = useState(null);
  const [wide, setWideState] = useState(readWide);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const on = () => setSheet(true);
    window.addEventListener("colmena:code-shortcuts", on);
    return () => window.removeEventListener("colmena:code-shortcuts", on);
  }, []);
  const projectOf = () => projects.find((p) => p.tasks.some((t) => t.id === taskId))?.id || selected;
  useCodeKeys({
    newTask: () => navigate("/codigo" + (projectOf() ? "?proyecto=" + projectOf() : "")),
    focusComposer: () => document.querySelector("[data-code-composer]")?.focus(),
    togglePlan: () => command("plan-toggle"),
    stop: () => command("parar"),
    compact: () => command("compactar"),
    save: () => command("guardar"),
    togglePanel: () => setPanel((p) => !p),
    widePanel: () => { setPanel(true); setWide(!wide); },
    tabChanges: () => { setPanel(true); setTab("cambios"); },
    tabPreview: () => { setPanel(true); setTab("vista"); },
    tabTerminal: () => { setPanel(true); setTab("terminal"); },
    newTerminal: () => { setPanel(true); setTab("terminal"); setTimeout(() => window.dispatchEvent(new Event("colmena:code-new-terminal")), 300); },
    shortcuts: () => setSheet(true),
  });
  const setWide = (v) => { setWideState(v); try { localStorage.setItem(WIDE_KEY, v ? "1" : "0"); } catch {} };
  useEffect(() => { if (query.proyecto) setSelected(query.proyecto); }, [query.proyecto]);
  useEffect(() => { setTurn(null); }, [taskId]);
  const addFolder = async () => {
    const folder = await pickProjectFolder();
    if (!folder) return;
    try { const { project } = await post("/code/projects", { folder }); setSelected(project.id); navigate("/codigo?proyecto=" + project.id); reload(); } catch (e) { window.alert(e.message); }
  };
  return (
    <Shell active="codigo" scroll={false} extraCss={CODE_CSS}>
      <div style={{ display: "flex", height: "100%", minWidth: 0 }}>
        {taskId && panel && wide ? null : <ProjectList projects={projects} currentTask={taskId} onOpen={addFolder} />}
        {taskId ? (
          <>
            <TaskView taskId={taskId} narrow={panel && wide} panelOpen={panel} onTogglePanel={() => setPanel(!panel)} onShowTurn={(n) => { setTurn(n); setTab("cambios"); setPanel(true); }} />
            {panel ? <SidePanel taskId={taskId} turn={turn} onTurn={setTurn} tab={tab} setTab={setTab} wide={wide} onWide={setWide} /> : null}
          </>
        ) : (
          <CodeHome projects={projects} selected={selected} onSelect={(id) => { setSelected(id); reload(); }} engines={data?.engines || []} />
        )}
      </div>
      {sheet ? <ShortcutsSheet onClose={() => setSheet(false)} /> : null}
    </Shell>
  );
}
