import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, FileText, Paperclip, Upload } from "lucide-react";
import { PeerAvatar } from "./PeerAvatar.jsx";
import { BotPresence } from "../Presence.jsx";
import { MentionPill } from "./PeopleMessage.jsx";
import { resolveMentions, resolvePeople } from "../../../lib/mentions.js";

// Where you write in a conversation with people, or in one of its threads
// (design/V2Personas.dc.html, pasos persona and hilo). «@» opens who you can name: the
// people here first (they get a notice of their own), then the bots, each with whose it is.
const sectionTitle = { padding: "8px 12px 4px", fontSize: "12px", fontWeight: 600, color: "#8C8F99" };

// «Adjuntar»: a file of this computer (or dropped here) or a deliverable of Colmena (Archivo).
const SHAREABLE = /\.(png|jpe?g|webp|gif|pdf|docx|xlsx|pptx|txt|md|csv)$/i;

export default function PeopleComposer({ others = [], mentionable = [], mineEnabled = [], me = null, disabled = false, placeholder, onSend, onTyping = () => {}, above = null, compact = false, resetKey = null, onError, onAttach = null, artifacts = [], onArtifact = null }) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef(null);
  const shareable = artifacts.filter((a) => SHAREABLE.test("." + String(a.format || "").toLowerCase())).slice(0, 8);
  const attach = (list) => { setAttachOpen(false); if (list?.length) onAttach?.([...list].slice(0, 5)); };
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [bots, setBots] = useState([]); // [{owner, bot, name}] picked with «@»
  const [people, setPeople] = useState([]); // [{id, name}] picked with «@»
  const input = useRef(null);
  useEffect(() => { setText(""); setBots([]); setPeople([]); setOpen(false); input.current?.focus(); }, [resetKey]);
  const botOf = (owner, bot) => mentionable.find((x) => x.owner === owner && x.bot === bot) || null;
  const shared = (name) => mentionable.filter((x) => x.name.toLowerCase() === String(name).toLowerCase()).length > 1;
  // Who the message goes to, shown before sending: picked bots, and «@Vera» written by hand is yours.
  const resolved = useMemo(() => resolveMentions(text, bots, mineEnabled, me).map((m) => botOf(m.owner, m.bot) || { ...m, note: "tu bot", ownerFace: { me: true } }), [text, bots, mineEnabled, me, mentionable]); // eslint-disable-line react-hooks/exhaustive-deps
  const named = useMemo(() => resolvePeople(text, people, others, mentionable.map((b) => b.name)), [text, people, others, mentionable]);
  // A first name two people here share is written in full.
  const labelOf = (p) => { const first = p.name.split(" ")[0]; return others.filter((o) => o.name.split(" ")[0].toLowerCase() === first.toLowerCase()).length > 1 ? p.name : first; };
  const insert = (label) => {
    setOpen(false);
    setText((t) => (t.endsWith("@") ? t.slice(0, -1) : t) + (t && !/\s$/.test(t) && !t.endsWith("@") ? " " : "") + "@" + label + " ");
    input.current?.focus();
  };
  const pickBot = (m) => { setBots((all) => (all.some((x) => x.owner === m.owner && x.bot === m.bot) ? all : [...all, m])); insert(m.name); };
  const pickPerson = (p) => { setPeople((all) => (all.some((x) => x.id === p.id) ? all : [...all, p])); insert(labelOf(p)); };
  const send = async () => {
    const value = text.trim();
    if (!value || disabled) return;
    // Bots always with their owner (a hand-written «@Vera» goes as yours, as the pill showed).
    const toBots = resolved.map(({ owner, bot }) => ({ owner, bot }));
    const toPeople = named.map((p) => p.id);
    setText(""); setBots([]); setPeople([]);
    if (input.current) input.current.style.height = "auto";
    try { await onSend(value, toBots, toPeople); } catch (e) { onError?.(e.message); setText(value); }
  };
  const anyone = others.length + mentionable.length > 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ position: "relative", flex: "none", width: "100%" }}
      onDragOver={onAttach && !disabled ? (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); setDragging(true); } } : undefined}
      onDragLeave={onAttach ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); } : undefined}
      onDrop={onAttach && !disabled ? (e) => { e.preventDefault(); setDragging(false); attach(e.dataTransfer.files); } : undefined}>
      {dragging ? <div aria-hidden="true" style={{ position: "absolute", inset: "-6px", zIndex: 20, display: "grid", placeItems: "center", borderRadius: "30px", background: "rgba(245,245,242,.92)", boxShadow: "inset 0 0 0 2px #1F4FD1", fontSize: "15px", fontWeight: 600, color: "#1F4FD1", pointerEvents: "none" }}><span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Upload size={17} strokeWidth={2.2} />{"Suéltalo para compartirlo cifrado"}</span></div> : null}
      {attachOpen ? (
        <div role="menu" aria-label="Adjuntar" style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: 0, bottom: "10px", width: "min(380px, 100%)", maxHeight: "360px", overflowY: "auto", padding: "8px", background: "rgba(255,255,255,.97)", WebkitBackdropFilter: "blur(20px)", backdropFilter: "blur(20px)", borderRadius: "24px", boxShadow: "0 30px 60px -20px rgba(18,19,26,.35)", display: "flex", flexDirection: "column", gap: "2px", animation: "rise .22s ease-out", zIndex: 10 }}>
            <button type="button" role="menuitem" onClick={() => picker.current?.click()} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "0 12px", border: 0, borderRadius: "14px", background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "15px", fontWeight: 500 }}><Upload size={17} strokeWidth={2} aria-hidden="true" />{"Un archivo de este ordenador"}</button>
            {shareable.length ? <span style={sectionTitle}>{"Entregables de Colmena"}</span> : null}
            {shareable.map((a) => (
              <button key={a.id} type="button" role="menuitem" onClick={() => { setAttachOpen(false); onArtifact?.(a.id); }} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "46px", padding: "0 12px", border: 0, borderRadius: "14px", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                <FileText size={16} strokeWidth={2} aria-hidden="true" color="#5C606C" />
                <span style={{ flex: 1, minWidth: 0, fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                <span style={{ font: "500 11px/1 'Geist Mono', monospace", textTransform: "uppercase", color: "#8C8F99" }}>{a.format}</span>
              </button>
            ))}
            <span style={{ padding: "8px 12px 4px", fontSize: "12px", lineHeight: 1.45, color: "#8C8F99" }}>{"Sale cifrado de aquí y solo lo abren quienes estáis en la conversación. Hasta 25 MB; el buzón lo guarda 7 días."}</span>
          </div>
        </div>
      ) : null}
      <input ref={picker} type="file" multiple hidden accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv" onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
      {open && anyone ? (
        <div role="listbox" aria-label="Mencionar a alguien" style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: 0, bottom: "10px", width: "min(380px, 100%)", maxHeight: "340px", overflowY: "auto", padding: "8px", background: "rgba(255,255,255,.96)", WebkitBackdropFilter: "blur(20px)", backdropFilter: "blur(20px)", borderRadius: "24px", boxShadow: "0 30px 60px -20px rgba(18,19,26,.35)", display: "flex", flexDirection: "column", gap: "2px", animation: "rise .25s ease-out", zIndex: 10 }}>
            {others.length ? <span style={sectionTitle}>{"Personas · les llega un aviso"}</span> : null}
            {others.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected="false" aria-label={p.name} onClick={() => pickPerson(p)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "46px", padding: "0 12px", border: 0, borderRadius: "14px", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                <PeerAvatar person={p} size={26} dot={p.status === "active"} ring="#FFFFFF" />
                <span style={{ flex: 1, fontSize: "15px", fontWeight: 500 }}>{p.name}</span>
                {p.away ? <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{p.away.mode === "dnd" ? "No molestar" : "Fuera"}</span> : null}
              </button>
            ))}
            {mentionable.length ? <span style={sectionTitle}>{"Bots · contestan aquí"}</span> : null}
            {mentionable.map((m) => (
              <button key={m.owner + m.bot} type="button" role="option" aria-selected="false" aria-label={`${m.name}, ${m.note}`} onClick={() => pickBot(m)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "46px", padding: "0 12px", border: 0, borderRadius: "14px", background: shared(m.name) ? "rgba(18,19,26,.03)" : "transparent", cursor: "pointer", textAlign: "left" }}>
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
      {above}
      {resolved.length || named.length ? (
        <div aria-label="Para" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", margin: "0 0 8px 14px", fontSize: "13px", color: "#5C606C", animation: "fade .2s ease-out" }}>
          {"Para"}
          {named.map((p) => (
            <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "1px 8px 1px 3px", borderRadius: "999px", background: "rgba(31,79,209,.09)", color: "#1F3FA6", fontWeight: 600 }}>
              <PeerAvatar person={p} size={15} />{p.name.split(" ")[0]}<span style={{ fontWeight: 500, color: "#5C606C" }}>{"· le avisa"}</span>
            </span>
          ))}
          {resolved.map((m) => {
            const typed = !bots.some((x) => x.owner === m.owner && x.bot === m.bot);
            return <MentionPill key={m.owner + m.bot} bot={m} label={m.note} title={typed && shared(m.name) ? `Escrito a mano: es tu ${m.name}. Para otra, elígela con @.` : null} />;
          })}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", padding: compact ? "6px" : "8px", background: "#FFFFFF", borderRadius: compact ? "24px" : "28px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 50px -24px rgba(18,19,26,.35)" }}>
        <label style={{ flex: 1, display: "flex" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Mensaje"}</span>
          <textarea ref={input} rows={1} value={text} disabled={disabled} maxLength={8000}
            onChange={(e) => { const v = e.target.value; setText(v); if (v.trim()) onTyping(); if (/(^|\s)@$/.test(v)) setOpen(true); else if (open && !/@\S*$/.test(v)) setOpen(false); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"; }}
            onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); return; } if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            placeholder={placeholder}
            style={{ flex: 1, minWidth: 0, minHeight: compact ? "40px" : "44px", maxHeight: "200px", padding: compact ? "9px 12px" : "11px 14px", border: 0, outline: "none", resize: "none", background: "transparent", font: "inherit", fontSize: compact ? "15px" : "16px", lineHeight: 1.4 }} />
        </label>
        {onAttach ? <button type="button" aria-label="Adjuntar un archivo" title="Compartir un archivo o un entregable" aria-expanded={attachOpen ? "true" : "false"} onClick={() => { setOpen(false); setAttachOpen((o) => !o); }} disabled={disabled} style={{ width: compact ? "40px" : "44px", height: compact ? "40px" : "44px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", cursor: "pointer", background: attachOpen ? "#12131A" : "rgba(18,19,26,.05)", color: attachOpen ? "#FFFFFF" : "#12131A" }}><Paperclip size={18} strokeWidth={2} aria-hidden="true" /></button> : null}
        <button type="button" aria-label="Mencionar a alguien" title="Mencionar a una persona o a un bot" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((o) => !o)} disabled={disabled || !anyone} style={{ width: compact ? "40px" : "44px", height: compact ? "40px" : "44px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", cursor: "pointer", font: "600 17px/1 'Geist', sans-serif", background: "rgba(18,19,26,.05)", color: "#12131A" }}>{"@"}</button>
        <button type="submit" aria-label="Enviar" disabled={!text.trim() || disabled} style={{ width: compact ? "40px" : "44px", height: compact ? "40px" : "44px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: text.trim() && !disabled ? "#12131A" : "#C9CBD1", color: "#FFFFFF", cursor: text.trim() && !disabled ? "pointer" : "default" }}>
          <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
