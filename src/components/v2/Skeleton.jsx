// Colmena 2.0 · 35 «Cargando»: grey shapes with a soft shimmer, never a lone «Cargando…».
const bar = { background: "linear-gradient(90deg, #EFEFEA 0%, #F7F7F3 50%, #EFEFEA 100%)", backgroundSize: "200% 100%", animation: "shimmer 1.6s linear infinite" };
const WIDTHS = [["62%", "38%"], ["48%", "30%"], ["70%", "44%"], ["55%", "26%"]];

export default function SkeletonList({ rows = 4 }) {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {Array.from({ length: rows }, (_, i) => {
        const [w1, w2] = WIDTHS[i % WIDTHS.length];
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px 18px", borderRadius: "20px", background: "#FFFFFF" }}>
            <span style={{ width: "36px", height: "36px", flex: "none", borderRadius: "12px", ...bar }} />
            <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ height: "12px", borderRadius: "6px", width: w1, ...bar }} />
              <span style={{ height: "10px", borderRadius: "5px", width: w2, ...bar }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
