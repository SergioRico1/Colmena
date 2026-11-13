import { useState } from "react";
import { Check, FolderOpen, FolderCode, GitBranch, Sparkles, Ellipsis } from "../../Icon.js";
import { post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { useStore } from "../../../lib/store.jsx";
import { useHandoffs, useSharedTasks } from "../../../lib/codeshare.js";
import { C, MONO, HEAD, BTN, CHIP, SR, MenuChip, MenuItem, BotShape, botOf } from "./parts.jsx";
import Composer, { ENGINE_NAME } from "./Composer.jsx";
import EngineModelMenu from "./EngineModels.jsx";
import TaskSections, { useMenu, MenuSheet, Item, ProjectMenu } from "./ProjectList.jsx";
import { PeerAvatar } from "../people/PeerAvatar.jsx";
import { sharedStatus } from "../people/SharedTasks.jsx";

// Código (design/V3Codigo.dc.html): what it is in one sentence, the box to ask for a change
// («Empezar»), the tasks by state and, beside them, the projects, the engines of this computer
// and what people hand over to you. Open a folder, clone a repository or start from scratch from
// «Abrir un proyecto».

/** «E:\\a\\b\\c\\proyecto» → «…\\c\\proyecto»: where it is, without the long head. */
export const shortPath = (p) => { const parts = String(p || "").split(/[\\/]/).filter(Boolean); return parts.length > 2 ? "…" + (String(p).includes("\\") ? "\\" : "/") + parts.slice(-2).join(String(p).includes("\\") ? "\\" : "/") : String(p || ""); };

export async function pickProjectFolder() {
  const api = typeof window !== "undefined" ? window.colmenaWindow : null;
  if (api?.pickFolder) return api.pickFolder("code");
  const typed = window.prompt("Ruta de la carpeta del proyecto (por ejemplo E:\\Proyectos\\mi-web):");
  return typed ? typed.trim() : null;
}

const ENGINE_KEY = "colmena:code-engine";
const readChoice = () => { try { return JSON.parse(localStorage.getItem(ENGINE_KEY) || "null") || {}; } catch { return {}; } };
const MODE_KEY = "colmena:code-start-mode";
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === "build" ? "build" : "plan"; } catch { return "plan"; } };
const CARD = { display: "flex", flexDirection: "column", gap: "4px", padding: "16px 18px", borderRadius: "var(--r-xl)", background: C.white };
const CARD_H = { margin: "0 0 6px", fontSize: "var(--t-ui)", fontWeight: 600 };

function ProjectRow({ p, n, on, onPick }) {
  const menu = useMenu(262);
  return (
    <div className="code-task" style={{ position: "relative", display: "flex", alignItems: "center", gap: "10px", minHeight: "48px" }}>
      <button type="button" onClick={onPick} aria-pressed={on} title={"Nuevas tareas y la lista, en " + p.name} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "10px", padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
        <span aria-hidden="true" style={{ flex: "none", width: "30px", height: "30px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: on ? C.ink : C.track, color: on ? C.white : C.ink, font: `600 var(--t-micro)/1 ${MONO}` }}>&lt;/&gt;</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
          <span style={{ font: `500 var(--t-ui)/1.2 ${MONO}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          <span title={p.root} style={{ font: `400 var(--t-caption)/1.3 ${MONO}`, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>{"\u200e" + shortPath(p.root)}</span>
        </span>
        <span className="code-stat" style={{ fontSize: "var(--t-meta)", color: C.muted, whiteSpace: "nowrap" }}>{n === 1 ? "1 tarea" : n + " tareas"}</span>
      </button>
      <button type="button" className={menu.at ? undefined : "code-x"} onClick={menu.open} aria-label={"Archivado de " + p.name} aria-haspopup="menu" title="Cuándo se archivan sus tareas"
        style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", width: "30px", height: "30px", display: "grid", placeItems: "center", border: "1px solid rgb(var(--c-ink-rgb) / .12)", borderRadius: "var(--r-circle)", background: C.white, color: C.text, cursor: "pointer" }}>
        <Ellipsis size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <ProjectMenu project={p} menu={menu} />
    </div>
  );
}

function Engines({ engines }) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState(null);
  const install = async () => {
    setInstalling(true); setError(null);
    try { await post("/code/engines/opencode/install", {}); } catch (e) { setError(e.message); } finally { setInstalling(false); }
  };
  return (
    <div style={CARD}>
      <h2 style={CARD_H}>Motores en este ordenador</h2>
      {engines.map((e) => (
        <div key={e.id} title={e.available ? undefined : e.need || undefined} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "42px", fontSize: "var(--t-ui)" }}>
          <span style={{ flex: 1, fontWeight: 500 }}>{e.label}{e.version ? <> <span style={{ font: `400 var(--t-caption)/1 ${MONO}`, color: C.muted }}>{e.version}</span></> : null}</span>
          {e.available ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "var(--t-meta)", fontWeight: 600, color: C.greenText }}><Check size={14} weight="bold" aria-hidden="true" />listo</span>
            : e.installable ? <button type="button" disabled={installing || e.installing} onClick={install} style={{ height: "30px", padding: "0 12px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: C.white, fontSize: "var(--t-meta)", cursor: installing || e.installing ? "default" : "pointer" }}>{installing || e.installing ? "Instalando…" : "Instalar"}</button>
              : <span style={{ fontSize: "var(--t-meta)", color: C.muted }}>Sin sesión</span>}
        </div>
      ))}
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: C.red }}>{error}</span> : null}
    </div>
  );
}

/** «Marta te pasa una tarea»: a handoff waiting for «Seguir en mi Colmena» (it needs you). */
function Handoff({ h }) {
  const first = h.ownerPerson?.name?.split(" ")[0] || "Alguien";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "var(--r-xl)", background: C.white, boxShadow: "0 0 0 2px var(--c-honey-ring)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: C.muted }}><PeerAvatar person={h.ownerPerson} size={22} ring={C.white} />{first} te pasa una tarea</span>
      <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{h.title}</span>
      <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.45, color: C.text2 }}>{h.note ? "«" + h.note + "» " : ""}Su Bruno escribió qué está hecho y qué falta.</span>
      <a href={"/codigo/traspaso/" + h.id} onClick={(e) => { e.preventDefault(); navigate("/codigo/traspaso/" + h.id); }} style={{ alignSelf: "flex-start", height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-sm)", background: C.ink, color: C.white, fontSize: "var(--t-ui)", fontWeight: 600 }}>Seguir en mi Colmena</a>
    </div>
  );
}

function Shared({ items }) {
  return (
    <div style={CARD}>
      <h2 style={CARD_H}>Compartidas contigo</h2>
      {items.map((m) => {
        const st = sharedStatus(m.snapshot, m.ownerPerson.name);
        return (
          <a key={m.id} href={"/codigo/compartida/" + m.id} onClick={(e) => { e.preventDefault(); navigate("/codigo/compartida/" + m.id); }} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "48px", color: C.ink }}>
            <PeerAvatar person={m.ownerPerson} size={26} ring={C.white} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "var(--t-ui)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.snapshot.title}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", color: C.muted }}><span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "var(--r-circle)", background: st.dot }} />{st.text}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

export default function CodeHome({ projects = [], selected = null, onSelect, engines = [] }) {
  const { bots } = useStore();
  const bruno = botOf(bots, { botId: "bruno" });
  const handoffs = useHandoffs();
  const shared = useSharedTasks() || [];
  const [mode, setMode] = useState(null); // 'clone' | 'new'
  const [how, setHowState] = useState(readMode); // «Plan primero» or «Directo»
  const setHow = (v) => { setHowState(v); try { localStorage.setItem(MODE_KEY, v); } catch {} };
  const [filter, setFilter] = useState(null);
  const [choice, setChoiceState] = useState(readChoice); // {engine, model}: the last one you used
  const setChoice = (c) => { setChoiceState(c); try { localStorage.setItem(ENGINE_KEY, JSON.stringify(c)); } catch {} };
  const available = engines.filter((e) => e.available);
  const engine = available.find((e) => e.id === choice.engine) || available[0] || null;
  const model = engine ? engine.models.find((m) => m.id === choice.model) || engine.models.find((m) => m.isDefault) || engine.models[0] : null;
  // «Probar con N motores y comparar» (T3 Code «several at once»): one task per engine · model.
  const [multi, setMulti] = useState(false);
  const [picks, setPicks] = useState([]);
  const everyEngine = available.slice(0, 4).map((e) => ({ engine: e.id, model: (e.models.find((m) => m.isDefault) || e.models[0])?.id })).filter((p) => p.model);
  const chosen = multi && picks.length ? picks : engine && model ? [{ engine: engine.id, model: model.id }] : [];
  const modelName = (p) => engines.find((e) => e.id === p.engine)?.models.find((m) => m.id === p.model)?.label || p.model;
  const labelOf = (p) => ENGINE_NAME[p.engine] + " · " + modelName(p);
  const togglePick = (p) => setPicks((all) => all.some((x) => x.engine === p.engine && x.model === p.model) ? all.filter((x) => !(x.engine === p.engine && x.model === p.model)) : all.length >= 4 ? all : [...all, p]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const open = useMenu(300);
  const project = projects.find((p) => p.id === selected) || [...projects].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  };
  const openFolder = () => run(async () => {
    const folder = await pickProjectFolder();
    if (!folder) return;
    const { project: p } = await post("/code/projects", { folder });
    onSelect(p.id);
  });
  const confirm = (e) => run(async () => {
    e.preventDefault();
    if (!value.trim()) return;
    const { project: p } = await post("/code/projects", mode === "clone" ? { clone: value.trim() } : { name: value.trim() });
    setMode(null); setValue("");
    onSelect(p.id);
  });
  const start = async (text, _when, plan, files = []) => run(async () => {
    let p = project;
    if (!p) ({ project: p } = await post("/code/projects", { name: (text || "proyecto").split(/\s+/).slice(0, 4).join(" ") }));
    const many = chosen.length > 1;
    // Started together, they are compared together (/codigo/comparar/<grupo>).
    const group = many ? "cg-" + Math.random().toString(16).slice(2, 10) : null;
    let first = null;
    for (const c of chosen.length ? chosen : [null]) {
      const { task } = await post("/code/tasks", { projectId: p.id, text, mode: plan === "plan" ? "plan" : "build", attachments: files, ...(c ? { engine: c.engine, model: c.model } : {}), ...(many ? { label: labelOf(c), group } : {}) });
      first ||= task;
    }
    navigate(group ? "/codigo/comparar/" + group : "/codigo/" + first.id);
    return true;
  }).then((ok) => ok === true);
  const counts = new Map(projects.map((p) => [p.id, p.tasks.filter((t) => !t.archived).length]));
  const distinct = new Set(chosen.map((c) => c.engine)).size;
  const engineChip = engine ? (multi && picks.length > 1 ? (bruno?.name || "Bruno") + " · " + picks.length + " a la vez" : (bruno?.name || "Bruno") + " · " + ENGINE_NAME[engine.id] + " · " + (model?.label || "")) : null;
  const pickProject = (id) => { onSelect(id); setFilter((f) => (f === id ? null : id)); };
  return (
    <div style={{ height: "100%", overflowY: "auto", overscrollBehavior: "contain" }}>
      <main style={{ maxWidth: "1160px", margin: "0 auto", padding: "44px clamp(20px, 4vw, 48px) 64px", display: "flex", flexDirection: "column", gap: "28px", animation: "fade .35s ease-out" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h1 style={{ margin: 0, font: `700 var(--t-headline)/1.15 ${HEAD}`, letterSpacing: "-0.015em" }}>Código</h1>
            <p style={{ margin: 0, maxWidth: "680px", fontSize: "var(--t-read)", lineHeight: 1.5, color: C.text2 }}>Tus bots programan en una copia aparte de tu proyecto. Ves cada cambio, lo pruebas en la vista previa y decides qué se queda.</p>
          </div>
          <button type="button" onClick={open.open} aria-haspopup="menu" aria-expanded={!!open.at} disabled={busy} style={{ ...BTN.outline, height: "44px", padding: "0 18px", fontSize: "var(--t-body)", fontWeight: 500 }}>Abrir un proyecto</button>
          <MenuSheet menu={open} label="Abrir un proyecto" width={300}>
            <Item icon={FolderOpen} text="Abrir una carpeta del ordenador" onClick={() => { open.close(); openFolder(); }} />
            <Item icon={GitBranch} text="Clonar de GitHub" onClick={() => { open.close(); setMode("clone"); setValue(""); }} />
            <Item icon={Sparkles} text="Empezar de cero" note="Documentos › Colmena" onClick={() => { open.close(); setMode("new"); setValue(""); }} />
          </MenuSheet>
        </header>
        {mode ? (
          <form onSubmit={confirm} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginTop: "-8px", animation: "rise .25s ease-out" }}>
            <label style={{ flex: "1 1 320px", display: "flex" }}>
              <span style={SR}>{mode === "clone" ? "Enlace del repositorio" : "Nombre del proyecto"}</span>
              <input className="c-quiet" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "clone" ? "https://github.com/usuario/proyecto" : "Nombre del proyecto nuevo"}
                style={{ flex: 1, minWidth: 0, height: "44px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-md)", background: C.white, fontSize: "var(--t-body)", fontFamily: mode === "clone" ? MONO : undefined }} />
            </label>
            <button type="submit" disabled={busy || !value.trim()} style={{ ...BTN.primary, height: "44px", opacity: busy || !value.trim() ? 0.5 : 1 }}>{busy ? (mode === "clone" ? "Clonando…" : "Creando…") : mode === "clone" ? "Clonar" : "Crear"}</button>
            <button type="button" onClick={() => setMode(null)} style={{ ...BTN.quiet, height: "44px" }}>Cancelar</button>
          </form>
        ) : null}
        {error ? <p role="alert" style={{ margin: "-8px 0 0", fontSize: "var(--t-ui)", color: C.red }}>{error}</p> : null}

        <Composer variant="home" busy={busy} onSend={start} autoFocus mode={how} onMode={setHow} projectId={project?.id || null}
          onCommand={(name) => { if (name === "plan") setHow("plan"); else if (name === "construir") setHow("build"); else if (name === "atajos") window.dispatchEvent(new Event("colmena:code-shortcuts")); }}
          placeholder="¿Qué construimos? Describe el cambio como se lo contarías a un compañero…"
          footer={
            <>
              <MenuChip title="Proyecto y rama" up={false} width={320} look={CHIP} chevron
                label={project ? <><span style={{ font: `500 var(--t-caption)/1 ${MONO}`, color: C.ink }}>{project.name}</span>{project.repo ? <span style={{ color: C.muted }}> {project.base || "main"}</span> : null}</> : "Proyecto nuevo"}>
                {(close) => (
                  <>
                    {projects.map((p) => <MenuItem key={p.id} icon={<FolderCode size={16} />} title={p.name} text={p.root} on={project?.id === p.id} onClick={() => { onSelect(p.id); close(); }} />)}
                    <MenuItem icon={<FolderOpen size={16} />} title="Abrir otra carpeta…" onClick={() => { close(); openFolder(); }} />
                  </>
                )}
              </MenuChip>
              {engine ? (
                <MenuChip title="Bot, motor y modelo" up={false} width={360} look={CHIP} keepLabel icon={<BotShape bot={bruno} size={14} />} label={engineChip}>
                  {(close) => (
                    <EngineModelMenu engines={engines} current={{ engine: engine.id, model: model?.id }} close={close} multi={multi ? picks : null}
                      onPick={(e, m) => { if (multi) togglePick({ engine: e, model: m }); else setChoice({ engine: e, model: m }); }}
                      switchNote={multi ? "Marca hasta 4: cada uno hace la misma tarea en su copia y luego los comparas." : null} />
                  )}
                </MenuChip>
              ) : null}
              <div role="radiogroup" aria-label="Cómo empieza" style={{ display: "inline-flex", padding: "3px", gap: "2px", borderRadius: "var(--r-pill)", background: C.track }}>
                {[["plan", "Plan primero"], ["build", "Directo"]].map(([id, text]) => (
                  <button key={id} type="button" role="radio" aria-checked={how === id} onClick={() => setHow(id)} title={id === "plan" ? "Bruno te propone un plan y no toca nada hasta que digas «Implementar»" : "Bruno se pone a hacer los cambios"}
                    style={{ height: "28px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: how === id ? C.white : "transparent", boxShadow: how === id ? "var(--c-shadow-lift)" : "none", fontSize: "var(--t-meta)", fontWeight: 500, cursor: "pointer" }}>{text}</button>
                ))}
              </div>
              {everyEngine.length > 1 ? (
                <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "34px", padding: "0 6px", fontSize: "var(--t-ui)", cursor: "pointer" }}>
                  <input type="checkbox" checked={multi} onChange={(e) => { setMulti(e.target.checked); setPicks(e.target.checked ? everyEngine : []); }} style={{ width: "24px", height: "24px", margin: 0, accentColor: C.ink }} />
                  {multi && picks.length > 1 ? `Probar con ${picks.length} ${distinct === picks.length ? "motores" : "modelos"} y comparar` : `Probar con ${everyEngine.length} motores y comparar`}
                </label>
              ) : null}
            </>
          } />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "22px", alignItems: "flex-start" }}>
          <TaskSections projects={projects} filter={filter} onClearFilter={() => setFilter(null)} />
          <aside style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={CARD}>
              <h2 style={CARD_H}>Proyectos</h2>
              {projects.length ? [...projects].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((p) => <ProjectRow key={p.id} p={p} n={counts.get(p.id) || 0} on={filter === p.id} onPick={() => pickProject(p.id)} />) : (
                <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: C.text2 }}>Ninguno todavía. Abre una carpeta, clona un repositorio o escribe arriba qué quieres y Colmena le crea una carpeta.</span>
              )}
            </div>
            {engines.length ? <Engines engines={engines} /> : null}
            {handoffs.map((h) => <Handoff key={h.id} h={h} />)}
            {shared.length ? <Shared items={shared} /> : null}
          </aside>
        </div>
      </main>
    </div>
  );
}
