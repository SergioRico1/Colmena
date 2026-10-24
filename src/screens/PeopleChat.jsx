import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, LogOut, Search } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import ConvList from "../components/v2/chat/ConvList.jsx";
import { PeerAvatar, PeoplePile } from "../components/v2/people/PeerAvatar.jsx";
import PeopleMessage, { names } from "../components/v2/people/PeopleMessage.jsx";
import PeopleComposer from "../components/v2/people/PeopleComposer.jsx";
import ThreadPanel from "../components/v2/people/ThreadPanel.jsx";
import ShareSearch from "../components/v2/people/ShareSearch.jsx";
import { useShareChat, RELAY_LABEL, statusText, unsendMessage, whenText } from "../lib/peers.js";
import { useRevealMessage } from "../lib/reveal.js";
import { isHidden, later, useToasts } from "../lib/undoToast.js";
import { useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import NotFound from "./NotFound.jsx";

// A conversation with people (design/V2Personas.dc.html, pasos persona, sala, hilo, buscar):
// one per contact, or a group of up to 32. Messages are plain text (never rendered as HTML or
// Markdown: they come from someone else); threads open beside it; your own messages can be
// edited or deleted for everyone (only your Colmena can: the change is signed by you).
const pillStyle = { display: "flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 18px", border: 0, borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600, boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 8px 20px -12px rgba(18,19,26,.2)", color: "#12131A" };
const dayLabel = (iso) => {
  const d = new Date(iso), today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (new Date(Date.now() - 864e5).toDateString() === d.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
};
const NOTE_KEY = "colmena:personas:nota-bots";

export default function PeopleChat({ params = {}, query = {} }) {
  const id = params.id;
  const { peers, bots: myBots = [] } = useStore();
  useToasts(); // a message being deleted hides until its «Deshacer» runs out
  const chat = useShareChat(id);
  const [error, setError] = useState(null);
  const [searching, setSearching] = useState(false);
  const threadId = query.hilo || null;
  useEffect(() => { setError(null); setSearching(false); }, [id]);
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
  const botOf = useCallback((owner, bot) => mentionable.find((x) => x.owner === owner && x.bot === bot) || null, [mentionable]);
  // Several bots with this name here (yours and someone else's): say so where it matters.
  const shared = useCallback((name) => mentionable.filter((x) => x.name.toLowerCase() === String(name).toLowerCase()).length > 1, [mentionable]);
  // The first time in a conversation with people: what your bots see here (once).
  const [botsNote, setBotsNote] = useState(() => { try { return !localStorage.getItem(NOTE_KEY); } catch { return false; } });
  const closeNote = () => { setBotsNote(false); try { localStorage.setItem(NOTE_KEY, "1"); } catch {} };
  // /con/x?m=<id> (a search hit, a notice) opens the conversation at that message.
  useRevealMessage(threadId ? null : query.m || null, { ready: !chat.loading && !!share, olderCount: chat.more ? chat.messages.length : 0, showOlder: chat.older });
  const openThread = useCallback((m) => navigate("/con/" + id + "?hilo=" + encodeURIComponent(m.id)), [id]);
  const closeThread = useCallback(() => navigate("/con/" + id, { replace: true }), [id]);
  if (chat.error === "missing") return <NotFound active="conversaciones" title="Esta conversación ya no está" text="Puede que la otra persona la cerrara. No se ha perdido nada de lo tuyo." />;
  const dm = share?.kind === "dm";
  const other = dm ? others[0] : null;
  const gone = !!(share?.left || share?.removed);
  const status = !share ? "" : dm
    ? (other?.status === "pending" ? "Esperando a que acepte en su Colmena" : other?.away ? statusText(other.away) : other?.online ? "Conectada" : "No está conectada ahora")
    : `${others.length + 1} personas`;
  const leave = async () => {
    try { await post(`/peers/shares/${encodeURIComponent(id)}/leave`); navigate("/chats"); } catch (e) { setError(e.message); }
  };
  // «Borrar para todos» waits for its «Deshacer» before anything leaves this computer.
  const remove = (m) => later({
    id: "peermsg:" + m.id, keys: ["peermsg:" + m.id], text: "Mensaje borrado para todos", error: "No se pudo borrar",
    run: async () => { await unsendMessage(m.id); await chat.load(); },
  });
  // My last message that someone saw: «Visto por …» goes only there.
  const lastSeenMine = [...chat.messages].reverse().find((m) => m.from === "me" && m.seenBy?.length)?.id;
  const shown = chat.messages.filter((m) => !isHidden("peermsg:" + m.id));
  const composer = { others, mentionable, mineEnabled, me, disabled: gone || !share, onTyping: chat.typingNow };
  let lastDay = null;
  return (
    <Shell active="conversaciones" scroll={false}>
      <div style={{ position: "relative", display: "flex", height: "100%", alignItems: "stretch" }}>
        <ConvList current={id} />
        <section aria-label={share ? "Conversación con " + share.title : "Conversación"} style={{ flex: "1", minWidth: "0", height: "100%", display: "flex", flexDirection: "column" }}>
          <header style={{ position: "relative", zIndex: 5, flex: "none", background: "#F5F5F2", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px", padding: "20px clamp(20px, 4vw, 44px) 18px" }}>
              {dm && other ? <PeerAvatar person={other} size={48} dot={other.status === "active"} dashed={other.status === "pending"} /> : null}
              <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                <h1 style={{ margin: 0, font: "600 26px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{share ? (dm ? share.title : <><span style={{ color: "#A3A6AE" }}>{"#"}</span>{" " + share.title}</>) : " "}</h1>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "14px", color: "#5C606C" }}>
                  {status}
                  {share ? <><span aria-hidden="true" style={{ width: "3px", height: "3px", borderRadius: "50%", background: "#A3A6AE" }} /><span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><Lock size={13} strokeWidth={2.2} aria-hidden="true" />{dm ? "Solo lo leéis vosotros dos" : "Solo lo leéis quienes estáis aquí"}</span></> : null}
                </span>
              </div>
              {share ? <button type="button" aria-label="Buscar en esta conversación" title="Buscar en esta conversación" aria-expanded={searching ? "true" : "false"} onClick={() => setSearching((s) => !s)} style={{ ...pillStyle, width: "48px", padding: 0, justifyContent: "center", background: searching ? "#12131A" : "rgba(18,19,26,.06)", color: searching ? "#FFFFFF" : "#12131A", boxShadow: "none" }}><Search size={17} strokeWidth={2.2} aria-hidden="true" /></button> : null}
              {!dm && share ? <span title={names(others.map((o) => o.name))} style={{ ...pillStyle, padding: "0 16px 0 8px", cursor: "default" }}><PeoplePile people={share.members} />{share.mine ? null : <span style={{ fontSize: "13px", color: "#5C606C" }}>{"de " + (share.members.find((m) => m.id === share.owner)?.name.split(" ")[0] || "")}</span>}</span> : null}
              {dm ? <button type="button" onClick={() => navigate("/ajustes/contactos#" + (other?.id || ""))} style={{ ...pillStyle, background: "rgba(18,19,26,.06)", boxShadow: "none" }}>{"Sobre " + (other?.name.split(" ")[0] || "esta persona")}</button> : null}
              {!dm && share && !gone ? <button type="button" onClick={leave} title={share.mine ? "La cierras para todos" : "Dejas de recibir sus mensajes"} style={{ ...pillStyle, background: "rgba(18,19,26,.06)", boxShadow: "none" }}><LogOut size={15} strokeWidth={2.2} aria-hidden="true" />{share.mine ? "Cerrar para todos" : "Salir"}</button> : null}
            </div>
            {searching && share ? <ShareSearch shareId={id} onClose={() => setSearching(false)} /> : null}
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
              {shown.map((m) => {
                const day = dayLabel(m.at);
                const showDay = day !== lastDay;
                lastDay = day;
                return (
                  <div key={m.id}>
                    {showDay ? <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "10px 0 12px", fontSize: "13px", color: "#6B6F7A" }}><span style={{ flex: 1, height: "1px", background: "rgba(18,19,26,.08)" }} />{day}<span style={{ flex: 1, height: "1px", background: "rgba(18,19,26,.08)" }} /></div> : null}
                    <PeopleMessage m={m} dm={dm} botOf={botOf} shared={shared} lastSeen={m.id === lastSeenMine} onMeeting={chat.updateMeeting}
                      onReact={chat.react} onRetry={chat.retry} onEdit={chat.edit} onDelete={remove} onThread={m.local ? null : openThread} onError={setError} />
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ flex: "none", width: "100%", maxWidth: "880px", margin: "0 auto", padding: "8px clamp(20px, 4vw, 44px) 22px", boxSizing: "border-box" }}>
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
            <PeopleComposer {...composer} resetKey={id} onError={setError}
              onSend={(text, bots, people) => { setError(null); return chat.send(text, bots, people); }}
              placeholder={gone ? "Ya no estás en esta conversación" : (dm ? `Escribe a ${other?.name.split(" ")[0] || ""}…` : "Escribe a todos…") + " o @ para mencionar"}
              above={<>
                {dm && other?.away && !gone ? (
                  <p role="note" style={{ margin: "0 0 10px 18px", fontSize: "13px", color: "#5C606C" }}>
                    {other.away.mode === "dnd"
                      ? `${other.name.split(" ")[0]} tiene «No molestar»${other.away.until ? " hasta " + whenText(other.away.until) : ""}: le llegará, sin sonarle.`
                      : `${other.name.split(" ")[0]} está fuera${other.away.until ? " hasta " + whenText(other.away.until) : ""}: lo verá a la vuelta.`}
                  </p>
                ) : null}
                {botsNote && share && !gone ? (
                  <p role="note" style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px 10px 16px", borderRadius: "16px", background: "#F2F2EE", fontSize: "14px", color: "#3D404A", animation: "rise .3s ease-out" }}>
                    <Lock size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />
                    <span style={{ flex: 1 }}>{"Tus bots aquí no ven tu correo ni tu memoria; menciónalos con @."}</span>
                    <button type="button" onClick={closeNote} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{"Entendido"}</button>
                  </p>
                ) : null}
              </>} />
          </div>
        </section>
        {threadId && share ? <ThreadPanel key={threadId} shareId={id} rootId={threadId} dm={dm} botOf={botOf} shared={shared} composer={composer} revealId={query.m || null} onClose={closeThread} onDelete={remove} onError={setError} /> : null}
      </div>
    </Shell>
  );
}
