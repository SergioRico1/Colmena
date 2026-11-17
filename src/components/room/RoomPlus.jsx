// «Para después» in the desktop's conversations (server/room-plus.mjs), as the channels of hosted
// Colmena have it: a message saved for later or a reminder about it (its menu), «Crear tarea…»,
// the box's «/» commands, polls in conversations with people (votes are reactions: 1️⃣ 2️⃣ 3️⃣…, so
// any Colmena reads and votes them), and the lists of what you saved and what is planned.
import { createContext, useContext, useEffect, useState } from "react";
import { AlarmClock, Bookmark, CheckSquare, Clock, Trash2 } from "../Icon.js";
import { del, get, post } from "../../lib/api.js";
import { navigate } from "../../lib/router.jsx";
import { isCloud } from "../../lib/cloud.js";
import { failure, promise, reversible } from "../../lib/undoToast.js";
import { EmptyArt } from "../Hive.jsx";
import { parsePoll, pollText } from "../../lib/polls.js";
export { parsePoll, pollText };

/** Where the conversation on screen is: {room} | {mission} | {share} (Room.jsx, PeopleChat.jsx). */
export const PlusWhere = createContext(null);
export const usePlusWhere = () => useContext(PlusWhere);

// What it did, said in a notice (with «Deshacer» when it can be undone).
const say = (text, undo = null) => (undo ? reversible({ text, undo }) : promise(Promise.resolve(), { success: text }));
const fail = (e) => failure("No se pudo", e?.message || null);

/** «Guardar para después», «Recordármelo» and «Crear tarea…» for a message's menu. */
export function plusItems(where, { id, text = "", author = "" }) {
  // On this computer only (server/room-plus.mjs): hosted Colmena has its own in the channels.
  if (!where || !id || isCloud()) return [];
  const remind = (when) => post("/plus/reminders", { where, messageId: id, text: text.slice(0, 300), when }).then((r) => say("Te lo recordaré " + r.label + ".", () => del("/plus/reminders/" + encodeURIComponent(r.id)))).catch(fail);
  return [
    { label: "Guardar para después", icon: Bookmark, onSelect: () => post("/plus/saved", { where, messageId: id, text: text.slice(0, 600), author }).then((r) => say("Guardado. Lo tienes en Para después (Ctrl K).", () => del("/plus/saved/" + encodeURIComponent(r.id)))).catch(fail) },
    { label: "Recordármelo", icon: AlarmClock, subLabel: "Recordármelo", items: [
      { label: "En 1 hora", onSelect: () => remind("en 1 hora") },
      { label: "Mañana", meta: "09:00", onSelect: () => remind("mañana a las 9") },
      { label: "El lunes", meta: "09:00", onSelect: () => remind("el lunes a las 9") },
    ] },
    text ? { label: "Crear tarea…", icon: CheckSquare, hint: "Una tarea en Trabajo con este mensaje", onSelect: () => navigate("/trabajo?nueva=1&texto=" + encodeURIComponent(text.slice(0, 1000))) } : null,
  ].filter(Boolean);
}

// ---- «/» commands of the box
export const ROOM_COMMANDS = [
  { name: "tarea", hint: "qué hay que hacer", text: "Crea una tarea en Trabajo" },
  { name: "recordar", hint: "cuándo y qué", text: "Te lo recuerda: «/recordar mañana a las 9 llamar a Ana»" },
  { name: "programar", hint: "cuándo y el mensaje", text: "Lo envía más tarde: «/programar el lunes a las 9 Buenos días»" },
  { name: "encuesta", hint: "¿pregunta? | opción | opción", text: "Una encuesta: se vota con las reacciones", shared: true },
  { name: "resumen", hint: "", text: "Uno de tus bots te resume la conversación, solo para ti", mission: true },
];
/** The commands that match «/enc…» at the start of the box. */
export function roomCommandMatches(text, { shared = false, mission = false } = {}) {
  if (isCloud()) return null;
  const m = /^\/([a-zñ]*)$/i.exec(text);
  if (!m) return null;
  return ROOM_COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase()) && (!c.shared || shared) && (!c.mission || mission));
}
/**
 * Runs a «/» command: true when the text was one (it is never sent as text). `ctx`: {where,
 * shared, missionId, send(text)} — send posts in this conversation as you.
 */
export async function runRoomCommand(text, ctx) {
  const m = /^\/([a-zñ]+)\s*([\s\S]*)$/i.exec(text.trim());
  if (!m) return false;
  const name = m[1].toLowerCase(), rest = m[2].trim();
  if (name === "tarea") { navigate("/trabajo?nueva=1" + (rest ? "&texto=" + encodeURIComponent(rest) : "")); return true; }
  if (name === "recordar") {
    if (!rest) throw new Error("Escribe cuándo y qué: «/recordar mañana a las 9 llamar a Ana».");
    const r = await post("/plus/reminders", { where: ctx.where, text: rest, when: rest });
    say("Te lo recordaré " + r.label + ".", () => del("/plus/reminders/" + encodeURIComponent(r.id)));
    return true;
  }
  if (name === "programar") {
    if (!rest) throw new Error("Escribe cuándo y el mensaje: «/programar el lunes a las 9 Buenos días».");
    const r = await post("/plus/scheduled", { where: ctx.where, text: rest, when: rest });
    say("Se enviará " + r.label + ". Lo tienes en Para después (Ctrl K).", () => del("/plus/scheduled/" + encodeURIComponent(r.id)));
    return true;
  }
  if (name === "encuesta" && ctx.shared) {
    const body = pollText(rest);
    if (!body) throw new Error("Escribe la pregunta y al menos dos opciones: «/encuesta ¿Pizza o sushi? | Pizza | Sushi».");
    await ctx.send(body);
    return true;
  }
  if (name === "resumen" && ctx.missionId) { ctx.summary?.(); return true; }
  throw new Error("No conozco «/" + name + "». Prueba con " + ROOM_COMMANDS.filter((c) => (!c.shared || ctx.shared) && (!c.mission || ctx.missionId)).map((c) => "/" + c.name).join(", ") + ".");
}

/** The «/» list over the box. */
export function CommandList({ items, index, onPick }) {
  if (!items?.length) return null;
  return (
    <div role="listbox" aria-label="Comandos" style={{ position: "absolute", zIndex: 30, left: 0, bottom: "calc(100% + 8px)", width: "420px", maxWidth: "calc(100vw - 32px)", padding: "6px", borderRadius: "var(--r-lg)", background: "var(--c-card)", boxShadow: "var(--c-shadow-pop)" }}>
      {items.map((c, i) => (
        <button key={c.name} type="button" role="option" aria-selected={i === index} onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          style={{ width: "100%", minHeight: "40px", display: "flex", alignItems: "center", gap: "10px", padding: "0 10px", border: 0, borderRadius: "var(--r-md)", background: i === index ? "var(--c-hover)" : "transparent", color: "var(--c-text)", cursor: "pointer", textAlign: "left" }}>
          <span style={{ fontWeight: 600, fontFamily: "'Geist Mono', monospace", fontSize: "var(--t-meta)" }}>{"/" + c.name}</span>
          {c.hint ? <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-4)" }}>{c.hint}</span> : null}
          <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: "var(--t-caption)", color: "var(--c-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.text}</span>
        </button>
      ))}
    </div>
  );
}

/** A poll in a conversation with people: each option with its votes (the message's reactions). */
export function PollCard({ poll, reactions = [], onVote }) {
  const of = (e) => reactions.find((r) => r.emoji === e) || { count: 0, mine: false, who: [] };
  const total = poll.options.reduce((n, o) => n + of(o.emoji).count, 0);
  return (
    <div role="group" aria-label={"Encuesta: " + poll.question} style={{ alignSelf: "flex-start", width: "min(420px, 100%)", display: "flex", flexDirection: "column", gap: "6px", padding: "12px", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid var(--c-line)" }}>
      <strong style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{"📊 " + poll.question}</strong>
      {poll.options.map((o) => {
        const v = of(o.emoji);
        const share = total ? v.count / total : 0;
        return (
          <button key={o.emoji} type="button" aria-pressed={v.mine} title={(v.who || []).join(", ")} onClick={() => onVote?.(o.emoji)}
            style={{ position: "relative", display: "flex", alignItems: "center", gap: "8px", minHeight: "38px", padding: "0 12px", border: v.mine ? "1.5px solid var(--c-focus)" : "1px solid var(--c-line)", borderRadius: "var(--r-md)", background: "var(--c-card)", color: "var(--c-text)", cursor: onVote ? "pointer" : "default", overflow: "hidden", textAlign: "left" }}>
            <span aria-hidden="true" style={{ position: "absolute", inset: 0, transformOrigin: "left", transform: `scaleX(${share})`, background: "var(--c-accent-soft)", transition: "transform .25s ease" }} />
            <span style={{ position: "relative", flex: 1, minWidth: 0 }}>{o.text}</span>
            <span style={{ position: "relative", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: "var(--t-meta)" }}>{v.count}</span>
          </button>
        );
      })}
      <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{total === 1 ? "1 voto" : total + " votos"}{" · se vota con un clic; otro clic lo quita"}</span>
    </div>
  );
}

// ---- the lists (Chats › Guardados, Chats › Programados)
const whenText = (at) => new Date(at).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ROW = { display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "var(--r-lg)", background: "var(--c-card)" };

function useList(path, key) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = () => get(path).then((d) => { setData(d[key] || []); setError(null); }, (e) => setError(e.message));
  useEffect(() => { load(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, load };
}
function Nothing({ title, text }) {
  return (
    <div style={{ ...ROW, flexDirection: "column", textAlign: "center", padding: "22px 24px" }}>
      <EmptyArt seed={title} />
      <strong style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{title}</strong>
      <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{text}</span>
    </div>
  );
}

export function SavedList() {
  const { data, error, load } = useList("/plus/saved", "saved");
  if (error) return <p role="alert" style={{ color: "var(--c-error)" }}>{error}</p>;
  if (!data) return null;
  if (!data.length) return <Nothing title="Nada guardado" text="Guarda un mensaje desde su menú (⋯ › Guardar para después)." />;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
      {data.map((s) => (
        <li key={s.id} style={ROW}>
          <Bookmark size={18} style={{ flex: "none", color: "var(--c-text-3)" }} />
          <a href={s.url} style={{ flex: 1, minWidth: 0, color: "var(--c-text)", textDecoration: "none" }}>
            <span style={{ display: "block", fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{(s.author ? s.author + " · " : "") + whenText(s.at)}</span>
            <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: "var(--t-ui)" }}>{s.text || "Mensaje"}</span>
          </a>
          <button type="button" className="v4-ib" aria-label="Quitar de guardados" title="Quitar" onClick={() => del("/plus/saved/" + encodeURIComponent(s.id)).then(load, fail)}><Trash2 size={16} /></button>
        </li>
      ))}
    </ul>
  );
}

export function PlannedList() {
  const sched = useList("/plus/scheduled", "scheduled");
  const rem = useList("/plus/reminders", "reminders");
  if (sched.error || rem.error) return <p role="alert" style={{ color: "var(--c-error)" }}>{sched.error || rem.error}</p>;
  if (!sched.data || !rem.data) return null;
  const items = [...sched.data.map((x) => ({ ...x, type: x.kind === "followup" ? "followup" : "send" })), ...rem.data.map((x) => ({ ...x, type: "remind" }))].sort((a, b) => a.at - b.at);
  if (!items.length) return <Nothing title="Nada programado" text="Escribe /programar o /recordar en una conversación, o «Recordármelo» en el menú de un mensaje." />;
  const word = { send: "Se enviará", remind: "Te lo recordará", followup: "Un bot volverá a esto" };
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
      {items.map((x) => (
        <li key={x.id} style={ROW}>
          {x.type === "remind" ? <AlarmClock size={18} style={{ flex: "none", color: "var(--c-text-3)" }} /> : <Clock size={18} style={{ flex: "none", color: "var(--c-text-3)" }} />}
          <a href={x.url} style={{ flex: 1, minWidth: 0, color: "var(--c-text)", textDecoration: "none" }}>
            <span style={{ display: "block", fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{word[x.type] + " · " + whenText(x.at)}</span>
            <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: "var(--t-ui)" }}>{x.text || "Lo que te apuntaste"}</span>
          </a>
          {x.type === "send" ? <button type="button" className="v4-btn" onClick={() => post("/plus/scheduled/" + encodeURIComponent(x.id) + "/send").then(sched.load, fail)}>{"Enviar ya"}</button> : null}
          <button type="button" className="v4-ib" aria-label="Cancelar" title="Cancelar" onClick={() => del((x.type === "remind" ? "/plus/reminders/" : "/plus/scheduled/") + encodeURIComponent(x.id)).then(() => { sched.load(); rem.load(); }, fail)}><Trash2 size={16} /></button>
        </li>
      ))}
    </ul>
  );
}
