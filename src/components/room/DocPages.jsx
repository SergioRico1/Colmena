import { useEffect, useState } from "react";

// A PDF, or a Word/Excel/PowerPoint file converted by this computer's Office or LibreOffice
// (server/officepdf.mjs), drawn page by page. The server says first whether it can
// ({available, pages, version, missingFonts, engine} or {available: false, note}); the pages
// come as pictures, so nothing of the file runs here. Leaving cancels a conversion in course.

/** The look of a file: {state: 'loading'|'ready'|'none', info}. `key` changes → asked again. */
export function useVisual(infoUrl, key = "") {
  const [result, setResult] = useState({ state: "loading", info: null });
  useEffect(() => {
    if (!infoUrl) { setResult({ state: "none", info: null }); return undefined; }
    const controller = new AbortController();
    setResult((r) => (r.state === "ready" ? r : { state: "loading", info: null }));
    fetch(infoUrl, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : r.json().catch(() => ({})).then((b) => ({ available: false, note: b.error || "No se pudo ver con su formato." }))))
      .then((info) => setResult({ state: info?.available ? "ready" : "none", info }), (e) => { if (e?.name !== "AbortError") setResult({ state: "none", info: { available: false, note: "No se pudo ver con su formato." } }); });
    return () => controller.abort();
  }, [infoUrl, key]);
  return result;
}

/** «Faltan fuentes…» and which program drew it, under the pages. */
export function VisualNotes({ info, style }) {
  const fonts = info?.missingFonts || [];
  if (!fonts.length && !info?.engine) return null;
  return (
    <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: "#555A68", ...style }}>
      {[info.engine ? `Vista preparada con ${info.engine}.` : null,
        fonts.length ? `Este equipo no tiene ${fonts.length === 1 ? "la fuente" : "las fuentes"} ${fonts.map((f) => `«${f}»`).join(", ")}: se ve con otra parecida.` : null].filter(Boolean).join(" ")}
    </p>
  );
}

/** The pages, lazily, one under the other. `pageUrl(n)` is the PNG of page n. */
export default function DocPages({ info, pageUrl, max = 200, gap = "12px", label = "Página" }) {
  const total = Math.min(info?.pages || 0, max);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap, alignItems: "stretch" }}>
      {Array.from({ length: total }, (_, i) => (
        <figure key={i} style={{ margin: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <img loading="lazy" src={pageUrl(i + 1)} alt={`${label} ${i + 1} de ${info.pages}`}
            style={{ width: "100%", height: "auto", minHeight: "120px", borderRadius: "8px", background: "#FFFFFF", border: "1px solid #E6E8EE", boxShadow: "0 10px 30px -22px rgba(18,19,26,.45)" }} />
          {info.pages > 1 ? <figcaption style={{ alignSelf: "center", font: "500 11px/1 'Geist Mono', monospace", color: "#8C91A0" }}>{`${i + 1} / ${info.pages}`}</figcaption> : null}
        </figure>
      ))}
      {info?.pages > max ? <p style={{ margin: 0, fontSize: "12px", color: "#555A68" }}>{`Se muestran las primeras ${max} páginas. Descárgalo para ver el resto.`}</p> : null}
    </div>
  );
}
