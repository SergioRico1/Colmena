import { useEffect, useRef, useState } from "react";
import { Pencil } from "../../Icon.js";

// Versions of a conversation (server/branches.mjs, after assistant-ui's BranchPicker and
// ActionBarEdit): «‹ Versión 2 de 3 ›» under a message that has other versions, and «Editar» on your
// own messages, which sends it again as a new version from there on.

const quiet = { width: "26px", height: "26px", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text-2)", fontSize: "var(--t-body)" };

/** «‹ Versión 2 de 3 ›» (design/V3Chat.dc.html): `branch` is { index, count, ids }; `onShow(id)` shows that version. */
export function BranchPicker({ branch, onShow, disabled = false, align = "flex-start" }) {
  if (!branch || branch.count < 2) return null;
  const go = (step) => {
    const id = branch.ids[branch.index - 1 + step];
    if (id) onShow(id);
  };
  const off = (edge) => disabled || edge;
  return (
    <span role="group" aria-label={`Versión ${branch.index} de ${branch.count}`} style={{ alignSelf: align, display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
      <button type="button" className="rm-focus" aria-label="Versión anterior" disabled={off(branch.index <= 1)} onClick={() => go(-1)} style={{ ...quiet, cursor: off(branch.index <= 1) ? "default" : "pointer", opacity: off(branch.index <= 1) ? 0.35 : 1 }}>
        <span aria-hidden="true">{"‹"}</span>
      </button>
      <span>{`Versión ${branch.index} de ${branch.count}`}</span>
      <button type="button" className="rm-focus" aria-label="Versión siguiente" disabled={off(branch.index >= branch.count)} onClick={() => go(1)} style={{ ...quiet, cursor: off(branch.index >= branch.count) ? "default" : "pointer", opacity: off(branch.index >= branch.count) ? 0.35 : 1 }}>
        <span aria-hidden="true">{"›"}</span>
      </button>
    </span>
  );
}

/** «Editar» under one of your messages. */
export function EditButton({ onClick, disabled }) {
  return (
    <button type="button" className="rm-focus" onClick={onClick} disabled={disabled} aria-label="Editar el mensaje" title={disabled ? "Espera a que termine de responder" : "Editar y enviar de nuevo"}
      style={{ ...quiet, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1 }}>
      <Pencil size={14} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

/**
 * Your message, written again. «Enviar» opens a new version from here; when the bot changed
 * files since then, you may also put them back as they were (restore points).
 */
export function EditMessage({ text, canRestore = false, onSend, onCancel }) {
  const [value, setValue] = useState(text);
  const [restore, setRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  useEffect(() => { const el = box.current; if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); } }, []);
  const send = async (e) => {
    e?.preventDefault();
    const body = value.trim();
    if (!body || busy) return;
    if (body === text.trim() && !restore) { onCancel(); return; }
    setBusy(true);
    setError(null);
    try { await onSend(body, restore); } catch (err) { setError(err?.message || "No se pudo enviar."); setBusy(false); }
  };
  return (
    <form className="c-ring" onSubmit={send} style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: "10px", padding: "14px", borderRadius: "var(--r-2xl)", background: "var(--c-card)", boxShadow: "0 0 0 1px rgba(18,19,26,.08), 0 16px 40px -24px rgba(18,19,26,.3)", animation: "rise .2s ease-out" }}>
      <label style={{ display: "flex" }}>
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Editar el mensaje"}</span>
        <textarea className="c-bare" ref={box} value={value} onChange={(e) => setValue(e.target.value)} rows={2}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) send(e); }}
          style={{ flex: "1", resize: "none", border: 0, padding: "6px 8px", fontSize: "var(--t-read)", lineHeight: "1.5", fontFamily: "inherit", color: "var(--c-text)", fieldSizing: "content", maxHeight: "260px", background: "transparent" }} />
      </label>
      {canRestore ? (
        <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 8px", fontSize: "var(--t-meta)", color: "var(--c-text-2)", cursor: "pointer" }}>
          <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "var(--c-text)" }} />
          {"Volver también los archivos a como estaban antes de este mensaje"}
        </label>
      ) : null}
      <span style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
        <span style={{ flex: "1", padding: "0 8px", fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{"Se envía como otra versión; la anterior se queda en ‹ ›."}</span>
        <button type="button" onClick={onCancel} style={{ height: "36px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text-2)" }}>{"Cancelar"}</button>
        <button type="submit" disabled={busy || !value.trim()} style={{ height: "36px", padding: "0 16px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: busy ? "progress" : "pointer", fontSize: "var(--t-ui)", fontWeight: 600 }}>{busy ? "Enviando…" : "Enviar"}</button>
      </span>
      {error ? <span role="alert" style={{ padding: "0 8px", fontSize: "var(--t-meta)", color: "var(--c-error)", fontWeight: 600 }}>{error}</span> : null}
    </form>
  );
}
