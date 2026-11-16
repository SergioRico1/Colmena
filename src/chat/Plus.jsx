// What team messaging adds to Slack's basics (server/cloud/chat-plus.mjs): encargos on messages,
// polls, saved messages, scheduled messages, reminders, the «/» commands of the box and the lists
// in «Canales». Every list reads the server; every change also comes back over the live socket.
import { useEffect, useMemo, useState } from "react";
import { AlarmClock, Bookmark, ChartBar, CircleCheck, Circle, Clock, ListChecks, LoaderCircle, Search, Trash2, X } from "../components/Icon.js";
import Markdown from "../components/room/Markdown.jsx";
import { chat } from "./api.js";
import { MessageText } from "./format.jsx";
import { channelTitle, chatState, dropEphemeral, mergeGhosts, nameOf, onChatEvent, useChat } from "./store.js";
import { Avatar, Dialog, Empty, whenOf } from "./ui.jsx";
import "./plus.css";

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const dueLabel = (ms) => {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const day = d.toDateString() === now.toDateString() ? "hoy" : d.toDateString() === new Date(now.getTime() + 86400000).toDateString() ? "mañana" : d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  return day + " " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
};
const STATUS = { open: "Pendiente", working: "Trabajando", done: "Hecho", failed: "Sin terminar" };

// ------------------------------------------------------------------ on a message
/** The encargos of a message: for whom, their state, and «Hecho» / «Reabrir» for who may. */
export function TaskCards({ m }) {
  const s = useChat();
  const [error, setError] = useState(null);
  if (!m.tasks?.length) return null;
  const me = s.me?.id;
  const admin = ["owner", "admin"].includes(s.me?.role);
  const set = (t, status) => chat.patch(`/tasks/${t.id}`, { status }).catch((e) => setError(e.message));
  return (
    <div className="px-tasks">
      {m.tasks.map((t) => {
        const may = [t.assignee, t.createdBy].includes(me) || admin;
        const late = t.due && t.status !== "done" && t.due < Date.now();
        return (
          <div key={t.id} className={"px-task is-" + t.status}>
            <span className="px-task-icon" aria-hidden="true">{t.status === "done" ? <CircleCheck size={18} weight="fill" /> : t.status === "working" ? <LoaderCircle size={18} className="px-spin" /> : <Circle size={18} />}</span>
            <span className="px-task-main">
              <span className="px-task-who">{"Encargo para "}<b>{t.assignee === me ? "ti" : nameOf(t.assignee, s)}</b>{t.createdBy !== me ? <span className="px-task-by">{" · de " + nameOf(t.createdBy, s)}</span> : null}</span>
              <span className="px-task-meta">
                <span className={"px-pill is-" + t.status}>{STATUS[t.status] || t.status}{t.status === "done" ? " ✓" : ""}</span>
                {t.due ? <span className={"px-due" + (late ? " is-late" : "")}><Clock size={12} aria-hidden="true" /> {(late ? "Venció " : "Para ") + dueLabel(t.due)}</span> : null}
              </span>
            </span>
            {may && t.status !== "working" ? (
              t.status === "done" || t.status === "failed"
                ? <button type="button" className="ch-btn px-task-btn" onClick={() => set(t, "open")}>Reabrir</button>
                : <button type="button" className="ch-btn px-task-btn" onClick={() => set(t, "done")}><CircleCheck size={15} /> Hecho</button>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
    </div>
  );
}

/** A poll: options as buttons with their bars; your vote marked; closed polls only show results. */
export function Poll({ m, canPost }) {
  const s = useChat();
  const [error, setError] = useState(null);
  const p = m.poll;
  if (!p) return null;
  const me = s.me?.id;
  const mine = new Set(p.options.filter((o) => o.people.includes(me)).map((o) => o.id));
  const total = p.options.reduce((n, o) => n + o.count, 0);
  const vote = (id) => {
    const next = p.multi ? (mine.has(id) ? [...mine].filter((x) => x !== id) : [...mine, id]) : mine.has(id) ? [] : [id];
    chat.post(`/messages/${m.id}/vote`, { options: next }).catch((e) => setError(e.message));
  };
  const mayClose = m.author === me || ["owner", "admin"].includes(s.me?.role);
  return (
    <div className="px-poll" role="group" aria-label={"Encuesta: " + p.question}>
      <div className="px-poll-head"><ChartBar size={16} aria-hidden="true" /><span className="px-poll-q">{p.question}</span></div>
      <ul className="px-poll-list">
        {p.options.map((o) => {
          const pct = total ? Math.round((o.count / total) * 100) : 0;
          const on = mine.has(o.id);
          const who = o.people.map((id) => (id === me ? "Tú" : nameOf(id, s))).join(", ");
          return (
            <li key={o.id}>
              <button type="button" className={"px-opt" + (on ? " is-mine" : "")} disabled={p.closed || !canPost} aria-pressed={on} onClick={() => vote(o.id)} title={who || "Nadie todavía"}>
                <span className="px-opt-bar" style={{ transform: `scaleX(${pct / 100})` }} aria-hidden="true" />
                <span className="px-opt-mark" aria-hidden="true">{on ? <CircleCheck size={16} weight="fill" /> : <Circle size={16} />}</span>
                <span className="px-opt-text">{o.text}</span>
                <span className="px-opt-n">{o.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-poll-foot">
        <span>{(p.voters === 1 ? "1 persona ha votado" : p.voters + " personas han votado") + (p.multi ? " · varias respuestas" : "") + (p.closed ? " · cerrada" : "")}</span>
        {mayClose ? <button type="button" className="px-link" onClick={() => chat.post(`/messages/${m.id}/poll`, { closed: !p.closed }).catch((e) => setError(e.message))}>{p.closed ? "Reabrir" : "Cerrar la encuesta"}</button> : null}
      </div>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
    </div>
  );
}

/** A reminder's way back to the message it was about. */
export function RefLink({ m }) {
  if (!m.ref?.channel || !m.ref?.message) return null;
  return <a className="px-ref" href={"/canal/" + m.ref.channel + (m.ref.thread ? "?hilo=" + m.ref.thread : "?m=" + m.ref.message)}>Ver el mensaje</a>;
}

/** A message only you see (a bot's «/resumen»): «Solo lo ves tú» and a way to dismiss it. */
export function Ephemeral({ m }) {
  const s = useChat();
  const bot = s.bots?.get(m.author);
  return (
    <div className="px-eph" role="note">
      <div className="ms-gutter"><Avatar id={m.author} size={36} /></div>
      <div className="ms-main">
        <div className="ms-head"><span className="ms-name">{m.botName || bot?.name || "Bot"}</span><span className="ch-chip">Bot</span><span className="px-eph-tag">Solo lo ves tú</span></div>
        <div className="ms-text">{m.format === "md" ? <Markdown text={m.text} size={15} /> : <MessageText text={m.text} />}</div>
        <button type="button" className="px-link" onClick={() => dropEphemeral(m.channel, m.id)}>Descartar</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ menus of a message
/** «Recordármelo»: a submenu of the message's actions. */
export function remindItems(m, onDone) {
  const at = (when) => () => chat.post("/reminders", { message: m.id, when }).then((r) => onDone?.("Te lo recordaré " + r.label + ".")).catch((e) => onDone?.(e.message));
  return { label: "Recordármelo", icon: AlarmClock, items: [
    { label: "En 20 minutos", onSelect: at("en 20 minutos") },
    { label: "En 1 hora", onSelect: at("en 1 hora") },
    { label: "En 3 horas", onSelect: at("en 3 horas") },
    { label: "Mañana", hint: "09:00", onSelect: at("mañana a las 9") },
    { label: "El lunes", hint: "09:00", onSelect: at("el lunes a las 9") },
  ] };
}
export function saveItem(m, saved, onError) {
  return { label: saved ? "Quitar de guardados" : "Guardar para después", icon: Bookmark, onSelect: () => chat.post(`/messages/${m.id}/save`, { on: !saved }).catch((e) => onError?.(e.message)) };
}

// ------------------------------------------------------------------ dialogs
/** Who: the channel's people first, then everyone, then the bots (not for guests). */
function AssigneePicker({ value, onChange, channel }) {
  const s = useChat();
  const [q, setQ] = useState("");
  const ch = s.channels.get(channel);
  const inChannel = new Set(ch?.people || []);
  const guest = s.me?.role === "guest";
  const people = [...s.people.values()].filter((p) => !p.deactivated && (!q || fold(p.name + " " + (p.title || "")).includes(fold(q))))
    .sort((a, b) => (inChannel.has(b.id) - inChannel.has(a.id)) || (a.id === s.me?.id) - (b.id === s.me?.id) || a.name.localeCompare(b.name, "es"))
    .map((p) => ({ id: p.id, name: p.id === s.me?.id ? p.name + " (tú)" : p.name, sub: p.title || "" }));
  const bots = guest ? [] : [...(s.bots?.values() || [])].filter((b) => !q || fold(b.name).includes(fold(q))).map((b) => ({ id: b.id, name: b.name, sub: "Bot" + (b.title ? " · " + b.title : "") }));
  const all = [...people, ...bots].slice(0, 40);
  return (
    <div className="pk">
      <label className="pk-search"><Search size={16} aria-hidden="true" /><input className="ch-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar personas o bots" aria-label="Buscar personas o bots" /></label>
      <ul className="pk-list" role="listbox" aria-label="Para quién">
        {all.length ? all.map((p) => (
          <li key={p.id} role="option" aria-selected={value === p.id} tabIndex={0} className={"pk-row" + (value === p.id ? " is-on" : "")} onClick={() => onChange(p.id)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onChange(p.id); } }}>
            <Avatar id={p.id} size={28} />
            <span className="pk-main"><span className="pk-name">{p.name}</span><span className="pk-sub">{p.sub}</span></span>
            <span className="pk-check" aria-hidden="true">{value === p.id ? <CircleCheck size={16} weight="fill" /> : null}</span>
          </li>
        )) : <li className="pk-empty">Nadie con ese nombre.</li>}
      </ul>
    </div>
  );
}

/** «Crear encargo»: on a message (`message`), or a new one (/encargo without a name). */
export function TaskDialog({ channel, message = null, thread = null, title: initialTitle = "", assignee: initialAssignee = null, onClose, onDone }) {
  const [assignee, setAssignee] = useState(initialAssignee);
  const [title, setTitle] = useState(initialTitle);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const bot = String(assignee || "").startsWith("bot:");
  const save = async () => {
    if (!assignee) { setError("Elige a quién se lo encargas."); return; }
    setBusy(true); setError(null);
    try {
      const t = await chat.post(`/channels/${channel}/tasks`, { message: message?.id || null, thread, assignee, title: message ? title.trim() || undefined : title.trim(), due: due.trim() || null });
      onDone?.(bot ? nameOf(assignee) + " se pone con ello en el hilo." : "Encargo creado" + (t.due ? " para " + dueLabel(t.due) : "") + ".");
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Crear un encargo" onClose={onClose} width={520}
      footer={<><button type="button" className="ch-btn" onClick={onClose}>Cancelar</button><button type="button" className="ch-btn is-primary" onClick={save} disabled={busy || (!message && !title.trim())}>{busy ? "Creando…" : bot ? "Encargárselo al bot" : "Crear encargo"}</button></>}>
      <div className="px-form">
        {message ? <div className="px-quote"><MessageText text={message.text || (message.poll ? message.poll.question : "")} /></div> : null}
        <label className="px-field"><span>{message ? "Qué hay que hacer (opcional)" : "Qué hay que hacer"}</span>
          <input className="ch-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={message ? "Si lo dejas vacío, el propio mensaje" : "Preparar el presupuesto de Acme"} maxLength={300} /></label>
        <div className="px-field"><span>Para quién</span><AssigneePicker value={assignee} onChange={setAssignee} channel={channel} /></div>
        {bot ? <p className="ch-hint">El bot trabaja en el hilo de este mensaje, con tu cuenta de IA. El encargo queda hecho cuando termina.</p> : (
          <label className="px-field"><span>Para cuándo (opcional)</span>
            <input className="ch-input" value={due} onChange={(e) => setDue(e.target.value)} placeholder="mañana, el viernes, el 25/11 a las 10…" /></label>
        )}
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}

/** «Crear encuesta»: a question and its options (2 to 10), one answer or several. */
export function PollDialog({ channel, thread = null, question: q0 = "", options: o0 = [], onClose }) {
  const [question, setQuestion] = useState(q0);
  const [options, setOptions] = useState(o0.length >= 2 ? o0 : [...o0, "", ""].slice(0, Math.max(2, o0.length)));
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ready = question.trim() && options.filter((o) => o.trim()).length >= 2;
  const save = async () => {
    setBusy(true); setError(null);
    try { await chat.post(`/channels/${channel}/polls`, { question, options: options.filter((o) => o.trim()), multi, thread }); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Crear una encuesta" onClose={onClose} width={480}
      footer={<><button type="button" className="ch-btn" onClick={onClose}>Cancelar</button><button type="button" className="ch-btn is-primary" onClick={save} disabled={busy || !ready}>{busy ? "Publicando…" : "Publicar"}</button></>}>
      <div className="px-form">
        <label className="px-field"><span>Pregunta</span><input className="ch-input" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="¿Qué día hacemos la reunión?" /></label>
        <div className="px-field"><span>Opciones</span>
          {options.map((o, i) => (
            <div key={i} className="px-optrow">
              <input className="ch-input" value={o} maxLength={120} aria-label={"Opción " + (i + 1)} placeholder={"Opción " + (i + 1)} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              {options.length > 2 ? <button type="button" className="ch-iconbtn" aria-label={"Quitar la opción " + (i + 1)} onClick={() => setOptions(options.filter((_, j) => j !== i))}><X size={16} /></button> : null}
            </div>
          ))}
          {options.length < 10 ? <button type="button" className="px-link" onClick={() => setOptions([...options, ""])}>Añadir otra opción</button> : null}
        </div>
        <label className="px-check"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> Se puede elegir más de una</label>
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}

/** «Elegir fecha y hora…» for a scheduled message: your clock. */
export function WhenDialog({ title = "Programar el envío", onPick, onClose }) {
  const start = useMemo(() => { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }, []);
  const [value, setValue] = useState(start);
  return (
    <Dialog title={title} onClose={onClose} width={380}
      footer={<><button type="button" className="ch-btn" onClick={onClose}>Cancelar</button><button type="button" className="ch-btn is-primary" onClick={() => { const at = new Date(value).getTime(); if (Number.isFinite(at)) onPick(at); }} disabled={!value}>Programar</button></>}>
      <label className="px-field"><span>Cuándo</span><input type="datetime-local" className="ch-input" value={value} min={start.slice(0, 10) + "T00:00"} onChange={(e) => setValue(e.target.value)} /></label>
    </Dialog>
  );
}

// ------------------------------------------------------------------ «/» commands of the box
export const COMMANDS = [
  { name: "encargo", hint: "@persona o @bot qué hay que hacer", text: "Encarga algo a alguien o a un bot" },
  { name: "recordar", hint: "cuándo qué", text: "Te lo recuerdo: «/recordar mañana a las 9 llamar a Ana»" },
  { name: "encuesta", hint: "pregunta | opción | opción", text: "Crea una encuesta" },
  { name: "resumen", hint: "", text: "Un bot te resume este canal o este hilo (solo lo ves tú)" },
];
/** The commands that match what is typed («/enc» → /encargo, /encuesta), or null when it is not a command yet. */
export function commandMatches(text) {
  const m = /^\/([a-zñ]*)$/i.exec(text);
  if (!m) return null;
  const q = fold(m[1]);
  return COMMANDS.filter((c) => c.name.startsWith(q));
}
/**
 * Runs «/comando …» (`body`: what the box holds, already in the stored format). → {done, notice}
 * or {dialog: {kind, ...props}} when it needs a form; throws on a mistake.
 */
export async function runCommand(raw, body, { channel, thread }) {
  const m = /^\/([a-zñ]+)\s*([\s\S]*)$/i.exec(raw.trim());
  const name = fold(m?.[1] || "");
  const rest = m?.[2] || "";
  const restStored = body.replace(/^\/[a-zñ]+\s*/i, "");
  if (name === "encargo") {
    const who = /^\s*<@([^>]+)>\s*/.exec(restStored);
    const title = who ? restStored.slice(who[0].length).trim() : restStored.trim();
    if (!who || !title) return { dialog: { kind: "task", assignee: who ? who[1] : null, title: who ? title : rest.trim() } };
    const t = await chat.post(`/channels/${channel}/tasks`, { assignee: who[1], title, thread });
    return { notice: t.assignee.startsWith("bot:") ? nameOf(t.assignee) + " se pone con ello." : "Encargo para " + nameOf(t.assignee) + "." };
  }
  if (name === "recordar") {
    if (!rest.trim()) throw Error("Escribe cuándo y qué: «/recordar mañana a las 9 llamar a Ana».");
    const r = await chat.post("/reminders", { text: rest.trim() });
    return { notice: "Te recordaré «" + r.text + "» " + r.label + "." };
  }
  if (name === "encuesta") {
    const parts = rest.split("|").map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 3) { await chat.post(`/channels/${channel}/polls`, { question: parts[0], options: parts.slice(1), thread }); return { notice: null }; }
    return { dialog: { kind: "poll", question: parts[0] || "", options: parts.slice(1) } };
  }
  if (name === "resumen") {
    const r = await chat.post(`/channels/${channel}/summary`, { thread });
    return { notice: r.bot.name + " está resumiendo " + (thread ? "el hilo" : "el canal") + ". Te llegará aquí y solo lo verás tú." };
  }
  throw Error("No conozco «/" + (m?.[1] || "") + "». Prueba /encargo, /recordar, /encuesta o /resumen.");
}

// ------------------------------------------------------------------ lists in «Canales»
function useLive(load, types) {
  useEffect(() => { load(); }, [load]);
  useEffect(() => onChatEvent((ev) => { if (types.includes(ev.type)) load(); }), [load]); // eslint-disable-line react-hooks/exhaustive-deps
}
function Where({ channel, s }) {
  const ch = s.channels.get(channel);
  return ch ? <span>{" en " + (ch.kind === "public" || ch.kind === "private" ? "#" : "") + channelTitle(ch, s)}</span> : null;
}
const hrefOf = (m) => "/canal/" + m.channel + (m.threadId ? "?hilo=" + m.threadId : "?m=" + m.id);

/** «Encargos»: for you, or the ones you asked for. Open ones first, the soonest due first. */
export function TasksList() {
  const s = useChat();
  const [scope, setScope] = useState("para-mi");
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useMemo(() => () => chat.get("/tasks?scope=" + scope).then((r) => { mergeGhosts(r.ghosts); setItems(r.items); }).catch((e) => setError(e.message)), [scope]);
  useLive(load, ["chat.update", "chat.notify"]);
  return (
    <div className="ch-section">
      <div className="px-seg" role="group" aria-label="Qué encargos">
        <button type="button" className={"ch-btn" + (scope === "para-mi" ? " is-on" : "")} aria-pressed={scope === "para-mi"} onClick={() => setScope("para-mi")}>Para mí</button>
        <button type="button" className={"ch-btn" + (scope === "pedidos" ? " is-on" : "")} aria-pressed={scope === "pedidos"} onClick={() => setScope("pedidos")}>Los que pedí</button>
      </div>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {!items ? <p className="ch-hint">Cargando…</p> : !items.length ? (
        <Empty title={scope === "para-mi" ? "No tienes encargos" : "No has encargado nada"}>Convierte cualquier mensaje en un encargo desde su menú (⋯ › Crear encargo), o escribe /encargo @persona y qué hay que hacer.</Empty>
      ) : (
        <ul className="ch-list">
          {items.map(({ task: t, message: m }) => (
            <li key={t.id} className={"ch-item px-row is-" + t.status}>
              <span className="px-task-icon" aria-hidden="true">{t.status === "done" ? <CircleCheck size={20} weight="fill" /> : t.status === "working" ? <LoaderCircle size={20} className="px-spin" /> : <Circle size={20} />}</span>
              <div className="ch-item-main">
                <a className="px-row-title" href={m ? hrefOf(m) : "/canal/" + t.channel}>{t.title}</a>
                <span className="px-row-meta">
                  {scope === "para-mi" ? "De " + nameOf(t.createdBy, s) : "Para " + (t.assignee === s.me?.id ? "ti" : nameOf(t.assignee, s))}
                  <Where channel={t.channel} s={s} />
                  {t.due ? <>{" · "}<span className={t.due < Date.now() && t.status !== "done" ? "px-due is-late" : "px-due"}>{(t.due < Date.now() && t.status !== "done" ? "venció " : "para ") + dueLabel(t.due)}</span></> : null}
                  {" · " + STATUS[t.status]}
                </span>
              </div>
              {t.status !== "working" ? <button type="button" className="ch-btn" onClick={() => chat.patch(`/tasks/${t.id}`, { status: t.status === "done" ? "open" : "done" }).then(load).catch((e) => setError(e.message))}>{t.status === "done" ? "Reabrir" : "Hecho"}</button> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** «Guardados»: your messages saved for later. */
export function SavedList() {
  const s = useChat();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useMemo(() => () => chat.get("/saved").then((r) => { mergeGhosts(r.ghosts); setItems(r.items); }).catch((e) => setError(e.message)), []);
  useLive(load, ["chat.saved"]);
  return (
    <div className="ch-section">
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {!items ? <p className="ch-hint">Cargando…</p> : !items.length ? <Empty title="Nada guardado">Guarda un mensaje para después desde su menú (⋯ › Guardar para después).</Empty> : (
        <ul className="ch-list">
          {items.map(({ message: m }) => (
            <li key={m.id} className="ch-item cl-mention">
              <Avatar id={m.author} size={32} />
              <div className="ch-item-main">
                <a className="cl-mention-head" href={hrefOf(m)}><b>{m.botName || nameOf(m.author, s)}</b><Where channel={m.channel} s={s} /><span className="cl-when">{whenOf(m.at)}</span></a>
                <div className="cl-mention-text">{m.format === "md" ? <Markdown text={m.text} size={14} /> : <MessageText text={m.text || (m.poll ? m.poll.question : "")} />}</div>
              </div>
              <button type="button" className="ch-iconbtn" aria-label="Quitar de guardados" title="Quitar de guardados" onClick={() => chat.post(`/messages/${m.id}/save`, { on: false }).catch((e) => setError(e.message))}><Bookmark size={18} weight="fill" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** «Programados»: messages waiting to be sent and your reminders. */
export function TimedList() {
  const s = useChat();
  const [sends, setSends] = useState(null);
  const [reminders, setReminders] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // {id, text}
  const load = useMemo(() => () => Promise.all([chat.get("/scheduled"), chat.get("/reminders")]).then(([a, b]) => { setSends(a.items); setReminders(b.items); }).catch((e) => setError(e.message)), []);
  useLive(load, ["chat.timed"]);
  const act = (p) => p.then(load).catch((e) => setError(e.message));
  return (
    <div className="ch-section">
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      <h2 className="px-h">Mensajes programados</h2>
      {!sends ? <p className="ch-hint">Cargando…</p> : !sends.length ? <p className="ch-hint">Ninguno. En la caja de un canal, la flecha junto a «Enviar» te deja programarlo.</p> : (
        <ul className="ch-list">
          {sends.map((x) => (
            <li key={x.id} className="ch-item px-row">
              <span className="px-task-icon" aria-hidden="true"><Clock size={20} /></span>
              <div className="ch-item-main">
                <span className="px-row-meta">{"Se enviará " + x.label}<Where channel={x.channel} s={s} />{x.thread ? " (en un hilo)" : ""}</span>
                {editing?.id === x.id ? (
                  <div className="px-edit">
                    <textarea className="ch-input" rows={3} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} aria-label="Texto del mensaje" />
                    <span><button type="button" className="ch-btn" onClick={() => setEditing(null)}>Cancelar</button> <button type="button" className="ch-btn is-primary" onClick={() => act(chat.patch(`/scheduled/${x.id}`, { text: editing.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") })).then(() => setEditing(null))}>Guardar</button></span>
                  </div>
                ) : <div className="cl-mention-text"><MessageText text={x.text} /></div>}
              </div>
              {editing?.id === x.id ? null : (
                <span className="px-actions">
                  <button type="button" className="ch-btn" onClick={() => act(chat.post(`/scheduled/${x.id}/send`))}>Enviar ya</button>
                  <button type="button" className="ch-btn" onClick={() => setEditing({ id: x.id, text: x.text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") })}>Editar</button>
                  <button type="button" className="ch-iconbtn" aria-label="Cancelar el envío" title="Cancelar el envío" onClick={() => act(chat.del(`/scheduled/${x.id}`))}><Trash2 size={17} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <h2 className="px-h">Recordatorios</h2>
      {!reminders ? <p className="ch-hint">Cargando…</p> : !reminders.length ? <p className="ch-hint">Ninguno. Escribe /recordar mañana a las 9 llamar a Ana, o usa ⋯ › Recordármelo en un mensaje.</p> : (
        <ul className="ch-list">
          {reminders.map((x) => (
            <li key={x.id} className="ch-item px-row">
              <span className="px-task-icon" aria-hidden="true"><AlarmClock size={20} /></span>
              <div className="ch-item-main">
                <span className="px-row-title">{x.text}</span>
                <span className="px-row-meta">{x.label}{x.message ? <> · <a href={"/canal/" + x.channel + (x.thread ? "?hilo=" + x.thread : "?m=" + x.message)}>ver el mensaje</a></> : null}</span>
              </div>
              <button type="button" className="ch-iconbtn" aria-label="Quitar el recordatorio" title="Quitar el recordatorio" onClick={() => act(chat.del(`/reminders/${x.id}`))}><Trash2 size={17} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { ListChecks };
export const savedNow = (id) => chatState().saved?.has(id);
