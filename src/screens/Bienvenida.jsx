import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Brain, ArrowRight, ArrowUp, BookOpen, Calculator, CalendarDays, Check, FolderOpen, Mail, MessagesSquare, Sheet, Sparkles } from "lucide-react";
import Logo, { LogoMark } from "../components/Logo.jsx";
import { css } from "../design/css/Bienvenida.js";
import { patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { useStore } from "../lib/store.jsx";
import { BotAvatar, UserAvatar } from "../components/room/common.jsx";
import { Notice, Spinner } from "../components/team/common.jsx";
import MemoryImport from "../components/library/MemoryImport.jsx";

// First start as a conversation with Atlas (Hermes / OpenClaw onboarding): he is the first bot
// you meet and always part of the team, because he coordinates it. He asks one thing at a
// time — your name, what you do, what you use every day — proposes a team with roles already
// made and three first tasks. Scripted on purpose: it works before your ChatGPT account is
// connected, and nothing is sent anywhere.

export const B = {
  atlas: { id: "atlas", name: "Atlas", role: "Coordinador", color: "#FFC93C", shape: "hex" },
  nora: { id: "nora", name: "Nora", role: "Investigación", color: "#2F6BFF", shape: "circle" },
  tomas: { id: "tomas", name: "Tomás", role: "Datos y finanzas", color: "#0B8A5F", shape: "square" },
  iris: { id: "iris", name: "Iris", role: "Diseño", color: "#FF5CA8", shape: "diamond" },
  bruno: { id: "bruno", name: "Bruno", role: "Código", color: "#FF7A1A", shape: "arch" },
  vera: { id: "vera", name: "Vera", role: "Redacción", color: "#7B4DFF", shape: "leaf" },
  leo: { id: "leo", name: "Leo", role: "Asistente legal", color: "#0E7C86", shape: "circle" },
};
export const ROLES = [
  { id: "diseno", label: "Diseño", team: [["atlas", "Reparte el trabajo y te trae un único resultado."], ["iris", "Maquetas, presentaciones y piezas visuales."], ["vera", "Titulares y textos que acompañan al diseño."], ["nora", "Referencias y lo que hace la competencia."]],
    tasks: ["Prepara un moodboard con referencias para una web nueva", "Revisa si los colores y la tipografía de este documento son coherentes", "Escribe cinco titulares para la próxima campaña"] },
  { id: "programacion", label: "Programación", team: [["atlas", "Reparte el trabajo y vigila los plazos."], ["bruno", "Scripts, revisiones de código y pruebas."], ["nora", "Lee documentación y busca soluciones."], ["vera", "Documenta y explica los cambios."]],
    tasks: ["Revisa este script y propón mejoras", "Resume los pasos para actualizar una librería a su última versión", "Escribe el README de un proyecto a partir de su código"] },
  { id: "finanzas", label: "Finanzas y economía", team: [["atlas", "Reparte el trabajo y te trae un único resultado."], ["tomas", "Hojas de cálculo, cierres y previsiones."], ["nora", "Informes, datos públicos y mercado."], ["vera", "Resúmenes claros para dirección."]],
    tasks: ["Prepara una previsión de tesorería para el próximo trimestre", "Compara tres bancos para la cuenta de la empresa", "Resume en una tabla los gastos de este mes"] },
  { id: "marketing", label: "Marketing", team: [["atlas", "Coordina campañas de principio a fin."], ["vera", "Textos, correos y redes."], ["iris", "Piezas visuales y variantes."], ["nora", "Competencia y tendencias."]],
    tasks: ["Propón un calendario de publicaciones para las próximas cuatro semanas", "Analiza qué está haciendo la competencia en redes", "Redacta un correo de bienvenida para clientes nuevos"] },
  { id: "operaciones", label: "Operaciones", team: [["atlas", "Reparte el trabajo y vigila los plazos."], ["tomas", "Costes, proveedores y cuadros de mando."], ["bruno", "Automatiza las tareas repetidas."], ["vera", "Comunicaciones internas."]],
    tasks: ["Compara los precios de tres proveedores", "Diseña un cuadro de mando con los costes del mes", "Propón cómo automatizar una tarea que repito cada semana"] },
  { id: "legal", label: "Legal", team: [["atlas", "Reparte el trabajo y vigila los plazos."], ["leo", "Contratos, cláusulas y renovaciones."], ["nora", "Normativa y documentación."], ["vera", "Redacta y revisa escritos."]],
    tasks: ["Revisa este contrato y señala las cláusulas de riesgo", "Haz una lista de los contratos que vencen este trimestre", "Resume la normativa de protección de datos que nos afecta"] },
  { id: "personas", label: "Personas y RR. HH.", team: [["atlas", "Coordina procesos de principio a fin."], ["vera", "Ofertas de empleo y comunicaciones."], ["nora", "Prepara entrevistas y estudios."], ["tomas", "Calendarios, vacaciones y datos."]],
    tasks: ["Redacta una oferta de empleo para un puesto nuevo", "Prepara las preguntas de una entrevista", "Organiza el calendario de vacaciones del equipo"] },
  { id: "otra", label: "Otra cosa", team: [["atlas", "Reparte el trabajo entre el equipo."], ["nora", "Busca, lee y resume."], ["vera", "Escribe y corrige."], ["tomas", "Números y hojas de cálculo."]],
    tasks: ["Busca tres planes para este fin de semana", "Resume este documento en cinco puntos", "Prepara mi lista de tareas para esta semana"] },
];
const APPS = [
  { id: "correo", label: "Correo", Icon: Mail },
  { id: "calendario", label: "Calendario", Icon: CalendarDays },
  { id: "hojas", label: "Hojas de cálculo", Icon: Sheet },
  { id: "carpetas", label: "Carpetas del ordenador", Icon: FolderOpen },
  { id: "chat", label: "Chat del equipo", Icon: MessagesSquare },
  { id: "contabilidad", label: "Contabilidad", Icon: Calculator },
];
// A first task that uses what you said you use.
export const APP_TASK = {
  correo: "Resume los correos importantes que me llegaron ayer",
  calendario: "Mira mi calendario de esta semana y dime dónde tengo huecos",
  hojas: "Revisa mi hoja de gastos y dime qué ha subido este mes",
  carpetas: "Ordena y resume los documentos de una de mis carpetas",
};
const STAGES = ["nombre", "rol", "apps", "equipo", "tareas"];

function AtlasLine({ atlas, children, entering, first }) {
  return (
    <div className={entering ? "c-enter" : undefined} style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", padding: "6px 0" }}>
      <span style={{ visibility: first ? "visible" : "hidden" }}><BotAvatar bot={atlas} size={40} mood="neutral" /></span>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
        {first ? <strong style={{ fontSize: "15px" }}>{"Atlas"} <span style={{ fontWeight: "500", color: "#555A68" }}>{"· Coordinador"}</span></strong> : null}
        <div style={{ fontSize: "16px", lineHeight: "1.6", color: "#12131A" }}>{children}</div>
      </div>
    </div>
  );
}

function YouLine({ text, onChange }) {
  return (
    <div className="c-enter msg-row--mine" style={{ display: "grid", gridTemplateColumns: "40px 1fr auto", gap: "12px", alignItems: "center", padding: "10px 12px", margin: "6px -12px", borderRadius: "12px" }}>
      <UserAvatar size={40} />
      <span style={{ fontSize: "16px", lineHeight: "1.5" }}>{text}</span>
      {onChange ? <button type="button" onClick={onChange} style={{ padding: "4px 6px", background: "transparent", border: 0, cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>{"Cambiar"}</button> : null}
    </div>
  );
}

function Typing({ atlas }) {
  return (
    <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", padding: "6px 0" }}>
      <BotAvatar bot={atlas} size={40} mood="pensando" />
      <span style={{ display: "flex", gap: "4px", alignItems: "center", height: "26px" }}>
        {[0, 1, 2].map((i) => <span key={i} className="onb-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4A4F5C", animationDelay: i * 0.18 + "s" }} />)}
      </span>
    </div>
  );
}

const chip = (on) => ({
  display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "44px", padding: "0 16px", borderRadius: "22px", cursor: "pointer", fontSize: "15px", fontWeight: "600",
  background: on ? "#12131A" : "#FFFFFF", color: on ? "#FFFFFF" : "#12131A", border: on ? "2px solid #12131A" : "1.5px solid #C9CED8",
});
const primary = { display: "inline-flex", alignItems: "center", gap: "10px", height: "48px", padding: "0 20px", background: "#FFC93C", color: "#12131A", border: "2px solid #12131A", borderRadius: "12px", boxShadow: "4px 4px 0 #12131A", fontWeight: "700", fontSize: "15px", cursor: "pointer" };

export default function Bienvenida() {
  const { bots, account, connectors, missions, settings } = useStore();
  const atlasReal = bots.find((b) => b.id === "atlas");
  const atlas = { ...B.atlas, ...(atlasReal ? { name: atlasReal.name, color: atlasReal.color, shape: atlasReal.shape } : {}) };
  const [stage, setStage] = useState(0);
  const [name, setName] = useState(settings.userName || "");
  const [role, setRole] = useState(null);
  const [apps, setApps] = useState([]);
  const [off, setOff] = useState([]); // bots you took out of the proposed team
  const [saved, setSaved] = useState(false);
  const [typing, setTyping] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const scroller = useRef(null);
  const input = useRef(null);

  // Atlas «types» a moment before each question (instant with reduced motion).
  useEffect(() => {
    const reduce = matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    setTyping(true);
    const t = setTimeout(() => setTyping(false), reduce ? 0 : stage === 0 ? 700 : 550);
    return () => clearTimeout(t);
  }, [stage]);
  useEffect(() => { if (!typing && stage === 0) input.current?.focus(); }, [typing, stage]);
  useLayoutEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [stage, typing, saved]);

  const cur = ROLES.find((r) => r.id === role);
  const team = (cur?.team || []).map(([id, help]) => {
    const real = bots.find((b) => b.id === id);
    return { ...B[id], ...(real ? { name: real.name, color: real.color, shape: real.shape } : {}), help };
  });
  const first = (name.trim().split(/\s+/)[0] || "").slice(0, 40);
  const connected = Boolean(account?.connected);
  const tasks = cur ? [...apps.filter((a) => APP_TASK[a]).slice(0, 1).map((a) => APP_TASK[a]), ...cur.tasks].slice(0, 3) : [];
  const goTo = (n) => { setError(null); setSaved(false); setStage(n); };

  const sendName = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    goTo(1);
  };
  const pickRole = (id) => { setRole(id); setOff([]); goTo(2); };
  const toggleApp = (id) => setApps((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const saveTeam = async () => {
    if (busy) return;
    setBusy("team");
    setError(null);
    try {
      await post("/onboarding", { role, team: team.map((b) => b.id).filter((id) => !off.includes(id)), userName: name.trim(), apps });
      setSaved(true);
      setStage(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  // A first task: it waits in the home box (after connecting the account, if needed).
  const start = (text) => {
    try { sessionStorage.setItem("colmena:draft", JSON.stringify({ text, mode: "equipo" })); } catch {}
    navigate(connected ? "/" : "/ajustes/ia");
  };
  const skip = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy("skip");
    try {
      await patch("/settings", { onboarded: true, ...(name.trim() ? { userName: name.trim() } : {}) });
      navigate("/");
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };

  const steps = [
    { n: 1, label: "Preséntate", done: stage >= 3, current: stage < 3 },
    { n: 2, label: "Tu equipo", done: saved, current: stage === 3 },
    { n: 3, label: "Tu primer encargo", done: missions.length > 0, current: stage === 4 },
  ];
  const shown = (n) => stage > n || (stage === n && !typing);

  return (
    <>
      <style>{css + "@keyframes onb-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}.onb-dot{animation:onb-dot 1.1s infinite both}@media (prefers-reduced-motion: reduce){.onb-dot{animation:none;opacity:.6}}"}</style>
      <div style={{ height: "100vh", display: "flex", flexWrap: "wrap", background: "#FFFFFF" }}>
        <section style={{ flex: "1 1 360px", maxWidth: "520px", background: "#12131A", color: "#FFFFFF", padding: "clamp(28px, 4vw, 56px)", display: "flex", flexDirection: "column", gap: "36px", position: "relative", overflow: "hidden" }}>
          <LogoMark size={420} style={{ position: "absolute", right: "-140px", bottom: "-120px", opacity: "0.12" }} />
          <Logo size={36} fontSize={23} tone="light" />
          <div style={{ display: "flex", flexDirection: "column", gap: "18px", position: "relative" }}>
            <h1 style={{ margin: 0, font: "800 clamp(36px, 4.4vw, 56px)/0.98 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", textWrap: "balance" }}>Tu primer equipo, en un minuto.</h1>
            <p style={{ margin: 0, fontSize: "17px", lineHeight: "1.5", color: "#C9CCD6", maxWidth: "420px" }}>Bots que trabajan contigo y entre ellos. Les hablas como a un compañero; ellos se reparten el trabajo y te preguntan lo importante.</p>
          </div>
          <ol aria-label="Pasos" style={{ margin: "auto 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "14px", position: "relative" }}>
            {steps.map((s) => (
              <li key={s.n} aria-current={s.current && !s.done ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "16px", fontWeight: s.current && !s.done ? "600" : "400", color: s.done || s.current ? "#FFFFFF" : "#C9CCD6" }}>
                {s.done
                  ? <span aria-label="Hecho" style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#3DDC97", color: "#12131A", display: "grid", placeItems: "center" }}><Check size={15} strokeWidth={3.2} aria-hidden="true" /></span>
                  : <span style={{ width: "32px", height: "32px", borderRadius: "50%", ...(s.current ? { background: "#FFC93C", color: "#12131A" } : { border: "1.5px solid #4A4F5C" }), display: "grid", placeItems: "center", font: "700 14px/1 'Geist Mono', monospace" }}>{s.n}</span>}
                {s.label}
              </li>
            ))}
          </ol>
        </section>

        <section style={{ flex: "1.4 1 520px", minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
          <div ref={scroller} role="log" aria-live="polite" aria-label="Conversación con Atlas" style={{ flex: "1", minHeight: 0, overflowY: "auto", padding: "clamp(24px, 4vw, 48px) clamp(20px, 4vw, 56px) 16px" }}>
            <div style={{ maxWidth: "720px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "4px" }}>
              {shown(0) ? (
                <>
                  <AtlasLine atlas={atlas} first entering={stage === 0}>{"¡Hola! Soy Atlas. Coordino a tu equipo de bots: reparto el trabajo, vigilo que salga bien y solo te pregunto lo importante."}</AtlasLine>
                  <AtlasLine atlas={atlas} entering={stage === 0}>{"Para empezar, ¿cómo te llamas?"}</AtlasLine>
                </>
              ) : null}
              {stage > 0 ? <YouLine text={name.trim()} onChange={() => goTo(0)} /> : null}

              {shown(1) ? <AtlasLine atlas={atlas} first entering={stage === 1}>{`Encantado, ${first}. ¿A qué te dedicas? Así te propongo un equipo con los roles que más te sirvan.`}</AtlasLine> : null}
              {stage > 1 && cur ? <YouLine text={cur.label} onChange={() => goTo(1)} /> : null}

              {shown(2) ? <AtlasLine atlas={atlas} first entering={stage === 2}>{"¿Qué usas en tu día a día? Elige todo lo que quieras; luego te diré qué conectar para que podamos ayudarte con ello."}</AtlasLine> : null}
              {stage > 2 ? <YouLine text={apps.length ? APPS.filter((a) => apps.includes(a.id)).map((a) => a.label).join(", ") : "Nada de esto, de momento"} onChange={() => goTo(2)} /> : null}

              {shown(3) ? (
                <AtlasLine atlas={atlas} first entering={stage === 3}>
                  <span>{`Este es el equipo que te propongo para ${cur?.label.toLowerCase()}. Yo estoy siempre, porque coordino; a los demás puedes quitarlos o añadirlos cuando quieras.`}</span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "10px", marginTop: "12px" }}>
                    {team.map((b) => {
                      const fixed = b.id === "atlas";
                      const on = fixed || !off.includes(b.id);
                      const editable = stage === 3 && !fixed;
                      return (
                        <button key={b.id} type="button" disabled={!editable} aria-pressed={on ? "true" : "false"} onClick={() => setOff((list) => (list.includes(b.id) ? list.filter((x) => x !== b.id) : [...list, b.id]))}
                          style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "14px", background: on ? "#F7F8FA" : "#FFFFFF", border: on ? "1.5px solid #12131A" : "1px dashed #C9CED8", borderRadius: "14px", textAlign: "left", cursor: editable ? "pointer" : "default", opacity: on ? 1 : 0.6, color: "#12131A" }}>
                          <BotAvatar bot={b} size={40} />
                          <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                              <strong style={{ fontSize: "15px" }}>{b.name} <span style={{ fontWeight: "500", color: "#4A4F5C" }}>{"· " + b.role}</span></strong>
                              {fixed ? <span style={{ padding: "3px 7px", background: "#FFF4D1", borderRadius: "5px", font: "600 11px/1.2 'Geist Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase" }}>{"Siempre"}</span> : null}
                            </span>
                            <span style={{ fontSize: "14px", lineHeight: "1.45", color: "#2B2D36" }}>{b.help}</span>
                          </span>
                          {fixed ? null
                            : <span aria-hidden="true" style={{ flex: "none", width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "6px", background: on ? "#12131A" : "#FFFFFF", border: on ? "0" : "1.5px solid #C9CED8", color: "#FFFFFF" }}>{on ? <Check size={14} strokeWidth={3} /> : null}</span>}
                        </button>
                      );
                    })}
                  </div>
                </AtlasLine>
              ) : null}
              {saved ? <YouLine text={"Me vale este equipo"} onChange={() => goTo(3)} /> : null}

              {shown(4) ? (
                <>
                  <AtlasLine atlas={atlas} first entering>
                    {connected
                      ? "¡Listo, el equipo está preparado! Para empezar, te propongo una de estas tareas. Elige una y la dejo escrita para que la lances, o pide lo que quieras."
                      : "¡Listo, el equipo está preparado! Solo falta una cosa: conectar tu cuenta de ChatGPT, que es lo que nos da cabeza a todos. Elige una primera tarea y te llevo a conectarla; la tarea te estará esperando."}
                  </AtlasLine>
                  <div className="c-enter" style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "6px 0 0 52px" }}>
                    {tasks.map((t, i) => (
                      <button key={t} type="button" onClick={() => start(t)} className="rm-focus"
                        style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "56px", padding: "10px 14px", background: "#FFFFFF", border: i === 0 ? "1.5px solid #12131A" : "1px solid #DCE0E8", borderRadius: "14px", textAlign: "left", cursor: "pointer", fontSize: "15px", color: "#12131A" }}>
                        <span aria-hidden="true" style={{ width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", background: i === 0 ? "#FFF4D1" : "#F7F8FA", borderRadius: "9px" }}>{i === 0 ? <Sparkles size={16} strokeWidth={2.2} /> : <BookOpen size={16} strokeWidth={2.2} />}</span>
                        <span style={{ flex: "1" }}>{t}</span>
                        <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#4A4F5C" }} />
                      </button>
                    ))}
                    {imported ? (
                      <span role="status" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 2px", fontSize: "14px", color: "#0B6B4A", fontWeight: 600 }}>
                        <Check size={16} strokeWidth={2.6} aria-hidden="true" />{imported === 1 ? "Ya conocemos 1 cosa de ti gracias a ChatGPT." : `Ya conocemos ${imported} cosas de ti gracias a ChatGPT.`}
                      </span>
                    ) : (
                      <button type="button" onClick={() => setImporting(true)} className="rm-focus"
                        style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "8px 14px", background: "#F7F8FA", border: "1px dashed #A9AEBB", borderRadius: "14px", textAlign: "left", cursor: "pointer", fontSize: "14px", color: "#12131A" }}>
                        <span aria-hidden="true" style={{ width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", background: "#FFFFFF", borderRadius: "9px" }}><Brain size={16} strokeWidth={2.2} /></span>
                        <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                          <strong>{"¿Usabas ChatGPT? Trae lo que ya sabe de ti"}</strong>
                          <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{"Tú eliges qué se queda. No se envía nada a ningún sitio."}</span>
                        </span>
                        <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#4A4F5C" }} />
                      </button>
                    )}
                    {importing ? <MemoryImport onClose={() => setImporting(false)} onDone={(r) => setImported(r.added)} /> : null}
                    <button type="button" onClick={() => start("")} style={{ alignSelf: "flex-start", padding: "6px 2px", background: "transparent", border: 0, cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>
                      {connected ? "Prefiero escribir lo mío" : "Conectar la cuenta y escribir lo mío"}
                    </button>
                  </div>
                </>
              ) : null}
              {typing ? <Typing atlas={atlas} /> : null}
            </div>
          </div>

          <div style={{ borderTop: "1px solid #E6E8EE", padding: "16px clamp(20px, 4vw, 56px) 20px", background: "#FFFFFF" }}>
            <div style={{ maxWidth: "720px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "12px" }}>
              {error ? <Notice>{error}</Notice> : null}
              {stage === 0 ? (
                <form onSubmit={sendName} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 6px 6px 16px", border: "1.5px solid #12131A", borderRadius: "14px", opacity: typing ? 0.6 : 1 }}>
                  <input ref={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Tu nombre" aria-label="Tu nombre" autoComplete="given-name"
                    style={{ flex: "1", minWidth: 0, height: "40px", border: 0, outline: "none", fontSize: "16px", background: "transparent" }} />
                  <button type="submit" disabled={!name.trim()} aria-label="Enviar" style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: name.trim() ? "#12131A" : "#DCE0E8", color: "#FFFFFF", border: 0, borderRadius: "10px", cursor: name.trim() ? "pointer" : "default" }}><ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" /></button>
                </form>
              ) : null}
              {stage === 1 && !typing ? (
                <div role="radiogroup" aria-label="A qué te dedicas" className="c-enter" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {ROLES.map((r) => <button key={r.id} type="button" role="radio" aria-checked={role === r.id ? "true" : "false"} onClick={() => pickRole(r.id)} style={chip(role === r.id)}>{r.label}</button>)}
                </div>
              ) : null}
              {stage === 2 && !typing ? (
                <div className="c-enter" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div role="group" aria-label="Lo que usas" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {APPS.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={apps.includes(id) ? "true" : "false"} onClick={() => toggleApp(id)} style={chip(apps.includes(id))}><Icon size={16} strokeWidth={2.2} aria-hidden="true" />{label}</button>)}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
                    <button type="button" onClick={() => goTo(3)} style={primary}>{apps.length ? "Listo" : "Nada de esto, de momento"}<ArrowRight size={17} strokeWidth={2.4} aria-hidden="true" /></button>
                  </div>
                </div>
              ) : null}
              {stage === 3 && !typing ? (
                <div className="c-enter" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
                  <button type="button" onClick={saveTeam} aria-busy={busy === "team"} style={{ ...primary, cursor: busy ? "wait" : "pointer" }}>
                    {busy === "team" ? <><Spinner size={16} />Preparando tu equipo…</> : <>{"Me vale este equipo"}<ArrowRight size={17} strokeWidth={2.4} aria-hidden="true" /></>}
                  </button>
                  <span style={{ fontSize: "14px", color: "#4A4F5C" }}>{"Pulsa un bot para quitarlo o volver a ponerlo."}</span>
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {stage < 4 ? <a href="/" onClick={skip} aria-busy={busy === "skip"} style={{ fontSize: "14px", color: "#4A4F5C", textDecoration: "underline", cursor: busy ? "wait" : "pointer" }}>Saltar, lo configuro luego</a> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
