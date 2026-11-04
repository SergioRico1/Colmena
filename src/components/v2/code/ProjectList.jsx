import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis, Pin, PinOff, AlarmClock, Archive, ArchiveRestore, Trash2, ChevronRight, Sun, CalendarClock, Search, X } from "lucide-react";
import { navigate } from "../../../lib/router.jsx";
import { del, patch, post } from "../../../lib/api.js";
import { later, reversible, useHidden } from "../../../lib/undoToast.js";
import { useStore } from "../../../lib/store.jsx";
import { C, MONO, SHEET, BotShape, botOf, Pill, SR, timeAgo } from "./parts.jsx";
import { GROUPS, groupOf, snoozePresets, whenLabel, pillOf, homeSections } from "./model.js";

// «Tareas» of Código (design/V3Codigo.dc.html): what waits for you, what is moving, and what is
// put off or done, each task with its state in words. Each task has a «…» menu (T3 Code thread
// actions): pin, snooze until a time, archive (settle) or keep it out of automatic archiving,
// and delete. The archived ones wait folded at the end.

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

export { GROUPS, groupOf, whenLabel };

const SHELF_KEY = "colmena:code-shelves";
const readShelves = () => { try { return JSON.parse(localStorage.getItem(SHELF_KEY) || "{}"); } catch { return {}; } };

const act = (fn) => fn().catch((e) => window.alert(e.message));
const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** A menu anchored to a button, drawn above the list (fixed), closed by a click outside or Esc. */
export function useMenu(width = 280) {
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
    setAt({ left: Math.min(r.right - width, window.innerWidth - width - 12), top: r.bottom + 6, up: r.bottom + 360 > window.innerHeight, bottom: window.innerHeight - r.top + 6 });
  };
  return { at, ref, open, close: () => setAt(null) };
}

export function MenuSheet({ menu, label, children, width = 280 }) {
  if (!menu.at) return null;
  // Drawn in <body>: inside the task's link, a click on a field would open the task.
  return createPortal(
    <div ref={menu.ref} role="menu" aria-label={label} onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", zIndex: 60, left: Math.max(8, menu.at.left) + "px", ...(menu.at.up ? { bottom: menu.at.bottom + "px" } : { top: menu.at.top + "px" }), width: width + "px", maxHeight: "min(76vh, 620px)", overflowY: "auto", padding: "6px", borderRadius: "18px", background: C.white, boxShadow: SHEET, animation: "rise .18s ease-out" }}>
      {children}
    </div>,
    document.body,
  );
}

export function Item({ icon: Icon, text, note = null, onClick, tone = null, on = false, disabled = false }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} className="code-hover"
      style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", padding: "0 10px", border: 0, borderRadius: "12px", background: on ? C.soft : "transparent", cursor: disabled ? "default" : "pointer", textAlign: "left", fontSize: "13px", fontWeight: 500, color: disabled ? C.quiet : tone || C.ink }}>
      {Icon ? <Icon size={14} strokeWidth={2.1} aria-hidden="true" style={{ flex: "none" }} /> : <span style={{ width: "14px", flex: "none" }} />}
      <span style={{ flex: 1 }}>{text}</span>
      {note ? <span style={{ font: `400 11px/1 ${MONO}`, color: C.quiet, whiteSpace: "nowrap" }}>{note}</span> : null}
    </button>
  );
}
export const Rule = () => <span aria-hidden="true" style={{ display: "block", height: "1px", margin: "4px 8px", background: C.rule }} />;
export const Heading = ({ children }) => <span style={{ display: "block", padding: "8px 10px 4px", font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>{children}</span>;

/** Pin, snooze, archive, delete: the items of a task's «…» (the list and the task's «Más»). */
export function TaskActions({ task, current, done }) {
  const [custom, setCustom] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600000)));
  const base = "/code/tasks/" + task.id;
  const close = () => { done(); setCustom(false); };
  const pin = (on) => act(async () => {
    close();
    await patch(base, { pinned: on });
    if (!on) reversible({ id: "codepin:" + task.id, text: `«${task.title}» ya no está fijada`, undo: () => patch(base, { pinned: true }) });
  });
  const snooze = (iso) => act(async () => {
    close();
    await post(base + "/snooze", { until: iso });
    reversible({ id: "codesnooze:" + task.id, text: `Pospuesta hasta ${whenLabel(iso)}`, undo: () => post(base + "/snooze", { until: null }) });
    if (current) navigate("/codigo");
  });
  const wake = () => act(async () => { close(); await post(base + "/snooze", { until: null }); });
  const archive = (on) => act(async () => {
    close();
    await post(base + "/archive", { archived: on });
    if (on) reversible({ id: "codearchive:" + task.id, text: `Tarea «${task.title}» archivada`, undo: () => post(base + "/archive", { archived: false }) });
  });
  const auto = (on) => act(async () => { close(); await patch(base, { autoArchive: on }); });
  // The task (its copy, its preview server) goes after the five-second «Deshacer».
  const remove = () => {
    close();
    later({ id: "codetask:" + task.id, keys: ["codetask:" + task.id], text: `Tarea «${task.title}» borrada`, error: "No se pudo borrar la tarea", run: () => del(base) });
    if (current) navigate("/codigo");
  };
  return (
    <>
      {!task.archived ? (task.pinned ? <Item icon={PinOff} text="Quitar de fijadas" onClick={() => pin(false)} /> : <Item icon={Pin} text="Fijar arriba" onClick={() => pin(true)} />) : null}
      {task.snoozed ? <Item icon={Sun} text="Despertar ahora" note={whenLabel(task.snoozed.until)} onClick={wake} /> : null}
      {!task.archived && !task.snoozed ? (
        <>
          <Heading>Posponer</Heading>
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
    </>
  );
}

function TaskMenu({ task, current, menu }) {
  return (
    <MenuSheet menu={menu} label={"Acciones de «" + task.title + "»"}>
      <TaskActions task={task} current={current} done={menu.close} />
    </MenuSheet>
  );
}

/** A project's own archiving rule, over Ajustes (T3 Code environment rules). */
export function ProjectMenu({ project, menu }) {
  const own = project.archive || {};
  const set = (archive) => act(async () => { menu.close(); await patch("/code/projects/" + project.id, { archive }); });
  const days = [[null, "Según Ajustes"], [0, "Nunca"], [1, "Tras 1 día"], [3, "Tras 3 días"], [7, "Tras 7 días"], [14, "Tras 14 días"], [30, "Tras 30 días"]];
  return (
    <MenuSheet menu={menu} label={"Archivado de " + project.name} width={262}>
      <Heading>Archivar las inactivas</Heading>
      {days.map(([d, label]) => <Item key={String(d)} text={label} on={(own.idleDays ?? null) === d} onClick={() => set({ idleDays: d })} />)}
      <Rule />
      <Heading>Si tienen una PR abierta</Heading>
      {[[null, "Según Ajustes"], [true, "Conservarlas"], [false, "Archivarlas igual"]].map(([v, label]) => <Item key={String(v)} text={label} on={(own.keepWithPr ?? null) === v} onClick={() => set({ keepWithPr: v })} />)}
      <Rule />
      <Item text="Más en Ajustes" note="›" onClick={() => { menu.close(); navigate("/ajustes/autonomia#codigo-archivar"); }} />
    </MenuSheet>
  );
}

/** The mono line under a task: project · branch · PR, or when it comes back. */
function metaOf(task, project) {
  const parts = [project?.name];
  if (task.snoozed) parts.push("vuelve " + whenLabel(task.snoozed.until));
  else if (task.archived) parts.push("archivada " + timeAgo(task.archived.at));
  else {
    if (task.branch && !task.saved) parts.push(task.branch);
    if (task.pr?.number) parts.push("PR #" + task.pr.number);
    if (task.saved || task.merged || !task.branch) parts.push(timeAgo(task.updatedAt));
  }
  return parts.filter(Boolean).join(" · ");
}

const ROW = { position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", minHeight: "64px", padding: "10px 18px", borderTop: "1px solid rgba(18,19,26,.05)", color: C.ink };
const META = { font: `400 12.5px/1.3 ${MONO}`, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const TITLE = { fontSize: "15px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function TaskRow({ task, project, bots }) {
  const menu = useMenu();
  const pill = pillOf(task);
  return (
    <a href={"/codigo/" + task.id} className="code-hover code-task" style={{ ...ROW, opacity: task.archived ? 0.75 : 1 }}>
      <BotShape bot={botOf(bots, task)} size={16} state={pill.tone === "run" ? "work" : "rest"} />
      <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          {task.pinned ? <Pin size={12} strokeWidth={2.4} color={C.faint} aria-label="Fijada" style={{ flex: "none" }} /> : null}
          <span style={TITLE}>{task.title}</span>
        </span>
        <span style={META}>{metaOf(task, project)}</span>
      </span>
      {task.add || task.del ? <span style={{ font: `500 12.5px/1 ${MONO}`, whiteSpace: "nowrap" }}><span style={{ color: C.greenText }}>{task.add ? "+" + task.add : ""}</span> <span style={{ color: C.red }}>{task.del ? "−" + task.del : ""}</span></span> : null}
      <span className="code-pill" style={{ display: "flex" }}><Pill pill={pill} /></span>
      <button type="button" className={menu.at ? undefined : "code-x"} onClick={menu.open} aria-label={"Acciones de la tarea " + task.title} aria-haspopup="menu" aria-expanded={!!menu.at} title="Fijar, posponer, archivar o borrar"
        style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", width: "30px", height: "30px", padding: 0, display: "grid", placeItems: "center", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: C.white, color: C.text, cursor: "pointer" }}>
        <Ellipsis size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <TaskMenu task={task} current={false} menu={menu} />
    </a>
  );
}

/** Several engines with the same request: one row that opens the comparison. */
function CompareRow({ row, project, bots }) {
  const working = row.section === "work";
  const pill = working ? pillOf({ running: true }) : pillOf({ turns: 1 });
  return (
    <a href={"/codigo/comparar/" + row.group} className="code-hover" style={ROW}>
      <BotShape bot={botOf(bots, row.tasks[0])} size={16} state={working ? "work" : "rest"} />
      <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={TITLE}>{row.title}</span>
        <span style={META}>{[project?.name, row.tasks.length + " propuestas para comparar"].filter(Boolean).join(" · ")}</span>
      </span>
      <Pill pill={pill} />
    </a>
  );
}

/**
 * «Tareas»: three parts (te esperan, en marcha, pospuestas y hechas) and the archived ones folded
 * at the end. `filter` is a project id (from «Proyectos») or null; `onClearFilter` drops it.
 */
export default function TaskSections({ projects = [], filter = null, onClearFilter }) {
  const { bots } = useStore();
  const [q, setQ] = useState("");
  const [shelves, setShelvesState] = useState(readShelves);
  const toggleShelf = (key) => setShelvesState((s) => { const next = { ...s, [key]: !s[key] }; try { localStorage.setItem(SHELF_KEY, JSON.stringify(next)); } catch {} return next; });
  const hiddenTask = useHidden("codetask");
  const query = q.trim().toLowerCase();
  const byId = new Map(projects.map((p) => [p.id, p]));
  const all = projects.flatMap((p) => p.tasks).filter((t) => !hiddenTask(t.id) && (!filter || t.projectId === filter) && (!query || t.title.toLowerCase().includes(query)));
  const total = projects.reduce((n, p) => n + p.tasks.length, 0);
  const sections = homeSections(all);
  const filtered = filter ? byId.get(filter) : null;
  return (
    <section aria-labelledby="tasks-t" style={{ flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", minHeight: "22px" }}>
        <h2 id="tasks-t" style={{ margin: 0, font: "600 22px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Tareas</h2>
        {filtered ? (
          <button type="button" onClick={onClearFilter} title="Ver las tareas de todos los proyectos" style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "26px", padding: "0 8px 0 11px", border: 0, borderRadius: "999px", background: C.track, cursor: "pointer", font: `500 12.5px/1 ${MONO}`, color: C.ink }}>
            {filtered.name}<X size={13} strokeWidth={2.4} aria-label="Quitar el filtro" />
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        {total > 8 || query ? (
          <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "32px", width: "220px", padding: "0 12px", borderRadius: "999px", background: C.white, border: "1px solid rgba(18,19,26,.1)", color: C.muted }}>
            <Search size={14} strokeWidth={2.2} aria-hidden="true" />
            <span style={SR}>Buscar tareas</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tareas" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: "13.5px" }} />
          </label>
        ) : null}
      </div>
      {!sections.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", borderRadius: "18px", background: C.white }}>
          <span style={{ fontSize: "15px", fontWeight: 600 }}>{query ? "Ninguna tarea coincide" : filtered ? "Este proyecto aún no tiene tareas" : "Aún no hay tareas"}</span>
          <span style={{ fontSize: "14px", lineHeight: 1.5, color: C.text2 }}>{query ? "Prueba con otras palabras." : "Cuenta arriba qué quieres construir y pulsa «Empezar». Bruno trabaja en una copia aparte y aquí verás cómo va."}</span>
        </div>
      ) : null}
      {sections.map((g) => {
        const shelf = g.key === "archived";
        const open = !shelf || !!query || !!shelves.archived;
        return (
          <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {shelf ? (
              <button type="button" onClick={() => toggleShelf("archived")} aria-expanded={open} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", padding: "0 4px", border: 0, background: "transparent", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: C.muted }}>
                <ChevronRight size={13} strokeWidth={2.6} aria-hidden="true" style={{ transition: "transform .2s ease", transform: open ? "rotate(90deg)" : "none" }} />{g.title} · {g.rows.length}
              </button>
            ) : <h3 style={{ margin: 0, padding: "0 4px", fontSize: "13px", fontWeight: 600, color: C.muted }}>{g.title}</h3>}
            {open ? (
              <div style={{ display: "flex", flexDirection: "column", borderRadius: "18px", background: C.white, overflow: "hidden" }}>
                {g.rows.map((r) => r.kind === "compare"
                  ? <CompareRow key={r.group} row={r} project={byId.get(r.tasks[0].projectId)} bots={bots} />
                  : <TaskRow key={r.task.id} task={r.task} project={byId.get(r.task.projectId)} bots={bots} />)}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
