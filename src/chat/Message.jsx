// One message of a channel or a thread (src/screens/Canal.jsx, src/chat/Thread.jsx): author and
// time, text, files, link preview, reactions, the thread's summary, and its actions (react, reply
// in a thread, edit, pin, copy link, mark unread from here, delete). The actions show on hover, on
// keyboard focus and, on a touch screen, after a tap.
import { memo, useState } from "react";
import { ChatCircleText, Copy, Download, Ellipsis, FileText, Pencil, Pin, PinOff, RotateCcw, SmilePlus, Trash2 } from "../components/Icon.js";
import { MenuButton } from "../components/Menu.js";
import { chat, fileUrl } from "./api.js";
import { MessageText } from "./format.jsx";
import { nameOf, personOf, useChat } from "./store.js";
import { Avatar, sizeOf, timeOf, whenOf } from "./ui.jsx";
import { Composer } from "./Composer.jsx";

export const QUICK = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "🔥"];

function Reactions({ m, me, onReact }) {
  const s = useChat();
  if (!m.reactions.length) return null;
  return (
    <div className="ms-reactions">
      {m.reactions.map((r) => {
        const mine = r.people.includes(me);
        const names = r.people.map((p) => (p === me ? "Tú" : nameOf(p, s))).join(", ");
        return (
          <button key={r.emoji} type="button" className={"ms-reaction" + (mine ? " is-mine" : "")} aria-pressed={mine} title={names} aria-label={`${r.emoji} ${r.count}: ${names}. ${mine ? "Quitar tu reacción" : "Reaccionar igual"}`} onClick={() => onReact(r.emoji, !mine)}>
            <span aria-hidden="true">{r.emoji}</span><span className="ms-reaction-n">{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function Files({ files }) {
  if (!files?.length) return null;
  return (
    <div className="ms-files">
      {files.map((f, i) => {
        const image = f.id && /^image\/(png|jpeg|gif|webp|avif)$/.test(f.type || "");
        if (image) {
          const w = Math.min(360, f.w || 360), h = f.w && f.h ? Math.round((w * f.h) / f.w) : null;
          return (
            <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noopener" className="ms-image" aria-label={"Abrir la imagen " + f.name}>
              <img src={fileUrl(f.id)} alt={f.name} loading="lazy" width={w} height={h || undefined} style={{ aspectRatio: f.w && f.h ? `${f.w} / ${f.h}` : undefined }} />
            </a>
          );
        }
        const href = f.id ? fileUrl(f.id, { download: true }) : f.link || null;
        return (
          <div key={f.id || i} className="ms-file">
            <span className="ms-file-icon" aria-hidden="true"><FileText size={20} /></span>
            <span className="ms-file-main">
              <span className="ms-file-name">{f.name}</span>
              <span className="ms-file-meta">{f.id ? sizeOf(f.size) : f.link ? "Enlace del archivo original" : "No se incluyó en la exportación"}</span>
            </span>
            {href ? <a className="ch-iconbtn" href={href} {...(f.id ? { download: f.name } : { target: "_blank", rel: "noopener noreferrer" })} aria-label={(f.id ? "Descargar " : "Abrir ") + f.name}><Download size={18} /></a> : null}
          </div>
        );
      })}
    </div>
  );
}

function Preview({ p }) {
  if (!p) return null;
  return (
    <a className="ms-preview" href={p.url} target="_blank" rel="noopener noreferrer nofollow">
      <span className="ms-preview-site">{p.site}</span>
      {p.title ? <span className="ms-preview-title">{p.title}</span> : null}
      {p.description ? <span className="ms-preview-desc">{p.description}</span> : null}
    </a>
  );
}

/**
 * `compact`: continues the author's previous message (no avatar or name). `inThread`: drawn in
 * the thread panel (no thread summary). `onThread(m)` opens its thread; `onUnread(m)` marks the
 * channel unread from it; `canPost`: the channel takes messages (not archived, you are in it).
 */
function Message({ m, compact = false, inThread = false, onThread = null, onUnread = null, canPost = true, admin = false, highlight = false }) {
  const s = useChat();
  const me = s.me?.id;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(false);
  const author = personOf(m.author, s);
  const name = m.botName ? m.botName : m.author === me ? s.me?.name : author?.name || "Alguien";
  const react = (emoji, on = true) => chat.post(`/messages/${m.id}/reactions`, { emoji, on }).catch((e) => setError(e.message));
  if (m.deleted) {
    return (
      <div className="ms-row is-deleted" data-message-id={m.id}>
        <div className="ms-gutter" />
        <div className="ms-main"><p className="ms-gone">Mensaje eliminado</p>{!inThread && m.replies ? <ThreadSummary m={m} onThread={onThread} /> : null}</div>
      </div>
    );
  }
  const items = () => [
    { group: null, items: [
      onThread && !inThread ? { label: "Responder en un hilo", icon: ChatCircleText, onSelect: () => onThread(m) } : null,
      m.author === me && canPost && !m.imported ? { label: "Editar", icon: Pencil, onSelect: () => setEditing(true) } : null,
      canPost ? { label: m.pinned ? "Quitar de fijados" : "Fijar en el canal", icon: m.pinned ? PinOff : Pin, onSelect: () => chat.post(`/messages/${m.id}/pin`, { on: !m.pinned }).catch((e) => setError(e.message)) } : null,
      { label: "Copiar enlace", icon: Copy, onSelect: () => navigator.clipboard?.writeText(location.origin + "/canal/" + m.channel + (m.threadId ? "?hilo=" + m.threadId : "?m=" + m.id)) },
      onUnread && !inThread ? { label: "Marcar como no leído desde aquí", icon: RotateCcw, onSelect: () => onUnread(m) } : null,
    ].filter(Boolean) },
    (m.author === me || admin) && !(m.imported && !admin) ? { group: null, items: [{ label: "Borrar el mensaje", icon: Trash2, danger: true, onSelect: () => { if (confirm("¿Borrar este mensaje? No se puede deshacer.")) chat.del(`/messages/${m.id}`).catch((e) => setError(e.message)); } }] } : null,
  ].filter(Boolean);
  return (
    <div className={"ms-row" + (compact ? " is-compact" : "") + (highlight ? " is-highlight" : "") + (m.pending ? " is-pending" : "")} data-message-id={m.id} tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget || e.target.closest(".ms-text")) e.currentTarget.classList.add("is-touched"); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove("is-touched"); }}>
      <div className="ms-gutter">
        {compact ? <time className="ms-gutter-time" dateTime={new Date(m.at).toISOString()}>{timeOf(m.at)}</time> : <Avatar id={m.author} size={36} />}
      </div>
      <div className="ms-main">
        {compact ? null : (
          <div className="ms-head">
            <span className="ms-name">{name}</span>
            {m.botName ? <span className="ch-chip">Integración</span> : author?.ghost && !m.botName ? <span className="ch-chip" title="Aún no ha entrado en Colmena">Importado</span> : null}
            <time className="ms-time" dateTime={new Date(m.at).toISOString()} title={new Date(m.at).toLocaleString("es-ES")}>{whenOf(m.at)}</time>
            {m.pinned ? <span className="ms-pinned"><Pin size={12} /> Fijado</span> : null}
          </div>
        )}
        {m.broadcast && !inThread ? <p className="ms-note">Respondió en un hilo</p> : null}
        {editing ? (
          <Composer editing={m} channel={m.channel} onDone={() => setEditing(false)} />
        ) : (
          <div className="ms-text" data-message-text="">
            {m.text ? <MessageText text={m.text} /> : null}
            {m.editedAt ? <span className="ms-edited" title={"Editado " + whenOf(m.editedAt)}> (editado)</span> : null}
          </div>
        )}
        <Files files={m.files} />
        <Preview p={m.preview} />
        <Reactions m={m} me={me} onReact={react} />
        {!inThread && m.replies ? <ThreadSummary m={m} onThread={onThread} /> : null}
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
      </div>
      {editing || m.pending ? null : (
        <div className="ms-tools" role="toolbar" aria-label="Acciones del mensaje">
          {canPost ? QUICK.slice(0, 3).map((e) => <button key={e} type="button" className="ms-tool ms-tool-emoji r-hide-phone" onClick={() => react(e)} aria-label={"Reaccionar con " + e}>{e}</button>) : null}
          {canPost ? (
            <span className="ms-picker-wrap">
              <button type="button" className="ms-tool" aria-label="Añadir una reacción" aria-expanded={picker} onClick={() => setPicker(!picker)}><SmilePlus size={17} /></button>
              {picker ? (
                <span className="ms-picker" role="group" aria-label="Reacciones">
                  {QUICK.map((e) => <button key={e} type="button" className="ms-tool ms-tool-emoji" onClick={() => { react(e); setPicker(false); }} aria-label={"Reaccionar con " + e}>{e}</button>)}
                </span>
              ) : null}
            </span>
          ) : null}
          {onThread && !inThread ? <button type="button" className="ms-tool" aria-label="Responder en un hilo" onClick={() => onThread(m)}><ChatCircleText size={17} /></button> : null}
          <MenuButton label="Más acciones" menuLabel="Mensaje" items={items} placement="bottom-end" className="ms-tool"><Ellipsis size={17} /></MenuButton>
        </div>
      )}
    </div>
  );
}

function ThreadSummary({ m, onThread }) {
  return (
    <button type="button" className="ms-thread" onClick={() => onThread?.(m)}>
      <span className="ms-thread-people" aria-hidden="true">{(m.replyPeople || []).slice(-3).map((p) => <Avatar key={p} id={p} size={20} presence={false} />)}</span>
      <span className="ms-thread-n">{m.replies === 1 ? "1 respuesta" : `${m.replies} respuestas`}</span>
      {m.lastReplyAt ? <span className="ms-thread-at">{"Última " + whenOf(m.lastReplyAt)}</span> : null}
    </button>
  );
}

export default memo(Message);
