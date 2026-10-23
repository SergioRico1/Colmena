import { useEffect, useRef, useState } from "react";
import { post } from "../../../lib/api.js";
import { pickTextFiles } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { MicButton, appendDictation } from "../../interaction/Voice.jsx";
import { SHAPES, gloss } from "../Presence.jsx";
import { TOOL_KEYS, TOOL_LABEL, skillMarkdown } from "../../team/common.jsx";

// «Nuevo bot» of Colmena 2.0 (design/V2Colmena.dc.html): three steps in one sheet with the
// live preview on the left. 1 Describe (as to a new colleague; Atlas checks what is missing),
// 2 Ajusta (name, role, look, instructions, skills, what it can use), 3 Pruébalo y contrátalo
// (a private test chat; nothing is saved or sent). Honey is not offered as a colour.
const SHAPE_LIST = [["circle", "Círculo"], ["hex", "Hexágono"], ["square", "Cuadrado"], ["diamond", "Rombo"], ["arch", "Arco"], ["leaf", "Hoja"]];
const COLORS = [["#0E7C86", "Turquesa"], ["#2F6BFF", "Azul"], ["#7B4DFF", "Violeta"], ["#FF5CA8", "Rosa"], ["#FF7A1A", "Naranja"], ["#0B8A5F", "Verde"], ["#D9366F", "Frambuesa"], ["#4F5BD5", "Añil"], ["#2B2D36", "Tinta"], ["#B08D57", "Arena"]];
const EXAMPLES = [
  ["Facturas", "Que lea las facturas que llegan al correo, las apunte en la hoja de gastos y me avise si alguna pasa de 500 €."],
  ["Clientes", "Que conteste los correos de clientes con nuestro tono cercano y me pase los que sean quejas."],
  ["Ventas", "Que cada lunes me prepare un resumen de ventas de la semana con tres cifras y un gráfico."],
];
const ACCESS = [["none", "No"], ["lee", "Leer"], ["pide", "Pide para escribir"], ["escribe", "Escribir"]];
const AUDIENCE = [["yo", "Solo para mí", "Trabaja con tus cosas y solo te responde a ti."], ["equipo", "Para el equipo", "Cualquiera de tu espacio puede pedirle cosas."]];
const AUTONOMY = [["sugiere", "Solo sugiere"], ["avisa", "Hace y te avisa"], ["solo", "Hace solo"]];

const checksOf = (d, files) => {
  const t = d.toLowerCase();
  return [
    ["Qué tiene que hacer", /revis|contest|respond|prepar|traduc|apunt|lee|resum|busca|organiz|escrib|calcul|compar/.test(t)],
    ["Qué te entrega o cuándo te avisa", /avis|resumen|tabla|entreg|me pase|cada lunes|cada día|antes de|informe/.test(t)],
    ["Con qué información trabaja", /correo|hoja|carpeta|contrato|factura|catálogo|código|web|calendario|excel|documento/.test(t) || files.length > 0],
    ["Qué no debe hacer nunca", /nunca|sin preguntar|no envíes|no publiques|no pagues/.test(t)],
  ];
};

export default function NewBot({ onClose, onHired }) {
  const { run } = useStore();
  const [step, setStep] = useState(1);
  const [desc, setDesc] = useState("");
  const [audience, setAudience] = useState("equipo");
  const [files, setFiles] = useState([]);
  const [d, setD] = useState(null); // the prepared draft
  const [skillIn, setSkillIn] = useState("");
  const [chat, setChat] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const chatEnd = useRef(null);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  useEffect(() => { chatEnd.current?.scrollIntoView?.({ block: "nearest" }); }, [chat, busy]);
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));

  const prepare = async () => {
    if (desc.trim().length < 20) return setError("Añade un poco más de detalle y el bot saldrá mejor a la primera.");
    setBusy("prepare");
    setError(null);
    try {
      const r = await post("/bots/prepare", { description: desc.trim(), audience, materials: files.filter((f) => typeof f.content === "string").map(({ name, content }) => ({ name, content })) });
      setD({
        name: r.name || "", role: r.role || "", instructions: r.instructions || desc.trim(), shape: SHAPES[r.shape] ? r.shape : "circle",
        color: /^#[0-9a-f]{6}$/i.test(r.color || "") && r.color.toUpperCase() !== "#FFC93C" ? r.color : COLORS[0][0],
        skills: (r.skills || []).map((s) => ({ name: s.name, description: s.description || "" })), tools: { ...(r.permissions || {}) }, autonomy: r.autonomy || "sugiere",
        ideas: [r.name].filter(Boolean),
      });
      setStep(2);
    } catch (e) {
      setError(e.status === 404 || e.status === 501 ? "Para preparar un bot hace falta tu cuenta de ChatGPT conectada (Ajustes › Cuenta de IA)." : e.message);
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
  const next = () => {
    if (step === 1) return prepare();
    if (step === 2) {
      if (!d.name.trim()) return setError("Ponle un nombre antes de contratarlo.");
      if (!d.role.trim()) return setError("Indica su puesto antes de contratarlo.");
      if (d.instructions.trim().length < 10) return setError("Las instrucciones son demasiado cortas.");
      setError(null);
      return setStep(3);
    }
    return hire();
  };

  const color = d?.color || "#C9CBD1";
  const shape = SHAPES[d?.shape] || SHAPES.circle;
  const nameShown = step === 1 ? "Tu bot" : d?.name?.trim() || "Sin nombre";
  const roleShown = step === 1 ? (desc.trim().length > 20 ? "Lo preparamos con lo que escribas" : "Describe lo que hará") : d?.role?.trim() || "Sin puesto";
  const hello = step === 1 ? "Cuéntame qué necesitas y lo preparo." : `Hola, soy ${d?.name || "tu bot"}. ${d?.role ? `Me ocupo de ${d.role.charAt(0).toLowerCase() + d.role.slice(1)}.` : ""} ¿Por dónde empiezo?`;
  const field = { height: "54px", padding: "0 18px", border: "0", borderRadius: "16px", outline: "none", background: "#F4F4F0", fontSize: "16px", width: "100%", boxSizing: "border-box" };
  const label = { fontSize: "13px", fontWeight: "500", color: "#5C606C" };
  const seg = (on) => ({ background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" });
  return (
    <div style={{ position: "fixed", top: "0", right: "0", bottom: "0", left: "84px", zIndex: "60", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "32px 24px", overflowY: "auto", background: "rgba(18,19,26,.3)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", animation: "fade .2s ease-out" }}>
      <section role="dialog" aria-modal="true" aria-labelledby="nb-t" style={{ width: "min(1140px, 100%)", display: "flex", flexWrap: "wrap", background: "#FFFFFF", borderRadius: "34px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55)", overflow: "hidden", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
        <aside aria-label="Así se verá" style={{ flex: "1 1 340px", minWidth: "0", display: "flex", flexDirection: "column", gap: "22px", padding: "34px 32px", transition: "background .6s ease", background: `linear-gradient(180deg, ${color}24, ${color}08)` }}>
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{"Así se verá"}</span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px", padding: "34px 20px 28px", borderRadius: "28px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 50px -30px rgba(18,19,26,.35)", textAlign: "center" }}>
            <span aria-hidden="true" style={{ display: "inline-grid", animation: "drift 5s ease-in-out infinite", filter: `drop-shadow(0 16px 30px ${color}66)` }}>
              <span style={{ display: "block", width: "116px", height: "116px", transition: "all .45s cubic-bezier(.2,.8,.2,1)", background: gloss(color), clipPath: shape.clip, borderRadius: shape.radius }} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <strong style={{ font: "600 34px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{nameShown}</strong>
              <span style={{ fontSize: "15px", color: "#5C606C" }}>{roleShown}</span>
            </div>
            <span style={{ padding: "6px 12px", borderRadius: "999px", background: "#F4F4F0", fontSize: "12px", fontWeight: "600", color: "#3D404A" }}>{AUDIENCE.find((a) => a[0] === audience)[1]}</span>
            <p style={{ margin: "0", padding: "14px 16px", borderRadius: "18px", background: "#F6F6F3", fontSize: "15px", lineHeight: "1.5", color: "#1E2029", textAlign: "left" }}>{"«" + hello + "»"}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {[["Describe", 1], ["Ajusta", 2], ["Pruébalo y contrata", 3]].map(([l, n]) => {
              const cur = n === step;
              const reach = n < step || (n === 2 && d) || (n === 3 && d && step === 3);
              return (
                <button key={n} type="button" disabled={!reach && !cur} onClick={() => reach && setStep(n)} aria-current={cur ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "46px", padding: "0 12px", border: "0", borderRadius: "14px", cursor: reach ? "pointer" : "default", textAlign: "left", background: cur ? "rgba(255,255,255,.75)" : "transparent" }}>
                  <span aria-hidden="true" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", borderRadius: "50%", font: "600 12px/1 'Geist', sans-serif", background: n < step ? "#0B8A5F" : cur ? "#12131A" : "rgba(18,19,26,.08)", color: n <= step ? "#FFFFFF" : "#6B6F7A" }}>{n < step ? "✓" : n}</span>
                  <span style={{ fontSize: "15px", fontWeight: cur ? 600 : 500 }}>{l}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div style={{ flex: "2 1 560px", minWidth: "0", display: "flex", flexDirection: "column", padding: "30px 34px 28px", gap: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <h2 id="nb-t" style={{ margin: "0", font: "600 34px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{["Un bot nuevo", "Ajústalo a tu gusto", "Pruébalo y contrátalo"][step - 1]}</h2>
            <button type="button" onClick={onClose} aria-label="Cerrar y volver a Tu colmena" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "rgba(18,19,26,.06)", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>

          {step === 1 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "22px", animation: "fade .3s ease-out" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label htmlFor="nb-desc" style={{ fontSize: "17px", color: "#3D404A" }}>{"Cuéntaselo como a un compañero nuevo. Con una o dos frases basta; luego lo afinas."}</label>
                <div style={{ position: "relative" }}>
                  <textarea id="nb-desc" rows="4" value={desc} onChange={(e) => { setDesc(e.target.value); setError(null); }} placeholder="Ej.: Quiero alguien que conteste los correos de clientes con nuestro tono y me pase los difíciles."
                    style={{ width: "100%", padding: "18px 64px 18px 20px", border: "0", borderRadius: "22px", outline: "none", background: "#F4F4F0", fontSize: "17px", lineHeight: "1.55", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
                  <span style={{ position: "absolute", right: "12px", bottom: "14px", display: "flex" }}>
                    <MicButton onText={appendDictation(setDesc)} size={42} style={{ background: "#FFFFFF" }} />
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "13px", color: "#6B6F7A", marginRight: "4px" }}>{"O empieza con un ejemplo"}</span>
                  {EXAMPLES.map(([l, t]) => <button key={l} type="button" onClick={() => setDesc(t)} style={{ height: "34px", padding: "0 12px", border: "0", borderRadius: "999px", background: "transparent", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.12)", cursor: "pointer", fontSize: "13px", color: "#3D404A" }}>{l}</button>)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "16px 18px", borderRadius: "20px", background: "#F6F6F3" }}>
                <span style={{ fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{"Atlas lo va revisando mientras escribes"}</span>
                {checksOf(desc, files).map(([l, ok]) => (
                  <div key={l} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px" }}>
                    <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", transition: "all .25s ease", background: ok ? "#0B8A5F" : "transparent", boxShadow: ok ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: ok ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                    </span>
                    <span style={{ color: ok ? "#12131A" : "#6B6F7A" }}>{l}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "18px" }}>
                <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={label}>{"Para quién será"}</span>
                  <div role="radiogroup" aria-label="Para quién será" style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "16px", background: "rgba(18,19,26,.05)" }}>
                    {AUDIENCE.map(([v, l, t]) => (
                      <button key={v} type="button" role="radio" aria-checked={audience === v ? "true" : "false"} onClick={() => setAudience(v)} style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px", padding: "10px 12px", border: "0", borderRadius: "13px", cursor: "pointer", textAlign: "left", ...seg(audience === v) }}>
                        <strong style={{ fontSize: "14px", fontWeight: "600" }}>{l}</strong>
                        <span style={{ fontSize: "12px", lineHeight: "1.35", color: "#5C606C" }}>{t}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={label}>{"Dale material (opcional)"}</span>
                  <button type="button" onClick={async () => { try { const picked = await pickTextFiles(); setFiles((f) => [...f, ...picked].slice(0, 5)); } catch (e) { setError(e.message); } }}
                    style={{ flex: "1", minHeight: "64px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", padding: "10px", border: "1.5px dashed rgba(18,19,26,.2)", borderRadius: "18px", background: "transparent", cursor: "pointer", fontSize: "14px" }}>
                    <strong style={{ fontWeight: "600" }}>{"Elige ejemplos de su trabajo"}</strong>
                    <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{"Contratos, correos, una hoja… Máximo cinco."}</span>
                  </button>
                  {files.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {files.map((f, i) => (
                        <span key={f.name + i} style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 6px 0 12px", borderRadius: "999px", background: "#F4F4F0", fontSize: "13px", animation: "pop .3s ease-out" }}>
                          {f.name}
                          <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={"Quitar " + f.name} style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#6B6F7A" }}>{"×"}</button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              {busy === "prepare" ? (
                <div role="status" style={{ display: "flex", alignItems: "center", gap: "14px", padding: "16px 18px", borderRadius: "18px", background: "#F6F6F3", animation: "rise .3s ease-out" }}>
                  <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2px solid rgba(18,19,26,.15)", borderTopColor: "#12131A", animation: "spin .8s linear infinite" }} />
                  <span style={{ fontSize: "15px", fontWeight: "500" }}>{"Colmena está preparando nombre, instrucciones, habilidades y permisos…"}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 2 && d ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "22px", animation: "fade .3s ease-out" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                <label style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={label}>{"Nombre"}</span>
                  <input type="text" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ponle un nombre" maxLength="20" style={{ ...field, font: "600 20px/1 'Bricolage Grotesque', sans-serif" }} />
                </label>
                <label style={{ flex: "2 1 280px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={label}>{"Puesto"}</span>
                  <input type="text" value={d.role} onChange={(e) => set({ role: e.target.value })} placeholder="Qué hace, en pocas palabras" maxLength="100" style={field} />
                </label>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px", borderRadius: "24px", background: "#F6F6F3" }}>
                <span style={{ font: "600 18px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em" }}>{"Su aspecto"}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={label}>{"Forma"}</span>
                  <div role="radiogroup" aria-label="Forma del avatar" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {SHAPE_LIST.map(([id, l]) => {
                      const on = d.shape === id;
                      return (
                        <button key={id} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={l} title={l} onClick={() => set({ shape: id })} style={{ width: "58px", height: "58px", display: "grid", placeItems: "center", border: "0", borderRadius: "16px", cursor: "pointer", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 0 0 2px #12131A" : "none" }}>
                          <span aria-hidden="true" style={{ width: "30px", height: "30px", background: gloss(d.color), clipPath: SHAPES[id].clip, borderRadius: SHAPES[id].radius }} />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={label}>{"Color "}<span style={{ color: "#8A8D96", fontWeight: "400" }}>{"· la miel está reservada para «te necesita»"}</span></span>
                  <div role="radiogroup" aria-label="Color del avatar" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {COLORS.map(([c, l]) => {
                      const on = d.color.toUpperCase() === c;
                      return <button key={c} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={l} title={l} onClick={() => set({ color: c })} style={{ width: "38px", height: "38px", border: "0", borderRadius: "50%", cursor: "pointer", transition: "box-shadow .2s ease", background: gloss(c), boxShadow: on ? "0 0 0 3px #FFFFFF, 0 0 0 5px #12131A" : "none" }} />;
                    })}
                  </div>
                </div>
                <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Cuando esté contratado podrás darle un retrato desde su ficha."}</span>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={label}>{"Instrucciones · Colmena ha preparado esto"}</span>
                <textarea rows="5" value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} style={{ padding: "16px 18px", border: "0", borderRadius: "18px", outline: "none", background: "#F4F4F0", fontSize: "15px", lineHeight: "1.55", resize: "vertical", fontFamily: "inherit" }} />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={label}>{"Habilidades"}</span>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                  {d.skills.map((k, i) => (
                    <span key={k.name + i} style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 6px 0 14px", borderRadius: "999px", background: "#F4F4F0", fontSize: "14px", animation: "pop .3s ease-out" }}>
                      {k.name}
                      <button type="button" onClick={() => set({ skills: d.skills.filter((_, j) => j !== i) })} aria-label={"Quitar " + k.name} style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#6B6F7A" }}>{"×"}</button>
                    </span>
                  ))}
                  <form onSubmit={(e) => { e.preventDefault(); if (skillIn.trim()) { set({ skills: [...d.skills, { name: skillIn.trim(), description: "" }].slice(0, 8) }); setSkillIn(""); } }} style={{ display: "flex", alignItems: "center", gap: "4px", height: "36px", padding: "0 4px 0 12px", borderRadius: "999px", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.12)" }}>
                    <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Nombre de la habilidad"}</span>
                    <input type="text" value={skillIn} onChange={(e) => setSkillIn(e.target.value)} placeholder="Ej.: Resumir contratos" style={{ width: "170px", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
                    <button type="submit" style={{ height: "28px", padding: "0 10px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>{"Añadir"}</button>
                  </form>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={label}>{"Puede usar"}</span>
                {TOOL_KEYS.map((k) => (
                  <div key={k} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", minHeight: "52px", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
                    <span style={{ flex: "1 1 160px", fontSize: "15px" }}>{TOOL_LABEL[k] || k}</span>
                    <div role="radiogroup" aria-label={TOOL_LABEL[k] || k} style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
                      {ACCESS.map(([v, l]) => {
                        const on = (d.tools[k] || "none") === v;
                        return <button key={v} type="button" role="radio" aria-checked={on ? "true" : "false"} onClick={() => set({ tools: { ...d.tools, [k]: v } })} style={{ height: "32px", padding: "0 12px", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: "600", ...seg(on) }}>{l}</button>;
                      })}
                    </div>
                  </div>
                ))}
                <span style={{ paddingTop: "8px", fontSize: "13px", color: "#5C606C" }}>{"Enviar algo fuera, mover dinero, borrar o instalar siempre piden permiso."}</span>
              </div>
            </div>
          ) : null}

          {step === 3 && d ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px", animation: "fade .3s ease-out" }}>
              <p style={{ margin: 0, fontSize: "16px", lineHeight: "1.5", color: "#3D404A" }}>{"Hazle una pregunta como se la harías en el trabajo. Responde con las instrucciones que acabas de escribir."}<br /><span style={{ fontSize: "13px", color: "#6B6F7A" }}>{"Nada de esto se guarda ni se envía."}</span></p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", minHeight: "180px", maxHeight: "360px", overflowY: "auto", padding: "18px", borderRadius: "24px", background: "#F6F6F3" }}>
                {chat.map((m, i) => (
                  <div key={i} style={m.who === "user"
                    ? { alignSelf: "flex-end", maxWidth: "80%", padding: "12px 16px", background: "#E8E8E2", borderRadius: "20px 20px 6px 20px", fontSize: "15px", lineHeight: "1.5" }
                    : { alignSelf: "flex-start", maxWidth: "85%", padding: "12px 16px", background: "#FFFFFF", borderRadius: "20px 20px 20px 6px", fontSize: "15px", lineHeight: "1.55", whiteSpace: "pre-wrap" }}>{m.text}</div>
                ))}
                {busy === "ask" ? <span role="status" style={{ fontSize: "14px", color: "#6B6F7A" }}>{`${d.name || "Tu bot"} está pensando…`}</span> : null}
                {!chat.length && busy !== "ask" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {[`¿Qué puedes hacer por mí${d.role ? ` como ${d.role.toLowerCase()}` : ""}?`, "Preséntate en dos frases"].map((t) => <button key={t} type="button" onClick={() => ask(t)} style={{ height: "34px", padding: "0 12px", border: "0", borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "13px" }}>{t}</button>)}
                  </div>
                ) : null}
                <span ref={chatEnd} />
              </div>
              <form onSubmit={(e) => { e.preventDefault(); ask(); }} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 18px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.12)" }}>
                <label style={{ flex: 1, display: "flex" }}><span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Pregunta de prueba"}</span>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Pregúntale algo a ${d.name || "tu bot"}…`} style={{ flex: 1, minWidth: 0, height: "44px", border: 0, outline: "none", background: "transparent", fontSize: "15px" }} /></label>
                <button type="submit" aria-label="Preguntar" disabled={busy === "ask"} style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: q.trim() ? "#12131A" : "#C9CBD1", color: "#FFFFFF", cursor: "pointer" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
                </button>
              </form>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", padding: "16px 18px", borderRadius: "20px", background: "#F6F6F3", fontSize: "14px" }}>
                <strong style={{ fontWeight: 600 }}>{d.name}</strong><span style={{ color: "#5C606C" }}>{"· " + d.role}</span>
                <span style={{ color: "#5C606C" }}>{AUDIENCE.find((a) => a[0] === audience)[1]}</span>
                <span style={{ color: "#5C606C" }}>{"Autonomía: " + (AUTONOMY.find((a) => a[0] === d.autonomy)?.[1] || "Solo sugiere").toLowerCase()}</span>
                <span style={{ color: "#5C606C" }}>{d.skills.length === 1 ? "1 habilidad" : `${d.skills.length} habilidades`}</span>
              </div>
            </div>
          ) : null}

          {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4372A" }}>{error}</p> : null}
          <div style={{ marginTop: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "10px", paddingTop: "8px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
            {step > 1 ? <button type="button" onClick={() => { setError(null); setStep(step - 1); }} style={{ height: "50px", padding: "0 20px", border: "0", borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{"Atrás"}</button> : null}
            <button type="button" disabled={!!busy} onClick={next} style={{ height: "50px", padding: "0 26px", border: "0", borderRadius: "999px", background: step === 3 ? "#FFC93C" : "#12131A", color: step === 3 ? "#12131A" : "#FFFFFF", cursor: busy ? "wait" : "pointer", fontSize: "15px", fontWeight: "600" }}>
              {step === 1 ? (busy === "prepare" ? "Preparando…" : "Preparar el bot") : step === 2 ? "Probarlo" : busy === "hire" ? "Contratando…" : `Contratar a ${d?.name || "este bot"}`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
