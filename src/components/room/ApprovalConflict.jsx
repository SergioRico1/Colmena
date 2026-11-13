import { Clock, RotateCcw } from "../Icon.js";

const ERROR = { margin: "0", fontSize: "var(--t-meta)", color: "var(--c-error)", fontWeight: "600" };

/**
 * Error line of an approval decision. A 409 (the content changed since you saw it, or it
 * expired) is shown as a highlighted note: the state was refreshed, so what you see now is
 * the latest version.
 */
export default function ApprovalConflict({ error, conflict, style }) {
  if (!error) return null;
  if (!conflict) return <p role="alert" style={{ ...ERROR, ...style }}>{error}</p>;
  const expired = /30 minutos|caduc/i.test(error);
  return (
    <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px", background: "var(--c-honey-soft)", border: "1.5px solid var(--c-text)", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)", lineHeight: "1.45", color: "var(--c-text)", ...style }}>
      {expired ? <Clock size={18} style={{ flex: "none", marginTop: "1px" }} /> : <RotateCcw size={18} style={{ flex: "none", marginTop: "1px" }} />}
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <strong>{error}</strong>
        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text)" }}>{expired ? "Por seguridad no se hace nada con una revisión caducada." : "Ya ves la versión actual. Revísala antes de decidir."}</span>
      </span>
    </div>
  );
}
