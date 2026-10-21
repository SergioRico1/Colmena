import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { post } from "../../lib/api.js";

// «Qué ha pasado en esta sala» (server/recaps.mjs): 1–3 sentences under a room on Inicio and
// Misiones. While it is being written, a quiet «Resumiendo…»; when it failed, «Reintentar
// resumen» where a button fits (rows, not inside a card that is itself a link).
export default function Recap({ m, lines = 2, retry = false, style = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const r = m?.recap;
  if (!r || (!r.text && r.status !== "writing" && !(retry && r.status === "failed"))) return null;
  const again = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try { await post(`/missions/${m.id}/recap`, {}); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const writing = busy || r.status === "writing";
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, ...style }}>
      {r.text ? (
        <span title={r.text} style={{ fontSize: "13px", lineHeight: "1.45", color: "#2B2D36", display: "-webkit-box", WebkitLineClamp: String(lines), WebkitBoxOrient: "vertical", overflow: "hidden", opacity: writing ? 0.6 : 1 }}>{r.text}</span>
      ) : null}
      {writing && !r.text ? <span style={{ fontSize: "13px", color: "#555A68", animation: "colmena-pulse 1.6s ease-in-out infinite" }}>{"Resumiendo lo que ha pasado…"}</span> : null}
      {retry && !writing && (r.status === "failed" || error) ? (
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", fontSize: "12px", color: "#555A68" }}>
          {error || (r.text ? "No se pudo actualizar el resumen." : "No se pudo escribir el resumen.")}
          <button type="button" className="rm-focus" onClick={again} style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "26px", padding: "0 9px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "7px", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "#12131A" }}>
            <RotateCcw size={12} strokeWidth={2.4} aria-hidden="true" />{"Reintentar resumen"}
          </button>
        </span>
      ) : null}
    </span>
  );
}
