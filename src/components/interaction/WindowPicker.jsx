import { useEffect, useState } from "react";
import { X } from "lucide-react";

// «Una ventana»: the open windows of other apps with a thumbnail each (OpenClaw Quick Chat
// «Capture Window…»). Used by the quick ask card and by the «+» menu of the composer.
// load() → [{id, name, thumb, icon}] from the desktop app.

/** «captura-factura-pdf»: a file name you will recognise. */
export const captureSlug = (s) => String(s || "app").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";

/** A picture from the desktop ({dataUrl, bytes, name}) → a composer attachment. */
export function captureFile(shot, label = "pantalla") {
  return { name: `captura-${captureSlug(label)}.jpg`, content: String(shot.dataUrl || "").replace(/^data:[^,]*,/, ""), size: shot.bytes, encoding: "base64" };
}

export default function WindowPicker({ load, onPick, onClose, style = null }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.resolve(load?.()).then((l) => alive && setList(l || []), (e) => alive && setError(e.message || "No pude ver las ventanas."));
    return () => { alive = false; };
  }, [load]);
  return (
    <div role="dialog" aria-label="Elige una ventana" className="c-pop" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      style={{ margin: "0", padding: "10px", background: "#FFFFFF", borderRadius: "18px", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35), 0 0 0 1px rgba(18,19,26,.06)", display: "flex", flexDirection: "column", gap: "8px", ...(style || {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>Elige una ventana</span>
        <button type="button" className="rm-focus" onClick={onClose} aria-label="Cerrar" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer" }}><X size={14} strokeWidth={2.2} aria-hidden="true" /></button>
      </div>
      {error ? <p role="alert" style={{ margin: 0, fontSize: "13px", color: "#B4372A" }}>{error}</p> : null}
      {!list && !error ? <p role="status" style={{ margin: 0, fontSize: "13px", color: "#555A68" }}>Buscando ventanas…</p> : null}
      {list && !list.length ? <p style={{ margin: 0, fontSize: "13px", color: "#555A68" }}>No hay otras ventanas abiertas.</p> : null}
      {list?.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", maxHeight: "250px", overflowY: "auto" }}>
          {list.map((w, i) => (
            <button key={w.id} type="button" className="rm-focus c-lift" autoFocus={i === 0} onClick={() => onPick(w)} title={w.name}
              style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "6px", background: "#F7F8FA", border: "1px solid #E6E8EE", borderRadius: "10px", cursor: "pointer", textAlign: "left" }}>
              <img src={w.thumb} alt="" style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", borderRadius: "6px", background: "#E6E8EE" }} />
              <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, fontSize: "12px", color: "#12131A" }}>
                {w.icon ? <img src={w.icon} alt="" style={{ width: "14px", height: "14px", flex: "none" }} /> : null}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
