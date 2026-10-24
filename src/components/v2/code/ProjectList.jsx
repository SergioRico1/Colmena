import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderGit2, Folder, FolderOpen, Plus, Search, Ellipsis, Pin, PinOff, AlarmClock, Archive, ArchiveRestore, Trash2, ChevronRight, Sun, CalendarClock } from "lucide-react";
import { navigate } from "../../../lib/router.jsx";
import { del, patch, post } from "../../../lib/api.js";
import { later, reversible, useHidden } from "../../../lib/undoToast.js";
import { C, MONO, HEAD, SHEET, BrunoMark, Stat, Seg, timeAgo } from "./parts.jsx";
import { GROUPS, groupOf, snoozePresets } from "./model.js";
import { SharedShelf } from "../people/SharedTasks.jsx";

// Left column of «Código»: each project with its tasks (design/V2Codigo.dc.html). Each task has
// a «…» menu (T3 Code thread actions): pin, snooze until a time, archive (settle) or keep it out
// of automatic archiving, and delete. Snoozed and archived tasks wait on two shelves at the end.

const STATUS = {
  working: { text: "Trabajando", dot: C.bruno, fg: C.faint, state: "work" },
  waiting: { text: "Te espera", dot: C.honey, fg: C.honeyText, state: "wait" },
  planned: { text: "Te espera · plan", dot: C.honey, fg: C.honeyText, state: "wait" },
  error: { text: "Atascada", dot: "#C2412D", fg: C.red, state: "rest" },
};

export function taskStatus(t) {
  if (STATUS[t.status]) return STATUS[t.status];
  if (t.merging) return { text: "Conflictos con " + (t.base || "main"), dot: C.honey, fg: C.honeyText, state: "wait" };
  if (t.goal && ["blocked", "limited"].includes(t.goal.status)) return { text: "Te espera · objetivo", dot: C.honey, fg: C.honeyText, state: "wait" };
  if (t.turns) return { text: t.merged || t.saved ? "Guardado" : t.isolated ? "Listo para revisar" : "Listo", dot: C.green, fg: C.faint, state: "rest" };
  return { text: "Nueva", dot: "#C9CBD1", fg: C.faint, state: "rest" };
}

export { GROUPS, groupOf };

/** «mañana 9:00», «hoy 18:00», «lun 9:00», «24 oct 9:00». */
export function whenLabel(iso, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return "hoy " + time;
  if (diff === 1) return "mañana " + time;
  if (diff > 1 && diff < 7) return d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "") + " " + time;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") + " " + time;
}

const VIEW_KEY = "colmena:code-list-view";
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === "projects" ? "projects" : "status"; } catch { return "status"; } };
const SHELF_KEY = "colmena:code-shelves";
const readShelves = () => { try { return JSON.parse(localStorage.getItem(SHELF_KEY) || "{}"); } catch { return {}; } };

const act = (fn) => fn().catch((e) => window.alert(e.message));
const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** A menu anchored to a button, drawn above the list (fixed), closed by a click outside or Esc. */
function useMenu() {
  const [at, setAt] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!at) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setAt(null); };
    const key = (e) => { if (e.key === "Escape") setAt(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", () => setAt(null), { once: true });
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [at]);
  const open = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (at) { setAt(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ left: Math.min(r.right - 280, window.innerWidth - 292), top: r.bottom + 6, up: r.bottom + 360 > window.innerHeight, bottom: window.innerHeight - r.top + 6 });
  };
  return { at, ref, open, close: () => setAt(null) };
}

function MenuSheet({ menu, label, children, width = 280 }) {
  if (!menu.at) return null;
  // Drawn in <body>: inside the task's link, a click on a field would open the task.
  return createPortal(
    <div ref={menu.ref} role="menu" aria-label={label} onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", zIndex: 60, left: Math.max(8, menu.at.left) + "px", ...(menu.at.up ? { bottom: menu.at.bottom + "px" } : { top: menu.at.top + "px" }), width: width + "px", padding: "6px", borderRadius: "18px", background: C.white, boxShadow: SHEET, animation: "rise .18s ease-out" }}>
      {children}
    </div>,
    document.body,
  );
}

function Item({ icon: Icon, text, note = null, onClick, tone = null, on = false }) {
  return (
    <button type="button" role="menuitem" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} className="code-hover"
      style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", padding: "0 10px", border: 0, borderRadius: "12px", background: on ? C.soft : "transparent", cursor: "pointer", textAlign: "left", fontSize: "13px", fontWeight: 500, color: tone || C.ink }}>
      {Icon ? <Icon size={14} strokeWidth={2.1} aria-hidden="true" style={{ flex: "none" }} /> : <span style={{ width: "14px", flex: "none" }} />}
      <span style={{ flex: 1 }}>{text}</span>
      {note ? <span style={{ font: `400 11px/1 ${MONO}`, color: C.quiet, whiteSpace: "nowrap" }}>{note}</span> : null}
    </button>
  );
}
const Rule = () => <span aria-hidden="true" style={{ display: "block", height: "1px", margin: "4px 8px", background: C.rule }} />;

function TaskMenu({ task, current, menu }) {
  const [custom, setCustom] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600000)));
  const base = "/code/tasks/" + task.id;
  const done = () => { menu.close(); setCustom(false); };
  const pin = (on) => act(async () => {
    done();
    await patch(base, { pinned: on });
    if (!on) reversible({ id: "codepin:" + task.id, text: `«${task.title}» ya no está fijada`, undo: () => patch(base, { pinned: true }) });
  });
  const snooze = (iso) => act(async () => {
    done();
    await post(base + "/snooze", { until: iso });
    reversible({ id: "codesnooze:" + task.id, text: `Pospuesta hasta ${whenLabel(iso)}`, undo: () => post(base + "/snooze", { until: null }) });
    if (current) navigate("/codigo");
  });
  const wake = () => act(async () => { done(); await post(base + "/snooze", { until: null }); });
  const archive = (on) => act(async () => {
    done();
    await post(base + "/archive", { archived: on });
    if (on) reversible({ id: "codearchive:" + task.id, text: `Tarea «${task.title}» archivada`, undo: () => post(base + "/archive", { archived: false }) });
  });
  const auto = (on) => act(async () => { done(); await patch(base, { autoArchive: on }); });
  // The task (its copy, its preview server) goes after the five-second «Deshacer».
  const remove = () => {
    done();
    later({ id: "codetask:" + task.id, keys: ["codetask:" + task.id], text: `Tarea «${task.title}» borrada`, error: "No se pudo borrar la tarea", run: () => del(base) });
    if (current) navigate("/codigo");
  };
  return (
    <MenuSheet menu={menu} label={"Acciones de «" + task.title + "»"}>
      {!task.archived ? (task.pinned ? <Item icon={PinOff} text="Quitar de fijadas" onClick={() => pin(false)} /> : <Item icon={Pin} text="Fijar arriba" onClick={() => pin(true)} />) : null}
      {task.snoozed ? <Item icon={Sun} text="Despertar ahora" note={whenLabel(task.snoozed.until)} onClick={wake} /> : null}
      {!task.archived && !task.snoozed ? (
        <>
          <span style={{ display: "block", padding: "8px 10px 4px", font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>Posponer</span>
          {snoozePresets().map((p) => <Item key={p.id} icon={AlarmClock} text={p.label} note={whenLabel(p.until)} onClick={() => snooze(p.until)} />)}
          {custom ? (
            <form onSubmit={(e) => { e.preventDefault(); const d = new Date(when); if (d > new Date()) snooze(d.toISOString()); }} style={{ display: "flex", gap: "6px", padding: "6px 8px" }}>
              <input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} aria-label="Hasta cuándo" style={{ flex: 1, minWidth: 0, height: "32px", padding: "0 8px", border: 0, borderRadius: "10px", background: C.soft, font: `400 12px/1 ${MONO}` }} />
              <button type="submit" style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", background: C.ink, color: C.white, cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>Posponer</button>
            </form>
          ) : <Item icon={CalendarClock} text="Elegir día y hora…" onClick={() => setCustom(true)} />}
          <Rule />
        </>
      ) : null}
      {task.archived ? <Item icon={ArchiveRestore} text="Desarchivar" onClick={() => archive(false)} /> : <Item icon={Archive} text="Archivar" note={task.running ? "trabaja" : null} onClick={() => archive(true)} />}
      {!task.archived ? <Item text="Archivar sola" note={task.autoArchive === false ? "desactivado" : "activado"} onClick={() => auto(task.autoArchive === false)} /> : null}
      <Rule />
      <Item icon={Trash2} text="Borrar la tarea" tone={C.red} onClick={remove} />
    </MenuSheet>
  );
}

function TaskRow({ task, current, project = null }) {
  const s = taskStatus(task);
  const menu = useMenu();
  const status = task.snoozed ? { text: "Vuelve " + whenLabel(task.snoozed.until), fg: C.faint, dot: "#C9CBD1" }
    : task.archived ? { text: "Archivada · " + timeAgo(task.archived.at), fg: C.faint, dot: "#C9CBD1" } : s;
  const line = task.snoozed || task.archived ? status.text : project ? (task.status === "idle" ? timeAgo(task.updatedAt) : s.text) : s.text + (task.status === "idle" ? " · " + timeAgo(task.updatedAt) : "");
  return (
    <a href={"/codigo/" + task.id} aria-current={current ? "page" : undefined} className="code-hover code-task"
      style={{ position: "relative", display: "flex", alignItems: "center", gap: "11px", marginLeft: project ? "4px" : "14px", padding: "9px 10px", borderRadius: "14px", background: current ? C.white : "transparent", boxShadow: current ? "0 1px 2px rgba(18,19,26,.05), 0 8px 20px -10px rgba(18,19,26,.18)" : "none", opacity: task.archived ? 0.72 : 1 }}>
      <BrunoMark size={18} state={task.archived || task.snoozed ? "rest" : s.state} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "14px", fontWeight: current ? 600 : 500 }}>
          {task.pinned ? <Pin size={11} strokeWidth={2.4} color={C.faint} aria-label="Fijada" style={{ flex: "none" }} /> : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: status.fg, whiteSpace: "nowrap" }}>
          {task.snoozed ? <AlarmClock size={11} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none" }} /> : <span aria-hidden="true" style={{ width: "6px", height: "6px", flex: "none", borderRadius: "50%", background: status.dot }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{project ? project.name + " · " : ""}{line}</span>
        </span>
      </span>
      <Stat add={task.add} del={task.del} size={11} />
      <button type="button" className={menu.at ? undefined : "code-x"} onClick={menu.open} aria-label={"Acciones de la tarea " + task.title} aria-haspopup="menu" aria-expanded={!!menu.at} title="Fijar, posponer, archivar o borrar"
        style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", width: "26px", height: "26px", padding: 0, display: "grid", placeItems: "center", border: 0, borderRadius: "999px", background: menu.at ? C.soft : C.white, boxShadow: "0 1px 2px rgba(18,19,26,.12)", color: C.text, cursor: "pointer" }}>
        <Ellipsis size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <TaskMenu task={task} current={current} menu={menu} />
    </a>
  );
}

/** A project's own archiving rule, over Ajustes (T3 Code environment rules). */
function ProjectMenu({ project, menu }) {
  const own = project.archive || {};
  const set = (archive) => act(async () => { menu.close(); await patch("/code/projects/" + project.id, { archive }); });
  const days = [[null, "Según Ajustes"], [0, "Nunca"], [1, "Tras 1 día"], [3, "Tras 3 días"], [7, "Tras 7 días"], [14, "Tras 14 días"], [30, "Tras 30 días"]];
  return (
    <MenuSheet menu={menu} label={"Archivado de " + project.name} width={262}>
      <span style={{ display: "block", padding: "8px 10px 4px", font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>Archivar las inactivas</span>
      {days.map(([d, label]) => <Item key={String(d)} text={label} on={(own.idleDays ?? null) === d} onClick={() => set({ idleDays: d })} />)}
      <Rule />
      <span style={{ display: "block", padding: "8px 10px 4px", font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>Si tienen una PR abierta</span>
      {[[null, "Según Ajustes"], [true, "Conservarlas"], [false, "Archivarlas igual"]].map(([v, label]) => <Item key={String(v)} text={label} on={(own.keepWithPr ?? null) === v} onClick={() => set({ keepWithPr: v })} />)}
      <Rule />
      <Item text="Más en Ajustes" note="›" onClick={() => { menu.close(); navigate("/ajustes/autonomia#codigo-archivar"); }} />
    </MenuSheet>
  );
}

function ProjectHeader({ p }) {
  const menu = useMenu();
  const rule = p.archive?.idleDays === 0 ? "no se archivan solas" : p.archive?.idleDays ? "se archivan tras " + p.archive.idleDays + (p.archive.idleDays === 1 ? " día" : " días") : null;
  return (
    <div className="code-task" style={{ position: "relative", display: "flex", alignItems: "center", gap: "10px", padding: "6px 8px" }} title={p.root}>
      <span aria-hidden="true" style={{ width: "30px", height: "30px", flex: "none", display: "grid", placeItems: "center", borderRadius: "9px", background: "#E9E9E4", color: C.text }}>
        {p.repo ? <FolderGit2 size={15} strokeWidth={2} /> : <Folder size={15} strokeWidth={2} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <strong style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</strong>
        <span style={{ font: `400 11px/1.3 ${MONO}`, color: C.quiet, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(p.repo ? (p.base || "git") : "sin git") + " · " + (rule || p.root)}</span>
      </span>
      <button type="button" className={menu.at ? undefined : "code-x"} onClick={menu.open} aria-label={"Archivado de " + p.name} aria-haspopup="menu" title="Cuándo se archivan sus tareas" style={{ width: "26px", height: "26px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", color: C.faint, cursor: "pointer" }}>
        <Ellipsis size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <button type="button" onClick={() => navigate("/codigo?proyecto=" + p.id)} aria-label={"Nueva tarea en " + p.name} title="Nueva tarea en este proyecto" style={{ width: "28px", height: "28px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", color: C.faint, cursor: "pointer" }}>
        <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <ProjectMenu project={p} menu={menu} />
    </div>
  );
}

const SHELF = new Set(["snoozed", "archived"]);
const groupColor = (key) => (key === "wait" ? C.honeyText : key === "stuck" ? C.red : C.faint);

export default function ProjectList({ projects = [], currentTask = null, currentShared = null, onOpen }) {
  const [q, setQ] = useState("");
  const [view, setViewState] = useState(readView);
  const [shelves, setShelvesState] = useState(readShelves);
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch {} };
  const toggleShelf = (key) => setShelvesState((s) => { const next = { ...s, [key]: !s[key] }; try { localStorage.setItem(SHELF_KEY, JSON.stringify(next)); } catch {} return next; });
  const query = q.trim().toLowerCase();
  const hiddenTask = useHidden("codetask");
  const shown = projects.map((p) => ({ ...p, tasks: p.tasks.filter((t) => !hiddenTask(t.id) && (!query || t.title.toLowerCase().includes(query))) })).filter((p) => !query || p.tasks.length || p.name.toLowerCase().includes(query));
  const all = shown.flatMap((p) => p.tasks.map((t) => ({ t, p })));
  const groups = GROUPS.map(([key, label]) => ({
    key, label,
    tasks: all.filter(({ t }) => groupOf(t) === key).sort((a, b) => key === "snoozed" ? String(a.t.snoozed.until).localeCompare(String(b.t.snoozed.until))
      : key === "archived" ? String(b.t.archived.at).localeCompare(String(a.t.archived.at)) : String(b.t.updatedAt).localeCompare(String(a.t.updatedAt))),
  })).filter((g) => g.tasks.length);
  // Searching opens the shelves; the task on screen opens its own.
  const openShelf = (g) => !!query || !!shelves[g.key] || g.tasks.some(({ t }) => t.id === currentTask);
  const live = groups.filter((g) => !SHELF.has(g.key));
  const parked = groups.filter((g) => SHELF.has(g.key));
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
      <div style={{ display: "flex", padding: "0 4px" }}>
        <Seg small label="Ordenar las tareas" value={view} onChange={setView} options={[["status", "Por estado"], ["projects", "Por proyecto"]]} />
      </div>
      {view === "status" ? live.map((g) => (
        <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px 4px", font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: groupColor(g.key) }}>
            {g.key === "pinned" ? <Pin size={11} strokeWidth={2.4} aria-hidden="true" /> : null}{g.label}<span style={{ color: C.quiet }}>{g.tasks.length}</span>
          </span>
          {g.tasks.map(({ t, p }) => <TaskRow key={t.id} task={t} project={p} current={t.id === currentTask} />)}
        </div>
      )) : null}
      {view === "status" && !live.length && !parked.length ? <p style={{ margin: "8px 12px", fontSize: "13px", lineHeight: 1.5, color: C.faint }}>{query ? "Ninguna tarea coincide." : "Aún no hay tareas. Pulsa «Nueva» para empezar una."}</p> : null}
      {view === "projects" ? shown.map((p) => (
        <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: "2px", paddingTop: "6px" }}>
          <ProjectHeader p={p} />
          {p.tasks.filter((t) => !t.archived && !t.snoozed).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).map((t) => <TaskRow key={t.id} task={t} current={t.id === currentTask} />)}
        </div>
      )) : null}
      {parked.map((g) => {
        const open = openShelf(g);
        return (
          <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <button type="button" onClick={() => toggleShelf(g.key)} aria-expanded={open}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px 4px", border: 0, background: "transparent", cursor: "pointer", font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, textAlign: "left" }}>
              <ChevronRight size={11} strokeWidth={2.6} aria-hidden="true" style={{ transition: "transform .2s ease", transform: open ? "rotate(90deg)" : "none" }} />
              {g.key === "snoozed" ? <AlarmClock size={11} strokeWidth={2.4} aria-hidden="true" /> : <Archive size={11} strokeWidth={2.4} aria-hidden="true" />}
              {g.label}<span style={{ color: C.quiet }}>{g.tasks.length}</span>
            </button>
            {open ? g.tasks.map(({ t, p }) => <TaskRow key={t.id} task={t} project={p} current={t.id === currentTask} />) : null}
          </div>
        );
      })}
      <SharedShelf current={currentShared} />
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: "10px", height: "42px", margin: "0 4px", padding: "0 12px", border: "1px dashed rgba(18,19,26,.18)", borderRadius: "14px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 500, color: C.text }}>
        <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />Abrir otro proyecto
      </button>
    </aside>
  );
}
