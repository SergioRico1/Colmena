import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";

// Versions of a conversation (server/branches.mjs, after assistant-ui's BranchPicker and
// ActionBarEdit): «‹ 2/3 ›» under a message that has other versions, and «Editar» on your
// own messages, which sends it again as a new version from there on.

const quiet = { width: "28px", height: "28px", display: "grid", placeItems: "center", border: 0, borderRadius: "8px", background: "transparent", color: "#4A4F5C" };

/** «‹ 2/3 ›»: `branch` is { index, count, ids }; `onShow(id)` shows that version. */
export function BranchPicker({ branch, onShow, disabled = false, align = "flex-start" }) {
  if (!branch || branch.count < 2) return null;
  const go = (step) => {
    const id = branch.ids[branch.index - 1 + step];
    if (id) onShow(id);
  };
  const off = (edge) => disabled || edge;
  return (
    <span role="group" aria-label={`Versión ${branch.index} de ${branch.count}`} style={{ alignSelf: align, display: "inline-flex", alignItems: "center", gap: "2px", fontSize: "13px", color: "#5C606C" }}>
      <button type="button" className="rm-focus" aria-label="Versión anterior" disabled={off(branch.index <= 1)} onClick={() => go(-1)} style={{ ...quiet, cursor: off(branch.index <= 1) ? "default" : "pointer", opacity: off(branch.index <= 1) ? 0.35 : 1 }}>
        <ChevronLeft size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <span style={{ font: "500 12px/1 'Geist Mono', monospace", minWidth: "28px", textAlign: "center" }}>{`${branch.index}/${branch.count}`}</span>
      <button type="button" className="rm-focus" aria-label="Versión siguiente" disabled={off(branch.index >= branch.count)} onClick={() => go(1)} style={{ ...quiet, cursor: off(branch.index >= branch.count) ? "default" : "pointer", opacity: off(branch.index >= branch.count) ? 0.35 : 1 }}>
        <ChevronRight size={15} strokeWidth={2.4} aria-hidden="true" />
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
    <form onSubmit={send} style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: "10px", padding: "14px", borderRadius: "24px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.08), 0 16px 40px -24px rgba(18,19,26,.3)", animation: "rise .2s ease-out" }}>
      <label style={{ display: "flex" }}>
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Editar el mensaje"}</span>
        <textarea ref={box} value={value} onChange={(e) => setValue(e.target.value)} rows={2}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) send(e); }}
          style={{ flex: "1", resize: "none", border: 0, outline: "none", padding: "6px 8px", fontSize: "16px", lineHeight: "1.5", fontFamily: "inherit", color: "#12131A", fieldSizing: "content", maxHeight: "260px", background: "transparent" }} />
      </label>
      {canRestore ? (
        <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 8px", fontSize: "13px", color: "#3D404A", cursor: "pointer" }}>
          <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#12131A" }} />
          {"Volver también los archivos a como estaban antes de este mensaje"}
        </label>
      ) : null}
      <span style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
        <span style={{ flex: "1", padding: "0 8px", fontSize: "12px", color: "#6B6F7A" }}>{"Se envía como otra versión; la anterior se queda en ‹ ›."}</span>
        <button type="button" onClick={onCancel} style={{ height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: "#3D404A" }}>{"Cancelar"}</button>
        <button type="submit" disabled={busy || !value.trim()} style={{ height: "36px", padding: "0 16px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: busy ? "progress" : "pointer", fontSize: "14px", fontWeight: 600 }}>{busy ? "Enviando…" : "Enviar"}</button>
      </span>
      {error ? <span role="alert" style={{ padding: "0 8px", fontSize: "13px", color: "#B4372A", fontWeight: 600 }}>{error}</span> : null}
    </form>
  );
}
