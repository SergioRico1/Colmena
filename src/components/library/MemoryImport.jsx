import { useEffect, useRef, useState } from "react";
import { Check, ClipboardPaste, FileJson, ShieldCheck, X } from "lucide-react";
import { post } from "../../lib/api.js";
import { IMPORT_LIMITS, parseConversations, parseMemoryText } from "../../lib/chatgptImport.js";

// «Traer lo que ChatGPT sabe de ti»: choose where from → review every line (keep, edit, «Sobre
// ti» or «Del equipo») → import. The file is read on this computer and never changed; only the
// lines you keep are saved, after a copy of the memory (server/memory-import.mjs).
const STATUS = {
  ok: null,
  revisar: { label: "Revísalo", color: "#8A6400", background: "#FFF4D1" },
  duplicado: { label: "Ya lo sabe", color: "#4A4F5C", background: "#EEF0F4" },
  bloqueado: { label: "No se guarda", color: "#8A1C1C", background: "#FDE8E8" },
};

export default function MemoryImport({ onClose, onDone }) {
  const dialog = useRef(null);
  const [step, setStep] = useState("origen"); // origen | revisar | hecho
  const [source, setSource] = useState("chatgpt-memoria");
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState([]); // {text, from, target, status, reason, on}
  const [stats, setStats] = useState(null);
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(null); // which source is being read
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const review = async (kind, items, info = null) => {
    setReading(kind);
    if (!items.length) {
      setError(kind === "chatgpt-export" ? "No hay frases sobre ti en esas conversaciones (o eran de temas delicados)." : "No hay ningún recuerdo en el texto pegado.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await post("/memories/import/preview", { source: kind, items });
      setSource(kind);
      setStats(info);
      setUsage(r.usage);
      setRows(r.items.map((x) => ({ ...x, on: x.status === "ok" })));
      setStep("revisar");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const fromText = () => review("chatgpt-memoria", parseMemoryText(pasted));
  const fromFile = async (file) => {
    setError(null);
    if (!file) return;
    if (file.size > IMPORT_LIMITS.fileBytes) return setError("El archivo supera 64 MB. Elige conversations.json, no el .zip entero.");
    if (!/\.json$/i.test(file.name)) return setError("Elige el archivo conversations.json (está dentro del .zip que te envía ChatGPT).");
    setBusy(true);
    setReading("chatgpt-export");
    try {
      const { items, stats: s } = parseConversations(JSON.parse(await file.text()));
      setBusy(false);
      await review("chatgpt-export", items, s);
    } catch (e) {
      setBusy(false);
      setError(e instanceof SyntaxError ? "Ese archivo no es un JSON válido." : e.message);
    }
  };
  const chosen = rows.filter((r) => r.on);
  const add = (target) => chosen.filter((r) => r.target === target).reduce((n, r) => n + r.text.length, 0);
  const teamAfter = (usage?.memory.used || 0) + add("memory");
  const teamOver = usage && teamAfter > usage.memory.limit;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post("/memories/import", { source, items: chosen.map((x) => ({ text: x.text, target: x.target })) });
      setResult(r);
      setStep("hecho");
      onDone?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (i, patch) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const selectable = rows.filter((r) => r.status !== "duplicado" && r.status !== "bloqueado");

  const btn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "44px", padding: "0 18px", borderRadius: "12px", cursor: "pointer", fontSize: "14px", fontWeight: 700 };
  const optionCard = { flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "10px", padding: "16px", border: "1px solid #DCE0E8", borderRadius: "14px", background: "#FFFFFF" };

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="mi-t"
      style={{ width: "min(760px, 94vw)", maxHeight: "88vh", padding: 0, border: "0", borderRadius: "32px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.5), 0 2px 6px rgba(18,19,26,.06)", background: "#FFFFFF", color: "#12131A", overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
        <header style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "20px 22px 14px", borderBottom: "1px solid #E6E8EE" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
            <h2 id="mi-t" style={{ margin: 0, font: "700 22px/1.15 'Bricolage Grotesque', sans-serif" }}>{"Traer lo que ChatGPT sabe de ti"}</h2>
            <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.5", color: "#4A4F5C" }}>
              {step === "origen" ? "Así tu equipo empieza sabiendo cómo trabajas. Tú eliges qué se queda." : step === "revisar" ? "Marca lo que quieres que recuerde tu equipo. Puedes corregir cada frase." : "Listo."}
            </p>
          </div>
          <button type="button" className="rm-focus" aria-label="Cerrar" onClick={() => dialog.current.close()} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "10px", cursor: "pointer", color: "#4A4F5C" }}>
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {error ? <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F1B5B7", borderRadius: "10px", fontSize: "13px", color: "#8F1D22" }}>{error}</p> : null}

          {step === "origen" ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                <section style={optionCard} aria-labelledby="mi-pegar">
                  <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span aria-hidden="true" style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "10px", background: "#FFF4D1" }}><ClipboardPaste size={17} strokeWidth={2} /></span>
                    <strong id="mi-pegar" style={{ fontSize: "15px" }}>{"Pegar tu memoria"}</strong>
                  </span>
                  <span style={{ fontSize: "13px", lineHeight: "1.5", color: "#4A4F5C" }}>{"En ChatGPT: Ajustes › Personalización › Memoria › Gestionar. Selecciona la lista, cópiala y pégala aquí."}</span>
                  <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} aria-label="Memoria de ChatGPT" placeholder={"Prefiere respuestas breves.\nTrabaja en una agencia de viajes…"}
                    style={{ padding: "10px 12px", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px", lineHeight: "1.45", resize: "vertical", fontFamily: "inherit" }} />
                  <button type="button" disabled={busy || !pasted.trim()} onClick={fromText} style={{ ...btn, alignSelf: "flex-start", height: "40px", background: "#12131A", color: "#FFFFFF", border: 0, opacity: pasted.trim() ? 1 : 0.5 }}>{busy && reading === "chatgpt-memoria" ? "Revisando…" : "Revisar"}</button>
                </section>
                <section style={optionCard} aria-labelledby="mi-export">
                  <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span aria-hidden="true" style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "10px", background: "#E7EEFF" }}><FileJson size={17} strokeWidth={2} /></span>
                    <strong id="mi-export" style={{ fontSize: "15px" }}>{"Usar tus conversaciones"}</strong>
                  </span>
                  <span style={{ fontSize: "13px", lineHeight: "1.5", color: "#4A4F5C" }}>{"En ChatGPT: Ajustes › Controles de datos › Exportar datos. Te llega un .zip por correo: descomprímelo y elige conversations.json."}</span>
                  <span style={{ fontSize: "13px", lineHeight: "1.5", color: "#4A4F5C" }}>{"Colmena busca frases tuyas que digan cómo trabajas o qué prefieres. Deja fuera las conversaciones de salud, dinero, temas legales o relaciones."}</span>
                  <label style={{ ...btn, alignSelf: "flex-start", height: "40px", background: "#FFFFFF", color: "#12131A", border: "1px solid #12131A", marginTop: "auto" }}>
                    {busy && reading === "chatgpt-export" ? "Leyendo…" : "Elegir conversations.json"}
                    <input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => fromFile(e.target.files?.[0])} style={{ position: "absolute", width: "1px", height: "1px", opacity: 0 }} />
                  </label>
                </section>
              </div>
              <p style={{ margin: 0, display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", lineHeight: "1.5", color: "#4A4F5C" }}>
                <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" style={{ flex: "none", marginTop: "1px", color: "#0B6B4A" }} />
                {"Se lee en este ordenador: el archivo no se modifica ni se envía a ningún sitio. Nunca se guardan claves, teléfonos ni datos de pago."}
              </p>
            </>
          ) : null}

          {step === "revisar" ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <span style={{ fontSize: "13px", color: "#4A4F5C" }}>
                  {stats ? `${stats.conversations.toLocaleString("es-ES")} conversaciones leídas · ${stats.used} con algo sobre ti · ${stats.withheld} ${stats.withheld === 1 ? "apartada" : "apartadas"} por ser de temas delicados` : `${rows.length} ${rows.length === 1 ? "recuerdo" : "recuerdos"} en lo que pegaste`}
                </span>
                {selectable.length ? (
                  <button type="button" onClick={() => { const all = selectable.every((r) => r.on); setRows((l) => l.map((r) => (r.status === "duplicado" || r.status === "bloqueado" ? r : { ...r, on: !all }))); }}
                    style={{ padding: 0, background: "transparent", border: 0, cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#1F4FD1" }}>
                    {selectable.every((r) => r.on) ? "Quitar todos" : "Marcar todos"}
                  </button>
                ) : null}
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid #DCE0E8", borderRadius: "14px", overflow: "hidden" }}>
                {rows.map((r, i) => {
                  const locked = r.status === "duplicado" || r.status === "bloqueado";
                  const tag = STATUS[r.status];
                  return (
                    <li key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: "10px", alignItems: "flex-start", padding: "10px 12px", borderTop: i ? "1px solid #E6E8EE" : 0, background: locked ? "#FAFAFB" : "#FFFFFF" }}>
                      <input type="checkbox" checked={!!r.on} disabled={locked} onChange={(e) => set(i, { on: e.target.checked })} aria-label={"Guardar: " + r.text} style={{ width: "18px", height: "18px", marginTop: "9px", accentColor: "#12131A" }} />
                      <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                        <textarea value={r.text} disabled={locked} rows={Math.min(4, Math.ceil(r.text.length / 70))} onChange={(e) => set(i, { text: e.target.value, on: true })} aria-label="Texto del recuerdo"
                          style={{ padding: "6px 8px", border: "1px solid transparent", borderRadius: "8px", fontSize: "14px", lineHeight: "1.45", resize: "none", fontFamily: "inherit", background: "transparent", color: locked ? "#555A68" : "#12131A" }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = "#DCE0E8"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "transparent"; }} />
                        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "0 8px", fontSize: "12px", color: "#555A68" }}>
                          {tag ? <span style={{ padding: "2px 7px", borderRadius: "6px", fontWeight: 600, color: tag.color, background: tag.background }}>{tag.label}</span> : null}
                          {r.reason ? <span>{r.reason}</span> : null}
                          {r.from && source === "chatgpt-export" ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "320px" }}>{"De «" + r.from + "»"}</span> : null}
                        </span>
                      </span>
                      {locked ? <span /> : (
                        <span role="group" aria-label="Dónde se guarda" style={{ display: "inline-flex", padding: "3px", background: "#EEF0F4", borderRadius: "9px", marginTop: "3px" }}>
                          {[["user", "Sobre ti"], ["memory", "Del equipo"]].map(([t, label]) => (
                            <button key={t} type="button" aria-pressed={r.target === t ? "true" : "false"} onClick={() => set(i, { target: t })}
                              style={{ height: "26px", padding: "0 9px", background: r.target === t ? "#FFFFFF" : "transparent", border: 0, borderRadius: "7px", boxShadow: r.target === t ? "0 1px 2px rgba(18,19,26,.12)" : "none", cursor: "pointer", fontSize: "12px", fontWeight: r.target === t ? 700 : 500, color: "#12131A", whiteSpace: "nowrap" }}>{label}</button>
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {teamOver ? <p role="alert" style={{ margin: 0, fontSize: "13px", color: "#8F1D22" }}>{`«Del equipo» quedaría en ${teamAfter} de ${usage.memory.limit} caracteres: pasa algunos a «Sobre ti» o desmarca los que sobren.`}</p> : null}
            </>
          ) : null}

          {step === "hecho" && result ? (
            <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "8px 0" }}>
              <span aria-hidden="true" style={{ width: "52px", height: "52px", flex: "none", display: "grid", placeItems: "center", borderRadius: "16px", background: "#E1F4EC", color: "#0B6B4A" }}><Check size={26} strokeWidth={2.4} /></span>
              <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <strong style={{ font: "700 20px/1.2 'Bricolage Grotesque', sans-serif" }}>{result.added === 1 ? "1 recuerdo nuevo" : `${result.added} recuerdos nuevos`}</strong>
                <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#4A4F5C" }}>{`Tu equipo ya lo tiene en cuenta. Antes se guardó una copia de la memoria (${result.backup}) por si quieres volver atrás.`}</span>
              </span>
            </div>
          ) : null}
        </div>

        <footer style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "10px", padding: "14px 22px 18px", borderTop: "1px solid #E6E8EE" }}>
          {step === "revisar" ? (
            <>
              <span style={{ marginRight: "auto", fontSize: "12px", color: "#555A68" }}>{"Antes de importar se guarda una copia de la memoria."}</span>
              <button type="button" onClick={() => { setStep("origen"); setError(null); }} style={{ ...btn, background: "#FFFFFF", color: "#12131A", border: "1px solid #DCE0E8" }}>{"Atrás"}</button>
              <button type="button" disabled={busy || !chosen.length || teamOver} onClick={confirm} className="c-press"
                style={{ ...btn, background: "#FFC93C", color: "#12131A", border: "2px solid #12131A", opacity: !chosen.length || teamOver ? 0.5 : 1 }}>
                {busy ? "Importando…" : chosen.length === 1 ? "Guardar 1 recuerdo" : `Guardar ${chosen.length} recuerdos`}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => dialog.current.close()} style={{ ...btn, background: "#12131A", color: "#FFFFFF", border: 0 }}>{step === "hecho" ? "Ver la memoria" : "Cancelar"}</button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
