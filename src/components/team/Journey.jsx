import { useEffect, useRef, useState } from "react";
import { Brain, Check, FolderOpen, Globe, GraduationCap, MessagesSquare, PencilLine, Sparkles, Trash2, Type, Wrench, X } from "lucide-react";
import { del, patch, post } from "../../lib/api.js";
import { roomUrl, shortDate } from "../../lib/format.js";
import { navigate } from "../../lib/router.jsx";
import { useAction, useResource, useStore } from "../../lib/store.jsx";

// «Qué ha aprendido» (Hermes /journey): what a bot learned, newest first, each with the room it
// came from; memories can be corrected or forgotten in place. «Enséñale» (Hermes /learn) opens a
// short lesson from a conversation, a folder, a web page or a text.

const ICON = { memory: Brain, skill: Wrench, soul: Sparkles };
const STATE_PILL = {
  activo: null, activa: null,
  "por revisar": { background: "#FFF4D1", color: "#12131A" },
  olvidado: { background: "#F4F4F0", color: "#5C606C" }, deshecho: { background: "#F4F4F0", color: "#5C606C" },
  desactivada: { background: "#F4F4F0", color: "#5C606C" }, archivada: { background: "#F4F4F0", color: "#5C606C" },
};
const iconButton = { width: "36px", height: "36px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "9px", cursor: "pointer", color: "#6B6F7A" };

function TimelineRow({ item, first, onOpenSkill }) {
  const { act, busy, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.title);
  const Icon = ICON[item.type] || Brain;
  const pill = STATE_PILL[item.state];
  const gone = item.state === "olvidado" || item.state === "deshecho";
  const room = item.missionId ? { id: item.missionId, conversation: item.conversation, botIds: item.botIds } : null;
  const save = (e) => {
    e.preventDefault();
    if (!text.trim() || text.trim() === item.title) return setEditing(false);
    act(() => patch(`/memories/${item.memoryId}`, { text: text.trim() })).then(() => setEditing(false)).catch(() => {});
  };
  return (
    <li style={{ display: "grid", gridTemplateColumns: "32px 1fr auto", gap: "12px", alignItems: "start", padding: "12px 0", borderTop: first ? "0" : "1px solid rgba(18,19,26,.06)" }}>
      <span aria-hidden="true" style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", background: "#F6F6F3", border: "1px solid rgba(18,19,26,.06)", borderRadius: "9px", color: "#5C606C" }}><Icon size={16} strokeWidth={2.1} /></span>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        {editing ? (
          <form onSubmit={save} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input autoFocus value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (setText(item.title), setEditing(false))} aria-label="Corregir el recuerdo"
              style={{ flex: "1", minWidth: 0, height: "38px", padding: "0 10px", border: "1.5px solid #12131A", borderRadius: "999px", fontSize: "15px" }} />
            <button type="submit" disabled={busy} aria-label="Guardar" style={{ ...iconButton, color: "#0B8A5F" }}><Check size={17} strokeWidth={2.4} aria-hidden="true" /></button>
            <button type="button" onClick={() => { setText(item.title); setEditing(false); }} aria-label="Cancelar" style={iconButton}><X size={17} strokeWidth={2.2} aria-hidden="true" /></button>
          </form>
        ) : item.type === "skill" && item.skillId ? (
          <button type="button" onClick={() => onOpenSkill?.(item.skillId)} style={{ padding: 0, background: "transparent", border: 0, textAlign: "left", cursor: "pointer", fontSize: "15px", lineHeight: "1.4", fontWeight: "600", color: "#12131A" }}>{item.title}</button>
        ) : (
          <span style={{ fontSize: "15px", lineHeight: "1.4", ...(gone ? { color: "#6B6F7A", textDecoration: item.title.startsWith("Olvidó") ? "none" : "line-through" } : {}) }}>{item.title}</span>
        )}
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6B6F7A" }}>
          {item.at ? <span>{shortDate(item.at)}</span> : null}
          {item.detail ? <span>{"· " + item.detail}</span> : null}
          {room ? <a href={roomUrl(room)} style={{ color: "#1F4FD1", fontWeight: "600" }}>{"#" + item.room}</a> : null}
          {pill ? <span style={{ padding: "2px 7px", borderRadius: "5px", fontWeight: "600", ...pill }}>{item.state}</span> : null}
        </span>
        {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4372A", fontWeight: "600" }}>{error}</span> : null}
      </div>
      {item.editable && item.memoryId && !editing ? (
        <span style={{ display: "flex" }}>
          <button type="button" onClick={() => setEditing(true)} aria-label="Corregir este recuerdo" title="Corregir" style={iconButton}><PencilLine size={16} strokeWidth={2} aria-hidden="true" /></button>
          <button type="button" disabled={busy} onClick={() => act(() => del(`/memories/${item.memoryId}`))} aria-label="Olvidar este recuerdo" title="Olvidar" style={iconButton}><Trash2 size={16} strokeWidth={2} aria-hidden="true" /></button>
        </span>
      ) : <span />}
    </li>
  );
}

const SOURCES = [
  { id: "texto", label: "Te lo explico", Icon: Type },
  { id: "sala", label: "Una conversación", Icon: MessagesSquare },
  { id: "carpeta", label: "Una carpeta", Icon: FolderOpen },
  { id: "web", label: "Una web", Icon: Globe },
];

/** «Enséñale»: what to learn and where from; it opens the lesson room. */
export function TeachDialog({ bot, onClose }) {
  const { missions = [], folders = [], run } = useStore();
  const [what, setWhat] = useState("");
  const [type, setType] = useState("texto");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const first = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    first.current?.focus();
    const key = (e) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const rooms = missions.filter((m) => m.status !== "cancelled" && !m.teach).slice(-40).reverse();
  const ready = what.trim().length >= 3 && (type === "texto" || value.trim());
  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const mission = await run(() => post(`/bots/${encodeURIComponent(bot.id)}/teach`, { what: what.trim(), source: { type, value: value.trim() } }));
      onClose();
      navigate(roomUrl(mission));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const field = { width: "100%", minHeight: "44px", padding: "0 12px", background: "#FFFFFF", border: "0", borderRadius: "10px", fontSize: "15px", color: "#12131A" };
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 2147482000, background: "rgba(18, 19, 26, 0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "80px 16px 16px", overflowY: "auto" }}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="ensena-t" style={{ width: "min(560px, 100%)", background: "#FFFFFF", color: "#12131A", border: "0", borderRadius: "20px", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 22px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h2 id="ensena-t" style={{ margin: 0, font: "600 22px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{`Enséñale algo a ${bot.name}`}</h2>
            <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>{`${bot.name} lo estudia en una sala, te cuenta lo que ha entendido para que le corrijas y lo guarda como habilidad o recuerdo. No envía ni cambia nada fuera de Colmena.`}</p>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", fontWeight: "600" }}>
            {"¿Qué quieres que aprenda?"}
            <span style={{ display: "flex", alignItems: "center", gap: "8px", ...field, padding: "0 12px" }}>
              <span style={{ color: "#6B6F7A", fontWeight: "400", whiteSpace: "nowrap" }}>{"Aprende"}</span>
              <input ref={first} value={what} maxLength={300} onChange={(e) => setWhat(e.target.value)} placeholder="cómo hago las facturas" style={{ flex: "1", minWidth: 0, height: "42px", border: 0, outline: "none", fontSize: "15px", background: "transparent" }} />
            </span>
          </label>
          <fieldset style={{ margin: 0, padding: 0, border: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            <legend style={{ padding: 0, marginBottom: "6px", fontSize: "14px", fontWeight: "600" }}>{"¿De dónde?"}</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "8px" }}>
              {SOURCES.map(({ id, label, Icon }) => (
                <button key={id} type="button" aria-pressed={type === id ? "true" : "false"} onClick={() => { setType(id); setValue(""); }}
                  style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "44px", padding: "0 12px", background: type === id ? "#12131A" : "#FFFFFF", color: type === id ? "#FFFFFF" : "#12131A", border: type === id ? "0" : "1px solid rgba(18,19,26,.1)", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: type === id ? "600" : "400" }}>
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            {type === "texto" ? <textarea value={value} maxLength={20000} onChange={(e) => setValue(e.target.value)} rows={5} placeholder="Pega aquí un ejemplo o explícale los pasos (opcional)" aria-label="Material" style={{ ...field, padding: "10px 12px", lineHeight: "1.5", resize: "vertical" }} /> : null}
            {type === "sala" ? (
              <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Conversación" style={field}>
                <option value="">{rooms.length ? "Elige una conversación o sala" : "Aún no hay conversaciones"}</option>
                {rooms.map((m) => <option key={m.id} value={m.id}>{(m.conversation ? "" : "#") + (m.conversation ? m.title : m.room || m.title)}</option>)}
              </select>
            ) : null}
            {type === "carpeta" ? (
              folders.length ? (
                <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Carpeta" style={field}>
                  <option value="">{"Elige una carpeta"}</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              ) : <p style={{ margin: 0, fontSize: "14px", color: "#5C606C" }}>Añade antes una carpeta en <a href="/ajustes/ordenador" style={{ color: "#1F4FD1", fontWeight: "600" }}>Ajustes › Este ordenador</a>.</p>
            ) : null}
            {type === "web" ? <input value={value} onChange={(e) => setValue(e.target.value)} type="url" inputMode="url" placeholder="https://…" aria-label="Dirección de la página" style={field} /> : null}
          </fieldset>
          {error ? <p role="alert" style={{ margin: 0, fontSize: "13px", color: "#B4372A", fontWeight: "600" }}>{error}</p> : null}
        </div>
        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid rgba(18,19,26,.06)", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ height: "44px", padding: "0 14px", background: "transparent", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px" }}>Cancelar</button>
          <button type="submit" disabled={busy || !ready} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: 0, borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px", opacity: busy || !ready ? 0.6 : 1 }}>
            <GraduationCap size={16} strokeWidth={2.2} aria-hidden="true" />{busy ? "Preparando…" : "Empezar la lección"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The «Qué ha aprendido» section of a bot's page. */
export default function Journey({ bot, sectionStyle, h2, ghost, onOpenSkill }) {
  const { data, loading } = useResource(`/bots/${encodeURIComponent(bot.id)}/timeline`);
  const [teaching, setTeaching] = useState(false);
  const [all, setAll] = useState(false);
  const items = data?.items || [];
  const shown = all ? items : items.slice(0, 8);
  return (
    <section id="aprendido" aria-labelledby="apr-t" style={{ ...sectionStyle, gap: "6px", scrollMarginTop: "16px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "12px", paddingBottom: "8px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="apr-t" style={h2}>{`Qué ha aprendido ${bot.name}`}</h2>
          <p style={{ margin: 0, fontSize: "14px", color: "#6B6F7A" }}>Lo que recuerda y las habilidades que ha escrito, con la sala de la que salió. Corrige o borra lo que no esté bien.</p>
        </div>
        <button type="button" onClick={() => setTeaching(true)} style={{ ...ghost, display: "flex", alignItems: "center", gap: "8px", fontWeight: "600" }}>
          <GraduationCap size={16} strokeWidth={2.2} aria-hidden="true" />{"Enséñale algo"}
        </button>
      </div>
      {items.length ? (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: "1px solid rgba(18,19,26,.06)" }}>
          {shown.map((item, i) => <TimelineRow key={item.id} item={item} first={i === 0} onOpenSkill={onOpenSkill} />)}
        </ol>
      ) : (
        <p style={{ margin: 0, padding: "14px 0 4px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14px", color: "#6B6F7A" }}>{loading ? "Cargando…" : `Aún no ha aprendido nada por su cuenta. Aprenderá al trabajar contigo, o puedes enseñarle algo ahora.`}</p>
      )}
      {items.length > 8 ? <button type="button" onClick={() => setAll((v) => !v)} style={{ ...ghost, alignSelf: "flex-start", marginTop: "8px" }}>{all ? "Ver menos" : `Ver los ${items.length}`}</button> : null}
      {teaching ? <TeachDialog bot={bot} onClose={() => setTeaching(false)} /> : null}
    </section>
  );
}
