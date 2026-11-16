// A conversation that is still loading (a channel, a sala, a chat with a bot): the shape of the
// messages it will show — an avatar, a name and a line or two — with the soft shimmer of
// «Cargando» (design/V3Estados.dc.html), never a lone «Cargando…». Built from the theme's tokens
// so it reads the same in light and dark. Screen readers hear one «Cargando los mensajes».
const shine = { background: "linear-gradient(90deg, var(--c-chip) 0%, var(--c-hover) 40%, var(--c-chip) 80%)", backgroundSize: "300% 100%", animation: "shimmer 1.6s ease-in-out infinite" };
const ROWS = [
  { name: "22%", lines: ["78%", "54%"] },
  { name: "16%", lines: ["62%"] },
  { name: "26%", lines: ["84%", "70%", "38%"] },
  { name: "18%", lines: ["48%"] },
];

export default function MessagesSkeleton({ rows = 4, style = null }) {
  return (
    <div role="status" aria-label="Cargando los mensajes" style={{ display: "flex", flexDirection: "column", gap: "22px", padding: "12px 0", ...style }}>
      {ROWS.slice(0, rows).map((r, i) => (
        <div key={i} aria-hidden="true" style={{ display: "flex", alignItems: "flex-start", gap: "12px", opacity: 1 - i * 0.12 }}>
          <span style={{ flex: "none", width: "32px", height: "32px", borderRadius: "var(--r-md)", ...shine }} />
          <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "8px", paddingTop: "2px" }}>
            <span style={{ height: "11px", width: r.name, borderRadius: "var(--r-pill)", ...shine }} />
            {r.lines.map((w, j) => <span key={j} style={{ height: "10px", width: w, borderRadius: "var(--r-pill)", background: "var(--c-chip)" }} />)}
          </span>
        </div>
      ))}
    </div>
  );
}
