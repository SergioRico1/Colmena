import { useState } from "react";
import { FolderOpen, GitBranch, Sparkles, Folder, FolderGit2 } from "lucide-react";
import { post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { C, MONO, HEAD, BrunoMark, MenuChip, MenuItem, timeAgo } from "./parts.jsx";
import Composer, { ENGINE_NAME } from "./Composer.jsx";
import EngineModelMenu, { EngineMark } from "./EngineModels.jsx";

// «¿Qué construimos?»: open a folder, clone a repository or start from scratch, then tell
// Bruno what to do (design/V2Codigo.dc.html, estado «inicio»).

export async function pickProjectFolder() {
  const api = typeof window !== "undefined" ? window.colmenaWindow : null;
  if (api?.pickFolder) return api.pickFolder("code");
  const typed = window.prompt("Ruta de la carpeta del proyecto (por ejemplo E:\\Proyectos\\mi-web):");
  return typed ? typed.trim() : null;
}

const ENGINE_KEY = "colmena:code-engine";
const readChoice = () => { try { return JSON.parse(localStorage.getItem(ENGINE_KEY) || "null") || {}; } catch { return {}; } };

export default function CodeHome({ projects = [], selected = null, onSelect, engines = [] }) {
  const [mode, setMode] = useState(null); // 'clone' | 'new'
  const [how, setHow] = useState("build"); // «Construir» or «Plan»
  const [choice, setChoiceState] = useState(readChoice); // {engine, model}: the last one you used
  const setChoice = (c) => { setChoiceState(c); try { localStorage.setItem(ENGINE_KEY, JSON.stringify(c)); } catch {} };
  const available = engines.filter((e) => e.available);
  const engine = available.find((e) => e.id === choice.engine) || available[0] || null;
  const model = engine ? engine.models.find((m) => m.id === choice.model) || engine.models.find((m) => m.isDefault) || engine.models[0] : null;
  // «Probar con varios a la vez» (T3 Code): one task per engine · model, the same request.
  const [multi, setMulti] = useState(false);
  const [picks, setPicks] = useState([]);
  const chosen = multi && picks.length ? picks : engine && model ? [{ engine: engine.id, model: model.id }] : [];
  const labelOf = (p) => ENGINE_NAME[p.engine] + " · " + (engines.find((e) => e.id === p.engine)?.models.find((m) => m.id === p.model)?.label || p.model);
  const togglePick = (p) => setPicks((all) => all.some((x) => x.engine === p.engine && x.model === p.model) ? all.filter((x) => !(x.engine === p.engine && x.model === p.model)) : all.length >= 4 ? all : [...all, p]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const project = projects.find((p) => p.id === selected) || projects[0] || null;
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
  const STARTS = [
    { id: "open", Icon: FolderOpen, title: "Abrir una carpeta", text: "Un proyecto que ya tienes en el ordenador.", act: openFolder },
    { id: "clone", Icon: GitBranch, title: "Clonar de GitHub", text: "Pega el enlace del repositorio.", act: () => { setMode("clone"); setValue(""); } },
    { id: "new", Icon: Sparkles, title: "Empezar de cero", text: "Una carpeta nueva en Documentos › Colmena.", act: () => { setMode("new"); setValue(""); } },
  ];
  return (
    <section aria-label="Empezar" style={{ flex: 1, minWidth: 0, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", animation: "fade .35s ease-out" }}>
      <div style={{ flex: 1, width: "100%", maxWidth: "860px", margin: "0 auto", padding: "88px clamp(20px, 4vw, 44px) 24px", display: "flex", flexDirection: "column", gap: "32px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <span style={{ alignSelf: "flex-start" }}><BrunoMark size={52} /></span>
          <h1 style={{ margin: 0, font: `600 44px/1.02 ${HEAD}`, letterSpacing: "-0.04em" }}>¿Qué construimos?</h1>
          <p style={{ margin: 0, maxWidth: "560px", fontSize: "17px", lineHeight: 1.6, color: C.text }}>Bruno trabaja en una copia aparte de tu proyecto. Ves cada cambio, lo pruebas en la vista previa y decides qué se queda.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
          {STARTS.map(({ id, Icon, title, text, act }) => (
            <button key={id} type="button" disabled={busy} onClick={act} className="code-hover"
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "14px", padding: "22px", border: 0, borderRadius: "24px", background: C.white, cursor: "pointer", textAlign: "left", boxShadow: mode === id ? `0 0 0 1.5px ${C.ink}` : "0 1px 2px rgba(18,19,26,.05), 0 18px 40px -28px rgba(18,19,26,.35)" }}>
              <span aria-hidden="true" style={{ width: "42px", height: "42px", display: "grid", placeItems: "center", borderRadius: "13px", background: "#F0F0EC", color: C.ink }}><Icon size={20} strokeWidth={1.8} /></span>
              <span style={{ display: "flex", flexDirection: "column", gap: "5px" }}><strong style={{ fontSize: "16px", fontWeight: 600 }}>{title}</strong><span style={{ fontSize: "14px", lineHeight: 1.5, color: C.muted }}>{text}</span></span>
            </button>
          ))}
        </div>
        {mode ? (
          <form onSubmit={confirm} style={{ display: "flex", gap: "8px", alignItems: "center", animation: "rise .25s ease-out" }}>
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "clone" ? "https://github.com/usuario/proyecto" : "Nombre del proyecto"}
              style={{ flex: 1, height: "48px", padding: "0 18px", border: 0, borderRadius: "999px", background: C.white, boxShadow: "inset 0 0 0 1px rgba(18,19,26,.1)", outline: "none", fontSize: "15px", fontFamily: mode === "clone" ? MONO : undefined }} />
            <button type="submit" disabled={busy || !value.trim()} style={{ height: "48px", padding: "0 20px", border: 0, borderRadius: "999px", background: C.ink, color: C.white, cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{busy ? (mode === "clone" ? "Clonando…" : "Creando…") : mode === "clone" ? "Clonar" : "Crear"}</button>
            <button type="button" onClick={() => setMode(null)} style={{ height: "48px", padding: "0 14px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Cancelar</button>
          </form>
        ) : null}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: C.red }}>{error}</p> : null}
        {projects.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2 style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 500, color: C.faint }}>Recientes</h2>
            {[...projects].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6).map((p) => (
              <button key={p.id} type="button" onClick={() => onSelect(p.id)} className="code-hover" style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 14px", border: 0, borderRadius: "16px", background: project?.id === p.id ? C.white : "transparent", cursor: "pointer", textAlign: "left" }}>
                {p.repo ? <FolderGit2 size={18} strokeWidth={1.8} color={C.muted} aria-hidden="true" /> : <Folder size={18} strokeWidth={1.8} color={C.muted} aria-hidden="true" />}
                <span style={{ flex: 1, minWidth: 0, fontSize: "15px", fontWeight: 500 }}>{p.name}</span>
                <span style={{ font: `400 12px/1 ${MONO}`, color: C.quiet, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "320px" }}>{p.root}</span>
                <span style={{ fontSize: "12px", color: C.faint, minWidth: "54px", textAlign: "right" }}>{timeAgo(p.updatedAt)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Composer busy={busy} onSend={start} autoFocus mode={how} onMode={setHow} projectId={project?.id || null}
        onCommand={(name) => { if (name === "plan") setHow("plan"); else if (name === "construir") setHow("build"); else if (name === "atajos") window.dispatchEvent(new Event("colmena:code-shortcuts")); }}
        placeholder={how === "plan" ? "Describe qué quieres: Bruno te propone un plan antes de tocar nada…" : project ? `Describe qué quieres cambiar en ${project.name}…` : "Describe lo que quieres construir…"}
        footer={
          <>
            <MenuChip title="Proyecto" icon={<Folder size={13} strokeWidth={2.2} aria-hidden="true" />} label={project ? project.name : "Proyecto nuevo"} width={300}>
              {(close) => (
                <>
                  {projects.map((p) => <MenuItem key={p.id} title={p.name} text={p.root} on={project?.id === p.id} onClick={() => { onSelect(p.id); close(); }} />)}
                  <MenuItem title="Abrir otra carpeta…" onClick={() => { close(); openFolder(); }} />
                </>
              )}
            </MenuChip>
            {engine ? (
              <MenuChip title="Motor y modelo" keepLabel icon={multi && picks.length > 1 ? null : <EngineMark engine={engine.id} size={13} />} label={multi && picks.length > 1 ? picks.length + " a la vez" : ENGINE_NAME[engine.id] + " · " + (model?.label || "")} width={360}>
                {(close) => (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px 10px", borderBottom: "1px solid " + C.rule, fontSize: "13px", color: C.text, cursor: "pointer" }}>
                      <input type="checkbox" checked={multi} onChange={(e) => { setMulti(e.target.checked); setPicks(e.target.checked && engine && model ? [{ engine: engine.id, model: model.id }] : []); }} style={{ width: "16px", height: "16px", accentColor: C.ink }} />
                      Probar con varios a la vez (una tarea por modelo, hasta 4)
                    </label>
                    {/* Every engine, the ready ones with their models; the others say how to get them ready. */}
                    <EngineModelMenu engines={engines} current={{ engine: engine.id, model: model?.id }} close={close} multi={multi ? picks : null}
                      onPick={(e, m) => { if (multi) togglePick({ engine: e, model: m }); else setChoice({ engine: e, model: m }); }} />
                  </>
                )}
              </MenuChip>
            ) : null}
          </>
        } />
    </section>
  );
}
