// Colmena 3 · «Cargando» (design/V3Estados.dc.html): grey shapes with a soft shimmer, never a
// lone «Cargando…». A tile and two lines per row; the first line shimmers, the second rests.
// `surface` (default) draws the white card around the rows; pass false inside a card already.
const shine = { background: "linear-gradient(90deg,#ECECE7 0%,#F6F6F3 40%,#ECECE7 80%)", backgroundSize: "300% 100%", animation: "shimmer 1.6s ease-in-out infinite" };
const WIDTHS = ["72%", "58%", "80%", "46%"];

export default function SkeletonList({ rows = 4, surface = true, style = null }) {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "12px", ...(surface ? { padding: "28px", borderRadius: "var(--r-2xl)", background: "var(--c-card)" } : {}), ...style }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ flex: "none", width: "34px", height: "34px", borderRadius: "var(--r-md)", ...shine }} />
          <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "7px" }}>
            <span style={{ height: "11px", width: WIDTHS[i % WIDTHS.length], borderRadius: "var(--r-pill)", ...shine }} />
            <span style={{ height: "9px", width: "40%", borderRadius: "var(--r-pill)", background: "var(--c-chip)" }} />
          </span>
        </div>
      ))}
    </div>
  );
}
