import { useEffect, useRef, useState } from "react";
import { post, pickTextFiles } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { useExpert } from "../../../lib/expert.js";
import { MicButton, appendDictation } from "../../interaction/Voice.jsx";
import { SHAPES } from "../Presence.jsx";
import { TOOL_KEYS, TOOL_LABEL, skillMarkdown } from "../../team/common.jsx";
import { autonomyLabel, Seg } from "../../v3/team/parts.jsx";

// Colmena 3 · «Nuevo bot» (design/V3NuevoBot.dc.html), a page inside Equipo: three steps —
// 1 Describe (as to a new colleague; Atlas checks what is missing), 2 Ajusta (name, role,
// shape, colour, instructions, skills, what it can use), 3 Prueba (a private test chat;
// nothing is saved or sent) — with «Así se verá» beside them. Honey is not offered as a
// colour (it means «te necesita») and ink belongs to Atlas.
const SHAPE_LIST = [["hex", "hexágono"], ["circle", "círculo"], ["square", "cuadrado"], ["diamond", "rombo"], ["arch", "arco"], ["leaf", "hoja"]];
const COLORS = [["#0E7C86", "verde azulado"], ["#2F6BFF", "azul"], ["#7B4DFF", "violeta"], ["#FF5CA8", "rosa"], ["#FF7A1A", "naranja"], ["#0B8A5F", "verde"], ["#B4236E", "frambuesa"]];
const EXAMPLES = [
  ["Contable", "Que lea las facturas de proveedores que llegan al correo, las apunte en la hoja de gastos y me avise si alguna pasa de 500 € o vence esta semana. Que nunca pague nada."],
  ["Atención al cliente", "Que conteste los correos de clientes con nuestro tono cercano y me pase los que sean quejas. Que nunca envíe nada sin preguntarme."],
  ["Investigador de mercado", "Que busque en la web lo que publica la competencia cada semana y me entregue un resumen con tres cifras y sus fuentes."],
  ["Community manager", "Que prepare cada lunes las publicaciones de la semana para redes con nuestro tono, y me las deje para revisar. Que nunca publique sin preguntarme."],
  ["Asistente de agenda", "Que mire mi calendario y mi correo cada mañana, me avise de las reuniones del día y proponga huecos cuando alguien pida una cita."],
];
const AUDIENCE = [["yo", "Solo para mí", "Usa tus cuentas y tu memoria", "solo para ti"], ["equipo", "Para salas de equipo", "Responde a quien le escriba", "para el equipo"]];
const ACCESS = [["none", "No"], ["lee", "Lee"], ["pide", "Pide"], ["escribe", "Escribe"]];
const LEVEL = { lee: "leer", pide: "pide para escribir", escribe: "escribir" };
const STEPS = ["Describe", "Ajusta", "Prueba"];

const checksOf = (d, files) => {
  const t = d.toLowerCase();
  return [
    ["Qué tiene que hacer", /revis|contest|respond|prepar|traduc|apunt|lee|resum|busca|organiz|escrib|calcul|compar|mire/.test(t)],
    ["Qué te entrega o cuándo te avisa", /avis|resumen|tabla|entreg|me pase|cada lunes|cada día|cada mañana|antes de|informe|deje/.test(t)],
    ["Con qué información trabaja", /correo|hoja|carpeta|contrato|factura|catálogo|código|web|calendario|excel|documento|redes/.test(t) || files.length > 0],
    ["Qué no debe hacer nunca", /nunca|sin preguntar|no envíes|no publiques|no pagues/.test(t)],
  ];
};
const label = { display: "flex", flexDirection: "column", gap: "6px", fontSize: "13.5px", fontWeight: "600", color: "#3D404A" };
const input = { height: "44px", padding: "0 14px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "12px", fontSize: "15px", fontWeight: "400", color: "#12131A", background: "#FFFFFF" };
const sr = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };

export default function NewBot({ onClose, onHired }) {
  const { run } = useStore();
  const [expert] = useExpert();
  const [step, setStep] = useState(0);
  const [desc, setDesc] = useState("");
  const [audience, setAudience] = useState("yo");
  const [files, setFiles] = useState([]);
  const [d, setD] = useState(null); // the prepared draft
  const [skillIn, setSkillIn] = useState("");
  const [chat, setChat] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const chatEnd = useRef(null);
  useEffect(() => { const k = (e) => e.key === "Escape" && !busy && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose, busy]);
  useEffect(() => { chatEnd.current?.scrollIntoView?.({ block: "nearest" }); }, [chat, busy]);
  const set = (p) => setD((cur) => ({ ...cur, ...p }));

  const addFiles = async (list) => {
    const read = await Promise.all([...list].map((f) => f.text().then((content) => ({ name: f.name, content })).catch(() => null)));
    setFiles((cur) => [...cur, ...read.filter(Boolean)].slice(0, 5));
  };
  const prepare = async () => {
    if (desc.trim().length < 20) return setError("Añade un poco más de detalle y el bot saldrá mejor a la primera.");
    setBusy("prepare");
    setError(null);
    try {
      const r = await post("/bots/prepare", { description: desc.trim(), audience, materials: files.filter((f) => typeof f.content === "string").map(({ name, content }) => ({ name, content })) });
      const color = /^#[0-9a-f]{6}$/i.test(r.color || "") && !["#FFC93C", "#12131A"].includes(r.color.toUpperCase()) ? r.color : COLORS[0][0];
      setD({
        name: r.name || "", role: r.role || "", instructions: r.instructions || desc.trim(), shape: SHAPES[r.shape] && r.shape !== "hex" ? r.shape : "leaf", color,
        skills: (r.skills || []).map((s) => ({ name: s.name, description: s.description || "" })), tools: { ...(r.permissions || {}) }, autonomy: r.autonomy || "sugiere",
      });
      setStep(1);
    } catch (e) {
      setError(e.status === 404 || e.status === 501 ? "Para preparar un bot hace falta una cuenta de IA conectada (Ajustes › Inteligencia)." : e.message);
    } finally {
      setBusy(null);
    }
  };
  const ask = async (text) => {
    const t = (text ?? q).trim();
    if (!t || busy) return;
    setQ("");
    setChat((c) => [...c, { who: "user", text: t }]);
    setBusy("ask");
    try {
      const r = await post("/bots/preview", { draft: { name: d.name, role: d.role, instructions: d.instructions, color: d.color, shape: d.shape, audience, autonomy: d.autonomy, tools: d.tools }, prompt: t });
      setChat((c) => [...c, { who: "bot", text: r?.text || "" }]);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const hire = async () => {
    setBusy("hire");
    setError(null);
    try {
      const bot = await run(() => post("/bots", { name: d.name.trim(), role: d.role.trim(), instructions: d.instructions.trim(), color: d.color, shape: d.shape, audience, autonomy: d.autonomy, tools: d.tools }));
      for (const s of d.skills) {
        try { await post("/skills", { content: skillMarkdown(s, bot), source: `Propuesta al contratar a ${bot.name}`, botId: bot.id }); } catch {}
      }
      onHired(bot);
    } catch (e) { setError(e.message); setBusy(null); }
  };
  const checkAjusta = () => {
    if (!d.name.trim()) return "Ponle un nombre antes de probarlo.";
    if (!d.role.trim()) return "Indica su puesto antes de probarlo.";
    if (d.instructions.trim().length < 10) return "Las instrucciones son demasiado cortas.";
    return null;
  };
  const next = () => {
    if (step === 0) return prepare();
    if (step === 1) { const e = checkAjusta(); setError(e); if (!e) setStep(2); return; }
    return hire();
  };
  const reach = (i) => i === step || i === 0 || (i === 1 && d) || (i === 2 && d && !checkAjusta());

  const color = d?.color || COLORS[0][0];
  const shape = SHAPES[d?.shape] || SHAPES.leaf;
  const aud = AUDIENCE.find((a) => a[0] === audience);
  const name = step === 0 ? "Tu bot" : d?.name?.trim() || "Sin nombre";
  const role = step === 0 ? (desc.trim().length > 20 ? "Lo preparamos con lo que escribas" : "Describe lo que hará") : d?.role?.trim() || "Sin puesto";
  const hello = step === 0 ? "Cuéntame qué necesitas y lo preparo." : `Hola, soy ${d?.name || "tu bot"}. ${d?.role ? `Me ocupo de ${d.role.charAt(0).toLowerCase() + d.role.slice(1)}.` : ""} Nunca hago nada irreversible sin tu OK.`;
  const usable = d ? TOOL_KEYS.filter((k) => (d.tools[k] || "none") !== "none") : [];
  return (
    <main style={{ maxWidth: "1120px", margin: "0 auto", padding: "36px clamp(20px, 4vw, 48px) 48px", display: "flex", flexDirection: "column", gap: "24px" }}>
      <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#5C606C" }}>
        <a href="/equipo" style={{ color: "#5C606C" }}>{"Equipo"}</a>
        <span aria-hidden="true">{"›"}</span>
        <span style={{ color: "#12131A", fontWeight: "500" }}>{"Nuevo bot"}</span>
      </nav>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <h1 style={{ margin: "0", font: "600 44px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{"Un compañero nuevo"}</h1>
        <ol aria-label="Pasos" style={{ margin: "0", padding: "4px", listStyle: "none", display: "inline-flex", gap: "2px", borderRadius: "999px", background: "#EBEBE6" }}>
          {STEPS.map((l, i) => {
            const cur = i === step;
            const ok = reach(i);
            return (
              <li key={l}>
                <button type="button" aria-current={cur ? "step" : undefined} disabled={!ok || !!busy} onClick={() => { setError(null); setStep(i); }} style={{ height: "36px", padding: "0 16px", display: "inline-flex", alignItems: "center", gap: "8px", border: "0", borderRadius: "999px", background: cur ? "#FFFFFF" : "transparent", boxShadow: cur ? "0 1px 2px rgba(18,19,26,.1)" : "none", fontSize: "14px", fontWeight: cur ? "600" : "500", color: ok ? "#12131A" : "#8C8F99", cursor: ok ? "pointer" : "default" }}>
                  <span style={{ fontSize: "12px", color: "#5C606C" }}>{i < step ? "✓" : String(i + 1)}</span>{l}
                </button>
              </li>
            );
          })}
        </ol>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "22px", alignItems: "flex-start" }}>
        <section aria-label="Formulario" style={{ flex: "999 1 520px", minWidth: "0", display: "flex", flexDirection: "column", gap: "20px", padding: "26px 28px", borderRadius: "26px", background: "#FFFFFF" }}>
          {step === 0 ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label htmlFor="nb-desc" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={{ fontSize: "17px", fontWeight: "600" }}>{"¿Qué hará?"}</span>
                  <span style={{ fontSize: "14px", color: "#5C606C" }}>{"Cuéntaselo como a un compañero nuevo. Con una o dos frases basta; luego lo afinas."}</span>
                </label>
                <div style={{ position: "relative" }}>
                  <textarea className="c-quiet" id="nb-desc" rows="4" value={desc} onChange={(e) => { setDesc(e.target.value); setError(null); }} placeholder="Ej.: Lee las facturas de proveedores que llegan al correo, apúntalas en la hoja de gastos y avísame si alguna pasa de 500 €."
                    style={{ width: "100%", padding: "14px 60px 14px 16px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "16px", background: "#FFFFFF", fontSize: "16px", lineHeight: "1.5", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
                  <span style={{ position: "absolute", right: "10px", bottom: "12px", display: "flex" }}><MicButton onText={appendDictation(setDesc)} size={38} style={{ background: "#F6F6F3" }} /></span>
                </div>
                <div role="list" aria-label="Atlas lo va revisando" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                  {checksOf(desc, files).map(([l, ok]) => (
                    <span key={l} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: ok ? "#0B6B4A" : "#5C606C", transition: "color .25s ease" }}>
                      <span aria-hidden="true" style={{ width: "16px", height: "16px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: ok ? "#0B8A5F" : "transparent", boxShadow: ok ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)", transition: "all .25s ease" }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: ok ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                      </span>
                      {l}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>{"O empieza con un ejemplo"}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {EXAMPLES.map(([l, t]) => <button key={l} type="button" onClick={() => { setDesc(t); setError(null); }} style={{ height: "36px", padding: "0 14px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: desc === t ? "#F1F1EC" : "#FFFFFF", fontSize: "14px", color: "#3D404A", cursor: "pointer" }}>{l}</button>)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>{"Para quién trabaja"}</span>
                <div role="radiogroup" aria-label="Para quién" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "8px" }}>
                  {AUDIENCE.map(([v, l, t]) => (
                    <button key={v} type="button" role="radio" aria-checked={audience === v ? "true" : "false"} onClick={() => setAudience(v)} style={{ padding: "12px 14px", border: `2px solid ${audience === v ? "#12131A" : "rgba(18,19,26,.1)"}`, borderRadius: "14px", background: "#FFFFFF", textAlign: "left", cursor: "pointer" }}>
                      <span style={{ display: "block", fontSize: "14.5px", fontWeight: "600" }}>{l}</span>
                      <span style={{ fontSize: "13px", color: "#5C606C" }}>{t}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={async () => { try { const picked = await pickTextFiles(); setFiles((f) => [...f, ...picked].slice(0, 5)); } catch (e) { setError(e.message); } }}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", padding: "22px", borderRadius: "18px", border: `1.5px dashed ${drag ? "#12131A" : "rgba(18,19,26,.2)"}`, background: drag ? "#F6F6F3" : "#FFFFFF", textAlign: "center", cursor: "pointer" }}>
                <span style={{ fontSize: "14.5px", fontWeight: "600" }}>{"Dale ejemplos de su trabajo (opcional)"}</span>
                <span style={{ fontSize: "13.5px", color: "#5C606C" }}>{"Arrastra facturas, correos o una hoja. Máximo cinco."}</span>
              </button>
              {files.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "-8px" }}>
                  {files.map((f, i) => (
                    <span key={f.name + i} style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 6px 0 12px", borderRadius: "999px", background: "#F6F6F3", fontSize: "13px", animation: "pop .3s ease-out" }}>
                      {f.name}
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={"Quitar " + f.name} style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#5C606C" }}>{"×"}</button>
                    </span>
                  ))}
                </div>
              ) : null}
              {busy === "prepare" ? (
                <div role="status" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "16px", background: "#F6F6F3", animation: "rise .3s ease-out" }}>
                  <span aria-hidden="true" style={{ width: "16px", height: "16px", borderRadius: "50%", border: "2px solid rgba(18,19,26,.15)", borderTopColor: "#12131A", animation: "spin .8s linear infinite" }} />
                  <span style={{ fontSize: "14.5px", fontWeight: "500" }}>{"Colmena está preparando nombre, instrucciones, habilidades y permisos…"}</span>
                </div>
              ) : null}
            </>
          ) : null}

          {step === 1 && d ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "12px" }}>
                <label style={label}>{"Nombre"}<input className="c-quiet" type="text" value={d.name} maxLength="20" onChange={(e) => set({ name: e.target.value })} placeholder="Ponle un nombre" style={input} /></label>
                <label style={label}>{"Puesto"}<input className="c-quiet" type="text" value={d.role} maxLength="100" onChange={(e) => set({ role: e.target.value })} placeholder="Qué hace, en pocas palabras" style={input} /></label>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <span style={{ fontSize: "13.5px", fontWeight: "600", color: "#3D404A" }}>{"Forma"}</span>
                <div role="radiogroup" aria-label="Forma" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {SHAPE_LIST.map(([id, l]) => {
                    const on = d.shape === id;
                    return (
                      <button key={id} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={l} title={l} onClick={() => set({ shape: id })} style={{ width: "52px", height: "52px", display: "grid", placeItems: "center", border: `2px solid ${on ? "#12131A" : "rgba(18,19,26,.1)"}`, borderRadius: "14px", background: "#FFFFFF", cursor: "pointer" }}>
                        <span style={{ width: "26px", height: "26px", background: d.color, clipPath: SHAPES[id].clip, borderRadius: SHAPES[id].radius }} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <span style={{ fontSize: "13.5px", fontWeight: "600", color: "#3D404A" }}>{"Color "}<span style={{ fontWeight: "400", color: "#5C606C" }}>{"· la miel es para «te necesita» y la tinta, para Atlas"}</span></span>
                <div role="radiogroup" aria-label="Color" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {COLORS.map(([hex, l]) => {
                    const on = d.color.toUpperCase() === hex;
                    return <button key={hex} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={l} title={l} onClick={() => set({ color: hex })} style={{ width: "38px", height: "38px", padding: "0", border: `3px solid ${on ? "#12131A" : "#FFFFFF"}`, borderRadius: "50%", background: hex, cursor: "pointer" }} />;
                  })}
                </div>
              </div>
              <label style={label}>
                {"Instrucciones · Colmena las ha preparado"}
                <textarea className="c-quiet" rows="5" value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} style={{ padding: "12px 14px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "14px", fontSize: "14.5px", fontWeight: "400", lineHeight: "1.55", color: "#12131A", fontFamily: "inherit", resize: "vertical" }} />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "13.5px", fontWeight: "600", color: "#3D404A" }}>{"Habilidades preparadas"}</span>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                  {d.skills.map((k, i) => (
                    <span key={k.name + i} style={{ height: "40px", padding: "0 6px 0 14px", display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", background: "#F6F6F3", fontSize: "14px", animation: "pop .3s ease-out" }}>
                      {k.name}
                      <button type="button" onClick={() => set({ skills: d.skills.filter((_, j) => j !== i) })} aria-label={"Quitar " + k.name} style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#5C606C" }}>{"×"}</button>
                    </span>
                  ))}
                  <form className="c-ring" onSubmit={(e) => { e.preventDefault(); if (skillIn.trim()) { set({ skills: [...d.skills, { name: skillIn.trim(), description: "" }].slice(0, 8) }); setSkillIn(""); } }} style={{ height: "40px", display: "inline-flex", alignItems: "center", gap: "4px", padding: "0 4px 0 14px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px" }}>
                    <label style={{ display: "flex" }}><span style={sr}>{"Nombre de la habilidad"}</span><input className="c-bare" type="text" value={skillIn} onChange={(e) => setSkillIn(e.target.value)} placeholder="Otra: resumir contratos…" style={{ width: "170px", border: "0", background: "transparent", fontSize: "14px" }} /></label>
                    <button type="submit" style={{ height: "30px", padding: "0 12px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "12.5px", fontWeight: "600" }}>{"Añadir"}</button>
                  </form>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "13.5px", fontWeight: "600", color: "#3D404A" }}>{"Puede usar"}</span>
                {expert ? (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {TOOL_KEYS.map((k) => (
                      <div key={k} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", minHeight: "48px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                        <span style={{ flex: "1 1 160px", fontSize: "14.5px" }}>{TOOL_LABEL[k] || k}</span>
                        <Seg label={TOOL_LABEL[k] || k} items={ACCESS} value={d.tools[k] || "none"} onPick={(v) => set({ tools: { ...d.tools, [k]: v } })} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {TOOL_KEYS.map((k) => {
                      const v = d.tools[k] || "none";
                      const on = v !== "none";
                      return (
                        <label key={k} style={{ height: "40px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", borderRadius: "999px", background: "#F6F6F3", fontSize: "14px", cursor: "pointer" }}>
                          <input type="checkbox" checked={on} onChange={() => set({ tools: { ...d.tools, [k]: on ? "none" : "lee" } })} style={{ accentColor: "#12131A" }} />
                          {(TOOL_LABEL[k] || k) + (on ? ` (${LEVEL[v] || v})` : "")}
                        </label>
                      );
                    })}
                  </div>
                )}
                <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Enviar algo fuera, mover dinero, borrar o instalar siempre te lo pregunta. Lo afinas después en su ficha."}</span>
              </div>
            </>
          ) : null}

          {step === 2 && d ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "17px", fontWeight: "600" }}>{"Hazle una pregunta de prueba"}</span>
                <span style={{ fontSize: "14px", color: "#5C606C" }}>{"Responde con las instrucciones que acabas de escribir. Nada se guarda ni se envía."}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", minHeight: "140px", maxHeight: "380px", overflowY: "auto", padding: "18px", borderRadius: "18px", background: "#F6F6F3" }}>
                {chat.map((m, i) => (m.who === "user"
                  ? <div key={i} style={{ alignSelf: "flex-end", maxWidth: "80%", padding: "12px 16px", borderRadius: "18px 18px 6px 18px", background: "#EBEBE6", fontSize: "15px" }}>{m.text}</div>
                  : <div key={i} style={{ display: "flex", gap: "10px" }}><span aria-hidden="true" style={{ flex: "none", width: "22px", height: "22px", background: color, clipPath: shape.clip, borderRadius: shape.radius }} /><span style={{ fontSize: "15px", lineHeight: "1.55", whiteSpace: "pre-wrap" }}>{m.text}</span></div>))}
                {busy === "ask" ? <div role="status" style={{ display: "flex", gap: "10px", alignItems: "center" }}><span aria-hidden="true" style={{ flex: "none", width: "22px", height: "22px", background: color, clipPath: shape.clip, borderRadius: shape.radius, animation: "breathe 1.4s ease-in-out infinite" }} /><span style={{ fontSize: "14px", color: "#5C606C" }}>{`${d.name || "Tu bot"} está pensando…`}</span></div> : null}
                {!chat.length && busy !== "ask" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {[`¿Qué puedes hacer por mí${d.role ? ` como ${d.role.toLowerCase()}` : ""}?`, "Preséntate en dos frases"].map((t) => <button key={t} type="button" onClick={() => ask(t)} style={{ height: "34px", padding: "0 12px", border: "0", borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "13px" }}>{t}</button>)}
                  </div>
                ) : null}
                <span ref={chatEnd} />
              </div>
              <form className="c-ring" onSubmit={(e) => { e.preventDefault(); ask(); }} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 8px 8px 16px", borderRadius: "16px", border: "1px solid rgba(18,19,26,.14)" }}>
                <label style={{ flex: "1", display: "flex" }}>
                  <span style={sr}>{"Otra pregunta de prueba"}</span>
                  <input className="c-bare" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={chat.length ? "Otra pregunta de prueba…" : `Pregúntale algo a ${d.name || "tu bot"}…`} style={{ flex: "1", minWidth: "0", height: "40px", border: "0", fontSize: "15px", background: "transparent" }} />
                </label>
                <button type="submit" aria-label="Preguntar" disabled={busy === "ask" || !q.trim()} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: q.trim() ? "#12131A" : "#C9CBD1", color: "#FFFFFF", cursor: "pointer" }}>{"↑"}</button>
              </form>
            </>
          ) : null}

          {error ? <p role="alert" style={{ margin: "0", fontSize: "14px", color: "#B4232A" }}>{error}</p> : null}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingTop: "6px", borderTop: "1px solid rgba(18,19,26,.07)" }}>
            {step > 0
              ? <button type="button" onClick={() => { setError(null); setStep(step - 1); }} style={{ height: "46px", padding: "0 16px", border: "0", background: "transparent", fontSize: "15px", color: "#4A4D57", cursor: "pointer" }}>{"Atrás"}</button>
              : <button type="button" onClick={onClose} style={{ height: "46px", padding: "0 16px", border: "0", background: "transparent", fontSize: "15px", color: "#4A4D57", cursor: "pointer" }}>{"Ahora no"}</button>}
            <span style={{ flex: "1" }} />
            <button type="button" disabled={!!busy} onClick={next} style={{ height: "46px", padding: "0 22px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "15px", fontWeight: "600", cursor: busy ? "wait" : "pointer" }}>
              {step === 0 ? (busy === "prepare" ? "Preparando…" : "Preparar el bot") : step === 1 ? "Probarlo" : busy === "hire" ? "Contratando…" : `Contratar a ${d?.name?.trim() || "este bot"}`}
            </button>
          </div>
        </section>
        <aside aria-label="Así se verá" style={{ flex: "1 1 280px", minWidth: "0", position: "sticky", top: "24px", display: "flex", flexDirection: "column", gap: "16px", padding: "24px", borderRadius: "26px", background: "#12131A", color: "#FFFFFF" }}>
          <span style={{ fontSize: "13px", color: "#A9ACB6" }}>{"Así se verá"}</span>
          <span aria-hidden="true" style={{ width: "72px", height: "72px", background: color, clipPath: shape.clip, borderRadius: shape.radius, animation: "breathe 2.8s ease-in-out infinite", transition: "background .4s ease" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{name}</span>
            <span style={{ fontSize: "14.5px", color: "#C9CBD3" }}>{`${role} · ${aud[3]}`}</span>
          </div>
          <p style={{ margin: "0", fontSize: "14.5px", lineHeight: "1.5", color: "#E6E7EC" }}>{"«" + hello + "»"}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "14px", borderTop: "1px solid rgba(255,255,255,.12)", fontSize: "13.5px", color: "#C9CBD3" }}>
            <span>{"Autonomía: " + autonomyLabel(d?.autonomy || "sugiere").toLowerCase()}</span>
            <span>{d ? (d.skills.length === 1 ? "1 habilidad preparada" : `${d.skills.length} habilidades preparadas`) : "Las habilidades, al prepararlo"}</span>
            <span>{d ? (usable.length ? usable.map((k) => `${TOOL_LABEL[k] || k} (${LEVEL[d.tools[k]] || d.tools[k]})`).join(" · ") : "Sin apps conectadas") : "Las apps que use, al prepararlo"}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
