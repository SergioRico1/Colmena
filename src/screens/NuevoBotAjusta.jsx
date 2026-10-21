import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { css } from "../design/css/NuevoBotAjusta.js";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { useStore } from "../lib/store.jsx";
import { AUTONOMY, AccessPicker, COLOR_DEFS, Notice, SHAPE_DEFS, Spinner, TOOL_KEYS, TOOL_LABEL, clearDraft, readDraft, shapeDef, skillMarkdown, skillName, writeDraft } from "../components/team/common.jsx";

const LIGHT = new Set(["#FFC93C", "#FF5CA8", "#FF7A1A", "#FFE08A", "#3DDC97"]);
const ink = (hex) => (LIGHT.has((hex || "").toUpperCase()) ? "#12131A" : "#FFFFFF");

function normalize(saved) {
  const d = saved.draft || {};
  const skills = (d.skills || []).map((s) => (typeof s === "string" ? { name: s, on: true } : { ...s, on: s.on !== false })).filter((s) => skillName(s));
  return {
    name: d.name || "",
    role: d.role || "",
    instructions: d.instructions || "",
    color: d.color || COLOR_DEFS[0].id,
    shape: SHAPE_DEFS.some((s) => s.id === d.shape) ? d.shape : "circle",
    skills,
    tools: d.tools || {},
    autonomy: d.autonomy || "sugiere",
    audience: d.audience || saved.audience || "equipo",
    tryPrompts: d.tryPrompts || d.examples || [],
  };
}

export default function NuevoBotAjusta() {
  const { connectors } = useStore();
  const saved = useRef(readDraft()).current;
  const [d, setD] = useState(() => normalize(saved));
  const [chat, setChat] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const [autonomyOpen, setAutonomyOpen] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [error, setError] = useState(null);
  const chatEnd = useRef(null);

  useEffect(() => {
    if (!saved.draft) navigate("/equipo/nuevo", { replace: true });
  }, [saved.draft]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [chat, thinking]);

  if (!saved.draft) return null;

  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const sh = shapeDef(d.shape);
  const av = { background: d.color, color: ink(d.color), borderRadius: sh.radius, clipPath: sh.clip };
  const letter = (d.name || "?").trim().charAt(0).toUpperCase() || "?";
  const colors = COLOR_DEFS.some((c) => c.id.toUpperCase() === d.color.toUpperCase()) ? COLOR_DEFS : [{ id: d.color, label: "Color propuesto" }, ...COLOR_DEFS];
  const toolKeys = Object.keys(d.tools).length ? TOOL_KEYS.filter((k) => k in d.tools) : ["carpeta", "calendario", "correo"];
  const toolName = (k) => connectors.find((c) => c.id === k)?.name || TOOL_LABEL[k];
  const level = AUTONOMY.find((a) => a.id === d.autonomy) || AUTONOMY[0];
  const asked = saved.preparedFor || saved.description || "";
  const suggestions = (d.tryPrompts.length ? d.tryPrompts : [`¿Qué puedes hacer por mí${d.role ? ` como ${d.role.toLowerCase()}` : ""}?`, "Preséntate en dos frases"]).slice(0, 3);

  const botBody = () => ({
    name: d.name.trim(),
    role: d.role.trim(),
    instructions: d.instructions.trim(),
    color: d.color,
    shape: d.shape,
    audience: d.audience,
    autonomy: d.autonomy,
    tools: d.tools,
  });

  const persist = () => writeDraft({ ...readDraft(), draft: { ...(readDraft().draft || {}), ...d } });

  const saveDraft = () => {
    persist();
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 2000);
  };

  const ask = async (text) => {
    const q = (text ?? prompt).trim();
    if (!q || thinking) return;
    if (d.instructions.trim().length < 10) {
      setPreviewError("Escribe primero unas instrucciones para poder probarlo.");
      return;
    }
    setPrompt("");
    setPreviewError(null);
    setChat((c) => [...c, { role: "user", text: q }]);
    setThinking(true);
    try {
      const res = await post("/bots/preview", { draft: botBody(), prompt: q });
      setChat((c) => [...c, { role: "bot", text: res?.text || "" }]);
    } catch (e) {
      setPreviewError(e.status === 404 || e.status === 501 ? "La prueba privada aún no está disponible en Colmena." : e.message);
    } finally {
      setThinking(false);
    }
  };

  const hire = async () => {
    const body = botBody();
    if (!body.name) return setError("Ponle un nombre antes de contratarlo.");
    if (!body.role) return setError("Indica su puesto antes de contratarlo.");
    if (body.instructions.length < 10) return setError("Las instrucciones son demasiado cortas.");
    setHiring(true);
    setError(null);
    persist();
    try {
      const bot = await post("/bots", body);
      const failed = [];
      for (const s of d.skills.filter((x) => x.on)) {
        try {
          await post("/skills", { content: s.content || skillMarkdown(s, bot), source: `Propuesta al contratar a ${bot.name}`, botId: bot.id });
        } catch {
          failed.push(skillName(s));
        }
      }
      clearDraft();
      navigate(`/equipo/${bot.id}${failed.length ? "#habilidades" : ""}`);
    } catch (e) {
      setError(e.message);
      setHiring(false);
    }
  };

  const addSkill = () => {
    const name = newSkill.trim();
    if (name && !d.skills.some((s) => skillName(s).toLowerCase() === name.toLowerCase())) set({ skills: [...d.skills, { name, on: true }] });
    setNewSkill("");
    setAdding(false);
  };

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#EEF0F4" }}>
        <header style={{ position: "sticky", top: 0, zIndex: 2, minHeight: "68px", padding: "10px clamp(16px, 3vw, 32px)", background: "#FFFFFF", borderBottom: "1px solid #DCE0E8", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <a href="/equipo" aria-label="Cerrar y volver a Tu equipo" style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", border: "1px solid #DCE0E8", borderRadius: "12px" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></a>
            <h1 style={{ margin: 0, font: "700 21px/1 'Bricolage Grotesque', sans-serif" }}>Nuevo bot</h1>
          </div>
          <ol aria-label="Pasos" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", fontSize: "14px" }}>
            <li><a href="/equipo/nuevo" onClick={persist} style={{ display: "flex", alignItems: "center", gap: "8px", color: "#4A4F5C" }}><span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#12131A", color: "#FFFFFF", display: "grid", placeItems: "center" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg></span>Describe</a></li>
            <li aria-hidden="true" style={{ width: "24px", height: "2px", background: "#12131A" }} />
            <li aria-current="step" style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "700" }}><span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#FFC93C", border: "2px solid #12131A", display: "grid", placeItems: "center", font: "700 12px/1 'Geist Mono', monospace" }}>2</span>Ajusta</li>
            <li aria-hidden="true" style={{ width: "24px", height: "2px", background: "#C9CED8" }} />
            <li style={{ display: "flex", alignItems: "center", gap: "8px", color: "#4A4F5C" }}><span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "2px solid #A9AEBB", display: "grid", placeItems: "center", font: "700 12px/1 'Geist Mono', monospace" }}>3</span>Contrata</li>
          </ol>
          <button type="button" onClick={saveDraft} aria-live="polite" style={{ height: "40px", padding: "0 14px", background: savedNote ? "#E1F4EC" : "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px" }}>{savedNote ? "Borrador guardado" : "Guardar borrador"}</button>
        </header>

        <div style={{ flex: "1", width: "100%", maxWidth: "1240px", margin: "0 auto", padding: "32px clamp(16px, 3vw, 32px) 40px", display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
          <div style={{ flex: "3 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "20px" }}>
            <section aria-labelledby="pedido" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <h2 id="pedido" style={{ margin: 0, font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>Lo que pediste</h2>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", padding: "18px 20px", background: "#12131A", color: "#FFFFFF", borderRadius: "16px" }}>
                <p style={{ margin: 0, flex: "1 1 360px", font: "500 20px/1.4 'Bricolage Grotesque', sans-serif" }}>«{asked}»</p>
                <a href="/equipo/nuevo" onClick={persist} style={{ display: "flex", alignItems: "center", height: "40px", padding: "0 12px", color: "#FFFFFF", border: "1px solid #4A4F5C", borderRadius: "10px", fontSize: "13px" }}>Cambiar</a>
              </div>
            </section>

            <section aria-labelledby="propuesta" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "22px", display: "flex", flexDirection: "column", gap: "22px" }}>
              <h2 id="propuesta" style={{ margin: 0, font: "700 22px/1.1 'Bricolage Grotesque', sans-serif" }}>Colmena ha preparado esto</h2>

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "20px" }}>
                <span aria-hidden="true" style={{ width: "84px", height: "84px", flex: "none", display: "grid", placeItems: "center", font: "800 38px/1 'Bricolage Grotesque', sans-serif", ...av }}>{letter}</span>
                <div style={{ flex: "1 1 280px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "12px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>Nombre<input type="text" maxLength={100} value={d.name} onChange={(e) => set({ name: e.target.value })} style={{ height: "46px", padding: "0 12px", border: "1px solid #C9CED8", borderRadius: "10px", fontSize: "16px", fontWeight: "500", background: "#FFFFFF" }} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>Puesto<input type="text" maxLength={100} value={d.role} onChange={(e) => set({ role: e.target.value })} style={{ height: "46px", padding: "0 12px", border: "1px solid #C9CED8", borderRadius: "10px", fontSize: "16px", fontWeight: "500", background: "#FFFFFF" }} /></label>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600" }}>Forma</span>
                  <div role="radiogroup" aria-label="Forma del avatar" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {SHAPE_DEFS.map((s) => {
                      const on = s.id === d.shape;
                      return <button key={s.id} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={s.label} onClick={() => set({ shape: s.id })} style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", background: "#FFFFFF", borderRadius: "10px", cursor: "pointer", border: on ? "2px solid #12131A" : "1px solid #DCE0E8" }}><span style={{ width: "22px", height: "22px", background: "#4A4F5C", borderRadius: s.radius, clipPath: s.clip }} /></button>;
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600" }}>Color</span>
                  <div role="radiogroup" aria-label="Color del avatar" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {colors.map((c) => {
                      const on = c.id.toUpperCase() === d.color.toUpperCase();
                      return <button key={c.id} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={c.label} onClick={() => set({ color: c.id })} style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", background: "#FFFFFF", borderRadius: "50%", cursor: "pointer", border: on ? "2px solid #12131A" : "1px solid #DCE0E8" }}><span style={{ width: "28px", height: "28px", borderRadius: "50%", background: c.id }} /></button>;
                    })}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label htmlFor="instrucciones" style={{ fontSize: "13px", fontWeight: "600" }}>Instrucciones</label>
                <textarea id="instrucciones" value={d.instructions} maxLength={12000} onChange={(e) => set({ instructions: e.target.value })} style={{ width: "100%", minHeight: "120px", fieldSizing: "content", resize: "vertical", padding: "14px 16px", background: "#F7F8FA", border: "1px solid #E6E8EE", borderRadius: "12px", fontSize: "15px", lineHeight: "1.6", color: "#2B2D36", outlineColor: "#2F6BFF" }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: "600" }}>Habilidades</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {d.skills.length === 0 && !adding ? <span style={{ display: "flex", alignItems: "center", height: "36px", fontSize: "13px", color: "#555A68" }}>Colmena no ha propuesto habilidades; aprenderá al trabajar.</span> : null}
                  {d.skills.map((s, i) => (
                    <button key={skillName(s)} type="button" aria-pressed={s.on} title={s.on ? "Quitar esta habilidad" : "Añadir esta habilidad"} onClick={() => set({ skills: d.skills.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) })} style={s.on
                      ? { display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: 0, borderRadius: "18px", fontSize: "13px", cursor: "pointer" }
                      : { display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 12px", background: "transparent", color: "#555A68", border: "1px dashed #A9AEBB", borderRadius: "18px", fontSize: "13px", cursor: "pointer", textDecoration: "line-through" }}>
                      {s.on ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg> : null}{skillName(s)}
                    </button>
                  ))}
                  {adding ? (
                    <form onSubmit={(e) => { e.preventDefault(); addSkill(); }} style={{ display: "flex", alignItems: "center", gap: "4px", height: "36px", padding: "0 4px 0 12px", border: "1.5px solid #12131A", borderRadius: "18px" }}>
                      <input autoFocus aria-label="Nombre de la habilidad" value={newSkill} maxLength={100} onChange={(e) => setNewSkill(e.target.value)} onBlur={addSkill} onKeyDown={(e) => { if (e.key === "Escape") { setNewSkill(""); setAdding(false); } }} placeholder="Ej.: Resumir contratos" style={{ width: "180px", border: 0, outline: "none", background: "transparent", fontSize: "13px" }} />
                    </form>
                  ) : (
                    <button type="button" onClick={() => setAdding(true)} style={{ height: "36px", padding: "0 12px", background: "transparent", border: "1px dashed #A9AEBB", borderRadius: "18px", cursor: "pointer", fontSize: "13px" }}>Añadir</button>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "13px", fontWeight: "600", paddingBottom: "6px" }}>Puede usar</span>
                {toolKeys.map((k, i) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", minHeight: "50px", borderTop: "1px solid #E6E8EE", ...(i === toolKeys.length - 1 ? { borderBottom: "1px solid #E6E8EE" } : {}), fontSize: "15px" }}>
                    <span>{toolName(k)}</span>
                    <AccessPicker value={d.tools[k] || "none"} label={toolName(k)} chevron={false} size="draft" onChange={(v) => set({ tools: { ...d.tools, [k]: v } })} />
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", background: "#F7F8FA", borderRadius: "12px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                  <span style={{ fontSize: "15px" }}><strong>Autonomía:</strong> {level.title.toLowerCase()} {level.id === "sugiere" ? <span style={{ color: "#4A4F5C" }}>· recomendado para empezar</span> : null}</span>
                  <button type="button" aria-expanded={autonomyOpen} onClick={() => setAutonomyOpen((o) => !o)} style={{ height: "38px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }}>{autonomyOpen ? "Listo" : "Cambiar"}</button>
                </div>
                {autonomyOpen ? (
                  <div role="radiogroup" aria-label="Nivel de autonomía" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {AUTONOMY.map((l) => {
                      const on = l.id === d.autonomy;
                      return (
                        <button key={l.id} type="button" role="radio" aria-checked={on ? "true" : "false"} onClick={() => set({ autonomy: l.id })} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: "12px", alignItems: "start", padding: "12px 14px", textAlign: "left", borderRadius: "12px", cursor: "pointer", background: on ? "#FFF4D1" : "#FFFFFF", border: on ? "2px solid #12131A" : "1px solid #DCE0E8" }}>
                          <span style={{ width: "20px", height: "20px", marginTop: "1px", borderRadius: "50%", border: "2px solid #12131A", display: "grid", placeItems: "center" }}><span style={{ width: "10px", height: "10px", borderRadius: "50%", background: on ? "#12131A" : "transparent" }} /></span>
                          <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}><strong style={{ fontSize: "14px" }}>{l.title}</strong><span style={{ fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}>{l.desc}</span></span>
                        </button>
                      );
                    })}
                    <span style={{ fontSize: "13px", color: "#4A4F5C" }}>Enviar algo fuera, mover dinero, borrar o instalar siempre piden permiso.</span>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <aside aria-labelledby="prueba" style={{ flex: "2 1 360px", minWidth: 0, position: "sticky", top: "92px", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "18px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #E6E8EE", display: "flex", alignItems: "center", gap: "12px" }}>
              <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", font: "800 16px/1 'Bricolage Grotesque', sans-serif", ...av }}>{letter}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}><h2 id="prueba" style={{ margin: 0, font: "700 17px/1.1 'Bricolage Grotesque', sans-serif" }}>Pruébalo antes de contratar</h2><span style={{ fontSize: "12px", color: "#4A4F5C" }}>Nada de esto se guarda ni se envía</span></div>
            </div>
            <div aria-live="polite" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "16px", background: "#F7F8FA", maxHeight: "min(52vh, 520px)", minHeight: "160px", overflowY: "auto" }}>
              {chat.length === 0 && !thinking ? <p style={{ margin: "auto 0", fontSize: "14px", lineHeight: "1.5", color: "#4A4F5C", textAlign: "center" }}>Hazle una pregunta como se la harías en el trabajo. Responde con las instrucciones de la izquierda.</p> : null}
              {chat.map((m, i) => (m.role === "user"
                ? <div key={i} style={{ alignSelf: "flex-end", maxWidth: "88%", padding: "12px 14px", background: "#12131A", color: "#FFFFFF", borderRadius: "14px 14px 4px 14px", fontSize: "14px", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>{m.text}</div>
                : <div key={i} className="colmena-preview-md" style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", lineHeight: "1.55" }}><strong>{d.name || "Tu bot"}</strong><ReactMarkdown>{m.text}</ReactMarkdown></div>))}
              {thinking ? <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#4A4F5C" }}><Spinner size={14} /><strong style={{ color: "#12131A" }}>{d.name || "Tu bot"}</strong> está pensando…</div> : null}
              {previewError ? <Notice>{previewError}</Notice> : null}
              <span ref={chatEnd} />
            </div>
            <div style={{ padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {suggestions.map((s) => <button key={s} type="button" disabled={thinking} onClick={() => ask(s)} style={{ minHeight: "36px", padding: "6px 12px", background: "transparent", border: "1px dashed #A9AEBB", borderRadius: "18px", cursor: thinking ? "wait" : "pointer", fontSize: "13px", textAlign: "left" }}>{s}</button>)}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); ask(); }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 4px 12px", border: "1.5px solid #A9AEBB", borderRadius: "12px" }}><span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Pregunta de prueba</span><input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Hazle una pregunta de prueba…" style={{ flex: "1", minWidth: 0, height: "40px", border: 0, outline: "none", background: "transparent", fontSize: "14px" }} /><button type="submit" disabled={thinking || !prompt.trim()} aria-label="Enviar pregunta de prueba" style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "#12131A", color: "#FFFFFF", border: 0, borderRadius: "9px", cursor: thinking ? "wait" : "pointer", opacity: prompt.trim() ? 1 : 0.6 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg></button></label>
              </form>
            </div>
          </aside>
        </div>

        <footer style={{ position: "sticky", bottom: 0, padding: "14px clamp(16px, 3vw, 32px)", background: "#FFFFFF", borderTop: "1px solid #DCE0E8", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <a href="/equipo/nuevo" onClick={persist} style={{ display: "flex", alignItems: "center", height: "48px", padding: "0 18px", border: "1px solid #DCE0E8", borderRadius: "12px", fontSize: "14px" }}>Atrás</a>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px" }}>
            {error ? <Notice style={{ padding: "10px 12px" }}>{error}</Notice> : null}
            <span style={{ fontSize: "14px", color: "#4A4F5C" }}>{d.audience === "yo"
              ? <>{d.name || "Tu bot"} estará <strong style={{ color: "#12131A" }}>solo en tus chats</strong>; nadie más podrá usarlo.</>
              : <>{d.name || "Tu bot"} entrará en <strong style={{ color: "#12131A" }}>Tu equipo</strong> y podrá unirse a cualquier sala.</>}</span>
            <button type="button" onClick={hire} aria-busy={hiring} style={{ display: "flex", alignItems: "center", gap: "10px", height: "48px", padding: "0 22px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", fontWeight: "700", fontSize: "15px", cursor: hiring ? "wait" : "pointer" }}>{hiring ? <><Spinner size={16} />Contratando…</> : `Contratar a ${d.name.trim() || "tu bot"}`}</button>
          </div>
        </footer>
      </div>
      <style>{".colmena-preview-md p{margin:0}.colmena-preview-md ul,.colmena-preview-md ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}.colmena-preview-md code{font:500 12px/1.4 'Geist Mono',monospace;padding:2px 5px;background:#E7EEFF;color:#1F4FD1;border-radius:4px}"}</style>
    </>
  );
}
