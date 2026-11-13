import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Check, Target, Pause, Play, X, Ellipsis, Maximize2, Minimize2, ExternalLink, PanelRight, GitBranch, GitPullRequest, UploadCloud, ShieldCheck, RefreshCw, Columns3, Keyboard, GitMerge, GitPullRequestArrow, Files as FilesIcon, FolderOpen, SquareArrowOutUpRight, Stop } from "../components/Icon.js";
import { useRevealMessage } from "../lib/reveal.js";
import Shell from "../components/v2/Shell.jsx";
import { whenLabel, taskActions, CiChip } from "../components/v2/code/ProjectList.jsx";
import { MenuButton } from "../components/Menu.js";
import PrPanel from "../components/v2/code/PrPanel.jsx";
import { nextAction } from "../components/v2/code/flow.js";
import { TERM } from "../lib/palette4.js";
import CodeHome from "../components/v2/code/CodeHome.jsx";
import Composer from "../components/v2/code/Composer.jsx";
import { EngineMark } from "../components/v2/code/EngineModels.jsx";
import Changes from "../components/v2/code/Changes.jsx";
import Preview from "../components/v2/code/Preview.jsx";
import Files, { revealInTask } from "../components/v2/code/Files.jsx";
import Processes from "../components/v2/code/Processes.jsx";
import { buildRows, TimelineRow, withoutGoalMark, BOT_ROWS } from "../components/v2/code/Timeline.jsx";
import { findingContext, findingsText, stepsOf } from "../components/v2/code/model.js";
import { addContext } from "../components/v2/code/Extras.jsx";
import { useCodeLive, useCodeProjects, useCodeTask } from "../components/v2/code/useCode.js";
import { C, HEAD, MONO, SHEET, CODE_CSS, BTN, BotShape, botOf } from "../components/v2/code/parts.jsx";
import Markdown from "../components/room/Markdown.jsx";
import { del, patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { useStore } from "../lib/store.jsx";
import { usePanelWidth } from "../lib/usePanelWidth.jsx";
import ShortcutsSheet, { useCodeKeys } from "../components/v2/code/Shortcuts.jsx";
import Compare from "../components/v2/code/Compare.jsx";
import { failure, later } from "../lib/undoToast.js";
import BtwNotes, { useBtw } from "../components/v2/BtwNotes.jsx";
import TaskPeople, { PeerComments } from "../components/v2/people/TaskPeople.jsx";
import { HandoffPage, SharedTask } from "../components/v2/people/SharedTasks.jsx";

/** Commands for the open task from shortcuts and the palette (TaskView listens). */
const command = (name) => window.dispatchEvent(new CustomEvent("colmena:code-command", { detail: name }));

const WIDE_KEY = "colmena:code-panel-wide";
const readWide = () => { try { return localStorage.getItem(WIDE_KEY) === "1"; } catch { return false; } };

// Código (v4): the place with the box to start and the tasks by what they need; a task with Bruno's
// conversation on the left (resizable, remembered) and its workspace on the right (changes, PR,
// plan, terminal, files, processes, preview), with ONE primary button in the header for the next
// step (flow.js nextAction); and the comparison of several engines. Bruno works with Claude Code,
// Codex or OpenCode of this computer (server/code/), in a copy of the project when it uses Git.

const TABS = [["cambios", "Cambios"], ["pr", "PR"], ["plan", "Plan"], ["terminal", "Terminal"], ["archivos", "Archivos"], ["procesos", "Procesos"], ["vista", "Vista previa"]];

/**
 * Saving a task: «Fusionar en main» goes through a review first (OpenClaw autoreview: P0–P1
 * stop it); branch, push and PR; the review alone; catching up with the base. Pressing it is
 * your OK (red lines: merging, pushing and publishing never happen on Bruno's own).
 */
function useSave(task, reload) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [warn, setWarn] = useState(null); // {serious} after a review, {resolving: files} on conflicts
  const reviewed = task?.review && task.review.turns === task.turns;
  const save = async (to, { force = false } = {}) => {
    setBusy(to); setError(null); setWarn(null);
    try {
      if (to === "review" || to === "catchup") {
        const r = await post("/code/tasks/" + task.id + (to === "review" ? "/review" : "/catch-up"), {});
        if (r?.resolving) setWarn({ resolving: r.files });
        reload?.();
        return;
      }
      if (to === "base" && !force) {
        let serious = reviewed ? task.review.serious : null;
        if (serious === null) { setBusy("review"); serious = (await post("/code/tasks/" + task.id + "/review", {})).serious; setBusy("base"); }
        if (serious) { setWarn({ serious }); reload?.(); return; }
      }
      const r = await post("/code/tasks/" + task.id + "/save", { to });
      if (r?.resolving) setWarn({ resolving: r.files });
      if (r?.url) window.open(r.url, "_blank", "noopener");
      reload?.();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const label = { base: "Fusionando…", branch: "Guardando…", push: "Subiendo…", pr: "Preparando PR…", review: "Revisando…", catchup: "Trayendo " + (task?.base || "main") + "…" }[busy] || null;
  return { save, busy, label, error, setError, warn, setWarn };
}

/** A model of another engine chosen while Bruno works: it goes on with it when the turn ends. */
function SwitchLine({ task, engines }) {
  const p = task?.pendingSwitch;
  if (!p) return null;
  const e = engines.find((x) => x.id === p.engine);
  const name = (e?.label || p.engine) + " · " + (e?.models.find((m) => m.id === p.model)?.label || p.model);
  return (
    <p role="status" style={{ margin: "0 4px 8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-caption)", color: C.faint }}>
      <EngineMark engine={p.engine} size={12} />Al acabar este turno sigue con {name}, con lo hablado hasta ahora.
    </p>
  );
}

/** The engine's usage limit, when it gets close (T3 Code usage limits). */
function LimitLine({ task }) {
  const l = task?.limit;
  if (!l || (l.status === "allowed" && !(l.utilization >= 0.75))) return null;
  const engine = { codex: "ChatGPT", opencode: "OpenCode", "claude-code": "Claude" }[task.engine] || "Claude";
  const span = l.type === "seven_day" ? "semanal" : l.type === "five_hour" ? "de 5 horas" : "";
  const when = l.resetsAt ? new Date(l.resetsAt).toLocaleString("es-ES", { weekday: new Date(l.resetsAt).toDateString() === new Date().toDateString() ? undefined : "long", hour: "2-digit", minute: "2-digit" }) : null;
  const stop = l.status !== "allowed";
  return (
    <p role="status" style={{ margin: "0 4px 8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-caption)", color: stop ? C.honeyText : C.faint }}>
      <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "var(--r-circle)", background: stop ? C.honey : "var(--c-line-strong)" }} />
      {stop ? `Has llegado a tu límite ${span} de ${engine}` : `Has usado el ${Math.round(l.utilization * 100)} % de tu límite ${span} de ${engine}`}{when ? ` · se renueva ${when.includes(",") ? "el " + when : "a las " + when}` : ""}.
    </p>
  );
}

/** «/goal» (T3 Code Goals, OpenClaw goal): the objective above the composer and how it goes. */
function GoalRow({ task, onGoal }) {
  const g = task?.goal;
  if (!g) return null;
  const max = g.max || 12;
  const look = {
    active: { text: task.running ? `Vuelta ${Math.min(g.turns + 1, max)} de ${max}` : "En marcha", fg: C.text, bar: C.bruno },
    complete: { text: "Cumplido", fg: C.greenText, bar: C.green },
    blocked: { text: "Bloqueado" + (g.note ? ": " + g.note : ""), fg: C.honeyText, bar: C.honey },
    limited: { text: g.note || "Se paró", fg: C.honeyText, bar: C.honey },
    paused: { text: "En pausa" + (g.note && g.note !== "Lo has pausado." ? " · " + g.note : ""), fg: C.faint, bar: "var(--c-line-strong)" },
  }[g.status] || { text: g.status, fg: C.faint, bar: "var(--c-line-strong)" };
  const pct = g.status === "complete" ? 1 : Math.min(1, (g.turns + (task.running ? 0.5 : 0)) / max);
  const live = g.status === "active";
  const btn = { height: "28px", padding: "0 10px", display: "flex", alignItems: "center", gap: "5px", border: 0, borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .05)", cursor: "pointer", fontSize: "var(--t-caption)", fontWeight: 600, color: C.ink, whiteSpace: "nowrap" };
  return (
    <div role="status" aria-label="Objetivo" style={{ position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", padding: "8px 8px 8px 12px", borderRadius: "var(--r-lg)", background: C.white, boxShadow: "var(--c-shadow-lift)", animation: "rise .25s ease-out" }}>
      <span aria-hidden="true" style={{ width: "24px", height: "24px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: g.status === "complete" ? C.greenSoft : live ? "var(--c-accent-soft)" : C.soft, color: g.status === "complete" ? C.green : live ? C.bruno : C.muted }}>
        {g.status === "complete" ? <Check size={13} strokeWidth={2.6} /> : <Target size={13} strokeWidth={2.2} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontSize: "var(--t-meta)", fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.text}>{g.text}</span>
        <span style={{ fontSize: "var(--t-caption)", color: look.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{look.text}</span>
      </span>
      {live ? <button type="button" onClick={() => onGoal("pause")} style={btn} title="Bruno acaba el turno en curso y no sigue solo"><Pause size={11} strokeWidth={2.6} aria-hidden="true" />Pausar</button> : null}
      {["paused", "blocked", "limited"].includes(g.status) ? <button type="button" onClick={() => onGoal("resume")} style={btn} title="Bruno sigue con el objetivo"><Play size={11} strokeWidth={2.6} aria-hidden="true" />Reanudar</button> : null}
      <button type="button" onClick={() => onGoal("clear")} aria-label="Quitar el objetivo" title="Quitar el objetivo" style={{ width: "28px", height: "28px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "transparent", cursor: "pointer", color: C.muted }}><X size={13} strokeWidth={2.4} aria-hidden="true" /></button>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, bottom: 0, height: "2px", width: pct * 100 + "%", background: look.bar, transition: "width .5s ease" }} />
    </div>
  );
}

/** Tells the server which task is on screen, so it does not send a notice for it. */
function useWatch(taskId) {
  useEffect(() => {
    const tell = () => post("/code/watch", { task: taskId, focused: document.visibilityState === "visible" && document.hasFocus() }).catch(() => {});
    tell();
    const timer = setInterval(tell, 45000);
    window.addEventListener("focus", tell);
    window.addEventListener("blur", tell);
    document.addEventListener("visibilitychange", tell);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tell);
      window.removeEventListener("blur", tell);
      document.removeEventListener("visibilitychange", tell);
      post("/code/watch", { task: null, focused: false }).catch(() => {});
    };
  }, [taskId]);
}

const CHIP = { height: "24px", padding: "0 9px", display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "var(--r-sm)", background: C.white, border: "1px solid rgb(var(--c-ink-rgb) / .08)", whiteSpace: "nowrap", color: C.text2 };
// A status chip of the task (v4): a soft ground, its ink, an icon in front. Honey only for «Te espera».
const SIGNAL = (bg, fg) => ({ ...CHIP, height: "26px", gap: "6px", padding: "0 8px", border: 0, borderRadius: "var(--r-pill)", background: bg, color: fg, fontFamily: "'Geist', sans-serif", fontSize: "var(--t-caption)", fontWeight: 600 });
const PR_LOOK = { OPEN: ["var(--c-accent-soft)", "var(--c-accent-ink)"], MERGED: ["var(--c-ok-soft)", "var(--c-ok-ink)"], CLOSED: ["var(--c-chip)", "var(--c-text-3)"] };

/** What GitHub says of an open PR: draft, approved, changes requested ([text, look, title]). */
function prDecision(pr) {
  if (!pr?.number || pr.state !== "OPEN") return null;
  if (pr.isDraft) return ["Borrador", SIGNAL("var(--c-chip)", C.text2), "La PR es un borrador: nadie la revisa hasta que la marques como lista"];
  if (pr.reviewDecision === "APPROVED") return [<><Check size={12} weight="bold" aria-hidden="true" />Aprobada</>, SIGNAL("var(--c-ok-soft)", C.greenText), "Han aprobado la PR en GitHub"];
  if (pr.reviewDecision === "CHANGES_REQUESTED") return ["Piden cambios", SIGNAL("var(--c-warn-soft)", "var(--c-warn)"), "En GitHub piden cambios en la PR: Bruno se pone con ellos"];
  return null;
}

/** The chips under the title: branch → base, the PR, CI and where the task stands. */
function TaskChips({ task, project, running }) {
  const pr = task.pr;
  const base = task.base || project?.base || "main";
  const decision = prDecision(pr);
  const merged = pr?.state === "MERGED";
  const conflict = pr?.state === "OPEN" && pr.mergeable === "CONFLICTING";
  const wake = () => post("/code/tasks/" + task.id + (task.archived ? "/archive" : "/snooze"), task.archived ? { archived: false } : { until: null }).catch((e) => failure(task.archived ? "No se pudo desarchivar la tarea" : "No se pudo reanudar la tarea", e.message));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", font: `400 var(--t-meta)/1 ${MONO}`, color: C.text2 }}>
      {task.isolated ? (
        <span style={CHIP} title={task.saved ? "Ya está en tu carpeta. Su copia se ha limpiado; si vuelves a escribir aquí, Colmena la recupera tal cual." : "Bruno trabaja en una copia aparte (git worktree). " + base + " no cambia hasta que la fusiones."}>{task.branch} → {base}</span>
      ) : project ? <span style={CHIP} title="Bruno trabaja en la carpeta del proyecto">{project.root}</span> : null}
      {pr?.number ? <a href={pr.url || undefined} target="_blank" rel="noreferrer" style={{ ...SIGNAL(...(PR_LOOK[pr.state] || PR_LOOK.OPEN)), ...(pr.isDraft ? { background: "var(--c-chip)", color: C.text2 } : {}) }} title={pr.watching ? "Colmena sigue esta PR con gh: si falla el CI, hay conflictos o comentan, Bruno se pone con ello (subir sigue pidiendo tu OK)." : undefined}><GitPullRequest size={12} aria-hidden="true" />{(pr.isDraft ? "Borrador · " : "") + "PR #" + pr.number}</a>
        : pr?.watching ? <span style={CHIP}>PR · esperando…</span> : null}
      {merged ? <span style={SIGNAL("var(--c-ok-soft)", C.greenText)}><GitMerge size={12} aria-hidden="true" />Fusionada</span> : conflict ? <span style={SIGNAL("var(--c-warn-soft)", "var(--c-warn)")}>Conflictos con {base}</span> : <CiChip task={task} />}
      {decision ? <span style={decision[1]} title={decision[2]}>{decision[0]}</span> : null}
      {running ? <span style={SIGNAL("var(--c-accent-soft)", C.blue)}><span aria-hidden="true" className="code-pulse" style={{ width: "6px", height: "6px", borderRadius: "var(--r-circle)", background: C.blue }} />Trabajando</span>
        : task.status === "waiting" || task.status === "planned" ? <span style={SIGNAL(C.honey, "var(--c-honey-ink)")}>Te espera</span>
          : task.status === "error" ? <span style={SIGNAL(C.redSoft, C.red)}>Atascada</span> : null}
      {task.saved ? <span style={SIGNAL("var(--c-ok-soft)", C.greenText)}><Check size={12} weight="bold" aria-hidden="true" />Guardada en {base}</span> : null}
      {task.archived || task.snoozed ? (
        <button type="button" onClick={wake} title={task.archived ? "Archivada: vuelve si le escribes, o pulsa para desarchivarla" : "Pospuesta: pulsa para despertarla ya"} style={{ ...SIGNAL("var(--c-chip)", C.text2), cursor: "pointer" }}>
          {task.archived ? "Archivada · Desarchivar" : "Vuelve " + whenLabel(task.snoozed.until) + " · Despertar"}
        </button>
      ) : null}
      {task.group ? <a href={"/codigo/comparar/" + task.group} style={{ ...SIGNAL("var(--c-chip)", C.blue) }} title="La misma petición con otros motores, lado a lado"><Columns3 size={12} strokeWidth={2.2} aria-hidden="true" />Comparar</a> : null}
      {(task.overlaps || []).slice(0, 2).map((o) => (
        <a key={o.task} href={"/codigo/" + o.task} style={SIGNAL("var(--c-honey-soft)", C.honeyText)} title={`Las dos tareas cambian ${o.count === 1 ? "este archivo" : "estos archivos"}: ${o.files.join(", ")}${o.count > o.files.length ? "…" : ""}. Al fusionar pueden chocar.`}>
          <FilesIcon size={12} strokeWidth={2.2} aria-hidden="true" />Mismos archivos que «{o.title.length > 32 ? o.title.slice(0, 32) + "…" : o.title}»
        </a>
      ))}
    </div>
  );
}

/** «El plan de Bruno»: his list of steps (TodoWrite) with what is done and what he does now. */
function Steps({ steps, approved }) {
  const look = { done: ["✓", "var(--c-ok-soft)", C.greenText, C.ink], now: ["•", "var(--c-chip)", C.blue, C.ink], todo: ["", C.track, C.blue, C.muted] };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: "var(--r-xl)", background: C.white }}>
      <span style={{ fontSize: "var(--t-meta)", fontWeight: 600, color: C.muted }}>{approved ? "El plan de Bruno · aprobado" : "Los pasos de Bruno"}</span>
      {steps.map((s, k) => {
        const [mark, bg, ink, text] = look[s.status] || look.todo;
        return (
          <div key={k} style={{ display: "flex", gap: "10px", fontSize: "var(--t-ui)", lineHeight: 1.4 }}>
            <span aria-hidden="true" style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: bg, color: ink, fontSize: "var(--t-micro)", fontWeight: 700 }}>{mark}</span>
            <span style={{ color: text }}>{s.text}<span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{s.status === "done" ? " (hecho)" : s.status === "now" ? " (ahora)" : ""}</span></span>
          </div>
        );
      })}
    </div>
  );
}

/** Consecutive rows Bruno writes or does hang under his shape and name (design/V3CodigoTarea). */
function blocksOf(rows) {
  const out = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (BOT_ROWS.has(row.kind)) {
      if (last?.bot) last.rows.push(row);
      else out.push({ bot: true, id: "b-" + row.id, rows: [row] });
    } else out.push({ bot: false, id: row.id, row });
  }
  return out;
}

// The text Bruno is writing: these two read it themselves (useCodeLive), so each piece that
// arrives repaints them alone and the task screen stays as it is.
/** Under his last block of work: the text so far and the caret. */
function LiveTail({ taskId, color }) {
  const live = useCodeLive(taskId);
  if (!live) return null;
  return <div style={{ color: C.body, whiteSpace: "pre-wrap" }}>{withoutGoalMark(live)}<span aria-hidden="true" style={{ display: "inline-block", width: "6px", height: "15px", marginLeft: "2px", verticalAlign: "-2px", background: color, animation: "caret 1s steps(1) infinite" }} /></div>;
}
/** The text so far, or `children` while there is none yet. */
function LiveOr({ taskId, children }) {
  const live = useCodeLive(taskId);
  return live ? withoutGoalMark(live) : children;
}

// xterm is heavy and most tasks never open a terminal: loaded with the tab.
const loadTerminal = () => import("../components/v2/code/Terminal.jsx");
const TerminalPanel = lazy(loadTerminal);

function TaskScreen({ taskId, engines = [], github = null, panel, wide, onPanel, onWide, tab, setTab, turn, setTurn, reveal = null }) {
  const { task, project, items, models, commands, error, reload } = useCodeTask(taskId);
  // «Buscar en las tareas» opens /codigo/<task>?m=<item>: that message centred and lit up.
  useRevealMessage(reveal, { ready: items.length > 0 });
  const { bots } = useStore();
  const bot = botOf(bots, task);
  const name = bot?.name || "Bruno";
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [problem, setProblem] = useState(null);
  const [mode, setMode] = useState("build");
  const [count, setCount] = useState(null);
  useEffect(() => { setMode("build"); setCount(null); }, [taskId]);
  useWatch(taskId);
  const saving = useSave(task, reload);
  const [prBusy, setPrBusy] = useState(null); // "merge" | "ready": a button on the PR in GitHub
  // «/btw …»: ask Bruno something while he works, apart from the task (BtwNotes.jsx).
  const btw = useBtw("/code/tasks/" + taskId + "/btw");
  const sectionRef = useRef(null);
  useEffect(() => {
    // Esc closes the newest note when you are not in the middle of writing something.
    const on = (e) => {
      const field = e.target?.closest?.("textarea, input");
      if (field && field.value?.trim()) return;
      if (sectionRef.current?.contains(e.target) || e.target === document.body) btw.handleKey(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [btw.handleKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const commandRef = useRef(() => {});
  const runNextRef = useRef(() => {}); // the primary button, for its shortcut
  useEffect(() => {
    const on = (e) => commandRef.current(e.detail);
    window.addEventListener("colmena:code-command", on);
    return () => window.removeEventListener("colmena:code-command", on);
  }, []);
  const chat = usePanelWidth("codigo-chat", { min: 320, maxShare: 0.55, side: "left" });
  // Bruno's list of steps shows as the plan card on top, not as a line of his work log.
  const steps = useMemo(() => stepsOf(items), [items]);
  const rows = useMemo(() => buildRows(steps ? items.filter((i) => !(i.kind === "tool" && i.todos)) : items), [items, steps]);
  const blocks = useMemo(() => blocksOf(rows), [rows]);
  const running = !!task?.running || task?.status === "working";
  const editable = useMemo(() => new Set(items.filter((i) => i.kind === "user" && !i.steer).map((i) => i.id)), [items]);
  const lastNotice = items.at(-1)?.kind === "notice" ? items.at(-1).id : null;
  const plans = items.filter((i) => i.kind === "plan");
  const plan = plans.at(-1) || null;
  const openPlan = [...plans].reverse().find((i) => i.status === "open");
  const reviewItem = [...items].reverse().find((i) => i.kind === "review") || null;
  if (error && !task) return <section style={{ flex: 1, display: "grid", placeItems: "center", color: C.faint }}>{error}</section>;
  if (!task) return <section style={{ flex: 1 }} />;
  const act = async (fn) => { setProblem(null); try { return await fn(); } catch (e) { setProblem(e.message); return false; } };
  const current = reviewItem && task.review && task.review.turns === task.turns ? reviewItem : null;
  const findings = current?.findings || [];
  const serious = findings.filter((f) => f.severity === "P0" || f.severity === "P1").length;
  const pr = task.pr && task.pr.state !== "CLOSED" && task.pr.state !== "MERGED" ? task.pr : null;
  const ciFailing = pr?.checks === "failing";
  // The PR on GitHub: merge it (only the commit you saw) or mark a draft ready. Your click is the OK.
  const openPr = pr?.number && pr.state === "OPEN" ? pr : null;
  const prMergeWhy = !openPr ? null : openPr.isDraft ? "Es un borrador: márcala como lista primero" : ciFailing ? "Falla el CI: arréglalo antes de fusionar" : openPr.mergeable === "CONFLICTING" ? "Tiene conflictos con " + (task.base || "main") + ": que " + name + " los resuelva antes" : null;
  const prAction = (kind) => {
    setPrBusy(kind); saving.setError(null);
    post("/code/tasks/" + task.id + "/pr/" + kind, {}).catch((e) => saving.setError(e.message)).finally(() => { setPrBusy(null); reload(); });
  };
  const ghOff = github && (!github.installed || !github.authed) ? (github.installed ? "GitHub CLI no tiene sesión en este ordenador: para subir y seguir la PR, ejecuta «gh auth login» en una terminal." : "GitHub CLI (gh) no está instalado: para subir a GitHub y seguir la PR, instálalo y ejecuta «gh auth login».") : null;
  const fix = () => act(async () => {
    const parts = [];
    if (findings.length) parts.push(findingsText(findings));
    if (ciFailing) parts.push(`El CI de la PR${pr.number ? " #" + pr.number : ""} falla: mira qué falla y arréglalo hasta que pase.`);
    await post("/code/tasks/" + task.id + "/messages", { text: parts.join("\n\n"), when: "queue" });
  });
  const ctx = {
    busy: running, turns: task.turns, editable, lastNotice, review: current?.id || null,
    onDiff: (n) => { setTurn(n); setTab("cambios"); onPanel(true); },
    onShowPlan: () => { setTab("plan"); onPanel(true); },
    onRestore: (n) => act(() => post("/code/tasks/" + task.id + "/restore", { turn: n })),
    onUndoRestore: (item) => act(() => post("/code/tasks/" + task.id + "/restore", { undo: item.undo })),
    onAnswer: (item, body) => act(() => post("/code/tasks/" + task.id + "/asks/" + item.id, body)),
    onEditFrom: (item) => act(async () => { const r = await post("/code/tasks/" + task.id + "/edit-from", { item: item.id }); setDraft({ text: r.text }); }),
    onFinding: (f) => addContext(task.id, findingContext(f)),
    // A finding's «archivo:línea» opens the diff on that line.
    onShowFinding: (f) => {
      setTurn(null); setTab("cambios"); onPanel(true);
      let tries = 0;
      const look = () => {
        const el = document.querySelector(`[data-finding="${CSS.escape(f.file + ":" + f.line)}"]`);
        if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("code-flash"); return; }
        if (++tries < 20) setTimeout(look, 100);
      };
      setTimeout(look, 50);
    },
    pr: openPr ? { number: openPr.number } : null,
    onPublish: (item) => act(() => post("/code/tasks/" + task.id + "/reviews/" + item.id + "/publish", {})),
    onPlan: (item, action) => {
      if (action === "refine") { setMode("plan"); setDraft({ text: "" }); return; }
      return act(async () => {
        setMode("build");
        const r = await post("/code/tasks/" + task.id + "/plans/" + item.id, { action });
        if (r?.task?.id) navigate("/codigo/" + r.task.id);
      });
    },
  };
  const canSave = task.isolated || project?.repo;
  const base = task.base || "main";
  commandRef.current = (cmd) => {
    if (cmd === "plan-toggle") setMode((m) => (m === "plan" ? "build" : "plan"));
    else if (cmd === "parar") act(() => post("/code/tasks/" + task.id + "/stop", {}));
    else if (cmd === "compactar") act(() => post("/code/tasks/" + task.id + "/compact", {}));
    else if (cmd === "guardar") runNextRef.current();
  };
  const goal = (action, text) => act(() => post("/code/tasks/" + task.id + "/goal", { action, ...(text ? { text } : {}) }));
  const send = (text, when, how = "build", files = [], contexts = []) => act(async () => {
    // «/btw …» is a side question: it never reaches Bruno's task (server/btw.mjs).
    if (!files.length && !contexts.length && btw.intercept(text)) return true;
    // «/goal <qué es estar hecho>» sets the objective; «/goal pausa | sigue | quita» drive it.
    const g = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text);
    if (g && !files.length && !contexts.length) {
      const rest = (g[1] || "").trim();
      const word = rest.toLowerCase();
      const action = !rest ? null : ["pausa", "pausar", "pause"].includes(word) ? "pause" : ["sigue", "reanuda", "reanudar", "resume"].includes(word) ? "resume" : ["quita", "quitar", "borra", "clear"].includes(word) ? "clear" : "set";
      if (!action) { setProblem(task.goal ? null : "Escribe qué es «hecho» después de /goal: por ejemplo, /goal pasan todos los tests."); return !!task.goal; }
      await post("/code/tasks/" + task.id + "/goal", { action, ...(action === "set" ? { text: rest } : {}) });
      return true;
    }
    setBusy(true);
    try {
      // A plan-mode message while a plan waits refines it (T3 Code «Refine»).
      if (how === "plan" && openPlan && !running && !files.length && !contexts.length) await post("/code/tasks/" + task.id + "/plans/" + openPlan.id, { action: "refine", text });
      else await post("/code/tasks/" + task.id + "/messages", { text, when, mode: how, attachments: files, contexts });
    } finally { setBusy(false); }
    return true;
  });
  // Saving into the base waits while the review or the CI says something serious («… igualmente» in «Más»).
  const blockedWhy = ciFailing ? "Falla el CI: arréglalo antes de fusionar" : serious ? (serious === 1 ? "La revisión encontró un problema importante" : "La revisión encontró " + serious + " problemas importantes") + ": arréglalo antes de fusionar" : null;
  const pendingAsk = items.find((i) => i.kind === "ask" && i.status === "pending") || null;
  // The ONE primary button of the header: the next step for the person (flow.js).
  const next = nextAction(task, { pendingAsk, openPlan, findings, canSave: !!canSave });
  // A question or a plan has its own ink button on its card: the header only takes you there
  // (one primary per decision), opening the conversation when the wide panel hides it.
  const toCard = next?.id === "answer" || next?.id === "implement";
  const jumpToCard = (selector, tries = 0) => {
    const card = document.querySelector(selector);
    if (!card) {
      if (panel && wide && !tries) onWide(false);
      if (tries < 10) requestAnimationFrame(() => jumpToCard(selector, tries + 1));
      return;
    }
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.querySelector("[data-card-primary]:not(:disabled), button:not(:disabled)")?.focus({ preventScroll: true });
  };
  const runNext = () => {
    if (!next) return;
    const id = next.id;
    if (id === "answer") jumpToCard("[data-pending-ask]");
    else if (id === "implement") jumpToCard("[data-open-plan]");
    else if (id === "write") document.querySelector("[data-code-composer]")?.focus();
    else if (id === "fix") fix();
    else if (id === "catchup") saving.save("catchup");
    else if (id === "pr-ready") prAction("ready");
    else if (id === "merge-pr") prAction("merge");
    else if (id === "open-pr") window.open(task.pr.url, "_blank", "noopener");
    else if (id === "save") saving.save(task.isolated ? "base" : "branch");
  };
  runNextRef.current = runNext;
  const nextBusy = !!saving.busy || !!prBusy || (next?.id === "save" && !!task.merging && running);
  const nextIcon = { save: GitMerge, "merge-pr": GitMerge, "pr-ready": GitPullRequestArrow, "open-pr": ExternalLink, catchup: RefreshCw, fix: ShieldCheck }[next?.id] || null;
  const NextIcon = nextIcon;
  const primary = toCard ? (
    <button type="button" onClick={runNext} title={next.id === "implement" ? "El plan espera tu OK en la conversación" : "Te espera en la conversación"} style={BTN.outline}>
      <ArrowDown size={16} aria-hidden="true" />{next.id === "implement" ? "Ir al plan" : pendingAsk?.ask === "question" ? "Ir a la pregunta" : pendingAsk?.ask === "redline" ? "Ir a la línea roja" : "Ir al permiso"}
    </button>
  ) : next ? (
    <button type="button" disabled={nextBusy} onClick={runNext} title={next.id === "save" ? (task.isolated ? "Revisión, commit en " + task.branch + " y merge en tu carpeta" : "Commit con el mensaje que escribe " + name) : undefined}
      style={{ ...BTN.primary, opacity: nextBusy ? 0.6 : 1, cursor: nextBusy ? "default" : "pointer" }}>
      {NextIcon ? <NextIcon size={16} aria-hidden="true" /> : null}{(next.id === "save" || next.id === "catchup") && saving.label ? saving.label : prBusy === "merge" && next.id === "merge-pr" ? "Fusionando en GitHub…" : next.label}
    </button>
  ) : running ? (
    <button type="button" onClick={() => act(() => post("/code/tasks/" + task.id + "/stop", {}))} title={"Para a " + name + " al acabar el paso en curso (Ctrl+.)"} style={BTN.outline}>
      <Stop size={16} aria-hidden="true" />Parar
    </button>
  ) : null;
  const saveItems = canSave && !task.saved ? [
    ...(task.isolated ? [["base", GitMerge, "Fusionar en " + base, blockedWhy]] : [["branch", GitBranch, "Guardar (commit)", blockedWhy]]),
    ...(task.isolated ? [["branch", GitBranch, "Guardar solo en su rama"]] : []),
    ["push", UploadCloud, "Guardar y subir a GitHub"],
    ["pr", GitPullRequest, "Guardar, subir y abrir PR"],
  ] : [];
  const openEditor = () => act(async () => { const r = await post("/code/tasks/" + task.id + "/open-editor", { path: ".", line: 1 }); if (!r.editor) setProblem("No encuentro VS Code, Cursor ni Windsurf: se abre la carpeta."); });
  const openFolder = () => act(() => revealInTask(task.id, ""));
  const showChat = !(panel && wide);
  const points = items.filter((i) => i.kind === "turn").map((i) => ({ n: i.n, add: i.add, del: i.del, files: (i.files || []).length }));
  const tabLabel = (id, text) => (id === "cambios" && count ? text + " · " + count : id === "pr" && task.pr?.number ? "PR #" + task.pr.number : text);
  const shownTabs = TABS.filter(([id]) => id !== "pr" || canSave || task.pr?.number);
  // «Más acciones» (the app's one menu, components/Menu.js): other ways to save, the PR on
  // GitHub, reviewing, what to see, and the task's own pin / snooze / archive / delete last.
  const waitWhy = running ? name + " está trabajando: espera a que acabe" : null;
  const moreEntries = () => [
    saveItems.length ? { group: "Guardar", items: [
      ...saveItems.map(([to, Icon, text, blocked]) => {
        const why = waitWhy || blocked || (ghOff && (to === "push" || to === "pr") ? "GitHub CLI sin sesión: ejecuta «gh auth login»" : null) || (saving.busy ? "Ya se está guardando" : null);
        return { id: "save:" + to, label: text, icon: Icon, hint: why || undefined, disabled: why || false, onSelect: () => saving.save(to) };
      }),
      blockedWhy && !running ? { id: "save:force", label: (task.isolated ? "Fusionar en " + base : "Guardar") + " igualmente", icon: GitMerge, disabled: saving.busy ? "Ya se está guardando" : false,
        confirm: { title: task.isolated ? "¿Fusionar en " + base + " con los avisos?" : "¿Guardar con los avisos?", text: blockedWhy + ".", action: task.isolated ? "Fusionar igualmente" : "Guardar igualmente" },
        onSelect: () => saving.save(task.isolated ? "base" : "branch", { force: true }) } : null,
    ] } : null,
    openPr ? { group: "PR #" + openPr.number, items: [
      openPr.isDraft ? { label: prBusy === "ready" ? "Marcando como lista…" : "Marcar la PR como lista", icon: GitPullRequestArrow, disabled: prBusy ? "Espera a que acabe lo de GitHub" : false, onSelect: () => prAction("ready") } : null,
      (() => { const why = prMergeWhy || (running ? name + " está trabajando" : null) || (prBusy ? "Espera a que acabe lo de GitHub" : null); return { label: prBusy === "merge" ? "Fusionando en GitHub…" : "Fusionar en GitHub", icon: GitMerge, hint: why || undefined, disabled: why || false, onSelect: () => prAction("merge") }; })(),
      openPr.url ? { label: "Abrir en GitHub", icon: ExternalLink, onSelect: () => window.open(openPr.url, "_blank", "noopener") } : null,
    ] } : null,
    { group: "Revisar", items: [
      canSave && !task.saved ? { label: "Revisar los cambios", icon: ShieldCheck, hint: running ? name + " está trabajando" : undefined, disabled: running ? name + " está trabajando" : saving.busy ? "Ya se está guardando" : false, onSelect: () => saving.save("review") } : null,
      task.isolated && !task.saved ? { label: "Ponerse al día con " + base, icon: RefreshCw, hint: running ? name + " está trabajando" : undefined, disabled: running ? name + " está trabajando" : saving.busy ? "Ya se está guardando" : false, onSelect: () => saving.save("catchup") } : null,
      task.group ? { label: "Comparar con los otros motores", icon: Columns3, onSelect: () => navigate("/codigo/comparar/" + task.group) } : null,
      { label: "Ver los cambios", icon: FilesIcon, shortcut: "Ctrl+1", onSelect: () => { onPanel(true); setTab("cambios"); } },
    ] },
    { group: "Ver", items: [
      { label: "Panel de trabajo", icon: PanelRight, checked: !!panel, shortcut: "Ctrl+J", onSelect: () => onPanel(!panel) },
      { label: "Abrir la carpeta de la copia", icon: FolderOpen, onSelect: openFolder },
      { label: "Atajos de teclado", icon: Keyboard, shortcut: "F1", onSelect: () => window.dispatchEvent(new Event("colmena:code-shortcuts")) },
    ] },
    ...taskActions(task, true),
  ];
  const tabDot = (id) => (id === "pr" && ciFailing ? "var(--c-error)" : id === "cambios" && findings.length ? "var(--c-error)" : null);
  return (
    <div ref={sectionRef} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      <header style={{ position: "relative", flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", padding: "14px 24px 12px", borderBottom: "1px solid var(--c-line)" }}>
        <div style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
          <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: C.muted }}>
            <a href="/codigo" style={{ color: C.muted }}>Código</a><span aria-hidden="true">›</span><span style={{ fontFamily: MONO }}>{project?.name || "proyecto"}</span>
          </nav>
          <h1 title={task.title} style={{ margin: 0, font: `600 var(--t-title)/1.2 ${HEAD}`, letterSpacing: "-0.015em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</h1>
          <TaskChips task={task} project={project} running={running} />
        </div>
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <TaskPeople taskId={task.id} project={project ? { id: project.id, name: project.name } : null} look={{ ...BTN.outline, fontSize: "var(--t-ui)", fontWeight: 400 }} />
          <button type="button" onClick={openEditor} title={"Abre la copia de la tarea en VS Code, Cursor o Windsurf: " + task.cwd} style={BTN.outline}><SquareArrowOutUpRight size={16} aria-hidden="true" />Abrir en el editor</button>
          {primary}
          <MenuButton label="Más acciones" title="Más: guardar de otras formas, la PR, posponer, archivar…" items={moreEntries} openStyle={{ background: C.track }}
            style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", padding: 0, border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-raised)", color: C.text, cursor: "pointer" }}>
            <Ellipsis size={18} aria-hidden="true" />
          </MenuButton>
          {saving.error ? <p role="alert" onClick={() => saving.setError(null)} style={{ position: "absolute", zIndex: 30, top: "48px", right: 0, width: "340px", margin: 0, padding: "12px 14px", borderRadius: "var(--r-lg)", background: C.white, boxShadow: SHEET, fontSize: "var(--t-meta)", lineHeight: 1.45, color: C.red }}>{saving.error}</p> : null}
          {saving.warn ? (
            <div role="alertdialog" aria-label="Antes de fusionar" style={{ position: "absolute", zIndex: 30, top: "48px", right: 0, width: "350px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", borderRadius: "var(--r-xl)", background: C.white, boxShadow: SHEET, animation: "rise .2s ease-out" }}>
              <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: C.text }}>
                {saving.warn.resolving ? `Hay cambios que chocan con ${base}: ${name} los está resolviendo en su copia (${saving.warn.resolving.slice(0, 3).join(", ")}). Cuando acabe, vuelve a fusionar.`
                  : `La revisión ha encontrado ${saving.warn.serious === 1 ? "un problema importante" : saving.warn.serious + " problemas importantes"} (P0–P1). Los tienes en la conversación.`}
              </span>
              <span style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => saving.setWarn(null)} style={{ ...BTN.quiet, height: "34px", fontSize: "var(--t-meta)" }}>Vale</button>
                {saving.warn.serious ? <button type="button" onClick={() => saving.save("base", { force: true })} style={{ ...BTN.outline, height: "34px", fontSize: "var(--t-meta)" }}>Fusionar igualmente</button> : null}
              </span>
            </div>
          ) : null}
        </div>
        {running ? <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: "-1px", height: "2px", overflow: "hidden" }}><span style={{ position: "absolute", top: 0, bottom: 0, width: "35%", background: `linear-gradient(90deg, transparent, ${bot?.color || C.bruno}, transparent)`, animation: "sweep 1.8s ease-in-out infinite" }} /></span> : null}
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {showChat ? (
          <section aria-label={"Conversación con " + name} className={panel ? "code-chat" : undefined}
            style={{ position: "relative", ...(panel ? { flex: `0 0 ${chat.width || 400}px`, width: (chat.width || 400) + "px" } : { flex: 1 }), minWidth: 0, display: "flex", flexDirection: "column", borderRight: panel ? "1px solid var(--c-line)" : 0 }}>
            {panel ? chat.handle : null}
            <PeerComments taskId={task.id} />
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", display: "flex", flexDirection: "column-reverse" }}>
              <div style={{ width: "100%", maxWidth: panel ? "none" : "760px", margin: "0 auto", padding: "20px 22px 12px", display: "flex", flexDirection: "column", gap: "14px" }}>
                {steps ? <Steps steps={steps} approved={plans.some((p) => p.status === "implemented")} /> : null}
                {blocks.map((b, k) => b.bot ? (
                  <div key={b.id} style={{ display: "flex", gap: "10px" }}>
                    <BotShape bot={bot} size={22} state={running && k === blocks.length - 1 ? "work" : "rest"} />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "8px", fontSize: "var(--t-body)", lineHeight: 1.5 }}>
                      <strong style={{ fontWeight: 600, lineHeight: "22px" }}>{name}</strong>
                      {b.rows.map((row) => <TimelineRow key={row.id} row={row} ctx={ctx} />)}
                      {k === blocks.length - 1 ? <LiveTail taskId={taskId} color={bot?.color || C.bruno} /> : null}
                    </div>
                  </div>
                ) : <TimelineRow key={b.id} row={b.row} ctx={ctx} />)}
                {running && (!blocks.length || !blocks.at(-1).bot) ? (
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <BotShape bot={bot} size={22} state="work" />
                    <span style={{ fontSize: "var(--t-body)", color: C.body, whiteSpace: "pre-wrap" }}><LiveOr taskId={taskId}><span style={{ fontWeight: 500, background: "linear-gradient(90deg, var(--c-text-3) 0%, var(--c-text-3) 35%, var(--c-btn) 50%, var(--c-text-3) 65%, var(--c-text-3) 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" }}>{name} está trabajando…</span></LiveOr></span>
                  </div>
                ) : null}
                {problem ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: C.red }}>{problem}</p> : null}
              </div>
            </div>
            <div style={{ flex: "none", width: "100%", maxWidth: panel ? "none" : "760px", margin: "0 auto", padding: "8px 22px 20px" }}>
              <Composer task={task} models={models} engines={engines} busy={busy} running={running} draft={draft} mode={mode} onMode={setMode}
                projectId={task.projectId} commands={task.engine === "codex" ? [] : commands} status={<><BtwNotes btw={btw} botName={name} /><GoalRow task={task} onGoal={goal} /><SwitchLine task={task} engines={engines} /><LimitLine task={task} /></>}
                disabled={task.saved?.expired ? "Esta copia se limpió hace más de 30 días: empieza una tarea nueva." : null}
                onCommand={(cmd) => {
                  if (cmd === "plan") setMode("plan");
                  else if (cmd === "construir") setMode("build");
                  else if (cmd === "compactar") act(() => post("/code/tasks/" + task.id + "/compact", {}));
                  else if (cmd === "parar") act(() => post("/code/tasks/" + task.id + "/stop", {}));
                  else if (cmd === "nueva") navigate("/codigo?proyecto=" + task.projectId);
                  else if (cmd === "atajos") window.dispatchEvent(new Event("colmena:code-shortcuts"));
                }}
                placeholder={running ? (task.steer === false ? "Escribe y se lo paso a " + name + " cuando acabe…" : "Corrige o añade algo mientras trabaja…") : mode === "plan" ? (openPlan ? "¿Qué cambiarías del plan?" : "Describe qué quieres: " + name + " te propone un plan…") : "Escribe a " + name + "… / para comandos"}
                onSend={send}
                onStop={() => act(() => post("/code/tasks/" + task.id + "/stop", {}))}
                onChange={(body) => act(() => patch("/code/tasks/" + task.id, body))}
                onUnqueue={(id) => later({ id: "codequeue:" + id, keys: ["codequeue:" + id], text: "Mensaje quitado de la cola", error: "No se pudo quitar de la cola", run: () => act(() => del("/code/tasks/" + task.id + "/queue/" + id)) })} />
            </div>
          </section>
        ) : null}

        {panel ? (
          <section data-codepanel="" aria-label="Espacio de trabajo" style={{ flex: "999 1 480px", minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div role="tablist" aria-label="Espacio de trabajo" onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const ids = shownTabs.map(([id]) => id);
              const k = ids.indexOf(tab);
              const nextTab = ids[(k + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
              e.preventDefault(); setTab(nextTab);
              requestAnimationFrame(() => e.currentTarget.querySelector(`[data-tab="${nextTab}"]`)?.focus());
            }} style={{ flex: "none", display: "flex", alignItems: "center", gap: "2px", padding: "4px 12px 0", borderBottom: "1px solid var(--c-line)", overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none" }}>
              {shownTabs.map(([id, text]) => {
                const on = tab === id;
                const dot = tabDot(id);
                return (
                  <button key={id} data-tab={id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => setTab(id)}
                    style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", height: "40px", padding: "0 10px", border: 0, borderBottom: "2px solid " + (on ? C.ink : "transparent"), marginBottom: "-1px", background: "transparent", fontSize: "var(--t-meta)", fontWeight: on ? 600 : 500, color: on ? C.ink : C.text2, cursor: "pointer" }}>
                    {tabLabel(id, text)}{dot ? <span aria-label="necesita atención" style={{ width: "6px", height: "6px", borderRadius: "var(--r-circle)", background: dot }} /> : null}
                  </button>
                );
              })}
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => onWide(!wide)} aria-pressed={wide} aria-label={wide ? "Volver a ver la conversación" : "Ampliar el espacio de trabajo"} title={(wide ? "Volver a ver la conversación" : "Ampliar (la conversación se oculta)") + " · Ctrl ⇧ J"} style={{ width: "32px", height: "32px", marginBottom: "4px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-sm)", background: wide ? C.track : "transparent", cursor: "pointer", color: C.muted }}>
                {wide ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
              </button>
            </div>
            {tab === "plan" ? <PlanTab plan={plan} name={name} />
              : tab === "pr" ? <PrPanel task={task} name={name} running={running} ghOff={ghOff} mergeWhy={prMergeWhy} busy={saving.busy || prBusy} onSaveTo={(to) => saving.save(to)} onPrAction={prAction} onFix={ciFailing ? fix : null} />
                : tab === "vista" ? <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "12px 14px 14px", borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--c-line)", background: C.white }}><Preview task={task} project={project} onAsk={(text) => post("/code/tasks/" + task.id + "/messages", { text, when: "queue" }).catch(() => {})} /></div>
                  : tab === "terminal" ? <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "12px 14px 14px", borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--c-line)", background: TERM.bg }}><Suspense fallback={null}><TerminalPanel task={task} /></Suspense></div>
                    : tab === "archivos" ? <Files task={task} />
                      : tab === "procesos" ? <Processes task={task} name={name} />
                        : <Changes task={task} turn={turn} onTurn={setTurn} onCount={setCount} points={points} findings={findings} onFinding={ctx.onFinding} onRestore={(n) => ctx.onRestore(n)} />}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** «Plan»: what Bruno said he would do (the newest plan), or how to ask for one. */
function PlanTab({ plan, name }) {
  if (!plan) {
    return (
      <div style={{ flex: 1, margin: "16px 20px 20px", padding: "28px", borderRadius: "var(--r-lg)", background: C.white, display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
        <strong style={{ fontSize: "var(--t-body)" }}>Sin plan en esta tarea</strong>
        <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: C.text2, maxWidth: "460px" }}>{name} fue directo a los cambios. Si quieres que proponga antes de tocar nada, elige «Plan» en «…» al escribirle o empieza el mensaje con /plan.</span>
      </div>
    );
  }
  const state = { open: "Te espera: «Implementar» o «Refinar» en la conversación.", implemented: "Aprobado: " + name + " lo está siguiendo.", moved: "Se implementa en otra tarea.", refined: "Lo refinaste: hay una versión más nueva." }[plan.status];
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "16px 20px 20px", padding: "20px", borderRadius: "var(--r-lg)", background: C.white, display: "flex", flexDirection: "column", gap: "10px", fontSize: "var(--t-body)", lineHeight: 1.55 }}>
      <strong>Qué voy a hacer</strong>
      <div style={{ color: C.body }}><Markdown text={plan.text} size={15} /></div>
      {state ? <span style={{ fontSize: "var(--t-meta)", color: plan.status === "open" ? C.honeyText : C.muted }}>{state}</span> : null}
    </div>
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
  const setWide = (v) => { setWideState(v); try { localStorage.setItem(WIDE_KEY, v ? "1" : "0"); } catch {} };
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
    tabFiles: () => { setPanel(true); setTab("archivos"); },
    tabProcesses: () => { setPanel(true); setTab("procesos"); },
    newTerminal: () => { setPanel(true); setTab("terminal"); loadTerminal().then(() => setTimeout(() => window.dispatchEvent(new Event("colmena:code-new-terminal")), 300), () => {}); },
    shortcuts: () => setSheet(true),
  });
  useEffect(() => { if (query.proyecto) setSelected(query.proyecto); }, [query.proyecto]);
  useEffect(() => { setTurn(null); }, [taskId]);
  return (
    <Shell active="codigo" background="var(--c-app)" scroll={false} extraCss={CODE_CSS}>
      <div style={{ display: "flex", height: "100%", minWidth: 0 }}>
        {params.handoff ? <HandoffPage key={params.handoff} id={params.handoff} />
          : params.shared ? <SharedTask key={params.shared} id={params.shared} />
            : params.group ? <Compare group={params.group} projects={projects} />
              : taskId ? <TaskScreen key={taskId} taskId={taskId} engines={data?.engines || []} github={data?.github || null} panel={panel} wide={wide} onPanel={setPanel} onWide={setWide} tab={tab} setTab={setTab} turn={turn} setTurn={setTurn} reveal={query.m || null} />
                : <div style={{ flex: 1, minWidth: 0, height: "100%" }}><CodeHome projects={projects} selected={selected} onSelect={(id) => { setSelected(id); reload(); }} engines={data?.engines || []} /></div>}
      </div>
      {sheet ? <ShortcutsSheet onClose={() => setSheet(false)} /> : null}
    </Shell>
  );
}
