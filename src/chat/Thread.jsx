// A thread beside its channel (a panel on a laptop, the whole screen on a phone): the first
// message, every reply, and a box to answer that may also send the answer to the channel.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, X } from "../components/Icon.js";
import { chat } from "./api.js";
import { Composer } from "./Composer.jsx";
import Message from "./Message.jsx";
import { channelTitle, mergeGhosts, nameOf, onChatEvent, useChat } from "./store.js";

export default function Thread({ channel, rootId, canPost, admin, onClose }) {
  const s = useChat();
  const [root, setRoot] = useState(null);
  const [replies, setReplies] = useState([]);
  const [error, setError] = useState(null);
  const end = useRef(null);
  const panel = useRef(null);
  const load = useCallback(() => {
    chat.get(`/messages/${rootId}/thread`).then((t) => { mergeGhosts(t.ghosts); setRoot(t.root); setReplies(t.replies); setError(null); }).catch((e) => setError(e.message));
  }, [rootId]);
  useEffect(load, [load]);
  useEffect(() => { panel.current?.focus(); }, [rootId]);
  useEffect(() => onChatEvent((ev) => {
    if (ev.channel !== channel) return;
    if (ev.type === "chat.message" && ev.message?.threadId === rootId) setReplies((r) => [...r.filter((x) => x.id !== ev.message.id && !(ev.clientId && x.clientId === ev.clientId)), ev.message]);
    if (ev.type === "chat.update") {
      if (ev.message.id === rootId) setRoot(ev.message);
      else setReplies((r) => r.map((x) => (x.id === ev.message.id ? ev.message : x)));
    }
    if (ev.type === "chat.delete") {
      if (ev.id === rootId) load();
      else setReplies((r) => r.filter((x) => x.id !== ev.id));
    }
  }), [channel, rootId, load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [replies.length]);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape" && !e.defaultPrevented && panel.current?.contains(document.activeElement)) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const ch = s.channels.get(channel);
  const typingHere = [...(s.typing.get(channel) || new Map())].filter(([, t]) => t.thread === rootId && t.until > Date.now()).map(([p]) => nameOf(p, s));
  return (
    <aside ref={panel} tabIndex={-1} className="th r-overlay" aria-label="Hilo">
      <div className="th-head">
        <button type="button" className="ch-iconbtn th-back" onClick={onClose} aria-label="Volver al canal"><ArrowLeft size={18} /></button>
        <div className="th-title"><h2>Hilo</h2>{ch ? <span>{(ch.kind === "public" || ch.kind === "private" ? "#" : "") + channelTitle(ch, s)}</span> : null}</div>
        <button type="button" className="ch-iconbtn th-close" onClick={onClose} aria-label="Cerrar el hilo"><X size={18} /></button>
      </div>
      <div className="th-body">
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
        {root ? <Message m={root} inThread canPost={canPost} admin={admin} /> : <p className="th-loading">Cargando…</p>}
        {root ? <div className="th-count">{replies.length === 1 ? "1 respuesta" : `${replies.length} respuestas`}</div> : null}
        {replies.map((m, i) => <Message key={m.id} m={m} inThread compact={i > 0 && replies[i - 1].author === m.author && m.at - replies[i - 1].at < 5 * 60000} canPost={canPost} admin={admin} />)}
        <div ref={end} />
      </div>
      {typingHere.length ? <p className="th-typing" aria-live="polite">{typingHere.join(", ") + (typingHere.length === 1 ? " está escribiendo…" : " están escribiendo…")}</p> : <p className="th-typing" aria-live="polite" />}
      {canPost && root && !root.deleted ? (
        <div className="th-composer r-composer">
          <Composer channel={channel} thread={rootId} placeholder="Responder…" alsoChannel={ch && ch.kind !== "dm" && ch.kind !== "group" ? "#" + channelTitle(ch, s) : ch ? "la conversación" : null} autoFocus
            onPending={(m) => setReplies((r) => [...r, m])}
            onSent={(m, clientId) => setReplies((r) => (m ? [...r.filter((x) => x.clientId !== clientId && x.id !== m.id), m] : r.filter((x) => x.clientId !== clientId)))} />
        </div>
      ) : null}
    </aside>
  );
}
