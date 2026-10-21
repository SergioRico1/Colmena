import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { get, put } from "../../../lib/api.js";
import { C, HEAD, MONO, SHEET } from "./parts.jsx";

// Keyboard shortcuts of «Código» (T3 Code keybindings): defaults you can change one by one.
// Stored by the server (/api/code/keybindings); «mod» is Ctrl here (⌘ on a Mac).

export const ACTION_LABEL = {
  newTask: "Nueva tarea", focusComposer: "Escribir a Bruno", togglePlan: "Cambiar entre Construir y Plan", stop: "Parar a Bruno",
  compact: "Compactar la conversación", togglePanel: "Mostrar u ocultar el panel", widePanel: "Ampliar el panel",
  tabChanges: "Ver los cambios", tabPreview: "Ver la vista previa", tabTerminal: "Ver la terminal", newTerminal: "Nueva terminal",
  save: "Guardar (el botón principal)", shortcuts: "Ver los atajos",
};

const MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");

/** A keydown → «mod+shift+j» (null for a lone modifier). */
export function comboOf(e) {
  const key = String(e.key || "").toLowerCase();
  if (["control", "shift", "alt", "meta", "os"].includes(key)) return null;
  const name = key === " " ? "space" : key;
  const mod = MAC ? e.metaKey : e.ctrlKey;
  return [mod && "mod", e.altKey && "alt", e.shiftKey && "shift", name].filter(Boolean).join("+");
}

/** «mod+shift+j» → «Ctrl ⇧ J». */
export function showCombo(combo) {
  if (!combo) return "—";
  return combo.split("+").map((p) => ({ mod: MAC ? "⌘" : "Ctrl", shift: "⇧", alt: MAC ? "⌥" : "Alt", ctrl: "Ctrl", space: "Espacio", enter: "↵", escape: "Esc" }[p] || p.toUpperCase())).join(" ");
}

let cache = null;
const listeners = new Set();
export async function loadBindings(force = false) {
  if (!cache || force) cache = await get("/code/keybindings").catch(() => ({ defaults: {}, bindings: {} }));
  for (const fn of listeners) fn(cache);
  return cache;
}

/** Runs `handlers[action]` when its shortcut is pressed (not while typing a shortcut). */
export function useCodeKeys(handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [bindings, setBindings] = useState(cache?.bindings || {});
  useEffect(() => {
    const on = (c) => setBindings(c.bindings || {});
    listeners.add(on);
    loadBindings();
    return () => listeners.delete(on);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (window.__colmenaRecordingKey) return;
      const combo = comboOf(e);
      if (!combo) return;
      const action = Object.keys(bindings).find((a) => bindings[a] === combo);
      if (!action || !ref.current[action]) return;
      // Plain keys (no Ctrl/Alt) never fire while you type in a field.
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
      if (typing && !/^(mod|alt)\+/.test(combo) && !/^f\d+$/.test(combo)) return;
      e.preventDefault();
      ref.current[action]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindings]);
  return bindings;
}

export default function ShortcutsSheet({ onClose }) {
  const [data, setData] = useState(cache);
  const [recording, setRecording] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { loadBindings().then(setData); }, []);
  useEffect(() => {
    if (!recording) { window.__colmenaRecordingKey = false; return undefined; }
    window.__colmenaRecordingKey = true;
    const onKey = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(null); return; }
      const combo = comboOf(e);
      if (!combo) return;
      if (!/^(mod|alt)\+/.test(combo) && !/^f\d+$/.test(combo)) { setError("Usa Ctrl o Alt con la tecla, para que no salte mientras escribes."); return; }
      const taken = Object.entries(data.bindings).find(([a, c]) => c === combo && a !== recording);
      const next = { ...data.bindings, [recording]: combo, ...(taken ? { [taken[0]]: "" } : {}) };
      try { setData(await put("/code/keybindings", { bindings: next })); await loadBindings(true); setError(taken ? `Se lo has quitado a «${ACTION_LABEL[taken[0]]}».` : null); } catch (err) { setError(err.message); }
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.__colmenaRecordingKey = false; };
  }, [recording, data]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape" && !recording) onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [recording, onClose]);
  const reset = async () => { setData(await put("/code/keybindings", { bindings: {} })); await loadBindings(true); setError(null); };
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(18,19,26,.28)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", display: "grid", placeItems: "center", padding: "24px", animation: "fade .2s ease-out" }}>
      <div role="dialog" aria-modal="true" aria-label="Atajos de Código" style={{ width: "min(560px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", borderRadius: "28px", background: C.white, boxShadow: SHEET, animation: "sheet .35s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "22px 22px 12px" }}>
          <h2 style={{ flex: 1, margin: 0, font: `600 22px/1.1 ${HEAD}`, letterSpacing: "-0.02em" }}>Atajos de Código</h2>
          <button type="button" onClick={reset} style={{ height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Restablecer</button>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: C.muted }}><X size={16} strokeWidth={2.2} aria-hidden="true" /></button>
        </div>
        <p style={{ margin: "0 22px 10px", fontSize: "13px", lineHeight: 1.5, color: C.muted }}>Pulsa un atajo para cambiarlo y luego la combinación que quieras. Ctrl+K sigue abriendo «Buscar o pedir» en toda Colmena.</p>
        <div style={{ overflowY: "auto", padding: "4px 12px 16px" }}>
          {Object.keys(ACTION_LABEL).map((action) => (
            <div key={action} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "46px", padding: "0 10px", borderRadius: "14px" }} className="code-hover">
              <span style={{ flex: 1, fontSize: "14px" }}>{ACTION_LABEL[action]}</span>
              <button type="button" onClick={() => { setError(null); setRecording(action); }} aria-label={"Cambiar el atajo de " + ACTION_LABEL[action]}
                style={{ minWidth: "110px", height: "32px", padding: "0 12px", border: 0, borderRadius: "10px", cursor: "pointer", font: `500 12px/1 ${MONO}`, background: recording === action ? "#FFF4D1" : C.soft, color: recording === action ? C.honeyText : C.text, boxShadow: recording === action ? "0 0 0 1.5px " + C.honey : "none" }}>
                {recording === action ? "Pulsa la combinación…" : showCombo(data?.bindings?.[action])}
              </button>
            </div>
          ))}
        </div>
        {error ? <p role="status" style={{ margin: 0, padding: "12px 22px", borderTop: "1px solid " + C.rule, fontSize: "13px", color: C.honeyText }}>{error}</p> : null}
      </div>
    </div>
  );
}
