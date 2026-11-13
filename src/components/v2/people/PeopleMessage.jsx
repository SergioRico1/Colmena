import { useState } from "react";
import { Copy, Ellipsis, MessageSquare, Pencil, RotateCw, SmilePlus, Trash2 } from "../../Icon.js";
import { MenuButton, useContextMenu } from "../../Menu.js";
import { menuGroups } from "../../../lib/menu.js";
import { PeerAvatar, PeoplePile } from "./PeerAvatar.jsx";
import { BotPresence } from "../Presence.jsx";
import MeetingCard from "./MeetingCard.jsx";
import { FileCard } from "./PeerFiles.jsx";
import ErrandCard from "./ErrandCard.jsx";
import { mentionSegments } from "../../../lib/mentions.js";
import { copyRealSecrets, SecretText } from "../../room/SecretText.jsx";
import { AuthorAvatar, AuthorHead } from "../../room/Author.jsx";
import { authorOf } from "../../../lib/roomView.js";
import { C } from "../../../lib/theme.js";

// One message of a conversation with people (design/V2Personas.dc.html, pasos sala and hilo):
// plain text (never HTML or Markdown: it comes from someone else), «@» pills for bots and
// people, reactions, its thread, and for your own messages «Editar» and «Borrar».
export const QUICK = ["👍", "❤️", "😂", "🎉"];
const MORE = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "😮", "😢", "🔥"];
export const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
export const names = (list) => (list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list.at(-1));
const tool = { width: "34px", height: "34px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-md)", background: "transparent", cursor: "pointer", color: "var(--c-text-2)" };
const when = (iso) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? "hoy a las " + hhmm(iso) : d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " a las " + hhmm(iso);
};

/** A bot named in a message or about to be: its shape, its name and whose it is. */
export function MentionPill({ bot, label, title }) {
  return (
    <span title={title || undefined} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "1px 8px 1px 5px", borderRadius: "var(--r-pill)", background: `${bot.color || C.text4}24`, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "baseline" }}>
      <BotPresence bot={bot} size={12} state="rest" />
      {bot.name}
      {label ? <span style={{ fontWeight: 500, color: "var(--c-text-3)" }}>{"· " + label}</span> : null}
    </span>
  );
}
/** A person named with «@»: their face and the name as written; you, in yellow. */
export function PersonPill({ person, text }) {
  return (
    <span title={person.name} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "1px 8px 1px 3px", borderRadius: "var(--r-pill)", background: person.me ? "var(--c-mine)" : "color-mix(in srgb, var(--c-accent-ink) 9%, transparent)", color: person.me ? "var(--c-text)" : C.accentInk, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "baseline" }}>
      <PeerAvatar person={person.me ? { me: true } : person} size={15} />
      {text.replace(/^@/, "")}
    </span>
  );
}

/**
 * What can be done with one message, for its «…» and its right-click (components/Menu.js): the
 * frequent ones first (reply in a thread, copy the text), then yours (edit), and «Borrar para
 * todos» last, in red. Deleting has its five-second «Deshacer», so it does not ask first.
 * `full` (the right-click) also lists what the toolbar already shows: reply and react.
 */
export function messageMenu({ m, mine, onThread, onReactMore, onEdit, onDelete, full = false }) {
  if (!m || m.deleted) return [];
  const text = m.text && !(m.file && m.text === m.file.name) ? m.text : "";
  return [
    { group: null, items: [
      full && onThread ? { label: "Responder en un hilo", icon: MessageSquare, onSelect: () => onThread(m) } : null,
      full && onReactMore ? { label: "Reaccionar", icon: SmilePlus, onSelect: onReactMore } : null,
      text ? { label: "Copiar el texto", icon: Copy, onSelect: () => navigator.clipboard?.writeText?.(text) } : null,
    ] },
    mine && onEdit && !m.bot && !m.card && !m.local ? { label: "Editar", icon: Pencil, hint: "Lo verán todos como «editado»", onSelect: onEdit } : null,
    mine && onDelete && m.card?.kind !== "meeting" ? { label: "Borrar para todos", icon: Trash2, danger: true, onSelect: () => onDelete(m) } : null,
  ];
}

/** A right-click on a message opens its menu, unless text is selected (then the app's «Copiar»). */
export const selectionInside = (e) => { const s = window.getSelection?.(); return !!s && !s.isCollapsed && e.currentTarget.contains(s.anchorNode); };

/** «@Vera» and «@Marta» of a message, each with whose it is (bots) or who it is (people). */
export function messageParts(m, botOf) {
  const named = (m.mentions || []).map((x) => botOf(x.owner, x.bot)).filter(Boolean).map((b) => ({ kind: "bot", ...b }));
  // People are written with their full name or their first name: the longest one wins.
  for (const p of m.people || []) named.push({ kind: "person", person: p, name: p.name }, { kind: "person", person: p, name: p.name.split(" ")[0] });
  return mentionSegments(m.text, named);
}

// The row's author is drawn as everywhere (room/Author.jsx): a person is a circle with a name; a
// bot its shape, its name, its role and «bot de Lucía» when it is not yours. `continued`: it
// follows another message of the same author within minutes, so no avatar or name again.
export default function PeopleMessage({ m, dm, botOf, shared, lastSeen, inThread = false, continued = false, onMeeting = null, onOpenFile = null, onReact, onRetry, onThread, onEdit, onDelete, onError }) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const mine = m.from === "me";
  const author = authorOf(m);
  const face = inThread ? 32 : 40;
  const named = (m.people || []).some((p) => p.me);
  const react = (e) => onReact(m.id, e).catch((x) => onError(x.message));
  const save = async () => {
    const value = editing.trim();
    if (!value || value === m.text) { setEditing(null); return; }
    setSaving(true);
    try { await onEdit(m.id, value); setEditing(null); } catch (x) { onError(x.message); } finally { setSaving(false); }
  };
  // The toolbar on hover keeps the one-click things (reactions, reply); the rest is in «…» and
  // on a right-click, the same menu (Slack's model).
  const actions = (full) => messageMenu({ m, mine, onThread, onReactMore: () => setPicker(true), onEdit: () => setEditing(m.text), onDelete, full });
  const ctx = useContextMenu((e) => (selectionInside(e) || editing !== null ? null : { label: "Mensaje", items: actions(true) }));
  const [toolsOpen, setToolsOpen] = useState(false);
  // An errand for one of your bots: only its card (it is for you, not a message to anyone).
  if (m.errand) return <div data-message-id={m.id} style={{ display: "flex", padding: "10px 0 10px 54px" }}><ErrandCard errand={m.errand} /></div>;
  const more = actions(false);
  return (
    <div className="msg" data-message-id={m.id} onContextMenu={ctx.onContextMenu} style={{ position: "relative", display: "grid", gridTemplateColumns: inThread ? "32px 1fr" : "40px 1fr", gap: inThread ? "12px" : "14px", padding: named ? (continued ? "2px 12px" : "8px 12px 2px") : continued ? "2px 0" : "8px 0 2px", margin: named ? "0 -12px" : 0, borderRadius: "var(--r-xl)", background: named ? "color-mix(in srgb, var(--c-honey) 13%, transparent)" : "transparent" }}>
      {ctx.menu}
      {m.deleted || editing !== null ? null : (
        <div className={"msg-tools" + (toolsOpen ? " is-open" : "")} role="toolbar" aria-label="Acciones del mensaje" style={{ position: "absolute", top: "-16px", right: "12px", zIndex: 6, display: "flex", alignItems: "center", gap: "2px", padding: "4px", background: "var(--c-card)", borderRadius: "var(--r-lg)", boxShadow: "var(--c-shadow-pop)" }}>
          {QUICK.map((e) => <button key={e} type="button" aria-label={"Reaccionar " + e} onClick={() => react(e)} style={{ ...tool, fontSize: "var(--t-lead)", lineHeight: 1 }}>{e}</button>)}
          <button type="button" aria-label="Otra reacción" title="Otra reacción" onClick={() => setPicker((p) => !p)} style={tool}><SmilePlus size={18} strokeWidth={1.9} aria-hidden="true" /></button>
          <span aria-hidden="true" style={{ width: "1px", height: "20px", margin: "0 3px", background: "rgb(var(--c-ink-rgb) / .1)" }} />
          {onThread ? <button type="button" aria-label="Responder en un hilo" title="Responder en un hilo" onClick={() => onThread(m)} style={tool}><MessageSquare size={17} strokeWidth={1.9} aria-hidden="true" /></button> : null}
          {menuGroups(more).length ? <MenuButton label="Más acciones" menuLabel="Acciones del mensaje" items={more} style={tool} onOpenChange={setToolsOpen}><Ellipsis size={18} aria-hidden="true" /></MenuButton> : null}
        </div>
      )}
      {continued ? <span className="msg-gutter-time" aria-hidden="true">{hhmm(m.at)}</span> : <AuthorAvatar author={author} size={face} />}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
        {continued ? (m.edited && !m.deleted ? <span title={"Editado " + when(m.edited)} style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"editado"}</span> : null) : (
          <AuthorHead author={author} at={m.at} note={m.local ? "solo lo ves tú" : null}>
            {m.edited && !m.deleted ? <span title={"Editado " + when(m.edited)} style={{ color: "var(--c-text-3)" }}>{" · editado"}</span> : null}
          </AuthorHead>
        )}
        {m.deleted ? (
          <p style={{ margin: 0, fontSize: "var(--t-body)", fontStyle: "italic", color: C.text4 }}>{mine ? "Borraste este mensaje" : "Mensaje borrado"}</p>
        ) : editing !== null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", animation: "fade .15s ease-out" }}>
            <textarea className="c-quiet" autoFocus value={editing} maxLength={8000} disabled={saving} aria-label="Editar el mensaje"
              onChange={(e) => { setEditing(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px"; }}
              onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n); e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px"; }}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); } if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }}
              style={{ width: "100%", minHeight: "46px", maxHeight: "240px", padding: "11px 14px", border: 0, borderRadius: "var(--r-lg)", resize: "none", background: "var(--c-card)", boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--c-accent-ink) 35%, transparent), var(--c-shadow-pop)", font: "inherit", fontSize: "var(--t-read)", lineHeight: 1.5, boxSizing: "border-box" }} />
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
              <button type="button" onClick={save} disabled={saving} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600 }}>{"Guardar"}</button>
              <button type="button" onClick={() => setEditing(null)} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", background: "rgb(var(--c-ink-rgb) / .06)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600 }}>{"Cancelar"}</button>
              {"Intro guarda · Esc cancela · lo verán todos como «editado»"}
            </span>
          </div>
        ) : (m.file && m.text === m.file.name) || m.errand ? null : (
          <p style={{ margin: 0, fontSize: inThread ? "var(--t-body)" : "var(--t-read)", lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }} onCopy={copyRealSecrets}>
            {messageParts(m, botOf).map((s, i) => (!s.mention ? <span key={i}><SecretText text={s.text} /></span>
              : s.mention.kind === "person" ? <PersonPill key={i} person={s.mention.person} text={s.text} />
                : <MentionPill key={i} bot={s.mention} label={shared(s.mention.name) || !s.mention.mine ? s.mention.note : null} />))}
          </p>
        )}
        {m.file && !m.deleted ? <FileCard file={m.file} onOpen={(f) => onOpenFile?.(f)} /> : null}
        {m.card?.kind === "meeting" && !m.deleted ? <MeetingCard meeting={m.meeting} onChange={onMeeting || (() => {})} /> : null}
        {picker ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "6px", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid var(--c-line)", alignSelf: "flex-start", animation: "rise .2s ease-out" }}>
            {MORE.map((e) => <button key={e} type="button" aria-label={"Reaccionar " + e} onClick={() => { setPicker(false); react(e); }} style={{ width: "36px", height: "36px", border: 0, borderRadius: "var(--r-md)", background: "transparent", cursor: "pointer", fontSize: "var(--t-title)" }}>{e}</button>)}
          </div>
        ) : null}
        {m.reactions?.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {m.reactions.map((r) => (
              <button key={r.emoji} type="button" aria-pressed={r.mine ? "true" : "false"} title={names(r.who)} onClick={() => react(r.emoji)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px 0 8px", border: 0, borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, background: r.mine ? "color-mix(in srgb, var(--c-accent-ink) 10%, transparent)" : "rgb(var(--c-ink-rgb) / .05)", boxShadow: r.mine ? "inset 0 0 0 1.5px color-mix(in srgb, var(--c-accent-ink) 35%, transparent)" : "none", animation: "pop .3s ease-out" }}>
                <span style={{ fontSize: "var(--t-read)", lineHeight: 1 }}>{r.emoji}</span>{r.count}
              </button>
            ))}
          </div>
        ) : null}
        {m.replies && onThread ? (
          <button type="button" onClick={() => onThread(m)} aria-label={`Abrir el hilo: ${m.replies.count} respuestas`} style={{ alignSelf: "flex-start", maxWidth: "100%", display: "flex", alignItems: "center", gap: "10px", height: "32px", padding: "0 14px 0 6px", border: 0, borderRadius: "var(--r-sm)", background: "rgb(var(--c-ink-rgb) / .04)", cursor: "pointer", fontSize: "var(--t-meta)", color: "var(--c-text-3)", whiteSpace: "nowrap", overflow: "hidden" }}>
            <PeoplePile people={m.replies.people.map((p) => (p.me ? { ...p, me: true } : p))} size={24} max={3} />
            <strong style={{ fontWeight: 600, color: "var(--c-accent-ink)" }}>{m.replies.count === 1 ? "1 respuesta" : m.replies.count + " respuestas"}</strong>
            {"· la última " + when(m.replies.lastAt)}
          </button>
        ) : null}
        {mine && m.status === "sending" ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Enviando…"}</span> : null}
        {mine && m.status === "failed" ? <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{"No se envió."}<button type="button" onClick={() => onRetry(m.id).catch((x) => onError(x.message))} style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: "color-mix(in srgb, var(--c-error) 8%, transparent)", color: C.error, cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600 }}><RotateCw size={13} strokeWidth={2.4} aria-hidden="true" />{"Reintentar"}</button></span> : null}
        {lastSeen ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{dm ? "Visto" : "Visto por " + names(m.seenBy)}</span> : null}
      </div>
    </div>
  );
}
