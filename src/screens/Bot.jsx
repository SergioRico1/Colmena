import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ImagePlus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import ProviderMark, { engineOfModel } from "../components/v2/ProviderMark.jsx";
import { css } from "../design/css/Bot.js";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import SkillReview from "../components/team/SkillReview.jsx";
import { AUTONOMY, AccessPicker, BotAvatar, Notice, Spinner, Switch, TOOL_KEYS, TOOL_LABEL, longDay, monthName, shortDay } from "../components/team/common.jsx";
import { del, patch, pickTextFiles, post } from "../lib/api.js";
import { avatarStyle, initial } from "../lib/bots.js";
import PortraitPicker from "../components/team/PortraitPicker.jsx";
import { missionUrl, roomUrl, shortDate } from "../lib/format.js";
import { navigate } from "../lib/router.jsx";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import StandingOrdersCard from "../components/interaction/StandingOrders.jsx";
import ForgetButton from "../components/interaction/Forget.jsx";
import { VoicePicker } from "../components/interaction/VoicePicker.jsx";
import { SkeletonLines } from "../components/Skeleton.jsx";
import Journey from "../components/team/Journey.jsx";
import { later } from "../lib/undoToast.js";

const SLIDERS = [
  { id: "tono", left: "Formal", right: "Cercano", aria: "Tono, de formal a cercano" },
  { id: "detalle", left: "Breve", right: "Detallado", aria: "Nivel de detalle, de breve a detallado" },
  { id: "riesgo", left: "Prudente", right: "Atrevido", aria: "Riesgo, de prudente a atrevido" },
];
const THINKING = [
  { id: "rapido", label: "Rápido" },
  { id: "equilibrado", label: "Equilibrado" },
  { id: "profundo", label: "Profundo" },
];
const CHANNELS = [
  { id: "correo", label: "Correo", connector: "correo", hint: "Conecta el correo en Ajustes para activarlo" },
  { id: "chat", label: "Chat del equipo", connector: "chat", hint: "Conecta el chat del equipo en Ajustes para activarlo" },
  { id: "movil", label: "Mensajes del móvil", connector: "movil", soon: true },
];
const TABS = [
  { id: "rol", label: "Perfil" },
  { id: "habilidades", label: "Habilidades" },
  { id: "herramientas", label: "Herramientas" },
  { id: "memoria", label: "Memoria" },
  { id: "aprendido", label: "Aprendido" },
  { id: "equipo", label: "Equipo y canales" },
  { id: "historial", label: "Historial" },
];
const RED_LINES = ["Enviar algo fuera", "Mover dinero", "Borrar archivos", "Instalar programas"];
const MISSION_PILL = {
  running: { background: "#E1F4EC", color: "#0B5E41" },
  planning: { background: "#E1F4EC", color: "#0B5E41" },
  queued: { background: "#F4F4F0", color: "#5C606C" },
  waiting: { background: "#FFF4D1", color: "#12131A" },
  awaiting_plan: { background: "#FFF4D1", color: "#12131A" },
  awaiting_choice: { background: "#FFF4D1", color: "#12131A" },
  blocked: { background: "#FDE8E8", color: "#8A1C1C" },
  paused: { background: "#F4F4F0", color: "#5C606C" },
  completed: { background: "#F4F4F0", color: "#5C606C" },
  cancelled: { background: "#F4F4F0", color: "#8C91A0" },
};
const MISSION_LABEL = { running: "En curso", planning: "Planificando", queued: "En cola", waiting: "Te espera", awaiting_plan: "Plan por aprobar", awaiting_choice: "Elige propuesta", blocked: "Bloqueada", paused: "En pausa", completed: "Terminada", cancelled: "Cancelada" };

function fromBot(b) {
  return {
    instructions: b.instructions || "",
    personality: { tono: 50, detalle: 50, riesgo: 50, ...(b.personality || {}) },
    autonomy: b.autonomy || "avisa",
    thinking: b.thinking || "equilibrado",
    location: "local", // Colmena es solo de escritorio por ahora: siempre trabaja en este ordenador.
    tools: Object.fromEntries(TOOL_KEYS.map((k) => [k, b.tools?.[k] || "none"])),
    helpers: b.helpers || [],
    delegateFreely: Boolean(b.delegateFreely),
    channels: { colmena: true, correo: false, chat: false, movil: false, ...(b.channels || {}) },
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const uses = (s) => `usada ${s.uses === 1 ? "1 vez" : `${s.uses || 0} veces`}`;

function skillLine(s) {
  if (s.status === "disabled") return `Desactivada · ${uses(s)}`;
  if (s.status === "stale") return "Sin usar desde hace un mes · no la ofrece";
  if (s.status === "archived") return "Archivada por falta de uso";
  if (s.origin === "learned") return `Aprendida en ${monthName(s.createdAt)} · ${uses(s)}`;
  if (s.origin === "shared") return `Compartida${s.source ? ` por ${s.source}` : ""} · ${uses(s)}`;
  return `Instalada · ${uses(s)}`;
}
function pendingCopy(s) {
  if (s.origin === "imported") return { tag: "Importada · nueva", text: `La importaste el ${longDay(s.createdAt)}${s.source ? ` desde ${s.source}` : ""}. Aún no la usa sin tu visto bueno.` };
  if (s.origin === "shared") return { tag: "Compartida · nueva", text: `Te la compartieron el ${longDay(s.createdAt)}. Aún no la usa sin tu visto bueno.` };
  return { tag: "Aprendida sola · en espera", text: `La creó el ${longDay(s.createdAt)} ${s.learnedFrom || "tras repetir tareas parecidas"}. Mejora una habilidad que tienes apagada: actívala si quieres que la use.` };
}
const CAPABILITIES = [
  { id: "web", label: "Web", desc: "Leer páginas públicas de internet" },
  { id: "carpetas", label: "Carpetas", desc: "Las carpetas de este ordenador que le hayas dado" },
  { id: "apps", label: "Apps conectadas", desc: "Correo, calendario, hojas… según los permisos de abajo" },
  { id: "ordenador", label: "Usar el ordenador", desc: "Ver la pantalla y usar programas, con tu permiso" },
];
const METERS = [
  { id: "user", label: "De ti" },
  { id: "memory", label: "Del equipo" },
  { id: "bot", label: "Propia" },
];
const SOURCE = { importado: "De ChatGPT", dijiste: "Se lo dijiste", dedujo: "Lo dedujo", acuerdo: "Lo acordasteis", documento: "De un documento" };
function memoryLabel(m) {
  if (m.scope === "equipo") return "Compartido · equipo";
  const base = SOURCE[m.source] || m.sourceLabel || "Lo recuerda";
  if (m.review) return `${base} · revisar`;
  return `${base}${m.createdAt ? ` · ${shortDay(m.createdAt)}` : ""}`;
}

const MD_CSS = ".colmena-soul-md{font-size:15px;line-height:1.6;color:#3D404A}.colmena-soul-md>*:first-child{margin-top:0}.colmena-soul-md>*:last-child{margin-bottom:0}.colmena-soul-md h1{font:700 18px/1.25 'Bricolage Grotesque',sans-serif;margin:0 0 8px;color:#12131A}.colmena-soul-md h2,.colmena-soul-md h3{font:700 15px/1.3 'Bricolage Grotesque',sans-serif;margin:16px 0 6px;color:#12131A}.colmena-soul-md p{margin:0 0 10px}.colmena-soul-md ul{margin:0 0 10px;padding-left:20px}.colmena-soul-md hr{border:0;border-top:1px solid rgba(18,19,26,.06);margin:14px 0}";

export default function Bot({ params, query }) {
  const id = params.bot;
  const store = useStore();
  const { bots, ready, connectors, approvals } = store;
  const { data, error: loadError, setData } = useResource(`/bots/${id}`);
  const { data: learning, setData: setLearning } = useResource(`/bots/${id}/learning`);
  const { data: learnedBy } = useResource(`/bots/${id}/learned`);
  const summary = bots.find((b) => b.id === id);
  const bot = data && data.id === id ? { ...summary, ...data } : summary || null;

  const baseline = useMemo(() => (bot ? fromBot(bot) : null), [bot && JSON.stringify(fromBot(bot))]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edits, setEdits] = useState({});
  const [portraitOpen, setPortraitOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(false);
  const [soulDraft, setSoulDraft] = useState(null);
  const [reviewId, setReviewId] = useState(query?.skill || null);
  const [tab, setTab] = useState("rol");
  // The coloured header scrolls away but its tabs stay: the header is sticky with a
  // negative top equal to everything above the tabs.
  const headerRef = useRef(null);
  const tabsRef = useRef(null);
  const [stickTop, setStickTop] = useState(0);
  useLayoutEffect(() => {
    const h = headerRef.current, t = tabsRef.current;
    if (!h || !t) return undefined;
    const measure = () => setStickTop(-(h.offsetHeight - t.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(h);
    return () => ro.disconnect();
  });
  const [savedNote, setSavedNote] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { act, busy, error, setError } = useAction();
  const soulAction = useAction();
  const itemAction = useAction();
  const capAction = useAction();

  useEffect(() => {
    setEdits({});
    setEditingRole(false);
    setSoulDraft(null);
    setShowAll(false);
  }, [id]);

  const form = baseline ? { ...baseline, ...edits } : null;
  const changed = form ? Object.keys(edits).filter((k) => !same(edits[k], baseline[k])) : [];
  const dirty = changed.length > 0;
  const set = (key, value) => setEdits((e) => ({ ...e, [key]: value }));

  // Section tabs: scroll + active state (scroll-spy keeps it in sync).
  const scrolling = useRef(0);
  useEffect(() => {
    if (!bot) return;
    const sections = TABS.map((t) => document.getElementById(t.id)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      if (Date.now() < scrolling.current) return;
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setTab(visible.target.id);
    }, { rootMargin: "-20% 0px -60% 0px" });
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [Boolean(bot)]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (target) => (event) => {
    event?.preventDefault?.();
    setTab(target);
    scrolling.current = Date.now() + 800;
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    const hash = location.hash.slice(1);
    if (bot && TABS.some((t) => t.id === hash)) setTimeout(() => go(hash)(), 60);
  }, [Boolean(bot), id]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeReview = useCallback(() => {
    setReviewId(null);
    if (new URLSearchParams(location.search).has("skill")) history.replaceState(null, "", location.pathname + location.hash);
  }, []);
  useEffect(() => {
    if (query?.skill) setReviewId(query.skill);
  }, [query?.skill]);

  if (!bot) {
    return (
      <Shell active="colmena" extraCss={css}>
        <main style={{ maxWidth: "860px", margin: "0 auto", padding: "64px clamp(20px, 4vw, 40px)", display: "flex", flexDirection: "column", gap: "18px" }}>
          {ready ? (
            <>
              <h1 style={{ margin: 0, font: "600 clamp(40px, 5vw, 56px)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>No encontramos a este bot</h1>
              <p style={{ margin: 0, fontSize: "17px", color: "#5C606C" }}>Puede que ya no esté en tu colmena. {loadError ? `(${loadError})` : ""}</p>
              <a href="/colmena" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", height: "46px", padding: "0 22px", background: "#12131A", color: "#FFFFFF", borderRadius: "999px", fontWeight: "600", fontSize: "15px" }}>Volver a tu colmena</a>
            </>
          ) : <p style={{ margin: 0, fontSize: "15px", color: "#5C606C" }}>Cargando perfil…</p>}
        </main>
      </Shell>
    );
  }

  const color = bot.color || "#12131A";
  const ink = avatarStyle({ ...bot, portrait: null }).color;
  const dark = ink === "#12131A";
  const outline = dark ? "1.5px solid rgba(18,19,26,0.55)" : "1.5px solid rgba(255,255,255,0.6)";
  const chipBg = dark ? "rgba(18,19,26,0.1)" : "rgba(255,255,255,0.14)";
  const shape = avatarStyle(bot, 84);

  const skills = (learning?.skills || data?.skills || store.skills.filter((s) => s.botId === id));
  const pending = skills.filter((s) => s.status === "pending");
  const ORDER = { active: 0, stale: 1, disabled: 2, archived: 3 };
  const installed = skills.filter((s) => s.status !== "pending").sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (ORDER[a.status] ?? 4) - (ORDER[b.status] ?? 4) || (b.uses || 0) - (a.uses || 0));
  const caps = learning?.capabilities || { web: true, carpetas: true, apps: true, ordenador: true };
  const computerReady = Boolean(learning?.computer?.available || store.computer?.available === true || store.computer === true);
  const setCapability = async (key, value) => {
    const result = await capAction.act(() => patch(`/bots/${id}/capabilities`, { [key]: value }));
    if (result?.capabilities) setLearning((d) => (d ? { ...d, capabilities: result.capabilities } : d));
  };
  const togglePin = async (s) => {
    const result = await itemAction.act(() => patch(`/skills/${s.id}/curation`, { pinned: !s.pinned }));
    if (result?.id) setLearning((d) => (d ? { ...d, skills: d.skills.map((x) => (x.id === result.id ? result : x)) } : d));
  };
  const memoryMap = new Map();
  for (const m of [...(data?.memories || store.memories.filter((x) => x.botId === id)), ...store.memories.filter((x) => x.scope === "equipo")]) memoryMap.set(m.id, m);
  const memories = [...memoryMap.values()].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const history = (data?.history || store.missions.filter((m) => (m.botIds || []).includes(id))).slice().sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  const others = bots.filter((b) => b.id !== id && b.enabled !== false);
  const soulPending = approvals.find((a) => a.kind === "soul" && a.botId === id && a.status === "pending");
  const conn = (cid) => connectors.find((c) => c.id === cid);
  const waitingIn = bot.waitingIn || 0;
  const rooms = bot.missionCount || 0;

  const save = async () => {
    if (!dirty || busy) return;
    const body = Object.fromEntries(changed.map((k) => [k, edits[k]]));
    const result = await act(() => patch(`/bots/${id}`, body));
    if (result !== undefined) {
      if (result && typeof result === "object") setData((d) => (d ? { ...d, ...result } : d));
      setEdits({});
      setEditingRole(false);
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 2200);
    }
  };
  const duplicate = async () => {
    const copy = await act(() => post(`/bots/${id}/duplicate`));
    if (copy?.id) navigate(`/equipo/${copy.id}`);
  };
  const saveSoul = async () => {
    const result = await soulAction.act(() => patch(`/bots/${id}/soul`, { soul: soulDraft }));
    if (result !== undefined) {
      setData((d) => (d ? { ...d, soul: soulDraft } : d));
      setSoulDraft(null);
    }
  };
  const importSkill = async () => {
    let files;
    try {
      files = await pickTextFiles({ multiple: false, accept: ".md,.markdown,.txt" });
    } catch (e) {
      itemAction.setError(e.message);
      return;
    }
    if (!files?.length) return;
    const skill = await itemAction.act(() => post("/skills", { content: files[0].content, source: files[0].name, botId: id }));
    if (skill?.id) setReviewId(skill.id);
  };

  const sectionCard = { background: "#FFFFFF", border: 0, borderRadius: "26px", padding: "24px", display: "flex", flexDirection: "column" };
  const h2 = { margin: 0, font: "600 22px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" };
  const ghost = { height: "40px", padding: "0 16px", background: "rgba(18,19,26,.06)", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: "#12131A" };
  const frame = { padding: "16px 18px", background: "#F6F6F3", border: 0, borderRadius: "18px", fontSize: "15px", lineHeight: "1.6", color: "#3D404A" };
  const visibleHistory = showAll ? history : history.slice(0, 8);

  const pillLink = { display: "flex", alignItems: "center", height: "44px", padding: "0 18px", background: "rgba(18,19,26,.06)", color: "#12131A", border: 0, borderRadius: "999px", fontWeight: "600", fontSize: "14px", cursor: "pointer", textDecoration: "none" };
  return (
    <Shell active="colmena" extraCss={css + MD_CSS}>
        <main style={{ maxWidth: "1180px", margin: "0 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header ref={headerRef} style={{ position: "sticky", top: stickTop + "px", zIndex: 3, background: "rgba(245,245,242,.92)", WebkitBackdropFilter: "blur(16px)", backdropFilter: "blur(16px)", padding: "40px clamp(20px, 4vw, 48px) 12px", display: "flex", flexDirection: "column", gap: "22px" }}>
            <a href={`/colmena/${encodeURIComponent(id)}`} onClick={(e) => { e.preventDefault(); navigate(`/colmena/${encodeURIComponent(id)}`); }} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px 0 10px", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "14px", fontWeight: "500", color: "#12131A" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              {"Colmena"}
            </a>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "22px", minWidth: 0 }}>
                <button type="button" className="rm-focus" onClick={() => setPortraitOpen(true)} aria-label={bot.portrait ? `Cambiar el retrato de ${bot.name}` : `Darle un retrato a ${bot.name}`} title={bot.portrait ? "Cambiar el retrato" : "Darle un retrato"}
                  style={{ position: "relative", flex: "none", padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
                  <BotPresence bot={bot} size={84} />
                  <span aria-hidden="true" style={{ position: "absolute", right: "-4px", bottom: "-4px", width: "30px", height: "30px", display: "grid", placeItems: "center", background: "#FFFFFF", borderRadius: "50%", color: "#12131A", boxShadow: "0 2px 6px rgba(18,19,26,.2)" }}><ImagePlus size={14} strokeWidth={2.4} /></span>
                </button>
                {portraitOpen ? <PortraitPicker bot={bot} onClose={() => setPortraitOpen(false)} onSaved={(portrait) => setData((d) => (d ? { ...d, portrait } : d))} /> : null}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
                  <h1 style={{ margin: 0, font: "600 clamp(44px, 6vw, 64px)/0.95 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>{bot.name}</h1>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "14px", color: "#5C606C" }}>
                    {bot.role ? <span style={{ fontSize: "16px" }}>{bot.role}</span> : null}
                    {waitingIn > 0 ? <a href="/" style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 12px", background: "#FFF4D1", color: "#8A5A00", borderRadius: "999px", fontWeight: "600" }}><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#FFC93C", animation: "halo 1.8s ease-out infinite" }} />Te espera en {plural(waitingIn, "sala", "salas")}</a> : null}
                    {rooms > 0 ? <span style={{ display: "flex", alignItems: "center", height: "30px", padding: "0 12px", background: "rgba(18,19,26,.05)", borderRadius: "999px" }}>En {plural(rooms, "sala", "salas")}</span> : null}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <a href={`/chat/${id}`} style={pillLink}>Hablar</a>
                <button type="button" onClick={duplicate} disabled={busy} style={{ ...pillLink, cursor: busy ? "wait" : "pointer" }}>Duplicar</button>
                <button type="button" onClick={save} aria-disabled={!dirty} aria-busy={busy} title={dirty ? `Guardar ${plural(changed.length, "cambio", "cambios")}` : "No hay cambios"} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 22px", background: dirty || savedNote ? "#12131A" : "rgba(18,19,26,.08)", color: dirty || savedNote ? "#FFFFFF" : "#8A8D96", border: 0, borderRadius: "999px", cursor: dirty ? (busy ? "wait" : "pointer") : "default", fontWeight: "600", fontSize: "14px" }}>{busy && dirty ? <Spinner size={14} /> : null}{savedNote ? "Cambios guardados ✓" : "Guardar cambios"}</button>
              </div>
            </div>
            <nav ref={tabsRef} aria-label="Secciones del perfil" style={{ alignSelf: "flex-start", display: "flex", flexWrap: "wrap", gap: "2px", padding: "4px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
              {TABS.map((t) => (
                <a key={t.id} href={`#${t.id}`} onClick={go(t.id)} aria-current={tab === t.id ? "location" : undefined} style={{ display: "flex", alignItems: "center", height: "40px", padding: "0 16px", borderRadius: "999px", fontSize: "14px", fontWeight: "600", color: "#12131A", transition: "all .2s ease", background: tab === t.id ? "#FFFFFF" : "transparent", boxShadow: tab === t.id ? "0 1px 3px rgba(18,19,26,.15)" : "none" }}>{t.label}</a>
              ))}
            </nav>
          </header>

          <div style={{ padding: "24px clamp(20px, 4vw, 48px) 56px", display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
            {error || loadError && !summary ? <Notice style={{ flex: "1 1 100%" }}>{error || loadError}</Notice> : null}

            <div style={{ flex: "3 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "24px" }}>
              <section id="rol" aria-labelledby="rol-t" style={{ ...sectionCard, gap: "14px", scrollMarginTop: "16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
                  <h2 id="rol-t" style={h2}>Rol e instrucciones</h2>
                  <button type="button" aria-expanded={editingRole} onClick={() => setEditingRole((v) => !v)} style={ghost}>{editingRole ? "Hecho" : "Editar"}</button>
                </div>
                {editingRole
                  ? <textarea aria-label="Instrucciones del bot" autoFocus maxLength={12000} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} style={{ ...frame, width: "100%", minHeight: "140px", fieldSizing: "content", resize: "vertical", boxShadow: "inset 0 0 0 1.5px rgba(18,19,26,.25)", outline: "none" }} />
                  : <div style={{ ...frame, whiteSpace: "pre-wrap" }}>{form.instructions || "Aún no tiene instrucciones. Pulsa Editar y cuéntale qué hace en el equipo."}</div>}
                <p style={{ margin: 0, fontSize: "13px", color: "#6B6F7A" }}>Escribe como se lo explicarías a un compañero nuevo. No hace falta saber de IA.</p>
              </section>

              <section aria-labelledby="alma-t" style={{ ...sectionCard, gap: "14px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <h2 id="alma-t" style={h2}>Personalidad</h2>
                    <p style={{ margin: 0, fontSize: "14px", color: "#6B6F7A" }} title="Se guarda como SOUL.md, el formato de OpenClaw">Su forma de ser y de trabajar. Si el bot quiere cambiarla, te lo pedirá en Hoy.</p>
                  </div>
                  {soulDraft === null ? <button type="button" onClick={() => setSoulDraft(data?.soul || "")} disabled={!data} style={ghost}>Editar</button> : null}
                </div>
                {soulPending ? <a href="/bandeja" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#FFF4D1", border: "0", borderRadius: "12px", fontSize: "14px" }}><span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#C98A00", flex: "none" }} /><span><strong>{bot.name} propone un cambio.</strong> Revísalo en Hoy.</span></a> : null}
                {soulDraft !== null ? (
                  <>
                    <textarea aria-label="Personalidad del bot" autoFocus value={soulDraft} maxLength={40000} onChange={(e) => setSoulDraft(e.target.value)} style={{ ...frame, width: "100%", minHeight: "260px", fieldSizing: "content", resize: "vertical", border: "1.5px solid #12131A", font: "400 13px/1.6 'Geist Mono', monospace", outlineColor: "#2F6BFF" }} />
                    {soulAction.error ? <Notice>{soulAction.error}</Notice> : null}
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
                      <button type="button" onClick={() => { setSoulDraft(null); soulAction.setError(null); }} style={{ ...ghost, height: "44px" }}>Cancelar</button>
                      <button type="button" onClick={saveSoul} disabled={soulAction.busy || soulDraft === (data?.soul || "")} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: 0, borderRadius: "999px", cursor: soulAction.busy ? "wait" : "pointer", fontWeight: "600", fontSize: "14px", opacity: soulDraft === (data?.soul || "") ? 0.55 : 1 }}>{soulAction.busy ? <Spinner size={14} /> : null}Guardar alma</button>
                    </div>
                  </>
                ) : data?.soul ? (
                  <div className="colmena-soul-md" style={{ ...frame, maxHeight: "300px", overflowY: "auto" }} tabIndex={0} aria-label="Personalidad del bot"><ReactMarkdown>{data.soul}</ReactMarkdown></div>
                ) : (
                  <div style={{ ...frame, color: "#6B6F7A" }}>{data ? "Aún no tiene personalidad escrita. Pulsa Editar para darle una forma de ser." : loadError ? `No se pudo cargar su personalidad: ${loadError}` : <SkeletonLines lines={4} />}</div>
                )}
              </section>

              <section aria-labelledby="pers-t" style={{ ...sectionCard, gap: "18px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h2 id="pers-t" style={h2}>Personalidad</h2>
                  <p style={{ margin: 0, fontSize: "14px", color: "#6B6F7A" }}>Cómo habla y cuánto se arriesga. Mueve los controles y pruébalo en privado.</p>
                </div>
                {SLIDERS.map((s) => (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "96px 1fr 96px", alignItems: "center", gap: "14px" }}>
                    <span style={{ fontSize: "14px", color: "#5C606C", textAlign: "right" }}>{s.left}</span>
                    <input type="range" min="0" max="100" step="5" value={form.personality[s.id]} onChange={(e) => set("personality", { ...form.personality, [s.id]: Number(e.target.value) })} aria-label={s.aria} style={{ width: "100%", height: "44px", accentColor: color, cursor: "pointer" }} />
                    <span style={{ fontSize: "14px", color: "#5C606C" }}>{s.right}</span>
                  </div>
                ))}
              </section>

              <section id="habilidades" aria-labelledby="hab-t" style={{ ...sectionCard, gap: "14px", scrollMarginTop: "16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
                  <h2 id="hab-t" style={h2}>Habilidades</h2>
                  <button type="button" onClick={importSkill} disabled={itemAction.busy} title="Importar un SKILL.md" style={{ ...ghost, display: "flex", alignItems: "center", gap: "6px" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Añadir</button>
                </div>
                {itemAction.error ? <Notice>{itemAction.error}</Notice> : null}
                {pending.map((s) => {
                  const copy = pendingCopy(s);
                  return (
                    <div key={s.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px", padding: "16px", border: "0", borderRadius: "14px", background: "#E1F4EC" }}>
                      <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ alignSelf: "flex-start", padding: "4px 8px", background: "#12131A", color: "#FFFFFF", borderRadius: "6px", font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>{copy.tag}</span>
                        <strong style={{ fontSize: "16px" }}>{s.name}</strong>
                        <span style={{ fontSize: "14px", lineHeight: "1.45", color: "#3D404A" }}>{copy.text}</span>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}><button type="button" onClick={() => setReviewId(s.id)} style={{ height: "44px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: 0, borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>Revisar pasos</button><button type="button" disabled={itemAction.busy} onClick={() => itemAction.act(() => patch(`/skills/${s.id}`, { status: "active" }))} style={{ height: "44px", padding: "0 14px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: itemAction.busy ? "wait" : "pointer", fontWeight: "600", fontSize: "14px" }}>Activar</button></div>
                    </div>
                  );
                })}
                {installed.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "10px" }}>
                    {installed.map((s) => (
                      <div key={s.id} style={{ position: "relative", display: "flex" }}>
                        <button type="button" onClick={() => setReviewId(s.id)} aria-label={`${s.name}: ${skillLine(s)}. Ver pasos`} style={{ flex: "1", minWidth: 0, padding: "14px 52px 14px 14px", border: s.pinned ? "1.5px solid #12131A" : "1px solid rgba(18,19,26,.06)", borderRadius: "12px", display: "flex", flexDirection: "column", gap: "4px", background: s.status === "stale" ? "#F6F6F3" : "#FFFFFF", textAlign: "left", cursor: "pointer", opacity: ["disabled", "archived"].includes(s.status) ? 0.6 : 1 }}>
                          <strong style={{ fontSize: "15px" }}>{s.name}</strong>
                          <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{skillLine(s)}</span>
                          {s.status === "stale" || s.status === "archived" ? <span style={{ alignSelf: "flex-start", padding: "2px 7px", background: s.status === "stale" ? "#FFF4D1" : "#F4F4F0", borderRadius: "5px", fontSize: "12px", fontWeight: "600", color: "#12131A" }}>{s.status === "stale" ? "Sin usar · ábrela para reactivarla" : "Archivada · ábrela para reactivarla"}</span> : null}
                        </button>
                        {learning ? <button type="button" onClick={() => togglePin(s)} disabled={itemAction.busy} aria-pressed={s.pinned ? "true" : "false"} aria-label={s.pinned ? `Dejar de fijar ${s.name}` : `Fijar ${s.name}: nunca se archivará`} title={s.pinned ? "Fijada: nunca se archiva" : "Fijar: nunca se archivará por falta de uso"} style={{ position: "absolute", top: "8px", right: "8px", width: "36px", height: "36px", display: "grid", placeItems: "center", background: s.pinned ? "#12131A" : "transparent", color: s.pinned ? "#FFFFFF" : "#6B6F7A", border: s.pinned ? "0" : "1px solid rgba(18,19,26,.1)", borderRadius: "9px", cursor: "pointer" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4h6l-1 6 4 3H6l4-3zM12 13v7" /></svg></button> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {installed.some((s) => s.status === "stale" || s.status === "archived") ? <p style={{ margin: 0, fontSize: "13px", color: "#6B6F7A" }}>Las que no usa en un mes dejan de ofrecerse y a los tres meses se archivan; nunca se borran. Fija las que quieras conservar siempre.</p> : null}
                {!pending.length && !installed.length ? <p style={{ margin: 0, fontSize: "14px", color: "#6B6F7A" }}>Aún no tiene habilidades. Las aprenderá al repetir tareas, o puedes añadir un SKILL.md.</p> : null}
              </section>

              <section id="memoria" aria-labelledby="mem-t" style={{ ...sectionCard, gap: "6px", scrollMarginTop: "16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", paddingBottom: "8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <h2 id="mem-t" style={h2}>Lo que {bot.name} recuerda</h2>
                    <p style={{ margin: 0, fontSize: "14px", color: "#6B6F7A" }}>Puedes corregir o borrar cualquier recuerdo. Los compartidos los ve todo el equipo.</p>
                  </div>
                </div>
                {learning?.memory ? (
                  <div role="group" aria-label="Uso de la memoria" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: "10px", paddingBottom: "10px" }}>
                    {METERS.map((k) => {
                      const u = learning.memory[k.id];
                      if (!u) return null;
                      const tone = u.percent >= 90 ? "#E5484D" : u.percent >= 70 ? "#C98A00" : "#0B8A5F";
                      const name = k.id === "bot" ? `Propia de ${bot.name}` : k.label;
                      return (
                        <div key={k.id} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "10px 12px", background: "#F6F6F3", border: "1px solid rgba(18,19,26,.06)", borderRadius: "12px" }}>
                          <span style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13px" }}><strong>{name}</strong><span style={{ font: "500 12px/1.4 'Geist Mono', monospace", color: "#6B6F7A" }}>{u.label}</span></span>
                          <span role="meter" aria-label={`Memoria: ${name}`} aria-valuemin={0} aria-valuemax={u.limit} aria-valuenow={u.used} style={{ height: "6px", background: "rgba(18,19,26,.06)", borderRadius: "3px", overflow: "hidden" }}><span style={{ display: "block", width: `${Math.min(100, u.percent)}%`, height: "100%", background: tone }} /></span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {learning?.memory && METERS.some((k) => learning.memory[k.id]?.percent >= 90) ? <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#6B6F7A" }}>Casi llena: al aprender algo nuevo fusionará o quitará recuerdos parecidos.</p> : null}
                {memories.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "56px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                    <span style={{ flex: "1", fontSize: "15px", lineHeight: "1.4" }}>{m.text}</span>
                    <span style={{ fontSize: "12px", color: "#6B6F7A", whiteSpace: "nowrap" }}>{memoryLabel(m)}</span>
                    {m.review ? <button type="button" aria-label="Confirmar este recuerdo" title="Es correcto" disabled={itemAction.busy} onClick={() => itemAction.act(() => patch(`/memories/${m.id}`, { review: false }))} style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "10px", cursor: "pointer", color: "#0B8A5F" }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg></button> : null}
                    <button type="button" aria-label="Borrar este recuerdo" disabled={itemAction.busy} onClick={() => later({ id: "memory:" + m.id, keys: ["memory:" + m.id], text: "Recuerdo borrado", error: "No se pudo borrar", run: () => itemAction.act(() => del(`/memories/${m.id}`)) })} style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "10px", cursor: "pointer", color: "#6B6F7A" }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg></button>
                  </div>
                ))}
                {!memories.length ? <p style={{ margin: 0, padding: "14px 0 4px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14px", color: "#6B6F7A" }}>Aún no recuerda nada. Lo que le cuentes en el chat y lo que acordéis aparecerá aquí.</p> : null}
              </section>

              <Journey bot={bot} sectionStyle={sectionCard} h2={h2} ghost={ghost} onOpenSkill={setReviewId} />

              <section id="historial" aria-labelledby="his-t" style={{ ...sectionCard, gap: "6px", scrollMarginTop: "16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", paddingBottom: "8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <h2 id="his-t" style={h2}>Historial</h2>
                    <p style={{ margin: 0, fontSize: "14px", color: "#6B6F7A" }}>Misiones y conversaciones en las que ha trabajado.</p>
                  </div>
                  <a href="/misiones" style={{ ...ghost, display: "flex", alignItems: "center" }}>Misiones</a>
                </div>
                {visibleHistory.map((m) => {
                  const taught = learnedBy?.[m.id];
                  const row = (
                  <a key={m.id} href={m.conversation ? roomUrl(m) : missionUrl(m)} style={{ flex: "1", minWidth: 0, display: "flex", alignItems: "center", gap: "12px", minHeight: "56px", borderTop: taught ? "0" : "1px solid rgba(18,19,26,.06)" }}>
                    <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "15px", lineHeight: "1.4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title || m.prompt}</span>
                      <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{m.conversation ? "Chat" : m.room ? `#${m.room}` : m.mode === "debate" ? "Debate" : m.mode === "equipo" ? "Sala de equipo" : "Encargo"}</span>
                    </span>
                    <span style={{ padding: "4px 8px", borderRadius: "6px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap", ...(MISSION_PILL[m.status] || MISSION_PILL.completed) }}>{m.statusLabel || MISSION_LABEL[m.status] || m.status}</span>
                    <span style={{ fontSize: "12px", color: "#6B6F7A", whiteSpace: "nowrap", minWidth: "44px", textAlign: "right" }}>{shortDate(m.updatedAt || m.createdAt)}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8C91A0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </a>
                  );
                  if (!taught) return row;
                  // Something was learned here: «Olvidar lo aprendido aquí» next to the row.
                  return (
                    <div key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                      {row}
                      <span style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "8px", flexBasis: "100%", justifyContent: "flex-end" }}>
                        <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{[taught.memories ? plural(taught.memories, "recuerdo", "recuerdos") : null, taught.skills ? plural(taught.skills, "habilidad", "habilidades") : null].filter(Boolean).join(" y ") + " salieron de aquí"}</span>
                        <ForgetButton missionId={m.id} title={m.title || m.prompt} variant="row" />
                      </span>
                    </div>
                  );
                })}
                {history.length > 8 ? <button type="button" onClick={() => setShowAll((v) => !v)} style={{ ...ghost, alignSelf: "flex-start", marginTop: "8px" }}>{showAll ? "Ver menos" : `Ver las ${history.length}`}</button> : null}
                {!history.length ? <p style={{ margin: 0, padding: "14px 0 4px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14px", color: "#6B6F7A" }}>Aún no ha trabajado en ninguna misión. <a href={`/chat/${id}`} style={{ textDecoration: "underline" }}>Pídele algo en el chat.</a></p> : null}
              </section>
            </div>

            <div style={{ flex: "2 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: "24px" }}>
              <section aria-labelledby="aut-t" style={{ background: "#FFFFFF", border: "0", borderRadius: "26px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h2 id="aut-t" style={h2}>Autonomía</h2>
                  <p style={{ margin: 0, fontSize: "14px", color: "#6B6F7A" }}>Cuánta libertad tiene cuando nadie le mira.</p>
                </div>
                <div role="radiogroup" aria-label="Nivel de autonomía" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {AUTONOMY.map((l) => {
                    const on = l.id === form.autonomy;
                    return (
                      <button key={l.id} type="button" role="radio" aria-checked={on ? "true" : "false"} onClick={() => set("autonomy", l.id)} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: "12px", alignItems: "start", padding: "14px 16px", textAlign: "left", borderRadius: "18px", cursor: "pointer", border: "0", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 0 0 2px #12131A" : "inset 0 0 0 1px rgba(18,19,26,.08)", color: "#12131A" }}>
                        <span style={{ width: "20px", height: "20px", marginTop: "1px", borderRadius: "50%", border: "0", display: "grid", placeItems: "center" }}><span style={{ width: "10px", height: "10px", borderRadius: "50%", background: on ? "#12131A" : "transparent" }} /></span>
                        <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}><strong style={{ fontSize: "15px" }}>{l.title}</strong><span style={{ fontSize: "13px", lineHeight: "1.45", color: "#5C606C" }}>{l.desc}</span></span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "6px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>Siempre pide permiso para</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {RED_LINES.map((r) => <span key={r} style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 12px", background: "#F4F4F0", color: "#12131A", borderRadius: "999px", fontSize: "13px", fontWeight: 500 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /></svg>{r}</span>)}
                  </div>
                </div>
              </section>

              <StandingOrdersCard bot={bot} />

              <section aria-labelledby="cer-t" style={{ ...sectionCard, gap: "16px" }}>
                <h2 id="cer-t" style={h2}>Cerebro y lugar de trabajo</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>Forma de pensar</span>
                  <div role="group" aria-label="Forma de pensar" style={{ display: "flex", gap: "4px", padding: "4px", background: "#F4F4F0", borderRadius: "12px" }}>
                    {THINKING.map((t) => {
                      const on = form.thinking === t.id;
                      return <button key={t.id} type="button" aria-pressed={on ? "true" : "false"} onClick={() => set("thinking", t.id)} style={on ? { flex: "1", height: "40px", border: 0, borderRadius: "9px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontWeight: "600", fontSize: "14px" } : { flex: "1", height: "40px", border: 0, borderRadius: "9px", background: "transparent", cursor: "pointer", fontSize: "14px" }}>{t.label}</button>;
                    })}
                  </div>
                  <span style={{ fontSize: "13px", color: "#6B6F7A" }}>Profundo tarda más y cuesta más, pero razona mejor con números complejos.</span>
                  {bot?.model?.label ? (
                    <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#3D404A" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", font: "600 12px/1 'Geist Mono', monospace", padding: "5px 8px", background: "#FFF4D1", border: "0", borderRadius: "6px", color: "#12131A" }}><ProviderMark engine={bot.model.engine || engineOfModel(bot.model.slug)} tile={false} size={12} />{bot.model.label}</span>
                      {`Lo elige Colmena porque ${bot.model.reason}, en la versión más alta de tu plan.`}
                    </span>
                  ) : null}
                </div>
                <VoicePicker bot={bot} onSaved={(voice) => setData((d) => (d ? { ...d, voice } : d))} />
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>Dónde trabaja</span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                    {[
                      { id: "local", title: "Este ordenador", desc: "Abre tus archivos y programas locales" },
                      { id: "nube", title: "En la nube", desc: "Próximamente · hoy trabaja en este ordenador", soon: true },
                    ].map((o) => {
                      const on = form.location === o.id;
                      return (
                        <button key={o.id} type="button" aria-pressed={on ? "true" : "false"} aria-disabled={o.soon ? "true" : undefined} onClick={() => { if (!o.soon) set("location", o.id); }} style={on ? { padding: "12px", textAlign: "left", background: "#E1F4EC", border: "2px solid #0B8A5F", borderRadius: "12px", cursor: "pointer", display: "flex", flexDirection: "column", gap: "4px" } : { padding: "12px", textAlign: "left", background: "#FFFFFF", border: "0", borderRadius: "12px", cursor: o.soon ? "not-allowed" : "pointer", display: "flex", flexDirection: "column", gap: "4px" }}>
                          <strong style={{ fontSize: "14px", color: o.soon ? "#6B6F7A" : undefined }}>{o.title}</strong>
                          <span style={{ fontSize: "12px", lineHeight: "1.4", color: on ? "#3D404A" : "#6B6F7A" }}>{o.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section id="herramientas" aria-labelledby="her-t" style={{ ...sectionCard, gap: "4px", scrollMarginTop: "16px" }}>
                <h2 id="her-t" style={{ ...h2, margin: "0 0 10px" }}>Herramientas y permisos</h2>
                <span style={{ fontSize: "14px", fontWeight: "600", paddingBottom: "6px" }}>Qué puede usar</span>
                {CAPABILITIES.map((c) => {
                  const soon = c.id === "ordenador" && !computerReady;
                  const on = !soon && Boolean(caps[c.id]);
                  return (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", minHeight: "54px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "15px" }}>{c.label}</span>
                        <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{soon ? "Funciona con Colmena abierta en el escritorio" : c.desc}</span>
                      </span>
                      {soon
                        ? <button type="button" role="switch" aria-checked="false" aria-disabled="true" aria-label={`${c.label}: próximamente`} title="Próximamente" style={{ width: "52px", height: "30px", flex: "none", padding: "3px", background: "rgba(18,19,26,.1)", border: "0", borderRadius: "15px", cursor: "not-allowed", display: "flex", justifyContent: "flex-start", opacity: 0.6 }}><span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.3)" }} /></button>
                        : <Switch on={on} label={c.label} disabled={!learning || capAction.busy} onClick={() => { if (learning && !capAction.busy) setCapability(c.id, !on); }} />}
                    </div>
                  );
                })}
                {capAction.error ? <Notice>{capAction.error}</Notice> : null}
                <span style={{ fontSize: "14px", fontWeight: "600", padding: "14px 0 6px" }}>Permisos por app</span>
                {TOOL_KEYS.map((k) => {
                  const c = conn(k);
                  const label = c?.name || TOOL_LABEL[k];
                  return (
                    <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", minHeight: "54px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "15px" }}>{label}</span>
                        {c && !c.connected ? <a href="/ajustes/conexiones" style={{ fontSize: "12px", color: "#6B6F7A", textDecoration: "underline" }}>Conectar</a> : null}
                      </span>
                      <AccessPicker value={form.tools[k]} label={label} onChange={(v) => set("tools", { ...form.tools, [k]: v })} />
                    </div>
                  );
                })}
              </section>

              <section id="equipo" aria-labelledby="eq-t" style={{ ...sectionCard, gap: "16px", scrollMarginTop: "16px" }}>
                <h2 id="eq-t" style={h2}>Equipo y canales</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>Puede pedir ayuda a</span><span style={{ fontSize: "12px", color: "#6B6F7A", marginTop: "-4px" }}>Pulsa para marcar con quién puede repartir su trabajo.</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {others.map((b) => {
                      const on = form.helpers.includes(b.id);
                      return (
                        <button key={b.id} type="button" aria-pressed={on ? "true" : "false"} aria-label={`${b.name}: ${on ? "puede pedirle ayuda" : "no"}`} onClick={() => set("helpers", on ? form.helpers.filter((x) => x !== b.id) : [...form.helpers, b.id])} style={on
                          ? { display: "flex", alignItems: "center", gap: "6px", height: "38px", padding: "0 14px 0 10px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }
                          : { display: "flex", alignItems: "center", gap: "6px", height: "38px", padding: "0 14px 0 10px", background: "rgba(18,19,26,.05)", border: "0", borderRadius: "999px", fontSize: "13px", fontWeight: "600", color: "#12131A", cursor: "pointer" }}>
                          <BotAvatar bot={b} size={16} style={on ? undefined : { opacity: 0.6 }} />{b.name}{on ? <Check size={13} strokeWidth={2.6} aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                    {!others.length ? <span style={{ fontSize: "13px", color: "#6B6F7A" }}>Aún no hay más bots en el equipo.</span> : null}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontSize: "15px" }}>Delegar sin preguntarte</span><span style={{ fontSize: "13px", color: "#6B6F7A" }}>Si está apagado, te avisa antes de pasar trabajo</span></span>
                  <Switch on={form.delegateFreely} label="Delegar sin preguntarte" onClick={() => set("delegateFreely", !form.delegateFreely)} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", paddingTop: "4px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600", paddingBottom: "6px" }}>Dónde puedes hablarle</span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", minHeight: "50px", borderTop: "1px solid rgba(18,19,26,.06)" }}><span style={{ fontSize: "15px" }}>Colmena</span><Switch on label="Colmena" disabled title="Siempre activo" onClick={() => {}} /></div>
                  {CHANNELS.map((ch) => {
                    if (ch.soon) {
                      return (
                        <div key={ch.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", minHeight: "50px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                          <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontSize: "15px" }}>{ch.label}</span><span style={{ fontSize: "12px", color: "#6B6F7A" }}>Próximamente</span></span>
                          <button type="button" role="switch" aria-checked="false" aria-disabled="true" aria-label={`${ch.label}: próximamente`} title="Próximamente" style={{ width: "52px", height: "30px", flex: "none", padding: "3px", background: "rgba(18,19,26,.1)", border: "0", borderRadius: "15px", cursor: "not-allowed", display: "flex", justifyContent: "flex-start", opacity: 0.6 }}><span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.3)" }} /></button>
                        </div>
                      );
                    }
                    const connected = Boolean(conn(ch.connector)?.connected);
                    const on = Boolean(form.channels[ch.id]);
                    const usable = connected || on;
                    return (
                      <div key={ch.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", minHeight: "50px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                        <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "15px" }}>{ch.label}</span>
                          {!connected ? <a href="/ajustes/conexiones" style={{ fontSize: "12px", color: "#6B6F7A", textDecoration: "underline" }}>{ch.hint}</a> : null}
                        </span>
                        <Switch on={on} label={usable ? ch.label : `${ch.label}: conectar en Ajustes`} onClick={() => (usable ? set("channels", { ...form.channels, [ch.id]: !on }) : navigate("/ajustes/conexiones"))} />
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </main>
      {reviewId ? <SkillReview skillId={reviewId} onClose={closeReview} /> : null}
    </Shell>
  );
}
