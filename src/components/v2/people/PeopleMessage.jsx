import { useState } from "react";
import { MessageSquare, Pencil, RotateCw, SmilePlus, Trash2 } from "lucide-react";
import { PeerAvatar, PeoplePile } from "./PeerAvatar.jsx";
import { BotPresence } from "../Presence.jsx";
import MeetingCard from "./MeetingCard.jsx";
import { FileCard } from "./PeerFiles.jsx";
import ErrandCard from "./ErrandCard.jsx";
import { mentionSegments } from "../../../lib/mentions.js";

// One message of a conversation with people (design/V2Personas.dc.html, pasos sala and hilo):
// plain text (never HTML or Markdown: it comes from someone else), «@» pills for bots and
// people, reactions, its thread, and for your own messages «Editar» and «Borrar».
export const QUICK = ["👍", "❤️", "😂", "🎉"];
const MORE = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "😮", "😢", "🔥"];
export const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
export const names = (list) => (list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list.at(-1));
const tool = { width: "34px", height: "34px", display: "grid", placeItems: "center", border: 0, borderRadius: "10px", background: "transparent", cursor: "pointer", color: "#3D404A" };
const when = (iso) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? "hoy a las " + hhmm(iso) : d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " a las " + hhmm(iso);
};

/** A bot named in a message or about to be: its shape, its name and whose it is. */
export function MentionPill({ bot, label, title }) {
  return (
    <span title={title || undefined} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "1px 8px 1px 5px", borderRadius: "999px", background: `${bot.color || "#8C8F99"}24`, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "baseline" }}>
      <BotPresence bot={bot} size={12} state="rest" />
      {bot.name}
      {label ? <span style={{ fontWeight: 500, color: "#5C606C" }}>{"· " + label}</span> : null}
    </span>
  );
}
/** A person named with «@»: their face and the name as written; you, in yellow. */
export function PersonPill({ person, text }) {
  return (
    <span title={person.name} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "1px 8px 1px 3px", borderRadius: "999px", background: person.me ? "#FFE7A3" : "rgba(31,79,209,.09)", color: person.me ? "#5A4300" : "#1F3FA6", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "baseline" }}>
      <PeerAvatar person={person.me ? { me: true } : person} size={15} />
      {text.replace(/^@/, "")}
    </span>
  );
}

/** «@Vera» and «@Marta» of a message, each with whose it is (bots) or who it is (people). */
export function messageParts(m, botOf) {
  const named = (m.mentions || []).map((x) => botOf(x.owner, x.bot)).filter(Boolean).map((b) => ({ kind: "bot", ...b }));
  // People are written with their full name or their first name: the longest one wins.
  for (const p of m.people || []) named.push({ kind: "person", person: p, name: p.name }, { kind: "person", person: p, name: p.name.split(" ")[0] });
  return mentionSegments(m.text, named);
}

export default function PeopleMessage({ m, dm, botOf, shared, lastSeen, inThread = false, onMeeting = null, onOpenFile = null, onReact, onRetry, onThread, onEdit, onDelete, onError }) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const mine = m.from === "me";
  const named = (m.people || []).some((p) => p.me);
  const react = (e) => onReact(m.id, e).catch((x) => onError(x.message));
  const save = async () => {
    const value = editing.trim();
    if (!value || value === m.text) { setEditing(null); return; }
    setSaving(true);
    try { await onEdit(m.id, value); setEditing(null); } catch (x) { onError(x.message); } finally { setSaving(false); }
  };
  // An errand for one of your bots: only its card (it is for you, not a message to anyone).
  if (m.errand) return <div data-message-id={m.id} style={{ display: "flex", padding: "10px 0 10px 54px" }}><ErrandCard errand={m.errand} /></div>;
  return (
    <div className="msg" data-message-id={m.id} style={{ position: "relative", display: "grid", gridTemplateColumns: inThread ? "32px 1fr" : "40px 1fr", gap: inThread ? "12px" : "14px", padding: named ? "10px 12px" : "10px 0", margin: named ? "0 -12px" : 0, borderRadius: "18px", background: named ? "rgba(255,201,60,.13)" : "transparent" }}>
      {m.deleted || editing !== null ? null : (
        <div className="msg-tools" role="toolbar" aria-label="Acciones del mensaje" style={{ position: "absolute", top: "-16px", right: "12px", zIndex: 6, display: "flex", alignItems: "center", gap: "2px", padding: "4px", background: "#FFFFFF", borderRadius: "14px", boxShadow: "0 1px 2px rgba(18,19,26,.08), 0 12px 28px -12px rgba(18,19,26,.35)" }}>
          {QUICK.map((e) => <button key={e} type="button" aria-label={"Reaccionar " + e} onClick={() => react(e)} style={{ ...tool, fontSize: "18px", lineHeight: 1 }}>{e}</button>)}
          <button type="button" aria-label="Otra reacción" title="Otra reacción" onClick={() => setPicker((p) => !p)} style={tool}><SmilePlus size={18} strokeWidth={1.9} aria-hidden="true" /></button>
          {onThread || (mine && m.card?.kind !== "meeting") ? <span aria-hidden="true" style={{ width: "1px", height: "20px", margin: "0 3px", background: "rgba(18,19,26,.1)" }} /> : null}
          {onThread ? <button type="button" aria-label="Responder en un hilo" title="Responder en un hilo" onClick={() => onThread(m)} style={tool}><MessageSquare size={17} strokeWidth={1.9} aria-hidden="true" /></button> : null}
          {mine && !m.bot && !m.card && !m.local ? <button type="button" aria-label="Editar" title="Editar" onClick={() => setEditing(m.text)} style={tool}><Pencil size={16} strokeWidth={1.9} aria-hidden="true" /></button> : null}
          {mine && m.card?.kind !== "meeting" ? <button type="button" aria-label="Borrar para todos" title="Borrar para todos" onClick={() => onDelete(m)} style={{ ...tool, color: "#B4231A" }}><Trash2 size={16} strokeWidth={1.9} aria-hidden="true" /></button> : null}
        </div>
      )}
      {m.bot ? (
        // A bot of the author (on its owner's computer), with the owner's face beside it.
        <span aria-hidden="true" style={{ position: "relative", width: inThread ? "32px" : "40px", height: inThread ? "32px" : "40px", display: "grid", placeItems: "center" }}>
          <BotPresence bot={m.bot} size={inThread ? 26 : 32} state="rest" />
          <span style={{ position: "absolute", right: "-3px", bottom: "-3px" }}><PeerAvatar person={mine ? { me: true } : { initials: m.author.initials, color: m.author.color }} size={16} /></span>
        </span>
      ) : <PeerAvatar person={mine ? { me: true } : { initials: m.author.initials, color: m.author.color }} size={inThread ? 32 : 40} />}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
        <span style={{ fontSize: "14px" }}>
          <strong style={{ fontWeight: 600 }}>{m.bot ? m.bot.name : mine ? "Tú" : m.author.name}</strong>{" "}
          <span style={{ color: "#6B6F7A" }}>{(m.bot ? (mine ? "· tu bot" : "· bot de " + m.author.name.split(" ")[0]) + (m.local ? " · solo lo ves tú" : "") + " " : "") + "· " + hhmm(m.at)}</span>
          {m.edited && !m.deleted ? <span title={"Editado " + when(m.edited)} style={{ color: "#8C8F99" }}>{" · editado"}</span> : null}
        </span>
        {m.deleted ? (
          <p style={{ margin: 0, fontSize: "15px", fontStyle: "italic", color: "#8C8F99" }}>{mine ? "Borraste este mensaje" : "Mensaje borrado"}</p>
        ) : editing !== null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", animation: "fade .15s ease-out" }}>
            <textarea autoFocus value={editing} maxLength={8000} disabled={saving} aria-label="Editar el mensaje"
              onChange={(e) => { setEditing(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px"; }}
              onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n); e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px"; }}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); } if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }}
              style={{ width: "100%", minHeight: "46px", maxHeight: "240px", padding: "11px 14px", border: 0, borderRadius: "16px", outline: "none", resize: "none", background: "#FFFFFF", boxShadow: "inset 0 0 0 1.5px rgba(31,79,209,.35), 0 8px 24px -16px rgba(18,19,26,.3)", font: "inherit", fontSize: "16px", lineHeight: 1.5, boxSizing: "border-box" }} />
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "13px", color: "#6B6F7A" }}>
              <button type="button" onClick={save} disabled={saving} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{"Guardar"}</button>
              <button type="button" onClick={() => setEditing(null)} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{"Cancelar"}</button>
              {"Intro guarda · Esc cancela · lo verán todos como «editado»"}
            </span>
          </div>
        ) : (m.file && m.text === m.file.name) || m.errand ? null : (
          <p style={{ margin: 0, fontSize: inThread ? "15px" : "16px", lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }}>
            {messageParts(m, botOf).map((s, i) => (!s.mention ? <span key={i}>{s.text}</span>
              : s.mention.kind === "person" ? <PersonPill key={i} person={s.mention.person} text={s.text} />
                : <MentionPill key={i} bot={s.mention} label={shared(s.mention.name) || !s.mention.mine ? s.mention.note : null} />))}
          </p>
        )}
        {m.file && !m.deleted ? <FileCard file={m.file} onOpen={(f) => onOpenFile?.(f)} /> : null}
        {m.card?.kind === "meeting" && !m.deleted ? <MeetingCard meeting={m.meeting} onChange={onMeeting || (() => {})} /> : null}
        {picker ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "6px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35)", alignSelf: "flex-start", animation: "rise .2s ease-out" }}>
            {MORE.map((e) => <button key={e} type="button" aria-label={"Reaccionar " + e} onClick={() => { setPicker(false); react(e); }} style={{ width: "36px", height: "36px", border: 0, borderRadius: "10px", background: "transparent", cursor: "pointer", fontSize: "19px" }}>{e}</button>)}
          </div>
        ) : null}
        {m.reactions?.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {m.reactions.map((r) => (
              <button key={r.emoji} type="button" aria-pressed={r.mine ? "true" : "false"} title={names(r.who)} onClick={() => react(r.emoji)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px 0 8px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, background: r.mine ? "rgba(31,79,209,.1)" : "rgba(18,19,26,.05)", boxShadow: r.mine ? "inset 0 0 0 1.5px rgba(31,79,209,.35)" : "none", animation: "pop .3s ease-out" }}>
                <span style={{ fontSize: "16px", lineHeight: 1 }}>{r.emoji}</span>{r.count}
              </button>
            ))}
          </div>
        ) : null}
        {m.replies && onThread ? (
          <button type="button" onClick={() => onThread(m)} aria-label={`Abrir el hilo: ${m.replies.count} respuestas`} style={{ alignSelf: "flex-start", maxWidth: "100%", display: "flex", alignItems: "center", gap: "10px", height: "36px", padding: "0 14px 0 6px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.04)", cursor: "pointer", fontSize: "13px", color: "#5C606C", whiteSpace: "nowrap", overflow: "hidden" }}>
            <PeoplePile people={m.replies.people.map((p) => (p.me ? { ...p, me: true } : p))} size={24} max={3} />
            <strong style={{ fontWeight: 600, color: "#1F4FD1" }}>{m.replies.count === 1 ? "1 respuesta" : m.replies.count + " respuestas"}</strong>
            {"· la última " + when(m.replies.lastAt)}
          </button>
        ) : null}
        {mine && m.status === "sending" ? <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{"Enviando…"}</span> : null}
        {mine && m.status === "failed" ? <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#B4231A" }}>{"No se envió."}<button type="button" onClick={() => onRetry(m.id).catch((x) => onError(x.message))} style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "rgba(180,35,26,.08)", color: "#B4231A", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}><RotateCw size={13} strokeWidth={2.4} aria-hidden="true" />{"Reintentar"}</button></span> : null}
        {lastSeen ? <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{dm ? "Visto" : "Visto por " + names(m.seenBy)}</span> : null}
      </div>
    </div>
  );
}
