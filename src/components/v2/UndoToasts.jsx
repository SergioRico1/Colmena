import { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";
import { dismiss, undoLast, useToasts } from "../../lib/undoToast.js";

// The quiet «Deshacer» notice (src/lib/undoToast.js), the v2 «Todo se puede deshacer» pill
// (design/V2Principios.dc.html, idea 05): white, one line, the dark «Deshacer» on the right
// and a thin line that runs out in five seconds. Bottom centre, above everything; at most
// three stacked. Ctrl+Z outside a text field undoes the newest one.
const INK = "#12131A";

function Toast({ toast }) {
  const [run, setRun] = useState(false);
  useEffect(() => { const f = requestAnimationFrame(() => setRun(true)); return () => cancelAnimationFrame(f); }, []);
  const error = toast.kind === "error";
  return (
    <div role={error ? "alert" : "status"} style={{ pointerEvents: "auto", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: "12px", maxWidth: "min(560px, calc(100vw - 32px))", minHeight: "52px", padding: toast.undo ? "6px 6px 6px 20px" : "6px 8px 6px 20px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 12px 32px -12px rgba(18,19,26,.28), 0 0 0 1px rgba(18,19,26,.06)", animation: "rise .25s ease-out", color: error ? "#B4372A" : INK }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: "15px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={toast.text}>{toast.text}</span>
      {toast.undo ? (
        <button type="button" onClick={toast.undo} style={{ flex: "none", display: "flex", alignItems: "center", gap: "7px", height: "40px", padding: "0 18px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
          <Undo2 size={15} strokeWidth={2.2} aria-hidden="true" />Deshacer
        </button>
      ) : (
        <button type="button" aria-label="Cerrar el aviso" onClick={() => dismiss(toast.id)} style={{ flex: "none", width: "36px", height: "36px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#6B6F7A" }}>
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}
      {toast.undo ? (
        <span aria-hidden="true" style={{ position: "absolute", left: "20px", right: "20px", bottom: 0, height: "2px", borderRadius: "1px", background: "rgba(18,19,26,.08)", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", background: INK, transformOrigin: "left", transform: run ? "scaleX(0)" : "scaleX(1)", transition: `transform ${Math.max(0, toast.at + toast.ms - Date.now())}ms linear` }} />
        </span>
      ) : null}
    </div>
  );
}

export default function UndoToasts() {
  const toasts = useToasts();
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (undoLast()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!toasts.length) return null;
  return (
    <div aria-live="polite" style={{ position: "fixed", left: 0, right: 0, bottom: "24px", zIndex: 90, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "0 16px", pointerEvents: "none" }}>
      <style>{"@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}"}</style>
      {toasts.map((t) => <Toast key={t.id} toast={t} />)}
    </div>
  );
}
