import { useState } from "react";
import { updates, useUpdates } from "../lib/updates.js";

// Colmena 3 · «Actualización» (design/V3Estados.dc.html): once a new version has downloaded by
// itself (desktop/updater.cjs), one discreet ink bar — never a block. «Reiniciar y actualizar»
// waits for each bot to finish its step; «Luego» only hides it: the update still installs the
// next time Colmena closes. Nothing while it checks or downloads.

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
    <div role="status" aria-live="polite" style={{ position: "fixed", right: "24px", bottom: "24px", zIndex: 2147482000, width: "min(560px, calc(100vw - 48px))", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "10px 10px 10px 18px", borderRadius: "var(--r-xl)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", boxShadow: "0 18px 40px -20px rgba(18,19,26,.55)", animation: "rise .35s cubic-bezier(.2,.8,.2,1)" }}>
      <span style={{ flex: "1 1 180px" }}>
        {state.waiting ? "Se actualizará cuando cada bot termine su paso; luego siguen." : `Hay una versión nueva de Colmena (${state.version}).`}
      </span>
      {state.waiting ? null : (
        <button type="button" onClick={() => (manual ? updates.download() : updates.restart())} style={{ height: "38px", padding: "0 16px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: "600", cursor: "pointer" }}>
          {manual ? "Descargar" : "Reiniciar y actualizar"}
        </button>
      )}
      <button type="button" onClick={close} style={{ height: "38px", padding: "0 10px", border: "0", background: "transparent", color: "#C9CBD3", fontSize: "var(--t-ui)", cursor: "pointer" }}>
        {state.waiting ? "No esperar" : "Luego"}
      </button>
    </div>
  );
}
