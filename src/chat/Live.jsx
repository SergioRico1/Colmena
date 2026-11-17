// Two pieces of a conversation's screen (Canal.jsx, Thread.jsx):
// - Typing: who is writing right now, and which bots are working, as a pill over the box with
//   their faces («Ana está escribiendo…», «Nora está trabajando…»).
// - ChannelSearch: the search of one conversation, beside it («en #canal» already set).
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, X } from "../components/Icon.js";
import Markdown from "../components/room/Markdown.jsx";
import { chat } from "./api.js";
import { MessageText } from "./format.jsx";
import { channelTitle, mergeGhosts, nameOf, useChat, workingIn } from "./store.js";
import { Avatar, LiveBotFace, whenOf } from "./ui.jsx";
import { EmptyArt } from "../components/Hive.jsx";
import "./botcard.css";

const list = (names) => (names.length > 2 ? names.slice(0, 2).join(", ") + " y " + (names.length - 2) + " más" : names.join(" y "));

/** `thread`: a thread's pill (its writers and its bots); without it, the channel's (bots anywhere in it). */
export function Typing({ channel, thread = null }) {
  const s = useChat();
  // A tick while someone types, so the pill goes when their «escribiendo» runs out.
  const [, tick] = useState(0);
  const typing = [...(s.typing.get(channel) || new Map())].filter(([, t]) => (thread ? t.thread === thread : !t.thread) && t.until > Date.now()).map(([p]) => p);
  useEffect(() => { if (!typing.length) return undefined; const t = setTimeout(() => tick((n) => n + 1), 6500); return () => clearTimeout(t); }, [typing.length]);
  const bots = [...new Set(workingIn(s, channel, thread || undefined).map((w) => w.bot))];
  if (!typing.length && !bots.length) return <p className="cp-sr" aria-live="polite" />;
  const people = typing.map((p) => nameOf(p, s));
  const botNames = bots.map((b) => nameOf(b, s));
  const parts = [];
  if (people.length) parts.push(<span key="p"><b>{list(people)}</b>{people.length === 1 ? " está escribiendo" : " están escribiendo"}</span>);
  if (botNames.length) parts.push(<span key="b">{people.length ? " · " : ""}<b>{list(botNames)}</b>{(botNames.length === 1 ? " está trabajando" : " están trabajando") + (!thread ? " en un hilo" : "")}</span>);
  return (
    <div className="ty" role="status" aria-live="polite">
      <span className="ty-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="ty-faces" aria-hidden="true">{[...typing, ...bots].slice(0, 3).map((id) => (bots.includes(id) ? <LiveBotFace key={id} id={id} size={20} working /> : <Avatar key={id} id={id} size={20} presence={false} />))}</span>
      <span className="ty-text">{parts}…</span>
    </div>
  );
}

/** The search of one channel or conversation, as a panel beside it. `onOpen(m)` goes to a result. */
export function ChannelSearch({ channel, onOpen, onClose }) {
  const s = useChat();
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const box = useRef(null);
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return undefined; }
    const t = setTimeout(() => {
      chat.get(`/search?q=${encodeURIComponent(term)}&channel=${encodeURIComponent(channel)}`)
        .then((r) => { mergeGhosts(r.ghosts); setResults(r.results); setError(null); })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, channel]);
  const ch = s.channels.get(channel);
  const where = ch ? (ch.kind === "public" || ch.kind === "private" ? "en #" : "en ") + channelTitle(ch, s) : "aquí";
  return (
    <aside className="th r-overlay cs" aria-label={"Buscar " + where}>
      <div className="th-head">
        <button type="button" className="ch-iconbtn th-back" onClick={onClose} aria-label="Volver"><ArrowLeft size={18} /></button>
        <div className="th-title"><h2>Buscar</h2><span>{where}</span></div>
        <button type="button" className="ch-iconbtn th-close" onClick={onClose} aria-label="Cerrar la búsqueda"><X size={18} /></button>
      </div>
      <label className="cs-box">
        <Search size={16} aria-hidden="true" />
        <span className="cs-chip">{where}</span>
        <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} placeholder="Buscar palabras, from:@ana, has:file…" aria-label={"Buscar " + where} />
      </label>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {results === null ? <p className="cs-empty">Escribe para buscar solo {where}.</p> : !results.length ? <div className="cs-empty"><EmptyArt seed={q} /><p>Nada con esas palabras {where}.</p></div> : (
        <ul className="cs-list">
          {results.map(({ message: m }) => (
            <li key={m.id}>
              <button type="button" className="cs-item" onClick={() => onOpen(m)}>
                <span className="cs-head"><Avatar id={m.author} size={18} presence={false} /><b>{m.botName || nameOf(m.author, s)}</b>{whenOf(m.at)}{m.threadId && !m.broadcast ? " · en un hilo" : ""}</span>
                <span className="cs-text">{m.format === "md" ? <Markdown text={m.text} size={14} /> : <MessageText text={m.text || (m.poll ? m.poll.question : "")} />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
