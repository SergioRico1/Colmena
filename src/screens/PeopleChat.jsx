import Select from "../components/Select.jsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, LogOut, Search } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import { PeerAvatar, PeoplePile } from "../components/v2/people/PeerAvatar.jsx";
import PeopleMessage, { names } from "../components/v2/people/PeopleMessage.jsx";
import PeopleComposer from "../components/v2/people/PeopleComposer.jsx";
import ThreadPanel from "../components/v2/people/ThreadPanel.jsx";
import ShareSearch from "../components/v2/people/ShareSearch.jsx";
import { fileBase64, useShareChat, RELAY_LABEL, statusText, unsendMessage, whenText } from "../lib/peers.js";
import { useRevealMessage } from "../lib/reveal.js";
import { isHidden, later, useToasts } from "../lib/undoToast.js";
import { useAction, useStore } from "../lib/store.jsx";
import { patch, post } from "../lib/api.js";
import { extOf, extTint } from "../components/v2/chat/Parts.jsx";
import { FileViewer } from "../components/v2/people/PeerFiles.jsx";
import RoomSheet from "../components/v2/people/RoomSheet.jsx";
import { navigate } from "../lib/router.jsx";
import NotFound from "./NotFound.jsx";
import { authorOf, authorView, continues } from "../lib/roomView.js";
import { useAnnouncer } from "../lib/useAnnouncer.js";
import { messageListProps } from "../lib/messageKeys.js";
import Announcer from "../components/Announcer.jsx";

// A direct conversation with a person (design/V3Personas.dc.html; V2Personas for persona, hilo,
// buscar). A group is a room: its address opens the one room screen (/sala/:id, screens/Room.jsx).
// The rows are the same as in a room (people/PeopleMessage.jsx + room/Author.jsx). Messages are plain text (never rendered as HTML or
// Markdown: they come from someone else); threads open beside it; your own messages can be
// edited or deleted for everyone (only your Colmena can: the change is signed by you).
const dayLabel = (iso) => {
  const d = new Date(iso), today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (new Date(Date.now() - 864e5).toDateString() === d.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
};

const NOTHING = []; // nothing waits for an OK in a chat between people

export default function PeopleChat({ params = {}, query = {} }) {
  const id = params.id;
  const { peers, bots: myBots = [], artifacts = [], rooms = [] } = useStore();
  const [viewing, setViewing] = useState(null); // a shared file open in the viewer
  const [sending, setSending] = useState([]); // names of files being sealed and sent
  const closeViewer = useCallback(() => setViewing(null), []);
  const [room, setRoom] = useState(false); // «Personas» of a group: roles, invite, rename
  const closeRoom = useCallback(() => setRoom(false), []);
  useToasts(); // a message being deleted hides until its «Deshacer» runs out
  const chat = useShareChat(id);
  const [error, setError] = useState(null);
  const [searching, setSearching] = useState(false);
  const threadId = query.hilo || null;
  useEffect(() => { setError(null); setSearching(false); }, [id]);
  const share = chat.share;
  // A group is a room: the same address, on the room screen (it accepts the conversation's id).
  const isRoom = !String(id).startsWith("dm-") && (rooms.some((r) => r.id === id || r.shareId === id) || (!!share && share.kind !== "dm"));
  useEffect(() => {
    if (!isRoom) return;
    const qs = [query.hilo ? "hilo=" + encodeURIComponent(query.hilo) : null, query.m ? "m=" + encodeURIComponent(query.m) : null].filter(Boolean).join("&");
    navigate("/sala/" + encodeURIComponent(id) + (qs ? "?" + qs : ""), { replace: true });
  }, [isRoom, id]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // /con/x?m=<id> (a search hit, a notice) opens the conversation at that message.
  useRevealMessage(threadId ? null : query.m || null, { ready: !chat.loading && !!share, olderCount: chat.more ? chat.messages.length : 0, showOlder: chat.older });
  const openThread = useCallback((m) => navigate("/con/" + id + "?hilo=" + encodeURIComponent(m.id)), [id]);
  const closeThread = useCallback(() => navigate("/con/" + id, { replace: true }), [id]);
  // What arrives while you are here, said once to a screen reader (lib/useAnnouncer.js): the
  // other person's messages and what bots answer, never what you wrote.
  const spokenRows = useMemo(() => chat.messages.map((m) => {
    const a = authorOf(m);
    return { id: m.id, name: authorView(a).name, text: m.deleted ? "" : m.text || (m.file ? "ha compartido " + (m.file.name || "un archivo") : ""), skip: !!m.local || !!m.deleted || a.kind === "system" || (a.kind === "person" && a.you) };
  }), [chat.messages]);
  const said = useAnnouncer({ scope: id, ready: !chat.loading && !!share, items: spokenRows, waiting: NOTHING });
  if (isRoom) return null;
  if (chat.error === "missing") return <NotFound active="chats" title="Esta conversación ya no está" text="Puede que la otra persona la cerrara. No se ha perdido nada de lo tuyo." />;
  const dm = share?.kind === "dm";
  const other = dm ? others[0] : null;
  const gone = !!(share?.left || share?.removed);
  const status = !share ? "" : dm
    ? (other?.status === "pending" ? "Esperando a que acepte en su Colmena" : other?.away ? statusText(other.away) : other?.online ? "En línea" : "No está conectada ahora")
    : `${others.length + 1} personas`;
  // What you shared here (newest first), for «Compartido» on the right.
  const sharedFiles = chat.messages.filter((m) => m.file && !m.deleted).map((m) => ({ ...m.file, id: m.file.id || m.id })).reverse().slice(0, 6);
  const leave = async () => {
    try { await post(`/peers/shares/${encodeURIComponent(id)}/leave`); navigate("/chats"); } catch (e) { setError(e.message); }
  };
  // «Borrar para todos» waits for its «Deshacer» before anything leaves this computer.
  const remove = (m) => later({
    id: "peermsg:" + m.id, keys: ["peermsg:" + m.id], text: "Mensaje borrado para todos", error: "No se pudo borrar",
    run: async () => { await unsendMessage(m.id); await chat.load(); },
  });
  // Files: each one sealed here and sent; the message shows it as soon as it is out.
  const attach = async (files) => {
    for (const file of files) {
      setSending((list) => [...list, file.name]);
      try { await post(`/peers/shares/${encodeURIComponent(id)}/files`, { name: file.name, content: await fileBase64(file) }); await chat.load(); }
      catch (e) { setError(file.name + ": " + e.message); }
      finally { setSending((list) => list.filter((n) => n !== file.name)); }
    }
  };
  const shareArtifact = async (artifact) => {
    const a = artifacts.find((x) => x.id === artifact);
    setSending((list) => [...list, a?.title || "Entregable"]);
    try { await post(`/peers/shares/${encodeURIComponent(id)}/files/artifact`, { artifact }); await chat.load(); }
    catch (e) { setError(e.message); }
    finally { setSending((list) => list.filter((n) => n !== (a?.title || "Entregable"))); }
  };
  // My last message that someone saw: «Visto por …» goes only there.
  const lastSeenMine = [...chat.messages].reverse().find((m) => m.from === "me" && m.seenBy?.length)?.id;
  const shown = chat.messages.filter((m) => !isHidden("peermsg:" + m.id));
  // A guest of the group writes and reads; their messages wake no bot, so no bots to name.
  const guest = share?.members?.find((m) => m.me)?.role === "guest";
  const composer = { others, mentionable: guest ? [] : mentionable, mineEnabled: guest ? [] : mineEnabled, me, disabled: gone || !share, onTyping: chat.typingNow };
  let lastDay = null;
  const outline = { height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: "transparent", color: "#12131A", fontSize: "13.5px", fontWeight: 500, cursor: "pointer" };
  return (
    <Shell active="chats" scroll={false}>
      <div style={{ position: "relative", display: "flex", height: "100%", alignItems: "stretch" }}>
        <section aria-label={share ? "Conversación con " + share.title : "Conversación"} style={{ flex: "999 1 520px", minWidth: "0", height: "100%", display: "flex", flexDirection: "column" }}>
          <header style={{ position: "relative", zIndex: 5, flex: "none", background: "rgba(245,245,242,.92)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "14px 26px" }}>
              {dm && other ? <PeerAvatar person={other} size={34} dot={other.status === "active"} dashed={other.status === "pending"} /> : share ? <PeoplePile people={share.members} /> : null}
              <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", marginRight: "auto" }}>
                <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 600, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{share ? (dm ? share.title : "# " + share.title) : " "}</h1>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "13px", color: "#5C606C" }}>
                  {status}
                  {share ? <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><Lock size={12} strokeWidth={2.2} aria-hidden="true" />{dm ? "solo lo leéis vosotros dos, cifrado" : "solo lo leéis quienes estáis aquí, cifrado"}</span> : null}
                </span>
              </div>
              {share ? <button type="button" aria-label="Buscar en esta conversación" title="Buscar en esta conversación" aria-expanded={searching ? "true" : "false"} onClick={() => setSearching((s) => !s)} style={{ ...outline, width: "36px", padding: 0, justifyContent: "center", background: searching ? "#12131A" : "transparent", color: searching ? "#FFFFFF" : "#12131A" }}><Search size={16} strokeWidth={2.2} aria-hidden="true" /></button> : null}
              {!dm && share ? <button type="button" onClick={() => setRoom(true)} aria-label={"Personas de " + share.title} title={names(others.map((o) => o.name))} style={outline}>{share.mine ? "Personas" : "de " + (share.members.find((m) => m.id === share.owner)?.name.split(" ")[0] || "")}</button> : null}
              {!dm && share && !gone ? <button type="button" onClick={leave} title={share.mine ? "La cierras para todos" : "Dejas de recibir sus mensajes"} style={outline}><LogOut size={15} strokeWidth={2.2} aria-hidden="true" />{share.mine ? "Cerrar para todos" : "Salir"}</button> : null}
            </div>
            {searching && share ? <ShareSearch shareId={id} onClose={() => setSearching(false)} /> : null}
          </header>
          {relay !== "online" && share ? (
            <p role="status" style={{ flex: "none", margin: 0, padding: "10px 26px", background: "#FFF6DC", color: "#8A5A00", fontSize: "14px" }}>
              {relay === "off" ? "Falta conectar Colmena al buzón de mensajes: Ajustes › Personas." : RELAY_LABEL[relay] + ". Lo que escribas saldrá en cuanto vuelva."}
            </p>
          ) : null}
          <Announcer text={said} />
          <div {...messageListProps("Mensajes de la conversación")} style={{ flex: "1", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", display: "flex", flexDirection: "column-reverse" }}>
            <div style={{ width: "100%", maxWidth: "840px", margin: "0 auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: "8px", boxSizing: "border-box" }}>
              {chat.more ? <button type="button" onClick={chat.older} style={{ alignSelf: "center", height: "32px", padding: "0 14px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}>{"Ver mensajes anteriores"}</button> : null}
              {!chat.loading && !chat.messages.length ? (
                <div style={{ alignSelf: "center", maxWidth: "520px", margin: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", textAlign: "center", animation: "fade .4s ease-out" }}>
                  {share ? <PeoplePile people={share.members} size={56} /> : null}
                  <strong style={{ font: "600 22px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{dm && other?.status === "pending" ? "Invitación aceptada" : "Aún no os habéis escrito"}</strong>
                  <span style={{ fontSize: "15px", lineHeight: 1.55, color: "#4A4D57" }}>{dm && other?.status === "pending" ? `En cuanto ${other.name.split(" ")[0]} abra Colmena quedaréis conectados. Lo que escribas ahora le llegará entonces.` : "Cada mensaje sale cerrado con llave desde este ordenador y solo lo abren los de quienes estáis aquí."}</span>
                </div>
              ) : null}
              {shown.map((m, i) => {
                const day = dayLabel(m.at);
                const showDay = day !== lastDay;
                lastDay = day;
                return (
                  <div key={m.id}>
                    {showDay ? <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "4px 0 10px", fontSize: "12.5px", color: "#5C606C" }}><span style={{ flex: 1, height: "1px", background: "rgba(18,19,26,.08)" }} />{day}<span style={{ flex: 1, height: "1px", background: "rgba(18,19,26,.08)" }} /></div> : null}
                    <PeopleMessage m={m} dm={dm} botOf={botOf} shared={shared} lastSeen={m.id === lastSeenMine} onMeeting={chat.updateMeeting} continued={!showDay && continues(shown[i - 1], m, { hasReplies: !!shown[i - 1]?.replies })}
                      onReact={chat.react} onRetry={chat.retry} onEdit={chat.edit} onDelete={remove} onThread={m.local ? null : openThread} onOpenFile={setViewing} onError={setError} />
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ flex: "none", width: "100%", maxWidth: "840px", margin: "0 auto", padding: "0 26px 18px", boxSizing: "border-box" }}>
            <p style={{ margin: "0 0 8px 18px", minHeight: "18px", display: "flex", gap: "16px", fontSize: "13px", color: "#5C606C" }}>
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
              {sending.length ? <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span aria-hidden="true" style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#1F4FD1", animation: "breathe 1.4s ease-in-out infinite" }} />{"Cifrando y enviando " + names(sending) + "…"}</span> : null}
              {error ? <span role="alert" style={{ color: "#B4232A" }}>{error}</span> : null}
            </p>
            <PeopleComposer {...composer} resetKey={id} onError={setError} onAttach={gone ? null : attach} artifacts={artifacts} onArtifact={shareArtifact}
              onSend={(text, bots, people) => { setError(null); return chat.send(text, bots, people); }}
              placeholder={gone ? "Ya no estás en esta conversación" : (dm ? `Mensaje para ${other?.name.split(" ")[0] || ""}` : "Mensaje para todos") + " · @ para que uno de tus bots ayude aquí"}
              above={dm && other?.away && !gone ? (
                <p role="note" style={{ margin: "0 0 10px 18px", fontSize: "13px", color: "#5C606C" }}>
                  {other.away.mode === "dnd"
                    ? `${other.name.split(" ")[0]} tiene «No molestar»${other.away.until ? " hasta " + whenText(other.away.until) : ""}: le llegará, sin sonarle.`
                    : `${other.name.split(" ")[0]} está fuera${other.away.until ? " hasta " + whenText(other.away.until) : ""}: lo verá a la vuelta.`}
                </p>
              ) : null} />
            {share && !gone && !guest ? <p style={{ margin: "8px 0 0", fontSize: "12.5px", color: "#5C606C" }}>{"Tus bots aquí no ven tu correo ni tu memoria: solo lo que escribís en este chat."}</p> : null}
          </div>
        </section>
        {share && !threadId ? <PeopleAside share={share} other={other} dm={dm} files={sharedFiles} onPeople={() => setRoom(true)} onOpenFile={setViewing} /> : null}
        {viewing ? <FileViewer file={viewing} onClose={closeViewer} /> : null}
        {room && share && !dm ? <RoomSheet share={share} onClose={closeRoom} onChanged={chat.load} /> : null}
        {threadId && share ? <ThreadPanel key={threadId} shareId={id} rootId={threadId} dm={dm} botOf={botOf} shared={shared} composer={composer} revealId={query.m || null} onClose={closeThread} onDelete={remove} onError={setError} /> : null}
      </div>
    </Shell>
  );
}

const ENCARGOS = [["pregunta", "Preguntarme siempre"], ["siempre", "Sí, sin preguntar"], ["nunca", "Nunca"]];
const since = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : null);

/** On the right (V3Personas): who it is, your safety words, what their bots may ask yours, what you shared. */
function PeopleAside({ share, other, dm, files, onPeople, onOpenFile }) {
  const { peers } = useStore();
  const { act, busy } = useAction();
  const contact = dm && other ? (peers?.contacts || []).find((c) => c.id === other.id) || null : null;
  const asks = contact?.asks || {};
  const setAsk = (key, value) => act(() => patch(`/peers/contacts/${encodeURIComponent(contact.id)}`, { asks: { [key]: value } }));
  const head = { fontSize: "13px", fontWeight: 600, color: "#5C606C" };
  const freeOn = asks.libre && asks.libre !== "nunca";
  return (
    <aside aria-label={dm && other ? "Sobre " + other.name : "Personas de la conversación"} style={{ flex: "1 1 300px", maxWidth: "360px", minWidth: "280px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "18px", padding: "22px 20px", background: "#FFFFFF", borderLeft: "1px solid rgba(18,19,26,.07)" }}>
      {dm && other ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
          <PeerAvatar person={other} size={64} ring="#FFFFFF" />
          <span style={{ font: "600 20px/1 'Bricolage Grotesque', sans-serif" }}>{other.name}</span>
          <span style={{ fontSize: "13.5px", color: "#5C606C" }}>{[other.online ? "En línea" : "No está conectada ahora", contact?.addedAt ? "conectada desde el " + since(contact.addedAt) : null].filter(Boolean).join(" · ")}</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={head}>{`Personas · ${(share.members || []).length}`}</span>
          {(share.members || []).map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "36px" }}>
              <PeerAvatar person={p} size={26} ring="#FFFFFF" dot={!p.me} />
              <span style={{ flex: "1", fontSize: "14px" }}>{p.me ? "Tú" : p.name}</span>
              <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{p.id === share.owner ? "creó la conversación" : p.role === "guest" ? "invitado" : p.online ? "aquí ahora" : ""}</span>
            </div>
          ))}
          {share.mine ? <button type="button" onClick={onPeople} style={{ alignSelf: "flex-start", marginTop: "4px", height: "34px", padding: "0 12px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "999px", background: "#FFFFFF", fontSize: "13px", cursor: "pointer" }}>{"Invitar o cambiar"}</button> : null}
        </div>
      )}
      {contact?.words?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "14px 16px", borderRadius: "14px", background: "#F6F6F3" }}>
          <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Palabras de seguridad"}</span>
          <span style={{ font: "500 14px/1.4 'Geist Mono', monospace" }}>{contact.words.join(" · ")}</span>
          <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{contact.verifiedAt ? `Comprobadas: ${other.name.split(" ")[0]} ve las mismas.` : `Iguales en su Colmena: es ${other.name.split(" ")[0]}.`}</span>
        </div>
      ) : null}
      {contact ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={head}>{"Qué pueden pedirte sus bots"}</span>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
            {"Encargos a tus bots"}
            <Select label="Encargos a tus bots" value={asks.encargos || "pregunta"} disabled={busy} onChange={(e) => setAsk("encargos", e.target.value)} style={{ width: "100%", height: "38px", padding: "0 10px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "10px", background: "#FFFFFF", fontSize: "13.5px" }} options={ENCARGOS} />
          </label>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", minHeight: "40px", fontSize: "14px" }}>
            <span>{"Ver si estoy libre u ocupado"}</span>
            <button type="button" role="switch" aria-checked={freeOn ? "true" : "false"} aria-label="Ver si estoy libre u ocupado" disabled={busy} onClick={() => setAsk("libre", freeOn ? "nunca" : "pregunta")} style={{ flex: "none", position: "relative", width: "40px", height: "24px", padding: 0, border: 0, borderRadius: "12px", background: freeOn ? "#12131A" : "#C9CBD1", cursor: "pointer", transition: "background .15s ease" }}>
              <span aria-hidden="true" style={{ position: "absolute", top: "3px", left: freeOn ? "19px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.3)", transition: "left .15s ease" }} />
            </button>
          </div>
        </div>
      ) : null}
      {files.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={head}>{"Compartido"}</span>
          {files.map((f) => {
            const ext = extOf(f.name);
            const [bg, fg] = extTint(ext);
            return (
              <button key={f.id || f.name} type="button" onClick={() => onOpenFile(f)} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "14px", color: "#12131A" }}>
                <span aria-hidden="true" style={{ flex: "none", width: "26px", height: "26px", display: "grid", placeItems: "center", borderRadius: "7px", background: bg, color: fg, fontSize: "8px", fontWeight: 700 }}>{ext}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <span style={{ flex: "1" }} />
      <a href="/equipo" style={{ fontSize: "13.5px" }}>{"Todas tus personas en Equipo"}</a>
    </aside>
  );
}
