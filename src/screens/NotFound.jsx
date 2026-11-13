import Shell from "../components/v2/Shell.jsx";
import { navigate } from "../lib/router.jsx";

// Colmena 3 · «No encontrada» (design/V3Estados.dc.html): calm, says nothing was lost, two
// ways out — back to Inicio, or «Buscar» (the Ctrl K palette). Also for a request that was
// already resolved or expired (title and text change, the ways out stay).
export default function NotFound({ title = "Esta pantalla ya no está", text = "Puede que la tarea se cerrara o que alguien borrara la sala. No se ha perdido nada de lo tuyo.", active = "" }) {
  return (
    <Shell active={active}>
      <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px clamp(20px, 4vw, 56px)" }}>
        <div role="status" style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "14px", padding: "28px", borderRadius: "var(--r-2xl)", background: "var(--c-card)" }}>
          <h1 style={{ margin: "0", font: "600 var(--t-heading)/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{title}</h1>
          <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{text}</span>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} style={{ height: "42px", padding: "0 18px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "600", textDecoration: "none" }}>{"Volver a Inicio"}</a>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("colmena:palette"))} style={{ height: "42px", padding: "0 16px", display: "inline-flex", alignItems: "center", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "transparent", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" }}>{"Buscar"}</button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
