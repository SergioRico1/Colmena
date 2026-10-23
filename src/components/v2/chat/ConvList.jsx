import { useEffect, useMemo, useState } from "react";
import { Ticket, UserPlus } from "lucide-react";
import { useStore } from "../../../lib/store.jsx";
import { navigate } from "../../../lib/router.jsx";
import { needsYou } from "../../../lib/format.js";
import { BotPresence, gloss, shapeOf } from "../Presence.jsx";
import { listRows } from "../../../lib/threads.js";
import { post } from "../../../lib/api.js";
import { shareUrl } from "../../../lib/peers.js";
import { PeerAvatar, ShareFace } from "../people/PeerAvatar.jsx";
import { AcceptSheet, InviteSheet } from "../people/InviteSheets.jsx";

// «Chats» column of Colmena 2.0 (the boards call the place «Conversaciones»; the rail fits one line) (design/V2Conversacion.dc.html): rooms (#) and chats
// with each bot in one list, newest first; the current one as a white piece; a honey dot when
// one needs you. «Nueva» opens the sheet to start a chat (one bot) or a room (several).
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export function whenLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (new Date(Date.now() - 864e5).toDateString() === d.toDateString()) return "ayer";
  if (now - d < 6 * 864e5) return d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
}
// A bot's thread lives at /chat/<bot>; a private or an older chat keeps its own address.
export const chatUrl = (m) => (m.thread && !m.incognito ? `/chat/${m.botIds?.[0] || "atlas"}` : `/chat/${m.botIds?.[0] || "atlas"}?c=${m.id}`);
export const salaUrl = (m) => `/sala/${m.id}`;

export default function ConvList({ current = null }) {
  const { missions, bots, notifications = [], peers = null } = useStore();
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(false);
  const [peerSheet, setPeerSheet] = useState(null); // "invitar" | "aceptar"
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); setSheet(true); } };
    const onOpen = () => setSheet(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("colmena:new-conversation", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("colmena:new-conversation", onOpen); };
  }, []);
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  // One row per bot (its single chat, threads.js) and rooms; a private chat only while open.
  // …and the conversations with people (server/peers/), in the same list by time.
  const rows = useMemo(() => {
    const chats = listRows(missions, current).slice(0, 60).map((m) => ({ ...m, at: m.rowAt || m.updatedAt || m.createdAt }));
    const shares = (peers?.shares || []).filter((s) => !s.removed && (!s.left || s.id === current)).map((s) => ({ id: s.id, share: s, at: s.lastAt }));
    return shares.length ? [...chats, ...shares].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))) : chats;
  }, [missions, current, peers]);
  const shown = rows.filter((m) => {
    if (!q.trim()) return true;
    if (m.share) return fold([m.share.title, ...m.share.members.map((p) => p.name)].join(" ")).includes(fold(q.trim()));
    const b = botOf(m.botIds?.[0]);
    return fold([m.room, m.title, m.prompt, m.conversation ? b?.name : ""].join(" ")).includes(fold(q.trim()));
  });
  return (
    <aside data-convlist="" aria-label="Chats" style={{ flex: "none", width: "320px", height: "100%", overflowY: "auto", overscrollBehavior: "contain", padding: "28px 14px 28px 20px", display: "flex", flexDirection: "column", gap: "14px", borderRight: "1px solid rgba(18,19,26,.07)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px" }}>
        <h2 style={{ margin: "0", font: "600 22px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Chats"}</h2>
        <button type="button" onClick={() => setSheet(true)} title="Nuevo chat o sala (Ctrl+N)" style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px 0 11px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {"Nueva"}
        </button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", margin: "0 4px", padding: "0 12px", background: "rgba(18,19,26,.045)", borderRadius: "12px", color: "#5C606C" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Buscar chats y salas"}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" style={{ flex: "1", minWidth: "0", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {shown.length === 0 ? <p style={{ margin: "8px 10px", fontSize: "14px", color: "#6B6F7A" }}>{q.trim() ? "Ningún chat ni sala coincide." : "Aún no hay chats. Pulsa «Nueva» para empezar."}</p> : null}
        {shown.map((m) => {
          const on = m.id === current;
          if (m.share) return <ShareRow key={m.id} share={m.share} on={on} />;
          const bot = m.conversation ? botOf(m.botIds?.[0]) : null;
          const unread = notifications.some((n) => !n.read && n.missionId === m.id);
          const attention = needsYou(m);
          const title = m.conversation ? bot?.name || "Bot" : (m.room || m.title);
          const line = m.narration?.text || (m.conversation ? (m.incognito ? "De incógnito · " : "") + (m.lastLine || m.title) : m.activityLine || m.title);
          return (
            <a key={m.id} href={m.conversation ? chatUrl(m) : salaUrl(m)} aria-current={on ? "page" : undefined}
              style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px", borderRadius: "16px", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.05), 0 8px 20px -10px rgba(18,19,26,.18)" : "none" }}>
              {bot ? (
                <span style={{ width: "38px", height: "38px", flex: "none", display: "grid", placeItems: "center" }}><BotPresence bot={bot} size={28} state={m.status === "running" ? "work" : attention ? "wait" : "rest"} /></span>
              ) : (
                <span aria-hidden="true" style={{ width: "38px", height: "38px", flex: "none", display: "grid", placeItems: "center", borderRadius: "12px", background: "#E9E9E4", font: "600 16px/1 'Geist', sans-serif", color: "#3D404A" }}>{"#"}</span>
              )}
              <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <strong style={{ flex: "1", minWidth: "0", fontSize: "14px", fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</strong>
                  <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{whenLabel(m.rowAt || m.updatedAt || m.createdAt)}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ flex: "1", minWidth: "0", fontSize: "13px", color: "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line}</span>
                  {attention || (unread && !on) ? <span aria-label={attention ? "Te necesita" : "Mensajes nuevos"} style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: attention ? "#FFC93C" : "#12131A", boxShadow: attention ? "0 0 0 3px rgba(255,201,60,.25)" : "none" }} /> : null}
                </span>
              </span>
            </a>
          );
        })}
      </div>
      {sheet ? <NewConversation onClose={() => setSheet(false)} onPeople={(which) => { setSheet(false); setPeerSheet(which); }} /> : null}
      {peerSheet === "invitar" ? <InviteSheet onClose={() => setPeerSheet(null)} /> : null}
      {peerSheet === "aceptar" ? <AcceptSheet onClose={() => setPeerSheet(null)} /> : null}
    </aside>
  );
}

/** A conversation with people: the person (or «#» with who wrote last and «+N»), its last line. */
function ShareRow({ share, on }) {
  const typing = share.typing?.length ? share.typing.map((n) => n.split(" ")[0]).join(", ") + (share.typing.length > 1 ? " escriben…" : " está escribiendo…") : null;
  const who = share.lastFrom ? (share.lastFrom === share.members.find((p) => p.me)?.name ? "Tú: " : share.kind === "group" ? share.lastFrom.split(" ")[0] + ": " : "") : "";
  const line = typing || (share.lastLine ? who + share.lastLine : share.kind === "dm" ? "Aún no os habéis escrito" : `${share.members.length} personas`);
  const unread = !on && share.unread > 0;
  return (
    <a href={shareUrl(share.id)} aria-current={on ? "page" : undefined}
      style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px", borderRadius: "16px", color: "#12131A", textDecoration: "none", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.05), 0 8px 20px -10px rgba(18,19,26,.18)" : "none" }}>
      <ShareFace share={share} ring={on ? "#FFFFFF" : "#F5F5F2"} />
      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <strong style={{ flex: "1", minWidth: "0", fontSize: "14px", fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{share.title}</strong>
          <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{whenLabel(share.lastAt)}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ flex: "1", minWidth: "0", fontSize: "13px", color: typing ? "#1E2029" : "#5C606C", fontWeight: unread ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line}</span>
          {unread ? <span aria-label={share.unread === 1 ? "Un mensaje nuevo" : share.unread + " mensajes nuevos"} style={{ minWidth: "18px", height: "18px", padding: "0 5px", flex: "none", borderRadius: "9px", background: "#12131A", color: "#FFFFFF", font: "600 10px/18px 'Geist', sans-serif", textAlign: "center", boxSizing: "border-box" }}>{share.unread > 9 ? "9+" : share.unread}</span> : null}
        </span>
      </span>
    </a>
  );
}

/** «Nuevo chat»: one bot → a private chat; two or more → a room with a name. */
export function NewConversation({ onClose, preset = [], onPeople = null }) {
  const { bots, peers = null } = useStore();
  const [sel, setSel] = useState(preset);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  // People (server/peers/): one → your direct conversation, two or more → a group.
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const team = bots.filter((b) => b.enabled !== false);
  const contacts = (peers?.contacts || []).filter((c) => c.status === "active");
  // Bots and people do not mix yet: choosing one kind clears the other.
  const pick = (id) => { setPeople([]); setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); };
  const pickPerson = (id) => { setSel([]); setPeople((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); };
  const chosen = sel.map((id) => team.find((b) => b.id === id)).filter(Boolean);
  const chosenPeople = people.map((id) => contacts.find((c) => c.id === id)).filter(Boolean);
  const withPeople = chosenPeople.length > 0;
  const isRoom = chosen.length >= 2 || chosenPeople.length >= 2;
  const first = (n) => fold(String(n).split(/\s+/)[0]);
  const auto = withPeople ? chosenPeople.slice(0, 2).map((c) => first(c.name)).join("-y-") : chosen.slice(0, 2).map((b) => fold(b.name)).join("-y-");
  const match = (text) => !q.trim() || fold(text).includes(fold(q.trim()));
  const items = team.filter((b) => match(b.name + " " + b.role));
  const peopleItems = contacts.filter((c) => match(c.name));
  const hint = withPeople
    ? (chosenPeople.length === 1 ? `Conversación con ${chosenPeople[0].name}. Solo la leéis vosotros dos.` : `Una conversación con ${chosenPeople.length} personas y tú. Solo la leéis quienes estéis en ella.`)
    : !chosen.length ? "Elige un bot o una persona. Si añades otro más, se convertirá en una sala."
      : chosen.length === 1 ? `Conversación privada con ${chosen[0].name}. Solo la veréis tú y ${chosen[0].name}.`
        : `Será una sala con ${chosen.length} bots${chosen.some((b) => b.id === "atlas") ? "" : " (Atlas coordina)"}. Escribe tu primer mensaje y empiezan.`;
  const go = async () => {
    if (withPeople) {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const share = chosenPeople.length === 1
          ? await post(`/peers/dm/${encodeURIComponent(chosenPeople[0].id)}`)
          : await post("/peers/shares", { title: (name || auto).slice(0, 60), members: chosenPeople.map((c) => c.id) });
        onClose();
        navigate(shareUrl(share.id));
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!chosen.length) return;
    onClose();
    if (chosen.length === 1) navigate(`/chat/${chosen[0].id}`);
    else navigate(`/sala/nueva?bots=${chosen.map((b) => b.id).join(",")}&nombre=${encodeURIComponent((name || auto).slice(0, 60))}`);
  };
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: "0", zIndex: "70", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "64px 20px 24px", background: "rgba(18,19,26,.28)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)", animation: "fade .2s ease-out" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="nc-t" style={{ width: "min(620px, 100%)", maxHeight: "100%", display: "flex", flexDirection: "column", background: "#FFFFFF", borderRadius: "32px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55), 0 2px 6px rgba(18,19,26,.06)", animation: "sheet .4s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "24px 24px 6px 28px" }}>
          <h2 id="nc-t" style={{ margin: "0", font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.035em" }}>{withPeople ? (isRoom ? "Nueva conversación" : "Nuevo chat") : isRoom ? "Nueva sala" : "Nuevo chat"}</h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.06)", cursor: "pointer" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div style={{ flex: "none", padding: "14px 28px 0", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", minHeight: "52px", padding: "6px 8px 6px 14px", borderRadius: "18px", background: "#F6F6F3" }}>
            <span style={{ fontSize: "14px", color: "#6B6F7A", marginRight: "4px" }}>{"Con"}</span>
            {chosen.map((b) => (
              <span key={b.id} style={{ display: "flex", alignItems: "center", gap: "7px", height: "36px", padding: "0 6px 0 8px", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", fontWeight: "600", animation: "pop .25s ease-out" }}>
                <span aria-hidden="true" style={{ width: "18px", height: "18px", background: gloss(b.color), clipPath: shapeOf(b).clip, borderRadius: shapeOf(b).radius }} />
                {b.name}
                <button type="button" aria-label={"Quitar a " + b.name} onClick={() => pick(b.id)} style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#5C606C" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </span>
            ))}
            {chosenPeople.map((c) => (
              <span key={c.id} style={{ display: "flex", alignItems: "center", gap: "7px", height: "36px", padding: "0 6px 0 5px", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", fontWeight: "600", animation: "pop .25s ease-out" }}>
                <PeerAvatar person={c} size={26} />
                {c.name}
                <button type="button" aria-label={"Quitar a " + c.name} onClick={() => pickPerson(c.id)} style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#5C606C" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </span>
            ))}
            <input autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={chosen.length ? "Añadir otro bot" : withPeople ? "Añadir otra persona" : "Escribe un nombre"} aria-label="Buscar bots y personas"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (q.trim() && !withPeople && items[0]) { pick(items[0].id); setQ(""); } else if (q.trim() && peopleItems[0]) { pickPerson(peopleItems[0].id); setQ(""); } else go(); } }}
              style={{ flex: "1 1 160px", minWidth: "0", height: "36px", border: "0", outline: "none", background: "transparent", fontSize: "15px" }} />
          </div>
          <span style={{ padding: "0 4px", fontSize: "13px", lineHeight: "1.45", color: "#5C606C" }}>{hint}</span>
          {isRoom ? (
            <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "50px", padding: "0 16px", borderRadius: "16px", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.12)", animation: "fade .3s ease-out" }}>
              <span aria-hidden="true" style={{ font: "600 17px/1 'Geist', sans-serif", color: "#8A8D96" }}>{"#"}</span>
              <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Nombre de la sala"}</span>
              <input type="text" value={name || auto} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))} style={{ flex: "1", minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: "16px", fontWeight: "600" }} />
            </label>
          ) : null}
        </div>
        <div style={{ flex: "1", minHeight: "0", overflowY: "auto", padding: "14px 18px 6px" }}>
          {peers?.me ? (
            <>
              <span style={{ display: "block", padding: "4px 10px 6px", fontSize: "12px", fontWeight: "500", color: "#6B6F7A" }}>{"Personas"}</span>
              {peopleItems.map((c) => {
                const on = people.includes(c.id);
                return (
                  <button key={c.id} type="button" role="checkbox" aria-checked={on ? "true" : "false"} onClick={() => { pickPerson(c.id); setQ(""); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "14px", minHeight: "58px", padding: "6px 10px", border: 0, borderRadius: "16px", background: on ? "rgba(18,19,26,.045)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                    <PeerAvatar person={c} size={32} dot ring="#FFFFFF" />
                    <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <strong style={{ fontSize: "15px", fontWeight: "600" }}>{c.name}</strong>
                      <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{c.online ? "Conectada" : "En su Colmena"}</span>
                    </span>
                    <span aria-hidden="true" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? "#12131A" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: on ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                    </span>
                  </button>
                );
              })}
              {onPeople && !q.trim() ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "6px 10px 14px" }}>
                  <button type="button" onClick={() => onPeople("invitar")} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}><UserPlus size={15} strokeWidth={2.2} aria-hidden="true" />{"Invitar a alguien"}</button>
                  <button type="button" onClick={() => onPeople("aceptar")} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}><Ticket size={15} strokeWidth={2.2} aria-hidden="true" />{"Tengo una invitación"}</button>
                </div>
              ) : null}
            </>
          ) : null}
          {withPeople ? null : <>
          <span style={{ display: "block", padding: "4px 10px 6px", fontSize: "12px", fontWeight: "500", color: "#6B6F7A" }}>{"Bots"}</span>
          {items.map((b) => {
            const on = sel.includes(b.id);
            return (
              <button key={b.id} type="button" role="checkbox" aria-checked={on ? "true" : "false"} onClick={() => { pick(b.id); setQ(""); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "14px", minHeight: "58px", padding: "6px 10px", border: 0, borderRadius: "16px", background: on ? "rgba(18,19,26,.045)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                <BotPresence bot={b} size={30} state="rest" />
                <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong style={{ fontSize: "15px", fontWeight: "600" }}>{b.name}</strong>
                  <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{b.role}</span>
                </span>
                <span aria-hidden="true" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? "#12131A" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: on ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                </span>
              </button>
            );
          })}
          {items.length === 0 && !(q.trim() && peopleItems.length) ? <p style={{ margin: "10px", fontSize: "14px", color: "#6B6F7A" }}>{"No hay ningún bot con ese nombre."}</p> : null}
          </>}
        </div>
        {error ? <p role="alert" style={{ margin: "0 28px 8px", fontSize: "14px", color: "#B4231A" }}>{error}</p> : null}
        <div style={{ flex: "none", display: "flex", justifyContent: "flex-end", gap: "10px", padding: "14px 24px 22px", borderTop: "1px solid rgba(18,19,26,.07)" }}>
          <button type="button" onClick={onClose} style={{ height: "50px", padding: "0 20px", border: "0", borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{"Cancelar"}</button>
          <button type="button" disabled={!(chosen.length || withPeople) || busy} onClick={go} style={{ height: "50px", padding: "0 26px", border: "0", borderRadius: "999px", background: chosen.length || withPeople ? "#12131A" : "#C9CBD1", color: "#FFFFFF", cursor: chosen.length || withPeople ? "pointer" : "default", fontSize: "15px", fontWeight: "600" }}>
            {withPeople ? (isRoom ? "Crear conversación" : `Hablar con ${chosenPeople[0].name.split(" ")[0]}`) : isRoom ? "Crear sala" : chosen.length ? `Hablar con ${chosen[0].name}` : "Empezar"}
          </button>
        </div>
      </div>
    </div>
  );
}
