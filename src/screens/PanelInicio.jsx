import Shell from "../components/v2/Shell.jsx";
import Panel from "../components/blocks/Panel.jsx";

// Inicio › Panel (/panel): the live blocks you pinned (components/blocks/Panel.jsx). It was
// the last block of Inicio; it has its own page now, one click from Inicio's header, so that
// Inicio does one thing: what waits for you, a box to ask, and what is under way.
export default function PanelInicio() {
  return (
    <Shell active="inicio">
      <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "40px clamp(20px, 4vw, 52px) 72px", display: "flex", flexDirection: "column", gap: "28px" }}>
        <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#5C606C" }}>
          <a href="/" style={{ color: "#5C606C" }}>{"Inicio"}</a><span aria-hidden="true">{"›"}</span><span style={{ color: "#12131A", fontWeight: "500" }}>{"Panel"}</span>
        </nav>
        <Panel page />
      </main>
    </Shell>
  );
}
