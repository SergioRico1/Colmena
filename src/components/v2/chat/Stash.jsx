import { useState } from "react";
import { Bookmark, X } from "lucide-react";
import { comboLabel } from "../../../lib/useDock.js";
import { useDismiss } from "../../room/common.jsx";
import { whenLabel } from "./ConvList.jsx";

// «Guardados para después» (T3 Code ComposerStashMenu): Ctrl+S takes what you are writing out
// of the box and keeps it here; a click brings it back (what was in the box is kept in its
// place, so nothing is lost). Shared by every chat; it lives in this computer only.

const snippet = (text) => {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  return line.length > 90 ? line.slice(0, 90).trimEnd() + "…" : line;
};

export default function Stash({ entries = [], onRestore, onDelete, saved = false }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  if (!entries.length && !saved) return null;
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      {saved ? (
        <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 10px", fontSize: "13px", color: "#0B6B4A", animation: "fade .2s ease-out" }}>
          <Bookmark size={14} strokeWidth={2.2} aria-hidden="true" />{"Guardado para después"}
        </span>
      ) : (
        <button type="button" className="rm-focus" aria-haspopup="dialog" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} title={`Lo que guardaste con ${comboLabel("mod+s")}`}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 12px 0 10px", border: 0, borderRadius: "999px", background: open ? "#12131A" : "rgba(18,19,26,.06)", color: open ? "#FFFFFF" : "#3D404A", cursor: "pointer", fontSize: "13px", fontWeight: 600, transition: "background .15s ease, color .15s ease" }}>
          <Bookmark size={14} strokeWidth={2.2} aria-hidden="true" />
          {`Guardados para después · ${entries.length}`}
        </button>
      )}
      {open ? (
        <div role="dialog" aria-label="Guardados para después" style={{ position: "absolute", right: 0, bottom: "calc(100% + 8px)", zIndex: 30, width: "min(460px, 80vw)", padding: "6px", borderRadius: "20px", background: "#FFFFFF", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35), 0 0 0 1px rgba(18,19,26,.06)", animation: "rise .2s ease-out" }}>
          <p style={{ margin: 0, padding: "8px 12px 6px", fontSize: "12px", color: "#6B6F7A" }}>{`Pulsa uno para seguir escribiéndolo. ${comboLabel("mod+s")} guarda lo que tengas en el cuadro.`}</p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", maxHeight: "320px", overflowY: "auto" }}>
            {entries.map((e) => (
              <li key={e.id} style={{ display: "flex", alignItems: "center", gap: "4px", borderRadius: "14px" }}>
                <button type="button" className="rm-focus" onClick={() => { setOpen(false); onRestore(e); }} aria-label={`Seguir escribiendo: ${snippet(e.text)}`}
                  style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px", padding: "10px 12px", border: 0, borderRadius: "14px", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "14px", color: "#12131A" }}>{snippet(e.text)}</span>
                  <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{[e.label, whenLabel(new Date(e.at).toISOString())].filter(Boolean).join(" · ")}</span>
                </button>
                <button type="button" className="rm-focus" onClick={() => onDelete(e)} aria-label={`Borrar el guardado: ${snippet(e.text)}`} title="Borrar"
                  style={{ width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "10px", background: "transparent", cursor: "pointer", color: "#5C606C" }}>
                  <X size={15} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
