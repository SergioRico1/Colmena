import { useEffect, useState } from "react";
import { Ellipsis, Pin, PinOff, AlarmClock, Archive, ArchiveRestore, Trash2, ChevronRight, Sun, CalendarClock, Search, X, Files, MessageSquareText, Hourglass, GitPullRequest, Settings2, Check, CircleX, LoaderCircle, Columns3 } from "../../Icon.js";
import { navigate } from "../../../lib/router.jsx";
import { del, get, patch, post } from "../../../lib/api.js";
import { withMessage } from "../../../lib/reveal.js";
import { Highlight } from "../../home/shared.jsx";
import { failure, later, reversible, useHidden } from "../../../lib/undoToast.js";
import { useStore } from "../../../lib/store.jsx";
import { C, MONO, BotShape, botOf, SR, timeAgo } from "./parts.jsx";
import { EngineMark, ENGINE_NAME } from "./EngineModels.jsx";
import { GROUPS, groupOf, snoozePresets, whenLabel } from "./model.js";
import { listSections, needOf, stateText, ciOf } from "./flow.js";
import { MenuButton } from "../../Menu.js";

// «Tareas» of Código: one list in the order a developer works it — what needs you (the only honey),
// what is working, what is ready to save, what is done; put-off and archived folded at the end.
// Each row says the engine, the branch, +/− and the CI; its «…» pins, puts off, archives or deletes.

export { GROUPS, groupOf, whenLabel };

/**
 * A row's «…» inside a link: the press opens the menu, never the row's link. Clicks inside the
 * menu (drawn in <body>) bubble here through React too; those are left alone.
 */
export function RowMenu({ children, ...props }) {
  const stop = (e) => { if (e.currentTarget.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } };
  return <span onClick={stop} style={{ display: "contents" }}><MenuButton {...props}>{children}</MenuButton></span>;
}

const SHELF_KEY = "colmena:code-shelves";
const readShelves = () => { try { return JSON.parse(localStorage.getItem(SHELF_KEY) || "{}"); } catch { return {}; } };

// A change that fails says so in a notice (the app's toasts), never in a system dialog.
const act = (fn) => fn().catch((e) => failure("No se pudo hacer el cambio", e.message));
const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** «Elegir día y hora…»: the menu's own small form (components/Menu.js `panel`). */
function SnoozeAt({ onPick, back }) {
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600000)));
  return (
    <form onSubmit={(e) => { e.preventDefault(); const d = new Date(when); if (d > new Date()) onPick(d.toISOString()); }} style={{ display: "flex", flexDirection: "column", gap: "8px", width: "260px" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-caption)", fontWeight: 600, color: C.muted }}>
        Posponer hasta
        <input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} style={{ height: "32px", padding: "0 8px", border: "1px solid var(--c-line)", borderRadius: "var(--r-sm)", background: "var(--c-sunken)", color: C.ink, font: `400 var(--t-meta)/1 ${MONO}` }} />
      </label>
      <span style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
        <button type="button" className="c-menu-btn" onClick={back}>Volver</button>
        <button type="submit" className="c-menu-btn" style={{ borderColor: "transparent", background: "var(--c-btn)", color: "var(--c-btn-text)", fontWeight: 600 }}>Posponer</button>
      </span>
    </form>
  );
}

/**
 * Pin, snooze, archive, delete: the entries of a task's «…» (the list and the task's «Más»),
 * for the app's one menu (components/Menu.js). Each one closes the menu as it runs.
 */
export function taskActions(task, current) {
  const base = "/code/tasks/" + task.id;
  const pin = (on) => act(async () => {
    await patch(base, { pinned: on });
    if (!on) reversible({ id: "codepin:" + task.id, text: `«${task.title}» ya no está fijada`, undo: () => patch(base, { pinned: true }) });
  });
  const snooze = (iso) => act(async () => {
    await post(base + "/snooze", { until: iso });
    reversible({ id: "codesnooze:" + task.id, text: `Pospuesta hasta ${whenLabel(iso)}`, undo: () => post(base + "/snooze", { until: null }) });
    if (current) navigate("/codigo");
  });
  const wake = () => act(async () => { await post(base + "/snooze", { until: null }); });
  const archive = (on) => act(async () => {
    await post(base + "/archive", { archived: on });
    if (on) reversible({ id: "codearchive:" + task.id, text: `Tarea «${task.title}» archivada`, undo: () => post(base + "/archive", { archived: false }) });
  });
  const auto = (on) => act(async () => { await patch(base, { autoArchive: on }); });
  // The task (its copy, its preview server) goes after the five-second «Deshacer».
  const remove = () => {
    later({ id: "codetask:" + task.id, keys: ["codetask:" + task.id], text: `Tarea «${task.title}» borrada`, error: "No se pudo borrar la tarea", run: () => del(base) });
    if (current) navigate("/codigo");
  };
  return [
    { group: "Organizar", items: [
      task.archived ? { label: "Desarchivar", icon: ArchiveRestore, onSelect: () => archive(false) }
        : task.pinned ? { label: "Quitar de fijadas", icon: PinOff, onSelect: () => pin(false) } : { label: "Fijar arriba", icon: Pin, onSelect: () => pin(true) },
      !task.archived ? { label: "Archivar sola si se queda quieta", icon: Hourglass, checked: task.autoArchive !== false, onSelect: () => auto(task.autoArchive === false) } : null,
      task.snoozed ? { label: "Despertar ahora", icon: Sun, meta: whenLabel(task.snoozed.until), onSelect: wake } : null,
    ] },
    !task.archived && !task.snoozed ? { group: "Posponer hasta", items: [
      ...snoozePresets().map((p) => ({ id: "snooze:" + p.id, label: p.label, icon: AlarmClock, meta: whenLabel(p.until), onSelect: () => snooze(p.until) })),
      { label: "Elegir día y hora…", icon: CalendarClock, panel: ({ close, back }) => <SnoozeAt back={back} onPick={(iso) => { close(); snooze(iso); }} /> },
    ] } : null,
    !task.archived ? { label: "Archivar", icon: Archive, danger: true, meta: task.running ? "trabaja" : null, onSelect: () => archive(true) } : null,
    { label: "Borrar la tarea", icon: Trash2, danger: true, confirm: { title: "¿Borrar la tarea?", text: "Se borra su copia del proyecto y su vista previa. Tienes unos segundos para deshacerlo.", action: "Borrar" }, onSelect: remove },
  ];
}

/** A project's own archiving rule, over Ajustes (T3 Code environment rules): menu entries. */
export function projectArchiveEntries(project) {
  const own = project.archive || {};
  const set = (archive) => act(() => patch("/code/projects/" + project.id, { archive }));
  const days = [[null, "Según Ajustes"], [0, "Nunca"], [1, "Tras 1 día"], [3, "Tras 3 días"], [7, "Tras 7 días"], [14, "Tras 14 días"], [30, "Tras 30 días"]];
  return [
    { group: "Archivar las tareas quietas", items: days.map(([d, label]) => ({ id: "idle:" + d, label, icon: d === null ? Settings2 : Hourglass, radio: true, checked: (own.idleDays ?? null) === d, onSelect: () => set({ idleDays: d }) })) },
    { group: "Si tienen una PR abierta", items: [[null, "Según Ajustes", Settings2], [true, "Conservarlas", GitPullRequest], [false, "Archivarlas igual", Archive]].map(([v, label, icon]) => ({ id: "pr:" + v, label, icon, radio: true, checked: (own.keepWithPr ?? null) === v, onSelect: () => set({ keepWithPr: v }) })) },
    { group: null, items: [{ label: "Más en Ajustes", icon: Settings2, onSelect: () => navigate("/ajustes/autonomia#codigo-archivar") }] },
  ];
}

const ROW = { position: "relative", display: "flex", alignItems: "center", gap: "12px", minHeight: "56px", padding: "8px 14px 8px 16px", borderTop: "1px solid var(--c-line)", color: C.ink, textDecoration: "none" };
const META = { font: `400 var(--t-caption)/1.3 ${MONO}`, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const TITLE = { fontSize: "var(--t-ui)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const SMALL = { display: "inline-flex", alignItems: "center", gap: "5px", height: "22px", padding: "0 7px", borderRadius: "var(--r-xs)", fontSize: "var(--t-caption)", fontWeight: 500, whiteSpace: "nowrap" };
const TONE = {
  honey: { background: C.honey, color: "var(--c-honey-ink)" }, error: { background: "var(--c-error-soft)", color: "var(--c-error)" },
  warn: { background: "var(--c-warn-soft)", color: "var(--c-warn)" }, run: { background: "var(--c-accent-soft)", color: "var(--c-accent-ink)" },
};

/** «CI pasa / falla / en curso» with its mark (colour is never the only cue). */
export function CiChip({ task }) {
  const ci = ciOf(task);
  if (!ci) return null;
  const look = ci.state === "failing" ? TONE.error : ci.state === "passing" ? { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" } : { background: C.track, color: C.text2 };
  const Mark = ci.state === "failing" ? CircleX : ci.state === "passing" ? Check : LoaderCircle;
  return <span style={{ ...SMALL, ...look }} title={"PR #" + task.pr.number + " · " + ci.text}><Mark size={12} weight="bold" aria-hidden="true" />{ci.text}</span>;
}

/** «+12 −3» in the code font. */
const Diffstat = ({ add, del: d }) => (add || d ? (
  <span style={{ font: `500 var(--t-caption)/1 ${MONO}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }} aria-label={`${add || 0} líneas añadidas, ${d || 0} quitadas`}>
    <span style={{ color: C.greenText }}>+{add || 0}</span> <span style={{ color: C.red }}>−{d || 0}</span>
  </span>
) : null);

/** The quiet line under the title: project · branch, or when it comes back. */
function metaOf(task, project) {
  const parts = [project?.name];
  if (task.snoozed) parts.push("vuelve " + whenLabel(task.snoozed.until));
  else if (task.archived) parts.push("archivada " + timeAgo(task.archived.at));
  else {
    if (task.branch && !task.saved) parts.push(task.branch);
    parts.push(timeAgo(task.updatedAt));
  }
  return parts.filter(Boolean).join(" · ");
}

function TaskRow({ task, project, bots }) {
  const need = needOf(task);
  const running = task.running || task.status === "working";
  const pr = task.pr?.number && task.pr.state !== "CLOSED" ? task.pr : null;
  return (
    <a href={"/codigo/" + task.id} className="code-hover code-task" style={{ ...ROW, opacity: task.archived ? 0.75 : 1 }}>
      <BotShape bot={botOf(bots, task)} size={20} state={running ? "work" : "rest"} />
      <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          {task.pinned ? <Pin size={12} color={C.faint} aria-label="Fijada" style={{ flex: "none" }} /> : null}
          <span style={TITLE}>{task.title}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <span style={META}>{metaOf(task, project)}</span>
          {task.overlaps?.length ? <OverlapChip overlap={task.overlaps[0]} more={task.overlaps.length - 1} /> : null}
        </span>
      </span>
      <span className="code-chips" style={{ flex: "none", display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ ...SMALL, padding: 0 }} title={ENGINE_NAME[task.engine] || "Claude Code"}><EngineMark engine={task.engine} size={16} /><span style={SR}>{ENGINE_NAME[task.engine] || "Claude Code"}</span></span>
        <Diffstat add={task.add} del={task.del} />
        {pr ? <span style={{ ...SMALL, background: C.track, color: C.text2 }}><GitPullRequest size={12} aria-hidden="true" />#{pr.number}</span> : null}
        {need && ciOf(task)?.state === "failing" ? null : <CiChip task={task} />}
      </span>
      <span className="code-pill" style={{ flex: "none", width: "168px", display: "flex", justifyContent: "flex-end" }}>
        {need ? <span style={{ ...SMALL, height: "24px", padding: "0 9px", fontWeight: 600, borderRadius: "var(--r-pill)", ...TONE[need.tone] }}>{need.text}</span>
          : running ? <span style={{ ...SMALL, height: "24px", padding: "0 9px", fontWeight: 600, borderRadius: "var(--r-pill)", ...TONE.run }}><span aria-hidden="true" className="code-pulse" style={{ width: "6px", height: "6px", borderRadius: "var(--r-circle)", background: "currentColor" }} />Trabajando</span>
            : <span style={{ fontSize: "var(--t-caption)", color: C.muted, whiteSpace: "nowrap" }}>{stateText(task)}</span>}
      </span>
      <RowMenu items={() => taskActions(task, false)} className="code-x" label={"Acciones de la tarea " + task.title} menuLabel={"Acciones de «" + task.title + "»"} title="Fijar, posponer, archivar o borrar"
        openStyle={{ background: C.track }}
        style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", width: "30px", height: "30px", padding: 0, display: "grid", placeItems: "center", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-raised)", color: C.text, cursor: "pointer" }}>
        <Ellipsis size={16} aria-hidden="true" />
      </RowMenu>
    </a>
  );
}

/** «Mismos archivos que «X»»: another active task of the project changes the same files (opens it). */
function OverlapChip({ overlap, more = 0 }) {
  const open = (e) => { e.preventDefault(); e.stopPropagation(); navigate("/codigo/" + overlap.task); };
  return (
    <button type="button" onClick={open} title={`También los cambia «${overlap.title}»: ${overlap.files.join(", ")}${overlap.count > overlap.files.length ? "…" : ""}. Al fusionar pueden chocar.`}
      style={{ flex: "0 1 auto", minWidth: 0, display: "inline-flex", alignItems: "center", gap: "5px", height: "20px", padding: "0 8px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-warn-soft)", color: "var(--c-warn)", cursor: "pointer", font: `500 var(--t-caption)/1 ${MONO}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      <Files size={11} aria-hidden="true" style={{ flex: "none" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>mismos archivos que «{overlap.title}»{more > 0 ? " y " + (more === 1 ? "otra" : more + " más") : ""}</span>
    </button>
  );
}

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** What was said in the tasks (GET /api/code/search), asked 250 ms after you stop typing. */
function useConversationHits(q) {
  const [hits, setHits] = useState({ q: "", list: [] });
  const query = q.trim();
  const short = fold(query).length < 2;
  useEffect(() => {
    if (short) { setHits({ q: query, list: [] }); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      const done = (list) => alive && setHits({ q: query, list });
      get("/code/search?q=" + encodeURIComponent(query)).then((r) => done((r.hits || []).filter((h) => h.itemId)), () => done([]));
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, short]);
  // The last answer stays on screen while the next one comes (no flicker as you type).
  return { list: short ? [] : hits.list, answered: short || hits.q === query };
}

/** A match inside a task's conversation: the task, its project, the words around the match and when. */
function HitRow({ hit, query }) {
  return (
    <a href={withMessage("/codigo/" + hit.taskId, hit.itemId)} className="code-hover" style={{ ...ROW, minHeight: "58px", alignItems: "flex-start" }}>
      <MessageSquareText size={16} color={C.faint} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span style={TITLE}>{hit.title}</span>
          {hit.archived ? <span style={{ ...SMALL, height: "18px", background: C.track, color: C.muted }}>archivada</span> : null}
        </span>
        <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.45, color: C.text2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "break-word" }}>
          {hit.who ? <span style={{ fontWeight: 600, color: C.ink }}>{hit.who}: </span> : null}<Highlight text={hit.snippet} query={query} />
        </span>
        <span style={META}>{[hit.project, timeAgo(hit.at)].filter(Boolean).join(" · ")}</span>
      </span>
    </a>
  );
}

/** Several engines with the same request: one row that opens the comparison. */
function CompareRow({ group, tasks, project, bots }) {
  const working = tasks.some((t) => t.running || t.status === "working");
  const title = String(tasks[0].title).replace(/ · [^·]+(?: · [^·]+)?$/, "");
  return (
    <a href={"/codigo/comparar/" + group} className="code-hover code-task" style={ROW}>
      <BotShape bot={botOf(bots, tasks[0])} size={20} state={working ? "work" : "rest"} />
      <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={TITLE}>{title}</span>
        <span style={META}>{[project?.name, tasks.length + " motores con la misma petición"].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="code-chips" style={{ flex: "none", display: "flex", alignItems: "center", gap: "6px" }}>
        {tasks.map((t) => <span key={t.id} title={t.label || ENGINE_NAME[t.engine]} style={{ display: "inline-flex" }}><EngineMark engine={t.engine} size={14} /></span>)}
      </span>
      <span className="code-pill" style={{ flex: "none", width: "168px", display: "flex", justifyContent: "flex-end" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--t-caption)", color: C.muted }}><Columns3 size={14} aria-hidden="true" />{working ? "Trabajando" : "Comparar y elegir"}</span>
      </span>
    </a>
  );
}

/** Tasks started together with several engines collapse into one comparison row (2+ still open). */
function rowsOf(tasks) {
  const groups = new Map();
  for (const t of tasks) if (t.group && !t.archived) groups.set(t.group, [...(groups.get(t.group) || []), t]);
  const seen = new Set();
  const out = [];
  for (const t of tasks) {
    const list = t.group && !t.archived ? groups.get(t.group) : null;
    if (!list || list.length < 2) { out.push({ key: t.id, task: t }); continue; }
    if (seen.has(t.group)) continue;
    seen.add(t.group);
    out.push({ key: t.group, group: t.group, tasks: list });
  }
  return out;
}

/**
 * «Tareas»: the groups of flow.js (needs you · working · ready · done; put off and archived folded).
 * `filter` is a project id (from «Proyectos») or null; `onClearFilter` drops it.
 */
export default function TaskSections({ projects = [], filter = null, onClearFilter }) {
  const { bots } = useStore();
  const [q, setQ] = useState("");
  const [shelves, setShelvesState] = useState(readShelves);
  const toggleShelf = (key) => setShelvesState((s) => { const next = { ...s, [key]: !s[key] }; try { localStorage.setItem(SHELF_KEY, JSON.stringify(next)); } catch {} return next; });
  const hiddenTask = useHidden("codetask");
  const query = fold(q).replace(/\s+/g, " ").trim();
  const byId = new Map(projects.map((p) => [p.id, p]));
  const all = projects.flatMap((p) => p.tasks).filter((t) => !hiddenTask(t.id) && (!filter || t.projectId === filter) && (!query || fold(t.title).includes(query)));
  const total = projects.reduce((n, p) => n + p.tasks.length, 0);
  // A comparison goes where its most urgent task goes.
  const sections = listSections(all);
  const filtered = filter ? byId.get(filter) : null;
  // «Buscar en las tareas» also finds what was said in them (archived tasks too).
  const found = useConversationHits(q);
  const said = found.list.filter((h) => !hiddenTask(h.taskId) && (!filter || h.projectId === filter));
  return (
    <section aria-labelledby="tasks-t" style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", minHeight: "32px" }}>
        <h2 id="tasks-t" style={{ margin: 0, fontSize: "var(--t-read)", fontWeight: 600 }}>Tareas</h2>
        {filtered ? (
          <button type="button" onClick={onClearFilter} title="Ver las tareas de todos los proyectos" style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "26px", padding: "0 8px 0 11px", border: 0, borderRadius: "var(--r-pill)", background: C.track, cursor: "pointer", font: `500 var(--t-meta)/1 ${MONO}`, color: C.ink }}>
            {filtered.name}<X size={14} aria-label="Quitar el filtro" />
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        {total || query ? (
          <label title="Busca en los títulos y en lo que se ha dicho en cada tarea, también en las archivadas" style={{ display: "flex", alignItems: "center", gap: "8px", height: "32px", width: "260px", padding: "0 10px", borderRadius: "var(--r-sm)", background: "var(--c-card)", border: "1px solid var(--c-line)", color: C.muted }}>
            <Search size={16} aria-hidden="true" />
            <span style={SR}>Buscar en las tareas</span>
            <input inputMode="search" enterKeyHint="search" autoComplete="off" className="c-bare" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); setQ(""); } }} placeholder="Buscar en las tareas" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "var(--t-ui)" }} />
          </label>
        ) : null}
      </div>
      {!sections.length && !said.length && found.answered ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", background: "var(--c-card)" }}>
          <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{query ? "Ninguna tarea coincide" : filtered ? "Este proyecto aún no tiene tareas" : "Aún no hay tareas"}</span>
          <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: C.text2 }}>{query ? "Prueba con otras palabras." : "Escribe arriba qué quieres construir y pulsa «Empezar». Bruno trabaja en una copia aparte; aquí verás en qué está y qué te necesita."}</span>
        </div>
      ) : null}
      {sections.map((g) => {
        const shelf = g.key === "archived" || g.key === "snoozed";
        const open = !shelf || !!query || !!shelves[g.key];
        const rows = rowsOf(g.tasks);
        const head = { display: "flex", alignItems: "center", gap: "8px", padding: "0 2px", fontSize: "var(--t-meta)", fontWeight: 600, color: C.text2 };
        return (
          <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {shelf ? (
              <button type="button" onClick={() => toggleShelf(g.key)} aria-expanded={open} style={{ ...head, alignSelf: "flex-start", minHeight: "28px", border: 0, background: "transparent", cursor: "pointer", color: C.muted }}>
                <ChevronRight size={14} weight="bold" aria-hidden="true" style={{ transition: "transform .2s ease", transform: open ? "rotate(90deg)" : "none" }} />{g.title}<span style={{ fontWeight: 400 }}>{g.tasks.length}</span>
              </button>
            ) : (
              <h3 style={{ ...head, margin: 0 }}>
                {g.title}
                {g.key === "needs" ? <span style={{ minWidth: "20px", height: "20px", padding: "0 6px", display: "inline-grid", placeItems: "center", borderRadius: "var(--r-pill)", background: C.honey, color: "var(--c-honey-ink)", fontSize: "var(--t-micro)", fontWeight: 600 }}>{g.tasks.length}</span>
                  : <span style={{ fontWeight: 400, color: C.muted }}>{g.tasks.length}</span>}
              </h3>
            )}
            {open ? (
              <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", background: "var(--c-card)", overflow: "hidden" }} className="code-rows">
                {rows.map((r) => r.group
                  ? <CompareRow key={r.key} group={r.group} tasks={r.tasks} project={byId.get(r.tasks[0].projectId)} bots={bots} />
                  : <TaskRow key={r.key} task={r.task} project={byId.get(r.task.projectId)} bots={bots} />)}
              </div>
            ) : null}
          </div>
        );
      })}
      {said.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h3 style={{ margin: 0, padding: "0 2px", fontSize: "var(--t-meta)", fontWeight: 600, color: C.text2 }}>En las conversaciones · {said.length}</h3>
          <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", background: "var(--c-card)", overflow: "hidden" }} className="code-rows">
            {said.map((h) => <HitRow key={h.itemId} hit={h} query={q.trim()} />)}
          </div>
        </div>
      ) : null}
    </section>
  );
}
