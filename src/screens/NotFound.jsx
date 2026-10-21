import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";

// Colmena 2.0 · 35 «No encontrada» (design/V2Estados.dc.html): calm, says nothing was lost,
// two ways out. Also for a request that was already resolved or expired.
export default function NotFound({ title = "Esta pantalla ya no está", text = "Puede que el encargo se haya cerrado o que alguien borrara la sala. No se ha perdido nada de lo tuyo.", active = "hoy" }) {
  return (
    <Shell active={active}>
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", padding: "0 40px", textAlign: "center" }}>
        <span style={{ animation: "drift 5s ease-in-out infinite" }}>
          <BotPresence bot={{ shape: "hex", color: "#FFC93C" }} size={64} state="rest" />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "460px" }}>
          <strong style={{ font: "600 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{title}</strong>
          <span style={{ fontSize: "15px", lineHeight: "1.5", color: "#5C606C" }}>{text}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px" }}>
          <a href="/" style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 22px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "15px", fontWeight: "600" }}>{"Volver a Hoy"}</a>
          <a href="/archivo" style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 18px", borderRadius: "999px", background: "rgba(18,19,26,.06)", fontSize: "15px", fontWeight: "600" }}>{"Buscar en el Archivo"}</a>
        </div>
      </div>
    </Shell>
  );
}
