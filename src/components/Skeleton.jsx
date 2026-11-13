// Placeholder while something loads: soft grey lines with a slow shimmer (Colmena greys),
// instead of a loose «Cargando…». Screen readers hear one «Cargando» status.
const WIDTHS = ["92%", "76%", "84%", "60%", "70%"];

export function SkeletonLines({ lines = 3, label = "Cargando", style }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "4px 0", ...style }}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} aria-hidden="true" className="colmena-skeleton" style={{ display: "block", height: "12px", width: WIDTHS[i % WIDTHS.length], borderRadius: "var(--r-pill)" }} />
      ))}
    </div>
  );
}

/** A card-shaped placeholder (lists of cards: missions, goals…). */
export function SkeletonCard({ style }) {
  return (
    <div role="status" aria-label="Cargando" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "var(--r-lg)", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", ...style }}>
      <span aria-hidden="true" className="colmena-skeleton" style={{ display: "block", height: "10px", width: "40%", borderRadius: "var(--r-pill)" }} />
      <span aria-hidden="true" className="colmena-skeleton" style={{ display: "block", height: "16px", width: "85%", borderRadius: "var(--r-sm)" }} />
      <span aria-hidden="true" className="colmena-skeleton" style={{ display: "block", height: "12px", width: "60%", borderRadius: "var(--r-pill)" }} />
    </div>
  );
}
