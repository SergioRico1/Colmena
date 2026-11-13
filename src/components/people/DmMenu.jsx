import { useEffect, useRef, useState } from "react";
import { del, patch } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";
import { useDismiss } from "../room/common.jsx";
import { dmMenu } from "../../lib/invite.js";
import { Archive, BellRing, BellSlash, Ellipsis, UserMinus, UserRound } from "../Icon.js";
import "../../styles/conversation.css";
import "../../styles/invite.css";

// The «…» of a direct conversation's header (docs/SCREENS.md › «Invitar»): «Ver perfil»,
// «Silenciar», «Archivar» and «Quitar de contactos», each saying what it means under its name.
// Silencing and archiving stay on this computer (PATCH /api/peers/shares/:id/prefs); removing
// tells the other Colmena (DELETE /api/peers/contacts/:id) and asks first.
const pop = { position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, width: "300px", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-lg)", background: "var(--c-raised)", border: "1px solid var(--c-line)", boxShadow: "var(--c-shadow-pop)", animation: "rise .15s ease-out" };
const item = { width: "100%", display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 10px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text)", textAlign: "left", cursor: "pointer", font: "inherit" };
const hint = { display: "block", marginTop: "2px", fontSize: "var(--t-caption)", lineHeight: 1.4, color: "var(--c-text-3)" };

export default function DmMenu({ share, other, onProfile, onChanged = null }) {
  const { run } = useStore();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useDismiss(open, () => setOpen(false));
  const button = useRef(null);
  const words = dmMenu({ name: other?.name, muted: !!share?.muted });
  useEffect(() => { if (open) ref.current?.querySelector("[role=menuitem]")?.focus(); }, [open, ref]);
  const keys = (e) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); button.current?.focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = [...e.currentTarget.querySelectorAll("[role=menuitem]")];
    list[(list.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
  };
  const prefs = async (body) => {
    setOpen(false);
    setError(null);
    try { await run(() => patch(`/peers/shares/${encodeURIComponent(share.id)}/prefs`, body)); if (body.archived) navigate("/"); else await onChanged?.(); } catch (e) { setError(e.message); }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try { await run(() => del(`/peers/contacts/${encodeURIComponent(other.id)}`)); navigate("/"); } catch (e) { setError(e.message); setBusy(false); }
  };
  const row = (Icon, label, sub, onClick, danger = false) => (
    <button type="button" role="menuitem" onClick={onClick} style={{ ...item, color: danger ? "var(--c-error)" : "var(--c-text)" }} className="inv-mi">
      <Icon size={17} style={{ flex: "none", marginTop: "1px", color: danger ? "var(--c-error)" : "var(--c-text-3)" }} />
      <span style={{ minWidth: 0 }}><span style={{ fontSize: "var(--t-ui)", fontWeight: 500 }}>{label}</span><span style={hint}>{sub}</span></span>
    </button>
  );
  return (
    <>
      <span ref={ref} style={{ position: "relative" }}>
        <button ref={button} type="button" className="v4-ib" aria-label={`Más opciones de la conversación con ${other?.name || "esta persona"}`} title="Más opciones" aria-haspopup="menu" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)}><Ellipsis size={18} /></button>
        {open ? (
          <div role="menu" aria-label={`Conversación con ${other?.name || "esta persona"}`} onKeyDown={keys} style={pop}>
            {row(UserRound, words.profile, "Quién es, vuestras palabras de seguridad y qué pueden pedirte sus bots.", () => { setOpen(false); onProfile?.(); })}
            {row(share?.muted ? BellRing : BellSlash, words.mute, words.muteHint, () => prefs({ muted: !share?.muted }))}
            {row(Archive, words.archive, words.archiveHint, () => prefs({ archived: true }))}
            {other?.status === "active" ? row(UserMinus, words.remove, "Te preguntamos antes.", () => { setOpen(false); setConfirm(true); }, true) : null}
          </div>
        ) : null}
      </span>
      {confirm ? (
        <div role="alertdialog" aria-label={words.removeTitle} style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "12px 0 4px", borderTop: "1px solid var(--c-line)", fontSize: "var(--t-ui)" }}>
          <span style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "2px", lineHeight: 1.45 }}><strong style={{ fontWeight: 600 }}>{words.removeTitle}</strong><span style={{ color: "var(--c-text-2)", fontSize: "var(--t-meta)" }}>{words.removeText}</span></span>
          <button type="button" autoFocus className="v4-btn" style={{ color: "var(--c-error)" }} disabled={busy} onClick={remove}>{busy ? "Un momento…" : words.remove}</button>
          <button type="button" className="v4-btn ghost" onClick={() => { setConfirm(false); button.current?.focus(); }}>{"Cancelar"}</button>
        </div>
      ) : null}
      {error ? <span role="alert" style={{ flexBasis: "100%", fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</span> : null}
    </>
  );
}
