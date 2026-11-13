import { useState } from "react";
import { Copy, RotateCw } from "lucide-react";
import { Boundary, errorText, isChunkError } from "../lib/boundary.js";
import { WindowDots } from "./v2/Rail.jsx";

// The crash guard of the whole app. Colmena's window has no native frame, so a render error
// or a screen whose code no longer loads (a chunk replaced by an update) would leave a blank
// window with no way to close it. This draws a plain screen instead, with the window buttons
// still working, «Recargar», «Volver al inicio» and the error text to copy. It uses nothing
// from the store or the router: they may be what failed.

const pill = { height: "40px", padding: "0 18px", display: "inline-flex", alignItems: "center", gap: "8px", border: "0", borderRadius: "999px", fontSize: "var(--t-body)", fontWeight: "600", cursor: "pointer", textDecoration: "none" };
const dark = { ...pill, background: "#12131A", color: "#FFFFFF" };
const line = { ...pill, background: "#FFFFFF", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.16)", color: "#12131A", fontWeight: "500" };

export function CrashScreen({ error, componentStack = "", onReload, onHome }) {
  const chunk = isChunkError(error);
  const detail = errorText(error, componentStack);
  const [copied, setCopied] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied("Copiado");
    } catch {
      setCopied("No se pudo copiar: selecciona el texto");
    }
  };
  return (
    <div style={{ position: "fixed", inset: "0", zIndex: 2147483600, display: "flex", flexDirection: "column", background: "#F5F5F2", color: "#12131A", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      {/* The strip you drag the window by, with the window buttons where the sidebar has them. */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", height: "48px", padding: "0 18px", WebkitAppRegion: "drag" }}>
        <WindowDots inline />
      </div>
      <main style={{ flex: "1", minHeight: "0", overflowY: "auto", display: "grid", placeItems: "center", padding: "24px clamp(20px, 4vw, 52px) 72px" }}>
        <section role="alert" aria-labelledby="crash-t" style={{ width: "100%", maxWidth: "560px", display: "flex", flexDirection: "column", gap: "16px", padding: "28px", background: "#FFFFFF", borderRadius: "24px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 16px 40px -22px rgba(18,19,26,.16)" }}>
          <h1 id="crash-t" style={{ margin: "0", font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em" }}>
            {chunk ? "Hay que recargar Colmena" : "Algo ha fallado al mostrar esta pantalla"}
          </h1>
          <p style={{ margin: "0", fontSize: "var(--t-body)", lineHeight: "1.55", color: "#4A4D57" }}>
            {chunk
              ? "Colmena se ha actualizado y esta pantalla ya no está donde estaba. Recarga para seguir."
              : "Tus bots siguen con su trabajo: esto solo afecta a lo que ves. Recarga, o vuelve al inicio."}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" autoFocus onClick={onReload} style={dark}><RotateCw size={15} strokeWidth={2.2} aria-hidden="true" />{"Recargar"}</button>
            <button type="button" onClick={onHome} style={line}>{"Volver al inicio"}</button>
          </div>
          <details style={{ fontSize: "var(--t-ui)", color: "#5C606C" }}>
            <summary style={{ cursor: "pointer", fontWeight: "500" }}>{"Ver el detalle del error"}</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
              <pre tabIndex={0} style={{ margin: "0", padding: "12px 14px", maxHeight: "220px", overflow: "auto", borderRadius: "12px", background: "#F6F6F3", color: "#3D404A", font: "400 var(--t-caption)/1.55 'Geist Mono', monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }}>{detail}</pre>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button type="button" onClick={copy} style={{ ...line, height: "34px", padding: "0 14px", fontSize: "var(--t-ui)" }}><Copy size={14} strokeWidth={2.2} aria-hidden="true" />{"Copiar el detalle"}</button>
                <span role="status" style={{ fontSize: "var(--t-meta)", color: copied === "Copiado" ? "#0B6B4A" : "#5C606C" }}>{copied}</span>
              </div>
            </div>
          </details>
        </section>
      </main>
    </div>
  );
}

// Full loads on purpose: whatever broke (a screen, the store, the router) starts clean.
const reloadPage = () => window.location.reload();
const goHome = () => window.location.assign("/");

export default function ErrorBoundary({ children, onReload = reloadPage, onHome = goHome }) {
  return (
    <Boundary label="La pantalla ha fallado" keepStack fallback={(error, componentStack) => <CrashScreen error={error} componentStack={componentStack} onReload={onReload} onHome={onHome} />}>
      {children}
    </Boundary>
  );
}
