// A channel or a direct message of hosted Colmena (docs/CLOUD.md › Phase 2), at /canal/:id.
// The timeline is read by pages (50 at a time, older ones as you scroll up), opens at your first
// unread message with a «Nuevo» line, or around a message (?m=), and keeps itself current over
// the live socket. ?hilo= opens a thread beside it. Reading the end marks the channel as read.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Bell, BellSlash, Check, Ellipsis, Hash, LockSimple, Pin, UserPlus, UsersThree } from "../components/Icon.js";
import { MenuButton } from "../components/Menu.js";
import { navigate } from "../lib/router.jsx";
import { chat } from "../chat/api.js";
import Message from "../chat/Message.jsx";
import Thread from "../chat/Thread.jsx";
import { Composer } from "../chat/Composer.jsx";
import { ChannelInfo, PinsDialog, TopicDialog } from "../chat/ChannelDialogs.jsx";
import { channelTitle, dropChannel, loadChat, mergeGhosts, nameOf, onChatEvent, setOpenChannel, upsertChannel, useChat } from "../chat/store.js";
import { ChatPage, Empty, dayLabel } from "../chat/ui.jsx";
import "../chat/channel.css";

const byseq = (a, b) => a.seq - b.seq;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export default function Canal({ params, query }) {
  const id = params.id;
  const s = useChat();
  const [info, setInfo] = useState(null); // GET /channels/:id
  const [messages, setMessages] = useState([]);
  const [edges, setEdges] = useState({ before: false, after: false });
  const [newLine, setNewLine] = useState(null); // seq after which «Nuevo» is drawn
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const list = useRef(null);
  const fetching = useRef(false);
  const stick = useRef(true);
  const anchor = useRef(null); // keeps the view still while older messages come in above
  const focusId = query?.m || null;
  const threadId = query?.hilo || null;
  const ch = s.channels.get(id) || info;
  const me = s.me?.id;
  const admin = ["owner", "admin"].includes(s.me?.role);
  const member = !!s.channels.get(id);
  const canPost = member && !ch?.archived;
  const title = ch ? channelTitle(ch, s) : "";
  const isChannel = ch && (ch.kind === "public" || ch.kind === "private");

  // ---- loading a page
  const load = useCallback(async (mode = {}) => {
    const q = new URLSearchParams({ limit: "50", ...mode });
    const page = await chat.get(`/channels/${id}/messages?${q}`);
    mergeGhosts(page.ghosts);
    return page;
  }, [id]);
  useEffect(() => {
    let live = true;
    setLoading(true); setMessages([]); setError(null); setInfo(null); setNewLine(null); stick.current = true;
    setOpenChannel(id);
    (async () => {
      try {
        const view = await chat.get(`/channels/${id}`);
        if (!live) return;
        setInfo(view);
        const unreadFrom = view.member && view.readSeq < view.lastSeq ? view.readSeq : null;
        const page = await load(focusId ? { message: focusId } : unreadFrom != null && unreadFrom > 0 ? { around: String(unreadFrom) } : {});
        if (!live) return;
        setMessages(page.messages);
        setEdges({ before: page.hasBefore, after: page.hasAfter });
        if (unreadFrom != null) setNewLine(unreadFrom);
        stick.current = !focusId && !(unreadFrom != null && page.hasAfter);
      } catch (e) { if (live) setError(e.status === 404 ? "missing" : e.message); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; setOpenChannel(null); };
  }, [id, focusId, load]);

  // ---- where the view sits
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || loading) return;
    if (anchor.current) {
      const node = el.querySelector(`[data-message-id="${anchor.current.id}"]`);
      if (node) el.scrollTop += node.offsetTop - anchor.current.top;
      anchor.current = null;
      return;
    }
    if (focusId) {
      const node = el.querySelector(`[data-message-id="${CSS.escape(focusId)}"]`);
      if (node) { node.scrollIntoView({ block: "center" }); return; }
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (newLine != null) el.querySelector(".cv-new")?.scrollIntoView({ block: "center" });
  }, [messages, loading, focusId, newLine]);

  const older = async () => {
    if (fetching.current || !edges.before || !messages.length) return;
    fetching.current = true;
    const first = messages[0];
    const node = list.current?.querySelector(`[data-message-id="${first.id}"]`);
    anchor.current = { id: first.id, top: node?.offsetTop || 0 };
    try {
      const page = await load({ before: String(first.seq) });
      setMessages((m) => [...page.messages.filter((x) => !m.some((y) => y.id === x.id)), ...m]);
      setEdges((e) => ({ ...e, before: page.hasBefore }));
    } finally { fetching.current = false; }
  };
  const newer = async () => {
    if (fetching.current || !edges.after || !messages.length) return;
    fetching.current = true;
    try {
      const page = await load({ after: String(messages.at(-1).seq) });
      setMessages((m) => [...m, ...page.messages.filter((x) => !m.some((y) => y.id === x.id))]);
      setEdges((e) => ({ ...e, after: page.hasAfter }));
    } finally { fetching.current = false; }
  };
  const toEnd = async () => {
    if (edges.after) {
      const page = await load({});
      setMessages(page.messages);
      setEdges({ before: page.hasBefore, after: false });
    }
    stick.current = true;
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (focusId) navigate("/canal/" + id, { replace: true });
  };
  const onScroll = (e) => {
    const el = e.currentTarget;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = bottom && !edges.after;
    setAtBottom(bottom);
    if (el.scrollTop < 300) older();
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) newer();
  };

  // ---- read state: the end of the channel seen, in a visible tab
  const lastSeq = messages.length ? Math.max(...messages.filter((m) => !m.pending).map((m) => m.seq)) : 0;
  const readTimer = useRef(null);
  useEffect(() => {
    const c = s.channels.get(id);
    if (!c || !atBottom || edges.after || loading || document.visibilityState !== "visible") return;
    if ((c.readSeq || 0) >= c.lastSeq && !c.unread && !c.mentions) return;
    clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      chat.post(`/channels/${id}/read`, {}).then((r) => upsertChannel({ id, readSeq: r.readSeq, unread: r.unread, mentions: r.mentions })).catch(() => {});
    }, 600);
    return () => clearTimeout(readTimer.current);
  }, [id, atBottom, edges.after, loading, lastSeq, s.channels]);
  useEffect(() => {
    const vis = () => { if (document.visibilityState === "visible") setAtBottom((b) => b); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  // ---- live frames
  useEffect(() => onChatEvent((ev) => {
    if (ev.channel !== id) return;
    if (ev.type === "chat.message" && ev.message && (!ev.message.threadId || ev.message.broadcast)) {
      setMessages((m) => {
        if (edges.after) return m;
        const rest = m.filter((x) => x.id !== ev.message.id && !(ev.clientId && x.clientId === ev.clientId));
        return [...rest, ev.message].sort(byseq);
      });
    } else if (ev.type === "chat.update") {
      setMessages((m) => m.map((x) => (x.id === ev.message.id ? ev.message : x)));
    } else if (ev.type === "chat.delete") {
      setMessages((m) => m.map((x) => (x.id === ev.id ? (x.replies ? { ...x, deleted: true, text: "", files: [], reactions: [] } : null) : x)).filter(Boolean));
    } else if (ev.type === "chat.channel" && ev.view) {
      setInfo((i) => (i ? { ...i, ...ev.view, member: i.member, readSeq: i.readSeq } : i));
    }
  }), [id, edges.after]);
  useEffect(() => onChatEvent((ev) => { if (ev.type === "chat.left" && ev.channel === id) setInfo((i) => (i ? { ...i, member: false } : i)); }), [id]);

  // ---- actions
  const openThread = (m) => navigate(`/canal/${id}?hilo=${m.threadId || m.id}`, { replace: !!threadId });
  const closeThread = () => navigate(`/canal/${id}`, { replace: true });
  const markUnread = (m) => chat.post(`/channels/${id}/read`, { seq: m.seq - 1 }).then((r) => { upsertChannel({ id, readSeq: r.readSeq, unread: r.unread, mentions: r.mentions }); setNewLine(m.seq - 1); setNotice("Marcado como no leído desde ese mensaje."); }).catch((e) => setNotice(e.message));
  const join = async () => {
    try { const view = await chat.post(`/channels/${id}/join`, {}); upsertChannel(view); setInfo(view); }
    catch (e) { setNotice(e.message); }
  };
  const leave = async () => {
    if (!confirm(`¿Salir de ${isChannel ? "#" + title : "esta conversación"}?`)) return;
    try { await chat.post(`/channels/${id}/leave`, {}); dropChannel(id); navigate("/canales"); }
    catch (e) { setNotice(e.message); }
  };
  const setPrefs = (prefs) => chat.put(`/channels/${id}/prefs`, prefs).then(upsertChannel).catch((e) => setNotice(e.message));
  const archive = (on) => chat.patch(`/channels/${id}`, { archived: on }).then((v) => { setInfo(v); upsertChannel({ id, archived: on }); loadChat({ force: true }); }).catch((e) => setNotice(e.message));

  const myCh = s.channels.get(id);
  const bell = () => [
    { group: "Avisos de este canal", items: [
      { label: "Todos los mensajes", radio: "notify", checked: myCh?.notify === "all", onSelect: () => setPrefs({ notify: "all" }) },
      { label: isChannel ? "Solo menciones (por defecto)" : "Todos (por defecto)", radio: "notify", checked: !myCh?.notify || myCh.notify === "default", onSelect: () => setPrefs({ notify: "default" }) },
      { label: "Solo menciones", radio: "notify", checked: myCh?.notify === "mentions", onSelect: () => setPrefs({ notify: "mentions" }) },
      { label: "Nada", radio: "notify", checked: myCh?.notify === "nothing", onSelect: () => setPrefs({ notify: "nothing" }) },
    ] },
    { group: null, items: [{ label: myCh?.muted ? "Dejar de silenciar" : "Silenciar el canal", icon: myCh?.muted ? Bell : BellSlash, onSelect: () => setPrefs({ muted: !myCh?.muted }) }] },
  ];
  const more = () => [
    { group: null, items: [
      member ? { label: "Marcar como leído", icon: Check, onSelect: () => chat.post(`/channels/${id}/read`, {}).then((r) => upsertChannel({ id, ...r })) } : null,
      { label: "Mensajes fijados", icon: Pin, onSelect: () => setDialog("pins") },
      { label: isChannel ? "Personas y detalles" : "Personas", icon: UsersThree, onSelect: () => setDialog("info") },
      isChannel && info?.canManage ? { label: "Editar tema y descripción", icon: Ellipsis, onSelect: () => setDialog("topic") } : null,
    ].filter(Boolean) },
    isChannel ? { group: null, items: [
      info?.canManage ? { label: ch?.archived ? "Desarchivar el canal" : "Archivar el canal", onSelect: () => { if (ch?.archived || confirm("¿Archivar #" + title + "? Se podrá leer, pero nadie podrá escribir.")) archive(!ch?.archived); } } : null,
      member && ch?.kind !== "dm" ? { label: "Salir del canal", onSelect: leave } : null,
    ].filter(Boolean) } : (ch?.kind === "group" ? { group: null, items: [{ label: "Salir del grupo", onSelect: leave }] } : null),
  ].filter((g) => g && g.items.length);

  if (error === "missing") {
    return <ChatPage title="Canal" icon={<Hash size={19} />}><Empty title="No existe este canal o no puedes verlo" action={<a className="ch-btn" href="/canales">Ver los canales</a>}>Quizá es privado y no te han añadido, o se ha borrado.</Empty></ChatPage>;
  }
  const icon = !ch ? <Hash size={19} /> : ch.kind === "private" ? <LockSimple size={19} aria-label="Privado" /> : ch.kind === "public" ? <Hash size={19} /> : ch.kind === "group" ? <UsersThree size={19} /> : null;
  const sub = ch ? (ch.archived ? "Archivado · solo lectura" : isChannel ? ch.topic || ch.description || "" : ch.kind === "dm" ? s.people.get((ch.people || []).find((p) => p !== me))?.title || "" : (ch.people || []).length + " personas") : "";
  const typingHere = [...(s.typing.get(id) || new Map())].filter(([, t]) => !t.thread && t.until > Date.now()).map(([p]) => nameOf(p, s));
  const actions = ch ? (
    <>
      {isChannel ? <button type="button" className="ch-btn cv-members r-hide-phone" onClick={() => setDialog("info")} aria-label={`${info?.memberCount ?? ch.memberCount ?? 0} personas en el canal`}><UsersThree size={16} />{info?.memberCount ?? ch.memberCount ?? ""}</button> : null}
      {member ? <MenuButton label="Avisos" menuLabel="Avisos" items={bell} className="ch-iconbtn" placement="bottom-end">{myCh?.muted ? <BellSlash size={18} /> : <Bell size={18} />}</MenuButton> : null}
      <MenuButton label="Más opciones del canal" menuLabel={isChannel ? "#" + title : title} items={more} className="ch-iconbtn" placement="bottom-end"><Ellipsis size={18} /></MenuButton>
    </>
  ) : null;

  // The timeline with day lines, the «Nuevo» line and the author's runs of messages.
  const rows = [];
  let prev = null;
  for (const m of messages) {
    if (!prev || !sameDay(prev.at, m.at)) rows.push(<div key={"d" + m.id} className="cv-day" role="separator"><span>{dayLabel(m.at)}</span></div>);
    const isNew = newLine != null && prev && prev.seq <= newLine && m.seq > newLine && m.author !== me;
    if (isNew) rows.push(<div key={"n" + m.id} className="cv-new" role="separator" aria-label="Mensajes nuevos"><span>Nuevo</span></div>);
    const compact = prev && !isNew && sameDay(prev.at, m.at) && prev.author === m.author && !prev.deleted && !m.deleted && !m.broadcast && !prev.replies && m.at - prev.at < 5 * 60000 && !m.botName;
    rows.push(<Message key={m.id} m={m} compact={compact} onThread={openThread} onUnread={member ? markUnread : null} canPost={canPost} admin={admin} highlight={m.id === focusId} />);
    prev = m;
  }
  const unreadAbove = newLine != null && messages.length && messages[0].seq > newLine + 1;

  return (
    <ChatPage title={(isChannel ? "" : "") + title} top={isChannel ? "#" + title : title} icon={icon} sub={sub} actions={actions} scroll={false} bodyClass="cv-body">
      <div className="cv">
        <div className="cv-main">
          <div ref={list} className="cv-list" onScroll={onScroll} data-message-list="" aria-label={"Mensajes de " + (isChannel ? "#" : "") + title} role="log" aria-live="polite" aria-relevant="additions">
            {loading ? <p className="cv-loading">Cargando mensajes…</p> : null}
            {!loading && !edges.before ? <ChannelIntro ch={ch} title={title} s={s} /> : null}
            {edges.before && messages.length ? <div className="cv-more"><button type="button" className="ch-btn" onClick={older}>Ver mensajes anteriores</button></div> : null}
            {rows}
            {edges.after ? <div className="cv-more"><button type="button" className="ch-btn" onClick={newer}>Ver mensajes más recientes</button></div> : null}
          </div>
          {unreadAbove ? <button type="button" className="cv-jump is-top" onClick={() => list.current?.querySelector(".cv-new")?.scrollIntoView({ block: "center" })}>Ir a lo no leído</button> : null}
          {(!atBottom || edges.after) && !loading ? <button type="button" className="cv-jump" onClick={toEnd}><ArrowDown size={14} /> Ir al final</button> : null}
          <p className="cv-typing" aria-live="polite">{typingHere.length ? typingHere.join(", ") + (typingHere.length === 1 ? " está escribiendo…" : " están escribiendo…") : ""}</p>
          {notice ? <p className="cv-notice" role="status"><span>{notice}</span><button type="button" className="ch-btn" onClick={() => setNotice(null)}>Vale</button></p> : null}
          {ch?.archived ? <div className="cv-banner">Este canal está archivado: se puede leer, pero ya no admite mensajes.</div>
            : !member && ch ? (
              <div className="cv-banner"><span>{"Estás viendo #" + title + "."}</span><button type="button" className="ch-btn is-primary" onClick={join}>Unirme al canal</button></div>
            ) : ch ? (
              <div className="cv-composer r-composer">
                <Composer key={id} channel={id} initialDraft={myCh?.draft || ""} placeholder={isChannel ? "Escribe en #" + title : "Escribe a " + title}
                  onPending={(m) => { stick.current = true; setMessages((all) => (edges.after ? all : [...all, m])); }}
                  onSent={(m, clientId, notIn) => {
                    setMessages((all) => (m ? [...all.filter((x) => x.clientId !== clientId && x.id !== m.id), m].sort(byseq) : all.filter((x) => x.clientId !== clientId)));
                    if (notIn?.length) setNotice(notIn.map((p) => nameOf(p, s)).join(", ") + (notIn.length === 1 ? " no está en este canal y no lo verá." : " no están en este canal y no lo verán."));
                    if (edges.after) toEnd();
                  }} />
              </div>
            ) : null}
        </div>
        {threadId ? <Thread key={threadId} channel={id} rootId={threadId} canPost={canPost} admin={admin} onClose={closeThread} /> : null}
      </div>
      {dialog === "pins" ? <PinsDialog channel={id} onClose={() => setDialog(null)} onOpen={(m) => { setDialog(null); navigate(`/canal/${id}?m=${m.id}`); }} /> : null}
      {dialog === "info" ? <ChannelInfo channel={id} info={info} onClose={() => setDialog(null)} onChanged={(v) => setInfo(v)} /> : null}
      {dialog === "topic" ? <TopicDialog channel={id} info={info} onClose={() => setDialog(null)} onChanged={(v) => { setInfo(v); upsertChannel({ id, topic: v.topic, description: v.description, name: v.name }); }} /> : null}
    </ChatPage>
  );
}

function ChannelIntro({ ch, title, s }) {
  if (!ch) return null;
  if (ch.kind === "dm" || ch.kind === "group") {
    const others = (ch.people || []).filter((p) => p !== s.me?.id);
    return (
      <div className="cv-intro">
        <h2 className="cv-intro-title">{title}</h2>
        <p className="cv-intro-text">{others.length === 1 ? `Esta es tu conversación con ${title}. Solo la veis vosotros dos.` : "Solo las personas de este grupo ven esta conversación."}</p>
      </div>
    );
  }
  return (
    <div className="cv-intro">
      <h2 className="cv-intro-title">{(ch.kind === "private" ? "" : "#") + title}</h2>
      <p className="cv-intro-text">{ch.description || (ch.kind === "private" ? "Un canal privado: solo lo ven sus miembros." : "El principio de #" + title + ".")}</p>
      {ch.kind === "private" ? <p className="cv-intro-text"><LockSimple size={14} /> Privado</p> : null}
      <p className="cv-intro-text"><UserPlus size={14} /> Añade personas desde «Personas y detalles».</p>
    </div>
  );
}
