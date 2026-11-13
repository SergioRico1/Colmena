import { useState } from "react";
import { Check, Checks, MessageSquare, Pencil, RotateCw, SmilePlus, Trash2 } from "../Icon.js";
import { MentionPill, PersonPill, QUICK, hhmm, messageParts, names } from "../v2/people/PeopleMessage.jsx";
import { PeoplePile } from "../v2/people/PeerAvatar.jsx";
import { copyRealSecrets, SecretText } from "./SecretText.jsx";
import "../../styles/conversation.css";

// Your own message in a conversation with people (Colmena 4: design/v4 › .mine): on the right in
// the soft bubble, its time and how far it got («Enviando…», a tick, two and «Visto por …»), with
// the same tools as everyone's rows on hover (react, thread, edit, delete for everyone) and your
// edit in place. Plain text with «@» pills: it is what went to the others. Files, meetings,
// errands and what your bots say keep their own rows (v2/people/PeopleMessage.jsx).
const MORE = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "😮", "😢", "🔥"];
const tool = { width: "30px", height: "30px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", color: "var(--c-text-2)" };

/** Whether a row of people is yours and plain (drawn here) rather than a card of its own. */
export const isPlainMine = (m) => m?.from === "me" && !m.bot && !m.errand && !m.card && !m.file;

export default function PeerMine({ m, botOf, shared, lastSeen = false, dm = false, continued = false, onReact, onRetry, onThread, onEdit, onDelete, onError }) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const react = (e) => onReact(m.id, e).catch((x) => onError(x.message));
  const save = async () => {
    const value = editing.trim();
    if (!value || value === m.text) { setEditing(null); return; }
    setSaving(true);
    try { await onEdit(m.id, value); setEditing(null); } catch (x) { onError(x.message); } finally { setSaving(false); }
  };
  const seen = m.seenBy?.length ? (dm ? "Visto" : "Visto por " + names(m.seenBy)) : null;
  return (
    <div data-message-id={m.id} className={"msg-row v4-mine" + (continued ? " is-continued" : "")} style={{ background: "transparent" }}>
      {m.deleted || editing !== null ? null : (
        <span className="msg-actions" role="toolbar" aria-label="Acciones del mensaje">
          {QUICK.map((e) => <button key={e} type="button" aria-label={"Reaccionar " + e} onClick={() => react(e)} style={{ ...tool, fontSize: "var(--t-read)", lineHeight: 1 }}>{e}</button>)}
          <button type="button" aria-label="Otra reacción" title="Otra reacción" onClick={() => setPicker((p) => !p)} style={tool}><SmilePlus size={16} /></button>
          {onThread ? <button type="button" aria-label="Responder en un hilo" title="Responder en un hilo" onClick={() => onThread(m)} style={tool}><MessageSquare size={16} /></button> : null}
          {!m.local ? <button type="button" aria-label="Editar" title="Editar" onClick={() => setEditing(m.text)} style={tool}><Pencil size={15} /></button> : null}
          <button type="button" aria-label="Borrar para todos" title="Borrar para todos" onClick={() => onDelete(m)} style={{ ...tool, color: "var(--c-error)" }}><Trash2 size={15} /></button>
        </span>
      )}
      {editing !== null ? (
        <div style={{ width: "min(62%, 560px)", display: "flex", flexDirection: "column", gap: "8px", animation: "fade .15s ease-out" }}>
          <textarea className="c-quiet" autoFocus value={editing} maxLength={8000} disabled={saving} aria-label="Editar el mensaje"
            onChange={(e) => { setEditing(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px"; }}
            onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n); e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px"; }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); } if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }}
            style={{ width: "100%", minHeight: "44px", maxHeight: "240px", padding: "9px 14px", border: "1px solid var(--c-accent)", borderRadius: "var(--r-md)", resize: "none", background: "var(--c-raised)", color: "var(--c-text)", font: "inherit", fontSize: "var(--t-body)", lineHeight: 1.5, boxSizing: "border-box" }} />
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "8px", fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>
            {"Intro guarda · Esc cancela · lo verán todos como «editado»"}
            <button type="button" className="v4-btn" onClick={() => setEditing(null)}>{"Cancelar"}</button>
            <button type="button" className="v4-btn primary" onClick={save} disabled={saving}>{"Guardar"}</button>
          </span>
        </div>
      ) : (
        <div className="v4-bubble" onCopy={copyRealSecrets} style={m.deleted ? { fontStyle: "italic", color: "var(--c-text-3)" } : null}>
          {m.deleted ? "Borraste este mensaje" : messageParts(m, botOf).map((s, i) => (!s.mention ? <span key={i} style={{ whiteSpace: "pre-wrap" }}><SecretText text={s.text} /></span>
            : s.mention.kind === "person" ? <PersonPill key={i} person={s.mention.person} text={s.text} />
              : <MentionPill key={i} bot={s.mention} label={shared(s.mention.name) || !s.mention.mine ? s.mention.note : null} />))}
        </div>
      )}
      {editing !== null ? null : (
        <span className="v4-mine-meta">
          {m.edited && !m.deleted ? <span>{"editado ·"}</span> : null}
          <time dateTime={m.at}>{hhmm(m.at)}</time>
          {m.status === "sending" ? <span>{"Enviando…"}</span> : m.status === "failed" ? null : lastSeen && seen ? <><Checks size={15} aria-hidden="true" /><span>{seen}</span></> : <Check size={14} aria-label="Enviado" />}
        </span>
      )}
      {m.status === "failed" ? (
        <span style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{"No se envió."}
          <button type="button" className="v4-btn" onClick={() => onRetry(m.id).catch((x) => onError(x.message))}><RotateCw size={13} />{"Reintentar"}</button>
        </span>
      ) : null}
      {picker ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px", padding: "6px", borderRadius: "var(--r-md)", background: "var(--c-raised)", border: "1px solid var(--c-line)", boxShadow: "var(--c-shadow-pop)", animation: "rise .2s ease-out" }}>
          {MORE.map((e) => <button key={e} type="button" aria-label={"Reaccionar " + e} onClick={() => { setPicker(false); react(e); }} style={{ width: "36px", height: "36px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", fontSize: "var(--t-title)" }}>{e}</button>)}
        </div>
      ) : null}
      {m.reactions?.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "6px", marginTop: "6px" }}>
          {m.reactions.map((r) => (
            <button key={r.emoji} type="button" aria-pressed={r.mine ? "true" : "false"} title={names(r.who)} onClick={() => react(r.emoji)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 10px 0 8px", border: r.mine ? "1px solid var(--c-accent)" : "1px solid var(--c-line)", borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)", background: r.mine ? "var(--c-accent-soft)" : "var(--c-raised)" }}>
              <span style={{ fontSize: "var(--t-read)", lineHeight: 1 }}>{r.emoji}</span>{r.count}
            </button>
          ))}
        </div>
      ) : null}
      {m.replies && onThread ? (
        <button type="button" onClick={() => onThread(m)} aria-label={`Abrir el hilo: ${m.replies.count} respuestas`} style={{ display: "flex", alignItems: "center", gap: "8px", height: "32px", marginTop: "6px", padding: "0 10px 0 4px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
          <PeoplePile people={m.replies.people} size={22} max={3} />
          <strong style={{ fontWeight: 600, color: "var(--c-accent-ink)" }}>{m.replies.count === 1 ? "1 respuesta" : m.replies.count + " respuestas"}</strong>
        </button>
      ) : null}
    </div>
  );
}
