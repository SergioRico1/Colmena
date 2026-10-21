import { useState } from "react";
import { ClipboardType, TextCursorInput, X } from "lucide-react";
import { useDismiss } from "./common.jsx";

// A long paste waiting in the composer (OpenClaw pasted-text cards): what it starts with and
// how long it is, «Ver» to read it whole, «Ponerlo en el texto» to bring it back inline, ×.
const LABEL = 30;

const label = (text) => {
  const first = String(text || "").replace(/\s+/g, " ").trim();
  return first.length > LABEL ? first.slice(0, LABEL).trimEnd() + "…" : first || "Texto pegado";
};

export default function PastedCard({ file, onInline, onRemove }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const chars = String(file.content || "").length;
  const lines = String(file.content || "").split("\n").length;
  const small = { height: "28px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "6px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "#12131A" };
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "10px", padding: "8px 8px 8px 10px", border: "1px solid #DCE0E8", borderRadius: "12px", background: "#F7F8FA", maxWidth: "100%" }}>
      <span aria-hidden="true" style={{ width: "30px", height: "30px", flex: "none", borderRadius: "8px", background: "#FFF4D1", display: "grid", placeItems: "center", color: "#12131A" }}>
        <ClipboardType size={16} strokeWidth={2} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <strong style={{ fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "240px" }}>{label(file.content)}</strong>
        <span style={{ fontSize: "12px", color: "#555A68" }}>{`Texto pegado · ${chars.toLocaleString("es-ES")} caracteres · ${lines.toLocaleString("es-ES")} ${lines === 1 ? "línea" : "líneas"}`}</span>
      </span>
      <button type="button" className="rm-focus" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} style={small}>{open ? "Ocultar" : "Ver"}</button>
      {onInline ? (
        <button type="button" className="rm-focus" onClick={onInline} title="Quitar la tarjeta y poner el texto en el cuadro" style={small}>
          <TextCursorInput size={14} strokeWidth={2} aria-hidden="true" />
          {"Ponerlo en el texto"}
        </button>
      ) : null}
      <button type="button" className="rm-focus" aria-label="Quitar el texto pegado" onClick={onRemove} style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "8px", cursor: "pointer", color: "#555A68" }}>
        <X size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      {open ? (
        <span role="dialog" aria-label="Texto pegado" className="c-pop" style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", zIndex: 30, width: "min(560px, 80vw)", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "14px", boxShadow: "0 16px 36px -18px rgba(18,19,26,.45)", overflow: "hidden" }}>
          <pre style={{ margin: 0, padding: "14px 16px", maxHeight: "300px", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", font: "13px/1.5 'Geist Mono', monospace", color: "#2B2D36" }}>{file.content}</pre>
        </span>
      ) : null}
    </span>
  );
}
