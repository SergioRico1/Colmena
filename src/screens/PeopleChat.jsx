import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Lock, LogOut, RotateCw, SmilePlus } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import ConvList from "../components/v2/chat/ConvList.jsx";
import { PeerAvatar, PeoplePile } from "../components/v2/people/PeerAvatar.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import MeetingCard from "../components/v2/people/MeetingCard.jsx";
import { useShareChat, RELAY_LABEL } from "../lib/peers.js";
import { mentionSegments, resolveMentions } from "../lib/mentions.js";
import { useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import NotFound from "./NotFound.jsx";

// A conversation with people (design/V2Personas.dc.html, paso persona): one per contact, or a
// group of up to 32. Messages are plain text (never rendered as HTML or Markdown: they come
// from someone else); seen marks, reactions and «está escribiendo» as in the v2 Sala board.
const QUICK = ["👍", "❤️", "😂", "🎉"];
const pillStyle = { display: "flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 18px", border: 0, borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600, boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 8px 20px -12px rgba(18,19,26,.2)", color: "#12131A" };
const dayLabel = (iso) => {
  const d = new Date(iso), today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (new Date(Date.now() - 864e5).toDateString() === d.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
};
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const names = (list) => (list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list.at(-1));
const NOTE_KEY = "colmena:personas:nota-bots";

/** A bot named in a message or about to be: its shape, its name and whose it is. */
function MentionPill({ bot, label, title }) {
  return (
    <span title={title || undefined} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "1px 8px 1px 5px", borderRadius: "999px", background: `${bot.color || "#8C8F99"}24`, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "baseline" }}>
      <BotPresence bot={bot} size={12} state="rest" />
      {bot.name}
      {label ? <span style={{ fontWeight: 500, color: "#5C606C" }}>{"· " + label}</span> : null}
    </span>
  );
}

export default function PeopleChat({ params = {} }) {
  const id = params.id;
  const { peers, bots: myBots = [] } = useStore();
  const chat = useShareChat(id);
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentions, setMentions] = useState([]); // [{owner, bot, name}] picked with «@»
  const input = useRef(null);
  useEffect(() => { setText(""); setError(null); setMentions([]); setMentionOpen(false); input.current?.focus(); }, [id]);
  const share = chat.share;
  const relay = peers?.relay?.status || "off";
  const others = useMemo(() => (share?.members || []).filter((m) => !m.me), [share]);
  // Bots you can name here: yours, then each person's (what their Colmena announced). Each one
  // carries its owner: two people may both have a «Vera» (src/lib/mentions.js).
  const me = peers?.me?.address || null;
  const mineEnabled = useMemo(() => myBots.filter((b) => b.enabled !== false), [myBots]);
  const mentionable = useMemo(() => {
    const list = mineEnabled.map((b) => ({ owner: me, bot: b.id, name: b.name, color: b.color, shape: b.shape, mine: true, note: "tu bot", ownerFace: { me: true } }));
    for (const o of others) {
      const c = (peers?.contacts || []).find((x) => x.id === o.id);
      for (const b of c?.bots || []) list.push({ owner: o.id, bot: b.id, name: b.name, color: b.color, shape: b.shape, note: "de " + o.name.split(" ")[0], ownerFace: o });
    }
    return list;
  }, [mineEnabled, others, peers, me]);
  const botOf = (owner, bot) => mentionable.find((x) => x.owner === owner && x.bot === bot) || null;
  // Several bots with this name here (yours and someone else's): say so where it matters.
  const shared = (name) => mentionable.filter((x) => x.name.toLowerCase() === String(name).toLowerCase()).length > 1;
  const pickMention = (m) => {
    setMentionOpen(false);
    setMentions((all) => (all.some((x) => x.owner === m.owner && x.bot === m.bot) ? all : [...all, m]));
    setText((t) => (t.endsWith("@") ? t.slice(0, -1) : t) + (t && !/\s$/.test(t) && !t.endsWith("@") ? " " : "") + "@" + m.name + " ");
    input.current?.focus();
  };
  // Who the message goes to, shown before sending: picked bots, and «@Vera» written by hand is yours.
  const resolved = useMemo(() => resolveMentions(text, mentions, mineEnabled, me).map((m) => botOf(m.owner, m.bot) || { ...m, note: "tu bot", ownerFace: { me: true } }), [text, mentions, mineEnabled, me, mentionable]);
  // The first time in a conversation with people: what your bots see here (once).
  const [botsNote, setBotsNote] = useState(() => { try { return !localStorage.getItem(NOTE_KEY); } catch { return false; } });
  const closeNote = () => { setBotsNote(false); try { localStorage.setItem(NOTE_KEY, "1"); } catch {} };
  if (chat.error === "missing") return <NotFound active="conversaciones" title="Esta conversación ya no está" text="Puede que la otra persona la cerrara. No se ha perdido nada de lo tuyo." />;
  const dm = share?.kind === "dm";
  const other = dm ? others[0] : null;
  const gone = !!(share?.left || share?.removed);
  const status = !share ? "" : dm
    ? (other?.status === "pending" ? "Esperando a que acepte en su Colmena" : other?.online ? "Conectada" : "No está conectada ahora")
    : `${others.length + 1} personas`;
  const send = async () => {
    const value = text.trim();
    if (!value) return;
    // Always with their owner (a hand-written «@Vera» goes as yours, as the pill showed).
    const named = resolved.map(({ owner, bot }) => ({ owner, bot }));
    setText("");
    setMentions([]);
    setError(null);
    try { await chat.send(value, named); } catch (e) { setError(e.message); setText(value); }
  };
  const leave = async () => {
    try { await post(`/peers/shares/${encodeURIComponent(id)}/leave`); navigate("/chats"); } catch (e) { setError(e.message); }
  };
  // My last message that someone saw: «Visto por …» goes only there.
  const lastSeenMine = [...chat.messages].reverse().find((m) => m.from === "me" && m.seenBy?.length)?.id;
  let lastDay = null;
  return (
    <Shell active="conversaciones" scroll={false}>
      <div style={{ display: "flex", height: "100%", alignItems: "stretch" }}>
        <ConvList current={id} />
        <section aria-label={share ? "Conversación con " + share.title : "Conversación"} style={{ flex: "1", minWidth: "0", height: "100%", display: "flex", flexDirection: "column" }}>
          <header style={{ flex: "none", background: "#F5F5F2", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px", padding: "20px clamp(20px, 4vw, 44px) 18px" }}>
              {dm && other ? <PeerAvatar person={other} size={48} dot={other.status === "active"} dashed={other.status === "pending"} /> : null}
              <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                <h1 style={{ margin: 0, font: "600 26px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{share ? (dm ? share.title : <><span style={{ color: "#A3A6AE" }}>{"#"}</span>{" " + share.title}</>) : " "}</h1>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "14px", color: "#5C606C" }}>
                  {status}
                  {share ? <><span aria-hidden="true" style={{ width: "3px", height: "3px", borderRadius: "50%", background: "#A3A6AE" }} /><span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><Lock size={13} strokeWidth={2.2} aria-hidden="true" />{dm ? "Solo lo leéis vosotros dos" : "Solo lo leéis quienes estáis aquí"}</span></> : null}
                </span>
              </div>
              {!dm && share ? <span title={names(others.map((o) => o.name))} style={{ ...pillStyle, padding: "0 16px 0 8px", cursor: "default" }}><PeoplePile people={share.members} />{share.mine ? null : <span style={{ fontSize: "13px", color: "#5C606C" }}>{"de " + (share.members.find((m) => m.id === share.owner)?.name.split(" ")[0] || "")}</span>}</span> : null}
              {dm ? <button type="button" onClick={() => navigate("/ajustes/contactos#" + (other?.id || ""))} style={{ ...pillStyle, background: "rgba(18,19,26,.06)", boxShadow: "none" }}>{"Sobre " + (other?.name.split(" ")[0] || "esta persona")}</button> : null}
              {!dm && share && !gone ? <button type="button" onClick={leave} title={share.mine ? "La cierras para todos" : "Dejas de recibir sus mensajes"} style={{ ...pillStyle, background: "rgba(18,19,26,.06)", boxShadow: "none" }}><LogOut size={15} strokeWidth={2.2} aria-hidden="true" />{share.mine ? "Cerrar para todos" : "Salir"}</button> : null}
            </div>
          </header>
          {relay !== "online" && share ? (
            <p role="status" style={{ flex: "none", margin: 0, padding: "10px clamp(20px, 4vw, 44px)", background: "#FFF6DE", color: "#6B4E00", fontSize: "14px" }}>
              {relay === "off" ? "Falta conectar Colmena al buzón de mensajes: Ajustes › Personas." : RELAY_LABEL[relay] + ". Lo que escribas saldrá en cuanto vuelva."}
            </p>
          ) : null}
          <div style={{ flex: "1", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", display: "flex", flexDirection: "column-reverse" }}>
            <div style={{ width: "100%", maxWidth: "840px", margin: "0 auto", padding: "22px clamp(20px, 4vw, 44px) 24px", display: "flex", flexDirection: "column", gap: "6px", boxSizing: "border-box" }}>
              {chat.more ? <button type="button" onClick={chat.older} style={{ alignSelf: "center", height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.05)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{"Ver mensajes anteriores"}</button> : null}
              {!chat.loading && !chat.messages.length ? (
                <div style={{ alignSelf: "center", maxWidth: "520px", margin: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", textAlign: "center", animation: "fade .4s ease-out" }}>
                  {share ? <PeoplePile people={share.members} size={56} /> : null}
                  <strong style={{ font: "600 22px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{dm && other?.status === "pending" ? "Invitación aceptada" : "Aún no os habéis escrito"}</strong>
                  <span style={{ fontSize: "15px", lineHeight: 1.55, color: "#5C606C" }}>{dm && other?.status === "pending" ? `En cuanto ${other.name.split(" ")[0]} abra Colmena quedaréis conectados. Lo que escribas ahora le llegará entonces.` : "Cada mensaje sale cerrado con llave desde este ordenador y solo lo abren los de quienes estáis aquí."}</span>
                </div>
              ) : null}
              {chat.messages.map((m) => {
                const day = dayLabel(m.at);
                const showDay = day !== lastDay;
                lastDay = day;
                const mine = m.from === "me";
                return (
                  <div key={m.id}>
                    {showDay ? <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "10px 0 12px", fontSize: "13px", color: "#6B6F7A" }}><span style={{ flex: 1, height: "1px", background: "rgba(18,19,26,.08)" }} />{day}<span style={{ flex: 1, height: "1px", background: "rgba(18,19,26,.08)" }} /></div> : null}
                    <div className="msg" style={{ position: "relative", display: "grid", gridTemplateColumns: "40px 1fr", gap: "14px", padding: "10px 0" }}>
                      <div className="msg-tools" role="toolbar" aria-label="Acciones del mensaje" style={{ position: "absolute", top: "-16px", right: "12px", zIndex: 6, display: "flex", alignItems: "center", gap: "2px", padding: "4px", background: "#FFFFFF", borderRadius: "14px", boxShadow: "0 1px 2px rgba(18,19,26,.08), 0 12px 28px -12px rgba(18,19,26,.35)" }}>
                        {QUICK.map((e) => <button key={e} type="button" aria-label={"Reaccionar " + e} onClick={() => chat.react(m.id, e).catch((x) => setError(x.message))} style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", border: 0, borderRadius: "10px", background: "transparent", cursor: "pointer", fontSize: "18px", lineHeight: 1 }}>{e}</button>)}
                        <button type="button" aria-label="Otra reacción" onClick={() => setPicker(picker === m.id ? null : m.id)} style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", border: 0, borderRadius: "10px", background: "transparent", cursor: "pointer", color: "#3D404A" }}><SmilePlus size={18} strokeWidth={1.9} aria-hidden="true" /></button>
                      </div>
                      {m.bot ? (
                        // A bot of the author (on its owner's computer), with the owner's face beside it.
                        <span aria-hidden="true" style={{ position: "relative", width: "40px", height: "40px", display: "grid", placeItems: "center" }}>
                          <BotPresence bot={m.bot} size={32} state="rest" />
                          <span style={{ position: "absolute", right: "-3px", bottom: "-3px" }}><PeerAvatar person={mine ? { me: true } : { initials: m.author.initials, color: m.author.color }} size={18} /></span>
                        </span>
                      ) : <PeerAvatar person={mine ? { me: true } : { initials: m.author.initials, color: m.author.color }} size={40} />}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                        <span style={{ fontSize: "14px" }}><strong style={{ fontWeight: 600 }}>{m.bot ? m.bot.name : mine ? "Tú" : m.author.name}</strong> <span style={{ color: "#6B6F7A" }}>{(m.bot ? (mine ? "· tu bot" : "· bot de " + m.author.name.split(" ")[0]) + (m.local ? " · solo lo ves tú" : "") + " " : "") + "· " + hhmm(m.at)}</span></span>
                        <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }}>
                          {mentionSegments(m.text, (m.mentions || []).map((x) => botOf(x.owner, x.bot)).filter(Boolean)).map((s, i) => (s.mention
                            ? <MentionPill key={i} bot={s.mention} label={shared(s.mention.name) || !s.mention.mine ? s.mention.note : null} />
                            : <span key={i}>{s.text}</span>))}
                        </p>
                        {m.card?.kind === "meeting" ? <MeetingCard meeting={m.meeting} onChange={chat.updateMeeting} /> : null}
                        {picker === m.id ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "6px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35)", alignSelf: "flex-start", animation: "rise .2s ease-out" }}>
                            {["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "😮", "😢", "🔥"].map((e) => <button key={e} type="button" aria-label={"Reaccionar " + e} onClick={() => { setPicker(null); chat.react(m.id, e).catch((x) => setError(x.message)); }} style={{ width: "36px", height: "36px", border: 0, borderRadius: "10px", background: "transparent", cursor: "pointer", fontSize: "19px" }}>{e}</button>)}
                          </div>
                        ) : null}
                        {m.reactions?.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {m.reactions.map((r) => (
                              <button key={r.emoji} type="button" aria-pressed={r.mine ? "true" : "false"} title={names(r.who)} onClick={() => chat.react(m.id, r.emoji).catch((x) => setError(x.message))} style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px 0 8px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, background: r.mine ? "rgba(31,79,209,.1)" : "rgba(18,19,26,.05)", boxShadow: r.mine ? "inset 0 0 0 1.5px rgba(31,79,209,.35)" : "none", animation: "pop .3s ease-out" }}>
                                <span style={{ fontSize: "16px", lineHeight: 1 }}>{r.emoji}</span>{r.count}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {mine && m.status === "sending" ? <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{"Enviando…"}</span> : null}
                        {mine && m.status === "failed" ? <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#B4231A" }}>{"No se envió."}<button type="button" onClick={() => chat.retry(m.id).catch((x) => setError(x.message))} style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "rgba(180,35,26,.08)", color: "#B4231A", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}><RotateCw size={13} strokeWidth={2.4} aria-hidden="true" />{"Reintentar"}</button></span> : null}
                        {m.id === lastSeenMine ? <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{dm ? "Visto" : "Visto por " + names(m.seenBy)}</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ flex: "none", width: "100%", maxWidth: "880px", margin: "0 auto", padding: "8px clamp(20px, 4vw, 44px) 22px", boxSizing: "border-box" }}>
            <p role="status" style={{ margin: "0 0 10px 18px", minHeight: "18px", display: "flex", gap: "16px", fontSize: "13px", color: "#5C606C" }}>
              {chat.typing.length ? (
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span aria-hidden="true" style={{ display: "flex", gap: "3px" }}>{[0, 0.15, 0.3].map((d) => <span key={d} style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#5C606C", animation: `dots 1.2s ${d}s infinite` }} />)}</span>
                  {names(chat.typing.map((n) => n.split(" ")[0])) + (chat.typing.length > 1 ? " están escribiendo" : " está escribiendo")}
                </span>
              ) : null}
              {chat.thinking.length ? (
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span aria-hidden="true" style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#8C8F99", animation: "breathe 1.4s ease-in-out infinite" }} />
                  {names(chat.thinking) + (chat.thinking.length > 1 ? " están pensando" : " está pensando")}
                </span>
              ) : null}
              {error ? <span role="alert" style={{ color: "#B4231A" }}>{error}</span> : null}
            </p>
            {mentionOpen && mentionable.length ? (
              <div role="listbox" aria-label="Pedírselo a un bot" style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 0, bottom: "10px", width: "min(380px, 100%)", maxHeight: "320px", overflowY: "auto", padding: "8px", background: "rgba(255,255,255,.96)", WebkitBackdropFilter: "blur(20px)", backdropFilter: "blur(20px)", borderRadius: "24px", boxShadow: "0 30px 60px -20px rgba(18,19,26,.35)", display: "flex", flexDirection: "column", gap: "2px", animation: "rise .25s ease-out", zIndex: 10 }}>
                  {mentionable.map((m) => (
                    <button key={m.owner + m.bot} type="button" role="option" aria-selected="false" aria-label={`${m.name}, ${m.note}`} onClick={() => pickMention(m)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "46px", padding: "0 12px", border: 0, borderRadius: "14px", background: shared(m.name) ? "rgba(18,19,26,.03)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                      <span aria-hidden="true" style={{ position: "relative", width: "26px", height: "26px", display: "grid", placeItems: "center" }}>
                        <BotPresence bot={m} size={22} state="rest" />
                        <span style={{ position: "absolute", right: "-5px", bottom: "-5px" }}><PeerAvatar person={m.ownerFace} size={14} ring="#FFFFFF" /></span>
                      </span>
                      <span style={{ flex: 1, fontSize: "15px", fontWeight: 500 }}>{m.name}</span>
                      <span style={{ fontSize: "12px", fontWeight: shared(m.name) ? 600 : 400, color: shared(m.name) ? "#12131A" : "#6B6F7A" }}>{m.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {botsNote && share && !gone ? (
              <p role="note" style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px 10px 16px", borderRadius: "16px", background: "#F2F2EE", fontSize: "14px", color: "#3D404A", animation: "rise .3s ease-out" }}>
                <Lock size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />
                <span style={{ flex: 1 }}>{"Tus bots aquí no ven tu correo ni tu memoria; menciónalos con @."}</span>
                <button type="button" onClick={closeNote} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{"Entendido"}</button>
              </p>
            ) : null}
            {resolved.length ? (
              <div aria-label="Se lo pides a" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", margin: "0 0 8px 14px", fontSize: "13px", color: "#5C606C", animation: "fade .2s ease-out" }}>
                {"Para"}
                {resolved.map((m) => {
                  const typed = !mentions.some((x) => x.owner === m.owner && x.bot === m.bot);
                  return <MentionPill key={m.owner + m.bot} bot={m} label={m.note} title={typed && shared(m.name) ? `Escrito a mano: es tu ${m.name}. Para otra, elígela con @.` : null} />;
                })}
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", padding: "8px", background: "#FFFFFF", borderRadius: "28px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 50px -24px rgba(18,19,26,.35)" }}>
              <label style={{ flex: 1, display: "flex" }}>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Mensaje"}</span>
                <textarea ref={input} rows={1} value={text} disabled={gone || !share} maxLength={8000}
                  onChange={(e) => { const v = e.target.value; setText(v); if (v.trim()) chat.typingNow(); if (/(^|\s)@$/.test(v)) setMentionOpen(true); else if (mentionOpen && !/@\S*$/.test(v)) setMentionOpen(false); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"; }}
                  onKeyDown={(e) => { if (e.key === "Escape" && mentionOpen) { e.preventDefault(); setMentionOpen(false); return; } if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                  placeholder={gone ? "Ya no estás en esta conversación" : (dm ? `Escribe a ${other?.name.split(" ")[0] || ""}…` : "Escribe a todos…") + " o @ para pedírselo a un bot"}
                  style={{ flex: 1, minWidth: 0, minHeight: "44px", maxHeight: "200px", padding: "11px 14px", border: 0, outline: "none", resize: "none", background: "transparent", font: "inherit", fontSize: "16px", lineHeight: 1.4 }} />
              </label>
              <button type="button" aria-label="Pedírselo a un bot" aria-expanded={mentionOpen ? "true" : "false"} onClick={() => setMentionOpen((o) => !o)} disabled={gone || !share} style={{ width: "44px", height: "44px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", cursor: "pointer", font: "600 17px/1 'Geist', sans-serif", background: "rgba(18,19,26,.05)", color: "#12131A" }}>{"@"}</button>
              <button type="submit" aria-label="Enviar" disabled={!text.trim() || gone} style={{ width: "44px", height: "44px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: text.trim() && !gone ? "#12131A" : "#C9CBD1", color: "#FFFFFF", cursor: text.trim() && !gone ? "pointer" : "default" }}>
                <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      </div>
    </Shell>
  );
}
