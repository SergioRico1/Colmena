import { useState } from "react";
import { X } from "lucide-react";
import { updates, useUpdates } from "../lib/updates.js";

// «Hay una versión nueva · Reiniciar para actualizar»: one quiet line in the corner once a new
// version has downloaded by itself (desktop/updater.cjs). Nothing while it checks or downloads.
// Closing it only hides the line: the update still installs the next time Colmena closes.
const INK = "#12131A";
const MUTED = "#5C606C";

function dismissedKey(version) { return "colmena.update.dismissed:" + version; }
function wasDismissed(version) { try { return sessionStorage.getItem(dismissedKey(version)) === "1"; } catch { return false; } }

export default function UpdateNotice() {
  const state = useUpdates();
  const [hidden, setHidden] = useState(null);
  const manual = state?.status === "error" && state.manual && state.version;
  if (!state || !(state.status === "ready" || manual) || !state.version) return null;
  if (hidden === state.version || wasDismissed(state.version)) return null;
  const close = () => {
    try { sessionStorage.setItem(dismissedKey(state.version), "1"); } catch {}
    if (state.waiting) updates.cancelWait();
    setHidden(state.version);
  };
  return (
    <div role="status" aria-live="polite" title={"Colmena " + state.version} style={{ position: "fixed", right: "20px", bottom: "20px", zIndex: 2147482000, display: "flex", alignItems: "center", gap: "12px", maxWidth: "calc(100vw - 40px)", padding: "6px 6px 6px 18px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.06), 0 12px 32px rgba(18,19,26,.12)", color: INK, fontSize: "14px", animation: "rise .35s cubic-bezier(.2,.8,.2,1)" }}>
      <span aria-hidden="true" style={{ width: "7px", height: "7px", flex: "none", borderRadius: "50%", background: "#0B8A5F" }} />
      {state.waiting ? (
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {"Se actualizará cuando el equipo termine"}
        </span>
      ) : (
        <>
          <span style={{ whiteSpace: "nowrap", color: MUTED }}>{"Hay una versión nueva"}</span>
          <span aria-hidden="true" style={{ color: "#B5B8C0" }}>{"·"}</span>
          <button type="button" onClick={() => (manual ? updates.download() : updates.restart())} style={{ height: "34px", padding: "0 16px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" }}>
            {manual ? "Descargar" : "Reiniciar para actualizar"}
          </button>
        </>
      )}
      <button type="button" aria-label={state.waiting ? "No esperar" : "Ahora no"} onClick={close} style={{ width: "34px", height: "34px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", color: "#9A9DA6", cursor: "pointer" }}>
        <X size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
