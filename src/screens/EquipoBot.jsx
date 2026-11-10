import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, ChevronDown, ImagePlus, Pin } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import { shapeOf } from "../components/v2/Presence.jsx";
import { portraitOf } from "../lib/bots.js";
import PortraitPicker from "../components/team/PortraitPicker.jsx";
import SkillReview from "../components/team/SkillReview.jsx";
import Journey from "../components/team/Journey.jsx";
import StandingOrdersCard from "../components/interaction/StandingOrders.jsx";
import ForgetButton from "../components/interaction/Forget.jsx";
import { VoicePicker } from "../components/interaction/VoicePicker.jsx";
import DocHistory from "../components/v2/team/DocHistory.jsx";
import { VerdictList, VerdictMark } from "../components/v2/team/Verdict.jsx";
import { LimitLine } from "../components/v2/LimitNotice.jsx";
import { WithMark, engineOfModel } from "../components/v2/ProviderMark.jsx";
import { TOOL_KEYS, TOOL_LABEL, longDay, monthName, shortDay } from "../components/team/common.jsx";
import { AUTONOMY, INK, LINE, More, Seg, Shape, TEXT2, TEXT3, Toggle, card, dark, h2, outline, quiet, sub } from "../components/v3/team/parts.jsx";
import { formatTokens } from "../components/settings/format.jsx";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import { useActivity } from "../lib/liveStore.js";
import { del, get, patch, pickTextFiles, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { missionUrl, roomUrl, shortDate } from "../lib/format.js";
import { later, reversible, useHidden } from "../lib/undoToast.js";
import { useExpert } from "../lib/expert.js";

// Colmena 3 · «Ficha de un bot» (design/V3Bot.dc.html): a header tinted with the bot's colour
// (its shape, what it does and what it is doing now, «Pausar» and «Hablar con …»), the section
// tabs and six cards — Cómo trabaja, Apps, Habilidades, Memoria, Personalidad, Uso. Everything
// the old detailed editor (screens/Bot.jsx) offered lives in one of them: instructions, SOUL,
// sliders, voice, standing orders, what it learned, history, helpers, channels, duplicate.
// Changes apply at once and offer a 10 s «Deshacer»; nothing asks for confirmation.

const UNDO_MS = 10000;
const BLUE = "#1F4FD1";
const SECTIONS = [["como", "Cómo trabaja"], ["apps", "Apps"], ["habilidades", "Habilidades"], ["memoria", "Memoria"], ["personalidad", "Personalidad"], ["uso", "Uso"]];
const RED_LINES = ["enviar fuera", "mover dinero", "publicar", "borrar de verdad", "escribir contraseñas", "instalar programas"];
const THINKING = [["rapido", "Rápido", "Responde enseguida. Para tareas cortas y conocidas."], ["equilibrado", "Equilibrado", "Piensa lo justo. Lo mejor para casi todo."], ["profundo", "A fondo", "Se toma su tiempo y gasta más. Para análisis y decisiones importantes."]];
const SLIDERS = [["tono", "Formal", "Cercano", "Tono, de formal a cercano"], ["detalle", "Breve", "Detallado", "Nivel de detalle, de breve a detallado"], ["riesgo", "Prudente", "Atrevido", "Riesgo, de prudente a atrevido"]];
const STATE = { trabaja: "trabajando", espera: "te espera", pausado: "en pausa", bloqueado: "atascado", libre: "libre", limitado: "en su límite de uso" };
// «Apps que usa»: the mark drawn on the board and what each level lets it do.
const APP_MARK = { correo: "@", calendario: "31", carpeta: "▤", hojas: "▦", chat: "#", erp: "€" };
const APP_HINT = {
  correo: { lee: "Lee tu correo para buscar lo que necesita.", escribe: "Lee y prepara borradores. Enviar te lo pregunta.", pide: "Lee y te pide permiso antes de escribir." },
  calendario: { lee: "Ve tu agenda para proponer huecos.", escribe: "Ve tu agenda y prepara citas. Invitar a otros te lo pregunta.", pide: "Ve tu agenda y te pide permiso antes de tocarla." },
  carpeta: { lee: "Lee los documentos de la carpeta compartida.", escribe: "Lee y guarda documentos en la carpeta compartida.", pide: "Lee y te pide permiso antes de guardar." },
  hojas: { lee: "Lee tus hojas de cálculo.", escribe: "Lee y actualiza tus hojas de cálculo.", pide: "Lee y te pide permiso antes de cambiar nada." },
  chat: { lee: "Lee el chat del equipo.", escribe: "Lee y prepara mensajes. Publicar te lo pregunta.", pide: "Lee y te pide permiso antes de escribir." },
  erp: { lee: "Consulta el ERP.", escribe: "Consulta y prepara cambios en el ERP. Lo que mueve dinero te lo pregunta.", pide: "Consulta y te pide permiso antes de cambiar nada." },
};
const CAPABILITIES = [["apps", "Usar las apps conectadas", "Según el acceso de cada una, arriba."], ["web", "Buscar en la web", "Leer páginas públicas de internet."], ["carpetas", "Carpetas de este ordenador", "Las que le hayas dado."], ["ordenador", "Usar el ordenador", "Ver la pantalla y usar programas, con tu permiso."]];
const CHANNELS = [["correo", "Correo", "correo"], ["chat", "Chat del equipo", "chat"], ["movil", "Mensajes del móvil", null]];
const SOURCE = { importado: "De ChatGPT", dijiste: "Se lo dijiste", dedujo: "Lo dedujo", acuerdo: "Lo acordasteis", documento: "De un documento" };
const MISSION_LABEL = { running: "En curso", planning: "Planificando", queued: "En cola", waiting: "Te espera", awaiting_plan: "Plan por aprobar", awaiting_choice: "Elige propuesta", blocked: "Atascada", paused: "En pausa", completed: "Terminada", cancelled: "Cancelada" };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const uses = (s) => (s.uses ? `Usada ${s.uses === 1 ? "1 vez" : `${s.uses} veces`}` : "Aún sin usar");
const MD_CSS = ".v3-soul-md{font-size:15px;line-height:1.6;color:#3D404A}.v3-soul-md>*:first-child{margin-top:0}.v3-soul-md>*:last-child{margin-bottom:0}.v3-soul-md h1{font:600 18px/1.25 'Bricolage Grotesque',sans-serif;margin:0 0 8px;color:#12131A}.v3-soul-md h2,.v3-soul-md h3{font:600 15px/1.3 'Bricolage Grotesque',sans-serif;margin:14px 0 6px;color:#12131A}.v3-soul-md p{margin:0 0 10px}.v3-soul-md ul{margin:0 0 10px;padding-left:20px}.v3-soul-md hr{border:0;border-top:1px solid rgba(18,19,26,.06);margin:14px 0}";

function skillNote(s) {
  if (s.status === "pending") return s.origin === "imported" ? `Importada el ${longDay(s.createdAt)} · espera tu visto bueno` : s.origin === "shared" ? "Compartida · espera tu visto bueno" : `Nueva · la aprendió ${s.learnedFrom || `el ${longDay(s.createdAt)}`}`;
  if (s.status === "disabled") return `Desactivada · ${uses(s).toLowerCase()}`;
  if (s.status === "stale") return "Sin usar desde hace un mes · ya no la ofrece";
  if (s.status === "archived") return "Archivada por falta de uso · ábrela para reactivarla";
  return uses(s) + (s.origin === "learned" ? ` · aprendida en ${monthName(s.createdAt)}` : "");
}
const memoryNote = (m) => (m.scope === "equipo" ? "Lo sabe todo el equipo" : (SOURCE[m.source] || m.sourceLabel || "Lo recuerda") + (m.createdAt ? ` · ${shortDay(m.createdAt)}` : ""));

export default function EquipoBot({ params = {}, query = {} }) {
  const id = params.bot;
  const store = useStore();
  const { bots, ready, connectors = [], approvals = [], missions = [], ai = null, settings = {} } = store;
  const activity = useActivity(id);
  const [expert] = useExpert();
  const { data, error: loadError, setData } = useResource(id ? `/bots/${encodeURIComponent(id)}` : null);
  const { data: learning, setData: setLearning } = useResource(id ? `/bots/${encodeURIComponent(id)}/learning` : null);
  const { data: learnedBy } = useResource(id ? `/bots/${encodeURIComponent(id)}/learned` : null);
  const { data: versions } = useResource(id ? `/bots/${encodeURIComponent(id)}/soul/versions` : null);
  const summary = bots.find((b) => b.id === id);
  const bot = data && data.id === id ? { ...summary, ...data } : summary || null;
  const { act, busy, error } = useAction();
  const [reviewId, setReviewId] = useState(query?.skill || null);
  const [portrait, setPortrait] = useState(false);
  const [tab, setTab] = useState("como");
  const [usage, setUsage] = useState(null);

  useEffect(() => { if (query?.skill) setReviewId(query.skill); }, [query?.skill]);
  useEffect(() => {
    let alive = true;
    get(`/usage/history?days=${Math.max(7, new Date().getDate())}`).then((d) => alive && setUsage(d), () => alive && setUsage({ bots: [], total: 0 }));
    return () => { alive = false; };
  }, [id]);

  // Section tabs: a click scrolls there; the scroll-spy keeps the underline in sync.
  const lock = useRef(0);
  useEffect(() => {
    if (!bot) return undefined;
    const els = SECTIONS.map(([s]) => document.getElementById(s)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      if (Date.now() < lock.current) return;
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setTab(top.target.id);
    }, { rootMargin: "-15% 0px -60% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [Boolean(bot), id]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (target) => (e) => {
    e?.preventDefault?.();
    setTab(target);
    lock.current = Date.now() + 800;
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    const hash = location.hash.slice(1);
    if (bot && hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 80);
  }, [Boolean(bot), id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bot) {
    return (
      <Shell active="equipo">
        <main style={{ maxWidth: "1080px", margin: "0 auto", padding: "44px clamp(20px, 4vw, 48px)", display: "flex", flexDirection: "column", gap: "16px" }}>
          <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: TEXT2 }}><a href="/equipo" style={{ color: TEXT2 }}>{"Equipo"}</a></nav>
          {ready ? (
            <>
              <h1 style={{ margin: "0", font: "600 44px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{"No encontramos a este bot"}</h1>
              <p style={{ margin: "0", fontSize: "16px", color: TEXT2 }}>{"Puede que ya no esté en tu equipo."}{loadError ? ` (${loadError})` : ""}</p>
              <a href="/equipo" style={{ alignSelf: "flex-start", height: "44px", padding: "0 20px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "15px", fontWeight: "600" }}>{"Volver a Equipo"}</a>
            </>
          ) : <p style={{ margin: "0", fontSize: "15px", color: TEXT3 }}>{"Cargando la ficha…"}</p>}
        </main>
      </Shell>
    );
  }

  const color = bot.color || "#C9CBD1";
  const work = bot.status === "trabaja";
  const verb = activity?.verb;
  const now = work && verb ? "ahora: " + verb : STATE[bot.status] && bot.status !== "libre" ? "ahora: " + STATE[bot.status] : null;
  const live = missions.filter((m) => ["running", "queued", "planning"].includes(m.status) && [...(m.botIds || []), ...(m.chosenBotIds || [])].includes(bot.id));
  const merge = (r) => { if (r && typeof r === "object") setData((d) => (d ? { ...d, ...r } : d)); return r; };
  // One change to the bot, applied at once, with «Deshacer» for 10 s (the opposite patch).
  const change = async (body, before, text) => {
    const r = await act(() => patch(`/bots/${encodeURIComponent(bot.id)}`, body));
    if (r === undefined) return;
    merge(r);
    if (text) reversible({ id: "bot-change:" + bot.id + ":" + Object.keys(body).join(","), text, ms: UNDO_MS, undo: async () => merge(await patch(`/bots/${encodeURIComponent(bot.id)}`, before)) });
  };
  const pause = () => act(async () => {
    for (const m of live) await post(`/missions/${m.id}/control`, { action: "pause" });
    reversible({ id: "bot-pause:" + bot.id, text: `${bot.name} ha parado su trabajo`, ms: UNDO_MS, undo: async () => { for (const m of live) await post(`/missions/${m.id}/control`, { action: "resume" }); } });
  });
  const duplicate = async () => { const copy = await act(() => post(`/bots/${encodeURIComponent(bot.id)}/duplicate`)); if (copy?.id) navigate(`/equipo/${copy.id}`); };
  const retire = () => later({ id: "bot:" + bot.id, keys: ["bot:" + bot.id], text: `${bot.name} sale del equipo`, ms: UNDO_MS, error: "No se pudo retirar", run: async () => { await act(() => patch(`/bots/${encodeURIComponent(bot.id)}`, { enabled: false })); navigate("/equipo"); } });
  const tint = `color-mix(in srgb, ${color} 14%, #FFFFFF)`;
  const sh = shapeOf(bot);

  return (
    <Shell active="equipo" extraCss={MD_CSS}>
      <header style={{ display: "flex", flexDirection: "column", gap: "22px", padding: "30px clamp(20px, 4vw, 48px) 0", background: tint }}>
        <nav aria-label="Miga" style={{ maxWidth: "1080px", width: "100%", margin: "0 auto", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: TEXT2 }}>
          <a href="/equipo" style={{ color: TEXT2 }}>{"Equipo"}</a>
          <span aria-hidden="true">{"›"}</span>
          <span style={{ color: INK, fontWeight: "500" }}>{bot.name}</span>
        </nav>
        <div style={{ maxWidth: "1080px", width: "100%", margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "20px 24px" }}>
          <button type="button" onClick={() => setPortrait(true)} aria-label={portraitOf(bot) ? `Cambiar el retrato de ${bot.name}` : `Darle un retrato a ${bot.name}`} title={portraitOf(bot) ? "Cambiar el retrato" : "Darle un retrato"} style={{ position: "relative", flex: "none", padding: "0", border: "0", background: "transparent", cursor: "pointer" }}>
            <span aria-hidden="true" style={{ display: "block", width: "92px", height: "92px", background: portraitOf(bot) ? `${color} url("${portraitOf(bot)}") center / cover no-repeat` : color, clipPath: sh.clip, borderRadius: sh.radius, animation: work ? "breathe 2.8s ease-in-out infinite" : "none", boxShadow: `0 18px 40px -16px ${color}99`, opacity: bot.status === "libre" || bot.status === "pausado" ? 0.85 : 1 }} />
            {expert ? <span aria-hidden="true" style={{ position: "absolute", right: "-4px", bottom: "-4px", width: "28px", height: "28px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 6px rgba(18,19,26,.2)" }}><ImagePlus size={13} strokeWidth={2.4} /></span> : null}
          </button>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
            <h1 style={{ margin: "0", font: "600 52px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{bot.name}</h1>
            <span style={{ fontSize: "16px", color: "#3D404A" }}>{[bot.role, now].filter(Boolean).join(" · ")}</span>
            {bot.waitingIn > 0 ? <a href="/" style={{ alignSelf: "flex-start", fontSize: "14px", fontWeight: "600", color: "#8A5A00" }}>{`Te espera en ${plural(bot.waitingIn, "sala", "salas")}`}</a> : null}
            {bot.limited || bot.engineLimit ? <LimitLine limited={bot.limited || bot.engineLimit} style={{ fontSize: "14px" }} /> : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {live.length ? <button type="button" disabled={busy} onClick={pause} style={{ height: "44px", padding: "0 16px", border: "1px solid rgba(18,19,26,.18)", borderRadius: "999px", background: "rgba(255,255,255,.6)", fontSize: "14.5px", cursor: "pointer" }}>{"Pausar"}</button> : null}
            <More round light label={`Más opciones de ${bot.name}`} items={[
              { label: portraitOf(bot) ? "Cambiar el retrato" : "Darle un retrato", run: () => setPortrait(true) },
              { label: "Duplicar", run: duplicate, disabled: busy },
              { label: "Qué cuenta de IA usa", run: () => navigate("/ajustes/ia") },
              bot.id !== "atlas" ? { label: "Retirar del equipo", run: retire, danger: true } : null,
            ]} />
            <a href={`/chat/${encodeURIComponent(bot.id)}`} style={{ height: "44px", padding: "0 20px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "14.5px", fontWeight: "600" }}>{"Hablar con " + bot.name}</a>
          </div>
        </div>
        <nav aria-label="Secciones de la ficha" style={{ maxWidth: "1080px", width: "100%", margin: "0 auto", display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {SECTIONS.map(([s, label]) => (
            <a key={s} href={`#${s}`} onClick={go(s)} aria-current={tab === s ? "location" : undefined} style={{ height: "44px", padding: "0 14px", display: "inline-flex", alignItems: "center", borderBottom: `2px solid ${tab === s ? INK : "transparent"}`, color: INK, fontSize: "14.5px", fontWeight: tab === s ? "600" : "500" }}>{label}</a>
          ))}
        </nav>
      </header>
      <main style={{ maxWidth: "1080px", margin: "0 auto", padding: "32px clamp(20px, 4vw, 48px) 64px", display: "flex", flexDirection: "column", gap: "22px" }}>
        {error || (loadError && !summary) ? <p role="alert" style={{ margin: "0", padding: "12px 16px", borderRadius: "14px", background: "#FBE9EA", color: "#B4232A", fontSize: "14px" }}>{error || loadError}</p> : null}
        <HowItWorks bot={bot} ai={ai} bots={bots} settings={settings} expert={expert} busy={busy} change={change} />
        <StandingOrdersCard bot={bot} />
        <Apps bot={bot} connectors={connectors} learning={learning} setLearning={setLearning} expert={expert} busy={busy} change={change} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: "22px", alignItems: "start" }}>
          <Skills bot={bot} store={store} learning={learning} setLearning={setLearning} data={data} expert={expert} onOpen={setReviewId} />
          <Memory bot={bot} store={store} learning={learning} data={data} expert={expert} />
        </div>
        <Journey bot={bot} sectionStyle={{ ...card, gap: "6px" }} h2={h2} ghost={outline} onOpenSkill={setReviewId} />
        <Personality bot={bot} data={data} setData={setData} approvals={approvals} versions={versions} busy={busy} change={change} />
        <Usage bot={bot} usage={usage} missions={missions} settings={settings} expert={expert} learning={learning} />
        <History bot={bot} data={data} missions={missions} learnedBy={learnedBy} />
      </main>
      {portrait ? <PortraitPicker bot={bot} onClose={() => setPortrait(false)} onSaved={(p) => setData((d) => (d ? { ...d, portrait: p } : d))} /> : null}
      {reviewId ? <SkillReview skillId={reviewId} onClose={() => { setReviewId(null); if (new URLSearchParams(location.search).has("skill")) history.replaceState(null, "", location.pathname + location.hash); }} /> : null}
    </Shell>
  );
}

function SectionHead({ id, title, note, children }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2 id={id} style={h2}>{title}</h2>
        {note ? <span style={sub}>{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

const Lock = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5C606C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 10.5h11v9.5h-11zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>;

function Fact({ label, value, open, onClick, href }) {
  const inner = <><span style={{ color: TEXT3 }}>{label}</span>{" "}<strong style={{ fontWeight: "600" }}>{value}</strong></>;
  if (href) return <a href={href} style={{ color: INK }}>{inner}</a>;
  return (
    <button type="button" aria-expanded={open ? "true" : "false"} onClick={onClick} title="Cambiar" style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "0", border: "0", background: "transparent", fontSize: "14px", color: INK, cursor: "pointer" }}>
      <span>{inner}</span><ChevronDown size={13} strokeWidth={2.4} aria-hidden="true" style={{ color: TEXT3, transition: "transform .2s ease", transform: open ? "rotate(180deg)" : "none" }} />
    </button>
  );
}

function HowItWorks({ bot, ai, bots, settings, expert, busy, change }) {
  const [open, setOpen] = useState(null);
  const engines = ai?.engines || [];
  const team = engines.find((e) => e.id === ai?.primary) || null;
  const own = engines.find((e) => e.id === bot.engine) || null;
  const account = own?.label || team?.label || "sin cuenta conectada";
  const thinking = THINKING.find((t) => t[0] === (bot.thinking || "equilibrado")) || THINKING[1];
  const others = bots.filter((b) => b.id !== bot.id && b.enabled !== false);
  const helpers = (bot.helpers || []).map((h) => others.find((b) => b.id === h)?.name).filter(Boolean);
  const limit = settings?.limits?.monthlyTokens;
  const auto = bot.autonomy || "avisa";
  const modelEngine = bot.model?.engine || (bot.model?.slug ? engineOfModel(bot.model.slug) : null);
  const options = [{ id: null, label: "Como el equipo", sub: team ? team.label : "La cuenta que elijas en Ajustes" }, ...engines.filter((e) => e.connected).map((e) => ({ id: e.id, label: e.label, sub: e.detail || null }))];
  const panel = { display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderRadius: "16px", background: "#F6F6F3", animation: "rise .2s ease-out" };
  return (
    <section id="como" aria-labelledby="como-t" style={card}>
      <SectionHead id="como-t" title="Cómo trabaja" note="Cuánto hace por su cuenta antes de preguntarte." />
      <div role="radiogroup" aria-label="Autonomía" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "10px" }}>
        {AUTONOMY.map(([id, label, desc]) => {
          const on = auto === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on ? "true" : "false"} disabled={busy} onClick={() => !on && change({ autonomy: id }, { autonomy: auto }, `${bot.name}: ${label.toLowerCase()}`)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", padding: "16px", border: `2px solid ${on ? INK : "rgba(18,19,26,.1)"}`, borderRadius: "16px", background: "#FFFFFF", textAlign: "left", cursor: "pointer", transition: "border-color .2s ease" }}>
              <span style={{ fontSize: "15px", fontWeight: "600" }}>{label}</span>
              <span style={{ fontSize: "13.5px", lineHeight: "1.45", color: TEXT2 }}>{desc}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "14px 16px", borderRadius: "14px", background: "#F6F6F3", fontSize: "13.5px" }}>
        <span style={{ fontWeight: "600" }}>{"Siempre te pregunta antes de"}</span>
        {RED_LINES.map((r) => <span key={r} style={{ height: "26px", padding: "0 10px 0 8px", display: "inline-flex", alignItems: "center", gap: "5px", borderRadius: "999px", background: "#FFFFFF" }}><Lock />{r}</span>)}
        <a href="/ajustes/permisos" style={{ marginLeft: "auto", fontSize: "13px", color: BLUE }}>{"Por qué"}</a>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 24px", fontSize: "14px" }}>
        <Fact label="Piensa con" value={`${account} · ${thinking[1].toLowerCase()}`} open={open === "think"} onClick={() => setOpen(open === "think" ? null : "think")} />
        <Fact label="Puede pedir ayuda a" value={helpers.length ? helpers.join(", ") : "nadie"} open={open === "help"} onClick={() => setOpen(open === "help" ? null : "help")} />
        <Fact label="Gasto al mes" value={limit ? `hasta ${formatTokens(limit)} tokens del espacio` : "sin límite"} href="/ajustes/uso#limite-mensual" />
      </div>
      {expert && bot.model?.label ? (
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", font: "500 12.5px/1.4 'Geist Mono', monospace", color: TEXT2 }}>
          {modelEngine ? <WithMark engine={modelEngine} size={12} gap="6px">{bot.model.label}</WithMark> : bot.model.label}
          <span>{"· " + ["razonamiento " + thinking[1].toLowerCase(), bot.model.family ? "familia " + bot.model.family : null, bot.model.reason ? "porque " + bot.model.reason : null, bot.engine ? "cuenta propia" : "cuenta del equipo"].filter(Boolean).join(" · ")}</span>
        </span>
      ) : null}
      {open === "think" ? (
        <div style={panel}>
          <span style={{ fontSize: "13.5px", fontWeight: "600" }}>{"Con qué cuenta piensa"}</span>
          <div role="radiogroup" aria-label={"Con qué piensa " + bot.name} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {options.map((o) => {
              const on = (bot.engine || null) === o.id;
              return (
                <button key={String(o.id)} type="button" role="radio" aria-checked={on ? "true" : "false"} disabled={busy} onClick={() => !on && change({ engine: o.id }, { engine: bot.engine || null }, `${bot.name} piensa con ${o.id ? o.label : "la cuenta del equipo"}`)}
                  style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", border: `2px solid ${on ? INK : "rgba(18,19,26,.1)"}`, borderRadius: "14px", background: "#FFFFFF", textAlign: "left", cursor: "pointer" }}>
                  {o.id ? <WithMark engine={o.id} size={14}><span style={{ fontSize: "14px", fontWeight: "600" }}>{o.label}</span></WithMark> : <span style={{ fontSize: "14px", fontWeight: "600" }}>{o.label}</span>}
                  {o.sub ? <span style={{ fontSize: "12.5px", color: TEXT3 }}>{o.sub}</span> : null}
                </button>
              );
            })}
          </div>
          {options.length < 2 ? <span style={{ fontSize: "13px", color: TEXT3 }}>{"Conecta otra cuenta en "}<a href="/ajustes/ia" style={{ color: BLUE }}>{"Ajustes › Inteligencia"}</a>{" para que este bot piense con ella."}</span> : null}
          <span style={{ fontSize: "13.5px", fontWeight: "600", paddingTop: "4px" }}>{"Forma de pensar"}</span>
          <span style={{ alignSelf: "flex-start" }}><Seg label="Forma de pensar" items={THINKING.map(([v, l]) => [v, l])} value={thinking[0]} disabled={busy} onPick={(v) => change({ thinking: v }, { thinking: thinking[0] }, `${bot.name}: ${THINKING.find((t) => t[0] === v)[1].toLowerCase()}`)} /></span>
          <span role="status" style={{ fontSize: "13px", color: TEXT3 }}>{thinking[2]}{" Colmena elige el modelo por su función, en la versión más alta de tu plan."}</span>
        </div>
      ) : null}
      {open === "help" ? (
        <div style={panel}>
          <span style={{ fontSize: "13.5px", fontWeight: "600" }}>{"Con quién puede repartir su trabajo"}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {others.map((b) => {
              const on = (bot.helpers || []).includes(b.id);
              const next = on ? bot.helpers.filter((x) => x !== b.id) : [...(bot.helpers || []), b.id];
              return (
                <button key={b.id} type="button" aria-pressed={on ? "true" : "false"} disabled={busy} onClick={() => change({ helpers: next }, { helpers: bot.helpers || [] })}
                  style={{ height: "36px", padding: "0 14px 0 10px", display: "inline-flex", alignItems: "center", gap: "8px", border: "0", borderRadius: "999px", background: on ? INK : "#FFFFFF", color: on ? "#FFFFFF" : INK, fontSize: "13.5px", fontWeight: "500", cursor: "pointer" }}>
                  <Shape bot={b} size={14} style={on ? null : { opacity: 0.7 }} />{b.name}{on ? <Check size={13} strokeWidth={2.6} aria-hidden="true" /> : null}
                </button>
              );
            })}
            {!others.length ? <span style={{ fontSize: "13px", color: TEXT3 }}>{"Aún no hay más bots en el equipo."}</span> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontSize: "14.5px" }}>{"Delegar sin preguntarte"}</span><span style={{ fontSize: "12.5px", color: TEXT3 }}>{"Si está apagado, te avisa antes de pasar trabajo a otro bot."}</span></span>
            <Toggle on={!!bot.delegateFreely} label="Delegar sin preguntarte" disabled={busy} onClick={() => change({ delegateFreely: !bot.delegateFreely }, { delegateFreely: !!bot.delegateFreely })} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Apps({ bot, connectors, learning, setLearning, expert, busy, change }) {
  const caps = learning?.capabilities || { web: true, carpetas: true, apps: true, ordenador: true };
  const computerReady = Boolean(learning?.computer?.available);
  const capAct = useAction();
  const setCap = async (key, value) => {
    const r = await capAct.act(() => patch(`/bots/${encodeURIComponent(bot.id)}/capabilities`, { [key]: value }));
    if (r?.capabilities) setLearning((d) => (d ? { ...d, capabilities: r.capabilities } : d));
  };
  const tools = Object.fromEntries(TOOL_KEYS.map((k) => [k, bot.tools?.[k] || "none"]));
  const channels = { colmena: true, correo: false, chat: false, movil: false, ...(bot.channels || {}) };
  const conn = (cid) => connectors.find((c) => c.id === cid);
  const subhead = { padding: "14px 0 4px", fontSize: "13.5px", fontWeight: "600", color: "#3D404A" };
  const row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", minHeight: "58px", padding: "8px 0", borderTop: LINE };
  return (
    <section id="apps" aria-labelledby="apps-t" style={{ ...card, gap: "14px" }}>
      <SectionHead id="apps-t" title="Apps que usa" note="Lo que puede ver y tocar de cada app conectada." />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {TOOL_KEYS.map((k) => {
          const c = conn(k);
          const name = c?.name || TOOL_LABEL[k] || k;
          const v = tools[k];
          const levels = [["none", "No"], ["lee", "Lee"], ["escribe", "Escribe"], ...(expert || v === "pide" ? [["pide", "Pide"]] : [])];
          const hint = v === "none" ? "Sin acceso." : APP_HINT[k]?.[v] || "";
          return (
            <div key={k} style={row}>
              <span aria-hidden="true" style={{ flex: "none", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "10px", background: "#F1F1EC", fontSize: "12px", fontWeight: "700" }}>{APP_MARK[k] || "·"}</span>
              <span style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: "1px" }}>
                <span style={{ fontSize: "15px", fontWeight: "500" }}>{name}</span>
                <span style={{ fontSize: "12.5px", color: TEXT3 }}>{hint}{c && !c.connected ? <>{" Sin conectar · "}<a href="/ajustes/conexiones" style={{ color: BLUE }}>{"Conectar"}</a></> : null}{expert ? <span style={{ fontFamily: "'Geist Mono', monospace" }}>{` · tools.${k}=${v}`}</span> : null}</span>
              </span>
              <Seg label={`Acceso a ${name}`} items={levels} value={v} disabled={busy} onPick={(lv) => change({ tools: { ...tools, [k]: lv } }, { tools }, `${name}: ${levels.find((l) => l[0] === lv)[1].toLowerCase()}`)} />
            </div>
          );
        })}
      </div>
      <span style={subhead}>{"También puede"}</span>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "-10px" }}>
        {CAPABILITIES.map(([key, label, desc]) => {
          const soon = key === "ordenador" && !computerReady;
          const on = !soon && caps[key] !== false;
          return (
            <div key={key} style={{ ...row, minHeight: "52px" }}>
              <span style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "1px" }}>
                <span style={{ fontSize: "15px", fontWeight: "500" }}>{label}</span>
                <span style={{ fontSize: "12.5px", color: TEXT3 }}>{soon ? "Funciona con Colmena abierta en el escritorio." : desc}</span>
              </span>
              <Toggle on={on} label={label} disabled={soon || !learning || capAct.busy} onClick={() => setCap(key, !on)} />
            </div>
          );
        })}
      </div>
      <span style={subhead}>{"Dónde puedes hablarle"}</span>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "-10px" }}>
        <div style={{ ...row, minHeight: "52px" }}><span style={{ flex: "1", fontSize: "15px", fontWeight: "500" }}>{"Colmena"}</span><Toggle on label="Colmena" disabled title="Siempre activo" onClick={() => {}} /></div>
        {CHANNELS.map(([key, label, connector]) => {
          const connected = connector ? Boolean(conn(connector)?.connected) : false;
          const on = Boolean(channels[key]);
          const usable = connector && (connected || on);
          return (
            <div key={key} style={{ ...row, minHeight: "52px" }}>
              <span style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "1px" }}>
                <span style={{ fontSize: "15px", fontWeight: "500" }}>{label}</span>
                {!connector ? <span style={{ fontSize: "12.5px", color: TEXT3 }}>{"Próximamente"}</span> : !connected ? <a href="/ajustes/conexiones" style={{ fontSize: "12.5px", color: BLUE }}>{"Conéctalo en Ajustes para activarlo"}</a> : null}
              </span>
              <Toggle on={on} label={label} disabled={!usable || busy} onClick={() => change({ channels: { ...channels, [key]: !on } }, { channels })} />
            </div>
          );
        })}
      </div>
      {capAct.error ? <p role="alert" style={{ margin: "0", fontSize: "13.5px", color: "#B4232A" }}>{capAct.error}</p> : null}
    </section>
  );
}

function Skills({ bot, store, learning, setLearning, data, expert, onOpen }) {
  const item = useAction();
  const [all, setAll] = useState(false);
  const list = learning?.skills || data?.skills || store.skills.filter((s) => s.botId === bot.id);
  const ORDER = { pending: -1, active: 0, stale: 1, disabled: 2, archived: 3 };
  const sorted = list.slice().sort((a, b) => (ORDER[a.status] ?? 4) - (ORDER[b.status] ?? 4) || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.uses || 0) - (a.uses || 0));
  const shown = all ? sorted : sorted.slice(0, 6);
  const pin = async (s) => {
    const r = await item.act(() => patch(`/skills/${s.id}/curation`, { pinned: !s.pinned }));
    if (r?.id) setLearning((d) => (d ? { ...d, skills: d.skills.map((x) => (x.id === r.id ? r : x)) } : d));
  };
  const importSkill = async () => {
    let files;
    try { files = await pickTextFiles({ multiple: false, accept: ".md,.markdown,.txt" }); } catch (e) { item.setError(e.message); return; }
    if (!files?.length) return;
    const skill = await item.act(() => post("/skills", { content: files[0].content, source: files[0].name, botId: bot.id }));
    if (skill?.id) onOpen(skill.id);
  };
  return (
    <section id="habilidades" aria-labelledby="hab-t" style={{ ...card, gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
        <h2 id="hab-t" style={h2}>{"Habilidades"}</h2>
        <span style={{ display: "flex", gap: "14px", fontSize: "14px" }}>
          <button type="button" onClick={importSkill} disabled={item.busy} title="Añadir un SKILL.md" style={{ padding: "0", border: "0", background: "transparent", color: "#1F4FD1", fontSize: "14px", cursor: "pointer" }}>{"Añadir"}</button>
          <a href="/biblioteca/habilidades" style={{ color: BLUE }}>{"Todas"}</a>
        </span>
      </div>
      {shown.map((k) => (
        <div key={k.id} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", padding: "0 2px", borderTop: "1px solid rgba(18,19,26,.05)", opacity: ["disabled", "archived"].includes(k.status) ? 0.6 : 1 }}>
          <button type="button" onClick={() => onOpen(k.id)} aria-label={`${k.name}: ${skillNote(k)}. Ver pasos`} style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px", padding: "6px 0", border: "0", background: "transparent", textAlign: "left", cursor: "pointer" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "14.5px" }}>{k.name}{k.verdict && k.verdict.value !== "dudoso" ? <VerdictMark verdict={k.verdict} compact consolidated={k.consolidated} /> : null}</span>
            <span style={{ fontSize: "12.5px", color: TEXT3 }}>{skillNote(k)}{expert ? <span style={{ fontFamily: "'Geist Mono', monospace" }}>{` · v${k.version || 1} · ${k.origin || "instalada"} · ${k.steps || 0} pasos`}</span> : null}</span>
          </button>
          {k.status === "pending" ? (
            <button type="button" onClick={() => onOpen(k.id)} style={{ height: "28px", padding: "0 12px", border: "0", borderRadius: "999px", background: "#FFF1C7", color: "#8A5A00", fontSize: "12.5px", fontWeight: "600", cursor: "pointer" }}>{"Revisar"}</button>
          ) : learning ? (
            <button type="button" onClick={() => pin(k)} disabled={item.busy} aria-pressed={k.pinned ? "true" : "false"} aria-label={k.pinned ? `Dejar de fijar ${k.name}` : `Fijar ${k.name}: nunca se archivará`} title={k.pinned ? "Fijada: nunca se archiva" : "Fijar: nunca se archivará por falta de uso"}
              style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", border: "0", borderRadius: "9px", background: k.pinned ? INK : "transparent", color: k.pinned ? "#FFFFFF" : "#8C8F99", cursor: "pointer" }}>
              <Pin size={14} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
      {sorted.length > 6 ? <button type="button" onClick={() => setAll((x) => !x)} style={{ ...quiet, alignSelf: "flex-start", padding: "0", color: "#1F4FD1" }}>{all ? "Ver menos" : `Ver las ${sorted.length}`}</button> : null}
      {!sorted.length ? <span style={{ fontSize: "14px", color: TEXT3, paddingTop: "4px" }}>{"Aún no tiene habilidades. Las aprenderá al repetir tareas, o puedes añadir un SKILL.md."}</span> : null}
      {sorted.some((s) => s.status === "stale" || s.status === "archived") ? <span style={{ fontSize: "12.5px", color: TEXT3 }}>{"Las que no usa en un mes dejan de ofrecerse y a los tres meses se archivan; nunca se borran. Fija las que quieras conservar."}</span> : null}
      <VerdictList verdicts={learning?.verdicts} />
      {item.error ? <p role="alert" style={{ margin: "0", fontSize: "13.5px", color: "#B4232A" }}>{item.error}</p> : null}
    </section>
  );
}

const METERS = [["user", "De ti"], ["memory", "Del equipo"], ["bot", "Propia"]];
function Memory({ bot, store, learning, data, expert }) {
  const item = useAction();
  const hidden = useHidden("memory");
  const [all, setAll] = useState(false);
  const map = new Map();
  for (const m of data?.memories || store.memories.filter((x) => x.botId === bot.id)) if (!hidden(m.id)) map.set(m.id, m);
  const list = [...map.values()].sort((a, b) => (b.review ? 1 : 0) - (a.review ? 1 : 0) || Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const shown = all ? list : list.slice(0, 6);
  const forget = (m) => later({ id: "memory:" + m.id, keys: ["memory:" + m.id], text: "Recuerdo olvidado", ms: UNDO_MS, error: "No se pudo olvidar", run: () => del(`/memories/${encodeURIComponent(m.id)}`) });
  return (
    <section id="memoria" aria-labelledby="mem-t" style={{ ...card, gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
        <h2 id="mem-t" style={h2}>{"Recuerda de ti"}</h2>
        <a href="/biblioteca/memoria" style={{ fontSize: "14px", color: BLUE }}>{"Toda la memoria"}</a>
      </div>
      {expert && learning?.memory ? (
        <div role="group" aria-label="Uso de la memoria" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
          {METERS.map(([k, label]) => {
            const u = learning.memory[k];
            if (!u) return null;
            const tone = u.percent >= 90 ? "#B4232A" : u.percent >= 70 ? "#8A5A00" : "#0B8A5F";
            return (
              <span key={k} style={{ display: "flex", flexDirection: "column", gap: "5px", padding: "8px 10px", borderRadius: "12px", background: "#F6F6F3" }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: "6px", fontSize: "12px" }}><strong style={{ fontWeight: "600" }}>{label}</strong><span style={{ font: "500 11px/1.4 'Geist Mono', monospace", color: TEXT3 }}>{`${u.used}/${u.limit}`}</span></span>
                <span role="meter" aria-label={"Memoria: " + label} aria-valuemin={0} aria-valuemax={u.limit} aria-valuenow={u.used} style={{ height: "5px", borderRadius: "3px", background: "rgba(18,19,26,.07)", overflow: "hidden" }}><span style={{ display: "block", width: `${Math.min(100, u.percent)}%`, height: "100%", background: tone }} /></span>
              </span>
            );
          })}
        </div>
      ) : null}
      {shown.map((m) => (
        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", borderTop: "1px solid rgba(18,19,26,.05)", animation: "fade .3s ease-out" }}>
          <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px", padding: "6px 0" }}>
            <span style={{ fontSize: "14.5px", lineHeight: "1.4" }}>{m.text}</span>
            {expert || m.review ? <span style={{ fontSize: "12.5px", color: m.review ? "#8A5A00" : TEXT3 }}>{m.review ? "¿Es así? Confírmalo u olvídalo" : memoryNote(m)}{expert ? <span style={{ fontFamily: "'Geist Mono', monospace" }}>{` · ${m.scope || "bot"}${m.kind ? " · " + m.kind : ""}`}</span> : null}</span> : null}
          </span>
          {m.review ? <button type="button" disabled={item.busy} onClick={() => item.act(() => patch(`/memories/${encodeURIComponent(m.id)}`, { review: false }))} style={{ ...quiet, color: "#0B6B4A", fontWeight: "600" }}>{"Es así"}</button> : null}
          <button type="button" onClick={() => forget(m)} style={quiet}>{"Olvidar"}</button>
        </div>
      ))}
      {list.length > 6 ? <button type="button" onClick={() => setAll((x) => !x)} style={{ ...quiet, alignSelf: "flex-start", padding: "0", color: "#1F4FD1" }}>{all ? "Ver menos" : `Ver los ${list.length}`}</button> : null}
      {!list.length ? <span style={{ fontSize: "14px", color: TEXT3, paddingTop: "4px" }}>{"Aún no recuerda nada de ti. Lo que le cuentes en el chat y lo que acordéis aparecerá aquí."}</span> : null}
      {item.error ? <p role="alert" style={{ margin: "0", fontSize: "13.5px", color: "#B4232A" }}>{item.error}</p> : null}
    </section>
  );
}

function Personality({ bot, data, setData, approvals, versions, busy, change }) {
  const soulAct = useAction();
  const [showVersions, setShowVersions] = useState(false);
  const [soulDraft, setSoulDraft] = useState(null);
  const [editing, setEditing] = useState(null); // the approval being edited, if any
  const [instr, setInstr] = useState(null);
  const [pers, setPers] = useState(() => ({ tono: 50, detalle: 50, riesgo: 50, ...(bot.personality || {}) }));
  const timer = useRef(null);
  useEffect(() => { setPers({ tono: 50, detalle: 50, riesgo: 50, ...(bot.personality || {}) }); }, [JSON.stringify(bot.personality || {})]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);
  const hiddenApproval = useHidden("approval");
  const proposal = approvals.find((a) => a.kind === "soul" && a.botId === bot.id && a.status === "pending" && !hiddenApproval(a.id));
  const count = Array.isArray(versions) ? versions.length : 0;
  const soul = data?.soul || "";
  const slide = (key, value) => {
    const next = { ...pers, [key]: value };
    setPers(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => change({ personality: next }, { personality: bot.personality || {} }), 600);
  };
  const saveSoul = async () => {
    const before = soul;
    const r = await soulAct.act(() => patch(`/bots/${encodeURIComponent(bot.id)}/soul`, { soul: soulDraft }));
    if (r === undefined) return;
    setData((d) => (d ? { ...d, soul: soulDraft } : d));
    if (editing) await soulAct.act(() => post(`/approvals/${encodeURIComponent(editing.id)}/dismiss`)).catch(() => {});
    setSoulDraft(null);
    setEditing(null);
    reversible({ id: "soul:" + bot.id, text: "Personalidad guardada", ms: UNDO_MS, undo: async () => { await patch(`/bots/${encodeURIComponent(bot.id)}/soul`, { soul: before }); setData((d) => (d ? { ...d, soul: before } : d)); } });
  };
  const decide = (decision) => later({
    id: "approval:" + proposal.id, keys: ["approval:" + proposal.id], ms: UNDO_MS,
    text: decision === "approved" ? `Cambio de ${bot.name} aceptado` : `Cambio de ${bot.name} rechazado`, error: "No se pudo guardar tu respuesta",
    run: () => post(`/approvals/${encodeURIComponent(proposal.id)}`, { decision, revision: proposal.revision }),
  });
  const diff = (proposal?.diff || []).filter((d) => d.op !== " " && d.line.trim());
  const frame = { padding: "16px 18px", borderRadius: "16px", background: "#F6F6F3", fontSize: "15px", lineHeight: "1.6", color: "#3D404A" };
  const label = { fontSize: "13.5px", fontWeight: "600", color: "#3D404A" };
  return (
    <section id="personalidad" aria-labelledby="per-t" style={{ ...card, gap: "14px" }}>
      <SectionHead id="per-t" title="Personalidad" note={`Cómo es y cómo escribe. ${bot.name} no la cambia por su cuenta: te propone el cambio.`}>
        <button type="button" aria-expanded={showVersions ? "true" : "false"} onClick={() => setShowVersions((x) => !x)} style={outline}>{count ? `Versiones · ${count}` : "Versiones"}</button>
      </SectionHead>
      {showVersions ? <div style={{ margin: "0 -20px", animation: "rise .2s ease-out" }}><DocHistory doc="soul" botId={bot.id} empty="Su carácter no ha cambiado desde que llegó." /></div> : null}
      {proposal && soulDraft === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "18px 20px", borderRadius: "16px", background: "#FFF6DC" }}>
          <span style={{ fontSize: "14px", fontWeight: "600" }}>{`${bot.name} propone un cambio`}{proposal.summary ? ` · ${proposal.summary}` : ""}</span>
          <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.7", whiteSpace: "pre-wrap" }}>
            {diff.length ? diff.slice(0, 12).map((d, i) => (d.op === "-"
              ? <del key={i} style={{ display: "block", background: "#FBE9EA", color: "#B4232A" }}>{d.line}</del>
              : <ins key={i} style={{ display: "block", background: "#E3F4EC", color: "#0B6B4A", textDecoration: "none" }}>{d.line}</ins>)) : proposal.raw}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" onClick={() => decide("approved")} style={dark}>{"Aceptar el cambio"}</button>
            <button type="button" onClick={() => { setEditing(proposal); setSoulDraft(proposal.proposal || soul); }} style={{ ...outline, height: "38px" }}>{"Editarlo"}</button>
            <button type="button" onClick={() => decide("denied")} style={{ ...quiet, height: "38px" }}>{"Rechazar"}</button>
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <span style={label}>{"Lo que hace en el equipo"}</span>
          {instr === null ? <button type="button" onClick={() => setInstr(bot.instructions || "")} style={quiet}>{"Editar"}</button> : null}
        </div>
        {instr !== null ? (
          <>
            <textarea aria-label="Instrucciones del bot" autoFocus maxLength={12000} value={instr} onChange={(e) => setInstr(e.target.value)} style={{ ...frame, width: "100%", minHeight: "120px", fieldSizing: "content", resize: "vertical", border: "1px solid rgba(18,19,26,.14)", background: "#FFFFFF", fontFamily: "inherit", boxSizing: "border-box" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" onClick={() => setInstr(null)} style={quiet}>{"Cancelar"}</button>
              <button type="button" disabled={busy || instr.trim().length < 1} onClick={async () => { await change({ instructions: instr }, { instructions: bot.instructions || "" }, "Instrucciones guardadas"); setInstr(null); }} style={dark}>{"Guardar"}</button>
            </div>
          </>
        ) : <div style={{ ...frame, whiteSpace: "pre-wrap" }}>{bot.instructions || "Aún no tiene instrucciones. Cuéntale qué hace en el equipo, como a un compañero nuevo."}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <span style={label} title="Se guarda como SOUL.md">{"Su forma de ser"}</span>
          {soulDraft === null ? <button type="button" disabled={!data} onClick={() => { setEditing(null); setSoulDraft(soul); }} style={quiet}>{"Editar"}</button> : null}
        </div>
        {soulDraft !== null ? (
          <>
            <textarea aria-label="Personalidad del bot" autoFocus maxLength={40000} value={soulDraft} onChange={(e) => setSoulDraft(e.target.value)} style={{ ...frame, width: "100%", minHeight: "240px", fieldSizing: "content", resize: "vertical", border: "1px solid rgba(18,19,26,.14)", background: "#FFFFFF", font: "400 13px/1.6 'Geist Mono', monospace", boxSizing: "border-box" }} />
            {soulAct.error ? <p role="alert" style={{ margin: "0", fontSize: "13.5px", color: "#B4232A" }}>{soulAct.error}</p> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" onClick={() => { setSoulDraft(null); setEditing(null); }} style={quiet}>{"Cancelar"}</button>
              <button type="button" disabled={soulAct.busy || soulDraft === soul} onClick={saveSoul} style={{ ...dark, opacity: soulDraft === soul ? 0.55 : 1 }}>{editing ? "Guardar tu versión" : "Guardar"}</button>
            </div>
          </>
        ) : soul ? (
          <div className="v3-soul-md" tabIndex={0} aria-label="Personalidad del bot" style={{ ...frame, maxHeight: "260px", overflowY: "auto" }}><ReactMarkdown>{soul}</ReactMarkdown></div>
        ) : <div style={{ ...frame, color: TEXT3 }}>{data ? "Aún no tiene personalidad escrita." : "Cargando…"}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={label}>{"Cómo habla"}</span>
        {SLIDERS.map(([key, left, right, aria]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "84px 1fr 84px", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "13.5px", color: TEXT3, textAlign: "right" }}>{left}</span>
            <input type="range" min="0" max="100" step="5" value={pers[key]} onChange={(e) => slide(key, Number(e.target.value))} aria-label={aria} style={{ width: "100%", height: "36px", accentColor: bot.color || INK, cursor: "pointer" }} />
            <span style={{ fontSize: "13.5px", color: TEXT3 }}>{right}</span>
          </div>
        ))}
      </div>
      <VoicePicker bot={bot} onSaved={(voice) => setData((d) => (d ? { ...d, voice } : d))} />
    </section>
  );
}

function Usage({ bot, usage, missions, settings, expert, learning }) {
  const mine = usage?.bots?.find((x) => x.botId === bot.id) || { tokens: 0, calls: 0 };
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const since = Math.min(start.getTime(), Date.now() - 7 * 864e5);
  const tasks = missions.filter((m) => (m.botIds || []).includes(bot.id) && Date.parse(m.createdAt || m.updatedAt || 0) >= since).length;
  const limit = settings?.limits?.monthlyTokens || null;
  const base = limit || usage?.total || 0;
  const pct = base ? Math.min(100, Math.round((mine.tokens / base) * 100)) : 0;
  const share = limit ? `de ${formatTokens(limit)} del espacio` : usage?.total ? `· el ${pct} % del equipo` : "";
  return (
    <section id="uso" aria-labelledby="uso-t" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px 28px", padding: "22px 26px", borderRadius: "24px", background: "#FFFFFF", scrollMarginTop: "16px" }}>
      <h2 id="uso-t" style={h2}>{new Date().getDate() >= 7 ? "Uso este mes" : "Uso estos 7 días"}</h2>
      <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={{ fontSize: "14px" }}>
          {usage ? <><strong style={{ fontWeight: "600" }}>{`${formatTokens(mine.tokens || 0)} tokens`}</strong>{` ${share} · ${plural(tasks, "tarea", "tareas")}`}</> : "Calculando…"}
          {expert && usage ? <span style={{ font: "500 12.5px/1 'Geist Mono', monospace", color: TEXT3 }}>{` · ${mine.calls || 0} llamadas${learning?.counters ? ` · ${learning.counters.userTurns} turnos · ${learning.counters.toolCalls} herramientas` : ""}`}</span> : null}
        </span>
        <span aria-hidden="true" style={{ position: "relative", height: "8px", borderRadius: "4px", background: "#EEEEEA", overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: "0 auto 0 0", width: `${pct}%`, background: bot.color || INK, transition: "width .6s cubic-bezier(.2,.8,.2,1)" }} />
        </span>
      </div>
      <a href="/ajustes/uso" style={{ fontSize: "14px", color: BLUE }}>{"Ver detalle"}</a>
    </section>
  );
}

function History({ bot, data, missions, learnedBy }) {
  const [all, setAll] = useState(false);
  const list = useMemo(() => (data?.history || missions.filter((m) => (m.botIds || []).includes(bot.id))).slice().sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0)), [data?.history, missions, bot.id]);
  const shown = all ? list : list.slice(0, 6);
  return (
    <section aria-labelledby="his-t" style={{ ...card, gap: "6px" }}>
      <SectionHead id="his-t" title="En qué ha trabajado" note="Tareas, salas y chats. Si aprendió algo de uno, puedes hacer que lo olvide." />
      <div style={{ display: "flex", flexDirection: "column", paddingTop: "8px" }}>
        {shown.map((m) => {
          const taught = learnedBy?.[m.id];
          return (
            <div key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", borderTop: LINE }}>
              <a href={m.conversation ? roomUrl(m) : missionUrl(m)} style={{ flex: "1 1 320px", minWidth: "0", display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", color: INK }}>
                <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "14.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title || m.prompt}</span>
                  <span style={{ fontSize: "12.5px", color: TEXT3 }}>{[m.conversation ? "Chat" : m.room ? `#${m.room}` : m.mode === "debate" ? "Debate" : "Tarea", m.statusLabel || MISSION_LABEL[m.status] || null].filter(Boolean).join(" · ")}</span>
                </span>
                <span style={{ fontSize: "12.5px", color: TEXT3, whiteSpace: "nowrap" }}>{shortDate(m.updatedAt || m.createdAt)}</span>
              </a>
              {taught ? (
                <span style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "6px" }}>
                  <span style={{ fontSize: "12.5px", color: TEXT3 }}>{[taught.memories ? plural(taught.memories, "recuerdo", "recuerdos") : null, taught.skills ? plural(taught.skills, "habilidad", "habilidades") : null].filter(Boolean).join(" y ") + " salieron de aquí"}</span>
                  <ForgetButton missionId={m.id} title={m.title || m.prompt} variant="row" />
                </span>
              ) : null}
            </div>
          );
        })}
        {list.length > 6 ? <button type="button" onClick={() => setAll((x) => !x)} style={{ ...quiet, alignSelf: "flex-start", padding: "10px 0 0", color: "#1F4FD1" }}>{all ? "Ver menos" : `Ver los ${list.length}`}</button> : null}
        {!list.length ? <p style={{ margin: "0", padding: "14px 0 4px", borderTop: LINE, fontSize: "14px", color: TEXT3 }}>{"Aún no ha trabajado en nada. "}<a href={`/chat/${encodeURIComponent(bot.id)}`} style={{ color: BLUE }}>{"Pídele algo en el chat."}</a></p> : null}
      </div>
    </section>
  );
}
