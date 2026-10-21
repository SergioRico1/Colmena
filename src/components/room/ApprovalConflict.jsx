import { post } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";

const ERROR = { margin: "0", fontSize: "13px", color: "#B4372A", fontWeight: "600" };

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
    <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px", background: "#FFF4D1", border: "1.5px solid #12131A", borderRadius: "12px", fontSize: "14px", lineHeight: "1.45", color: "#12131A", ...style }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: "1px" }}>
        {expired ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5" />}
      </svg>
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <strong>{error}</strong>
        <span style={{ fontSize: "13px", color: "#2B2D36" }}>{expired ? "Por seguridad no se hace nada con una revisión caducada." : "Ya ves la versión actual. Revísala antes de decidir."}</span>
      </span>
    </div>
  );
}

/** «Caducado» actions for an expired send/permission: ask the bot to prepare it again, or drop it. */
export function ExpiredActions({ a, name = "el bot", dark, light, ghost }) {
  const { act, busy, error, conflict } = useAction();
  const renew = () => act(() => post(`/approvals/${a.id}/renew`, { revision: a.revision }));
  const drop = () => act(() => post(`/approvals/${a.id}`, { decision: "denied", revision: a.revision }));
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button type="button" disabled={busy} onClick={renew} title={`Se lo pedimos a ${name} en la sala`} style={{ ...dark, opacity: busy ? "0.6" : "1" }}>Volver a preparar</button>
        <button type="button" disabled={busy} onClick={drop} style={ghost || light}>Descartar</button>
      </div>
      <ApprovalConflict error={error} conflict={conflict} />
    </>
  );
}
