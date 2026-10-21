import { useEffect, useRef, useState } from "react";
import { css } from "../design/css/NuevoBot.js";
import { pickTextFiles, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { Notice, Spinner, readDraft, writeDraft } from "../components/team/common.jsx";

const EXAMPLES = [
  "Que conteste los correos de clientes con nuestro tono y me pase los difíciles.",
  "Que prepare cada lunes un resumen de ventas de la semana.",
  "Que revise el código de la web antes de publicar y me avise si algo falla.",
  "Que traduzca los catálogos al inglés y al portugués respetando nuestro glosario.",
];
const AUDIENCE = [
  { id: "yo", title: "Solo para mí", desc: "Lo verás en tus chats; nadie más podrá usarlo." },
  { id: "equipo", title: "Para todo el equipo", desc: "Podrá unirse a las salas y trabajar con otros bots." },
];
const MAX_FILES = 5;

function checksFor(t) {
  return [
    { label: "Qué tiene que hacer", ok: t.trim().length >= 25, hint: "Una tarea concreta: revisar, contestar, preparar, traducir…" },
    { label: "Con qué información trabaja", ok: /contrat|correo|hoja|factura|archivo|carpeta|document|cliente|venta|datos|código|web|catálogo/i.test(t), hint: "Contratos, correos, una hoja de cálculo, una carpeta…" },
    { label: "Qué te entrega o cuándo te avisa", ok: /avis|resumen|tabla|lista|informe|calendario|registro|fecha|borrador|pase/i.test(t), hint: "Un resumen, una tabla, un aviso antes de una fecha…" },
    { label: "Qué no debe hacer nunca", ok: /nunca|no debe|sin preguntar|sin permiso|jamás/i.test(t), hint: "Ej.: «nunca envíes nada a un proveedor sin preguntarme»." },
  ];
}

const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export default function NuevoBot() {
  const saved = useRef(readDraft()).current;
  const [text, setText] = useState(saved.description || "");
  const [aud, setAud] = useState(saved.audience || "equipo");
  const [materials, setMaterials] = useState(saved.materials || []);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const recognition = useRef(null);
  const base = useRef("");

  // Keep what the person typed if they leave and come back.
  useEffect(() => {
    writeDraft({ ...readDraft(), description: text, audience: aud, materials });
  }, [text, aud, materials]);

  useEffect(() => () => recognition.current?.abort?.(), []);

  const defs = checksFor(text);
  const score = defs.filter((d) => d.ok).length;
  const ready = text.trim().length >= 15;

  const dictate = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new Recognition();
    r.lang = "es-ES";
    r.continuous = true;
    r.interimResults = true;
    base.current = text ? text.replace(/\s*$/, " ") : "";
    r.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      setText((base.current + finalText + interim).slice(0, 12000));
    };
    r.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError("No hay permiso para usar el micrófono. Actívalo en el navegador y vuelve a probar.");
      else if (event.error !== "aborted" && event.error !== "no-speech") setError("No se pudo dictar. Prueba otra vez o escríbelo.");
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    setError(null);
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const addFiles = (files) => {
    setError(null);
    setMaterials((prev) => {
      const next = [...prev];
      for (const f of files) {
        const i = next.findIndex((x) => x.name === f.name);
        if (i >= 0) next[i] = f;
        else next.push(f);
      }
      if (next.length > MAX_FILES) setError(`Como mucho ${MAX_FILES} archivos de ejemplo.`);
      return next.slice(0, MAX_FILES);
    });
  };

  const pick = async () => {
    try {
      addFiles(await pickTextFiles());
    } catch (e) {
      setError(e.message);
    }
  };

  const drop = async (event) => {
    event.preventDefault();
    setDragging(false);
    try {
      const files = [...event.dataTransfer.files];
      if (files.length > MAX_FILES) throw Error("Máximo cinco archivos.");
      const out = [];
      for (const file of files) {
        if (file.size > 200000) throw Error(`«${file.name}» supera 200 KB.`);
        if (file.type && !/^text\/|json|xml|yaml|javascript|csv|markdown/.test(file.type)) throw Error(`«${file.name}» no es un archivo de texto. Usa .txt, .md, .csv…`);
        out.push({ name: file.name, content: await file.text(), size: file.size });
      }
      addFiles(out);
    } catch (e) {
      setError(e.message);
    }
  };

  const prepare = async () => {
    if (!ready || busy) return;
    recognition.current?.stop();
    setBusy(true);
    setError(null);
    try {
      const draft = await post("/bots/prepare", {
        description: text.trim(),
        audience: aud,
        materials: materials.filter((m) => typeof m.content === "string").map(({ name, content }) => ({ name, content })),
      });
      writeDraft({ description: text.trim(), preparedFor: text.trim(), audience: aud, materials, draft: { audience: aud, ...draft }, chat: [] });
      navigate("/equipo/nuevo/ajusta");
    } catch (e) {
      setError(e.status === 404 || e.status === 501 ? "Colmena aún no puede preparar bots automáticamente. Prueba con una plantilla de Tu equipo." : e.message);
      setBusy(false);
    }
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
            <li aria-current="step" style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "700" }}><span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#FFC93C", border: "2px solid #12131A", display: "grid", placeItems: "center", font: "700 12px/1 'Geist Mono', monospace" }}>1</span>Describe</li>
            <li aria-hidden="true" style={{ width: "24px", height: "2px", background: "#C9CED8" }} />
            <li style={{ display: "flex", alignItems: "center", gap: "8px", color: "#4A4F5C" }}><span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "2px solid #A9AEBB", display: "grid", placeItems: "center", font: "700 12px/1 'Geist Mono', monospace" }}>2</span>Ajusta</li>
            <li aria-hidden="true" style={{ width: "24px", height: "2px", background: "#C9CED8" }} />
            <li style={{ display: "flex", alignItems: "center", gap: "8px", color: "#4A4F5C" }}><span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "2px solid #A9AEBB", display: "grid", placeItems: "center", font: "700 12px/1 'Geist Mono', monospace" }}>3</span>Contrata</li>
          </ol>
          <a href="/equipo" style={{ display: "flex", alignItems: "center", height: "40px", padding: "0 14px", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px" }}>Usar una plantilla</a>
        </header>

        <div style={{ flex: "1", width: "100%", maxWidth: "1180px", margin: "0 auto", padding: "40px clamp(16px, 3vw, 32px) 40px", display: "flex", flexWrap: "wrap", gap: "28px", alignItems: "flex-start" }}>
          <section aria-labelledby="describe-t" style={{ flex: "3 1 540px", minWidth: 0, display: "flex", flexDirection: "column", gap: "22px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ font: "500 13px/1 'Geist Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase", color: "#555A68" }}>Paso 1 de 3</span>
              <h2 id="describe-t" style={{ margin: 0, font: "800 clamp(30px, 3.4vw, 42px)/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em", textWrap: "balance" }}>¿Qué necesitas que haga tu nuevo bot?</h2>
              <p style={{ margin: 0, fontSize: "17px", lineHeight: "1.5", color: "#4A4F5C" }}>Cuéntaselo como a un compañero nuevo. Con una o dos frases basta; luego lo afinas.</p>
            </div>

            <div style={{ background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "20px", boxShadow: "8px 8px 0 #FFC93C", padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <label htmlFor="descripcion" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Describe lo que debe hacer el bot</label>
              <textarea id="descripcion" rows={5} maxLength={12000} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) prepare(); }} placeholder="Ej.: Quiero alguien que conteste los correos de clientes con nuestro tono y me pase los difíciles." style={{ width: "100%", border: 0, outline: "none", resize: "none", background: "transparent", font: "500 21px/1.5 'Geist', sans-serif" }} />
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", paddingTop: "10px", borderTop: "1px solid #E6E8EE" }}>
                {Recognition ? (
                  <button type="button" onClick={dictate} aria-pressed={listening} style={listening
                    ? { display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 12px", background: "#FFF4D1", border: "2px solid #12131A", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }
                    : { display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px" }}>
                    {listening ? <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#E5484D", animation: "colmena-pulse 1.2s ease-in-out infinite" }} /> : null}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>{listening ? "Escuchando… toca para parar" : "Dictar"}
                  </button>
                ) : <span />}
                <span style={{ font: "500 13px/1 'Geist Mono', monospace", color: "#4A4F5C" }}>{text.length} caracteres</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "14px", fontWeight: "600" }}>O empieza con un ejemplo</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {EXAMPLES.map((x) => (
                  <button key={x} type="button" onClick={() => setText(x)} style={{ minHeight: "44px", padding: "10px 14px", background: "#FFFFFF", border: "1px dashed #A9AEBB", borderRadius: "14px", cursor: "pointer", fontSize: "14px", lineHeight: "1.35", textAlign: "left", maxWidth: "100%" }}>{x}</button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
              <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>Dale material <span style={{ fontWeight: "500", color: "#4A4F5C" }}>(opcional)</span></span>
                <button type="button" onClick={pick} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} style={{ minHeight: "112px", padding: "16px", background: dragging ? "#FFF4D1" : "#F7F8FA", border: dragging ? "1.5px dashed #12131A" : "1.5px dashed #A9AEBB", borderRadius: "14px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", textAlign: "center" }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" /></svg><span style={{ fontSize: "14px", fontWeight: "600" }}>Arrastra ejemplos de su trabajo</span><span style={{ fontSize: "13px", color: "#4A4F5C", lineHeight: "1.4" }}>Contratos, informes, correos… Le ayudan a entender cómo trabajáis.</span></button>
                {materials.length ? (
                  <ul aria-label="Material añadido" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {materials.map((m) => (
                      <li key={m.name} style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 4px 0 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "8px", fontSize: "13px", maxWidth: "100%" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" /></svg>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                        {typeof m.content !== "string" ? <span style={{ color: "#8A1C1C" }}>· vuelve a añadirlo</span> : null}
                        <button type="button" aria-label={`Quitar ${m.name}`} onClick={() => setMaterials((all) => all.filter((x) => x.name !== m.name))} style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "6px", cursor: "pointer", color: "#555A68" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>¿Para quién será?</span>
                <div role="radiogroup" aria-label="Para quién será el bot" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {AUDIENCE.map((a) => {
                    const on = a.id === aud;
                    return (
                      <button key={a.id} type="button" role="radio" aria-checked={on ? "true" : "false"} onClick={() => setAud(a.id)} style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: "10px", alignItems: "start", padding: "12px 14px", textAlign: "left", borderRadius: "12px", cursor: "pointer", background: on ? "#FFF4D1" : "#FFFFFF", border: on ? "2px solid #12131A" : "1px solid #DCE0E8" }}><span style={{ width: "18px", height: "18px", marginTop: "1px", borderRadius: "50%", border: "2px solid #12131A", display: "grid", placeItems: "center" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: on ? "#12131A" : "transparent" }} /></span><span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><strong style={{ fontSize: "14px" }}>{a.title}</strong><span style={{ fontSize: "13px", color: "#4A4F5C" }}>{a.desc}</span></span></button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <aside aria-labelledby="ayuda-t" style={{ flex: "2 1 320px", minWidth: 0, position: "sticky", top: "92px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span aria-hidden="true" style={{ width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", background: "#FFC93C", color: "#12131A", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", font: "800 14px/1 'Bricolage Grotesque', sans-serif" }}>A</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}><h2 id="ayuda-t" style={{ margin: 0, font: "700 18px/1.1 'Bricolage Grotesque', sans-serif" }}>Lo que ayuda a prepararlo</h2><span style={{ fontSize: "13px", color: "#4A4F5C" }}>Atlas lo va revisando mientras escribes</span></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ flex: "1", height: "8px", borderRadius: "4px", background: "#EEF0F4", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: Math.round((score / 4) * 100) + "%", background: "#12131A", borderRadius: "4px", transition: "width .3s ease" }} /></span>
              <span style={{ font: "600 13px/1 'Geist Mono', monospace" }}>{score} de 4</span>
            </div>
            <ul aria-live="polite" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
              {defs.map((c) => (
                <li key={c.label} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: "10px", padding: "10px 0", borderTop: "1px solid #E6E8EE" }}>
                  {c.ok
                    ? <span aria-label="Cumplido" style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#0B8A5F", color: "#FFFFFF", display: "grid", placeItems: "center" }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg></span>
                    : <span aria-label="Falta" style={{ width: "22px", height: "22px", borderRadius: "50%", border: "2px dashed #A9AEBB" }} />}
                  <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}><strong style={{ fontSize: "14px" }}>{c.label}</strong><span style={{ fontSize: "13px", lineHeight: "1.4", color: "#4A4F5C" }}>{c.hint}</span></span>
                </li>
              ))}
            </ul>
            <p style={{ margin: 0, padding: "12px 14px", background: "#F7F8FA", borderRadius: "12px", fontSize: "13px", lineHeight: "1.5", color: "#2B2D36" }}>{score >= 3 ? "Suficiente para empezar. Lo que falte se lo preguntará Colmena en el paso siguiente." : "Añade un poco más de detalle y el bot saldrá mejor a la primera."}</p>
          </aside>
        </div>

        <footer style={{ position: "sticky", bottom: 0, padding: "14px clamp(16px, 3vw, 32px)", background: "#FFFFFF", borderTop: "1px solid #DCE0E8", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <a href="/equipo" style={{ display: "flex", alignItems: "center", height: "48px", padding: "0 18px", border: "1px solid #DCE0E8", borderRadius: "12px", fontSize: "14px" }}>Cancelar</a>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px" }}>
            {/* Errors show next to the button you just pressed, not off-screen above. */}
            {error && !busy ? (
              <span role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: "600", color: "#B4372A", maxWidth: "560px" }}>
                {error}
                {/Conecta ChatGPT|cuenta de IA|clave de OpenAI/i.test(error) ? <a href="/ajustes/ia" style={{ color: "#1F4FD1" }}>{"Conectar ahora"}</a> : null}
              </span>
            ) : (
              <span style={{ fontSize: "14px", color: "#4A4F5C" }}>{busy ? "Colmena está preparando nombre, instrucciones, habilidades y permisos…" : "Colmena propondrá nombre, instrucciones, habilidades y permisos."}</span>
            )}
            {ready ? (
              <button type="button" onClick={prepare} aria-busy={busy} style={{ display: "flex", alignItems: "center", gap: "10px", height: "48px", padding: "0 22px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", fontWeight: "700", fontSize: "15px", cursor: busy ? "wait" : "pointer" }}>
                {busy ? <><Spinner size={16} />Preparando tu bot…</> : <>Preparar mi bot<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></>}
              </button>
            ) : (
              <button type="button" disabled style={{ height: "48px", padding: "0 22px", background: "#EEF0F4", color: "#4A4F5C", border: "2px dashed #A9AEBB", borderRadius: "12px", fontWeight: "700", fontSize: "15px" }}>Escribe un poco más</button>
            )}
          </div>
        </footer>
      </div>
    </>
  );
}
