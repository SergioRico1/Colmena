import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Highlight } from "../../home/shared.jsx";
import { get } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { hhmm } from "./PeopleMessage.jsx";

// «Buscar en esta conversación» (design/V2Personas.dc.html, paso buscar): what you search
// stays on this computer; every word must be there, accents and case do not matter. A hit
// opens the conversation (or its thread) at that message. Ctrl+K searches all of them.
export const hitUrl = (h) => "/con/" + h.shareId + "?" + (h.thread ? "hilo=" + encodeURIComponent(h.thread) + "&" : "") + "m=" + encodeURIComponent(h.id);
const day = (iso) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? hhmm(iso) : d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }); };

export default function ShareSearch({ shareId, onClose }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(null);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setHits(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      get(`/peers/search?share=${encodeURIComponent(shareId)}&q=${encodeURIComponent(query)}`).then((r) => alive && setHits(r.hits)).catch(() => alive && setHits([]));
    }, 140);
    return () => { alive = false; clearTimeout(t); };
  }, [q, shareId]);
  const first = q.trim().split(/\s+/)[0] || "";
  return (
    <div role="search" style={{ position: "relative", padding: "0 clamp(20px, 4vw, 44px) 14px", animation: "fade .2s ease-out" }}>
      <label style={{ display: "flex", alignItems: "center", gap: "10px", height: "46px", padding: "0 8px 0 16px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 10px 26px -16px rgba(18,19,26,.25)" }}>
        <Search size={17} strokeWidth={2.2} color="#6B6F7A" aria-hidden="true" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } if (e.key === "Enter" && hits?.[0]) { navigate(hitUrl(hits[0])); onClose(); } }}
          placeholder="Buscar en esta conversación" aria-label="Buscar en esta conversación"
          style={{ flex: 1, minWidth: 0, height: "100%", border: 0, outline: "none", background: "transparent", font: "inherit", fontSize: "15px" }} />
        {hits ? <span style={{ fontSize: "13px", color: "#6B6F7A", whiteSpace: "nowrap" }}>{hits.length === 0 ? "Nada" : hits.length === 1 ? "1 mensaje" : hits.length + (hits.length >= 40 ? "+" : "") + " mensajes"}</span> : null}
        <button type="button" aria-label="Cerrar la búsqueda" onClick={onClose} style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.05)", cursor: "pointer", color: "#3D404A" }}><X size={15} strokeWidth={2.4} aria-hidden="true" /></button>
      </label>
      {hits?.length ? (
        <ul role="listbox" aria-label="Mensajes encontrados" style={{ position: "absolute", left: "clamp(20px, 4vw, 44px)", right: "clamp(20px, 4vw, 44px)", top: "54px", zIndex: 20, maxHeight: "360px", overflowY: "auto", margin: 0, padding: "8px", listStyle: "none", background: "rgba(255,255,255,.97)", WebkitBackdropFilter: "blur(20px)", backdropFilter: "blur(20px)", borderRadius: "22px", boxShadow: "0 30px 60px -20px rgba(18,19,26,.35)", animation: "rise .2s ease-out" }}>
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" role="option" aria-selected="false" onClick={() => { navigate(hitUrl(h)); onClose(); }} style={{ width: "100%", display: "flex", flexDirection: "column", gap: "3px", padding: "10px 12px", border: 0, borderRadius: "14px", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                <span style={{ display: "flex", gap: "8px", fontSize: "13px", color: "#6B6F7A" }}><strong style={{ fontWeight: 600, color: "#12131A" }}>{h.bot ? h.bot + (h.author === "Tú" ? " · tu bot" : " · bot de " + h.author.split(" ")[0]) : h.author}</strong>{(h.thread ? "· en un hilo " : "") + "· " + day(h.at)}</span>
                <span style={{ fontSize: "14px", lineHeight: 1.45, color: "#3D404A" }}><Highlight text={h.snippet} query={first} /></span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
