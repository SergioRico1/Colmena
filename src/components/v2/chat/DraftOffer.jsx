import { Bookmark, PencilLine, X } from "lucide-react";
import { whenLabel } from "./ConvList.jsx";

// «Tenías un mensaje sin enviar» (after assistant-ui draft-restore): what you left written in
// this chat — after closing Colmena or going to another chat — waits above the box until you
// bring it back, keep it for later (the Ctrl+S list) or let it go.

const snippet = (t) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > 110 ? s.slice(0, 110).trimEnd() + "…" : s; };
const pill = { height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600 };

export default function DraftOffer({ offer, onRecover, onLater, onDiscard }) {
  if (!offer) return null;
  return (
    <div role="status" aria-label="Mensaje sin enviar" style={{ display: "flex", alignItems: "center", gap: "10px", margin: "0 0 10px", padding: "8px 8px 8px 14px", borderRadius: "var(--r-xl)", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.06), 0 10px 26px -18px rgba(18,19,26,.35)", animation: "rise .3s ease-out" }}>
      <PencilLine size={15} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#5C606C" }} />
      <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontSize: "var(--t-caption)", color: "#6B6F7A" }}>{`Tenías un mensaje sin enviar${offer.at ? " · " + whenLabel(new Date(offer.at).toISOString()) : ""}`}</span>
        <span style={{ fontSize: "var(--t-ui)", color: "#12131A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snippet(offer.text)}</span>
      </span>
      <button type="button" className="rm-focus" onClick={onRecover} style={{ ...pill, background: "#12131A", color: "#FFFFFF" }}>{"Recuperar"}</button>
      <button type="button" className="rm-focus" onClick={onLater} title="Lo guarda en «Guardados para después» (Ctrl+S)" aria-label="Guardar para después" style={{ ...pill, width: "32px", padding: 0, display: "grid", placeItems: "center", background: "rgba(18,19,26,.06)", color: "#12131A" }}>
        <Bookmark size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <button type="button" className="rm-focus" onClick={onDiscard} aria-label="Descartar el mensaje sin enviar" title="Descartar" style={{ ...pill, width: "32px", padding: 0, display: "grid", placeItems: "center", background: "transparent", color: "#5C606C" }}>
        <X size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}
