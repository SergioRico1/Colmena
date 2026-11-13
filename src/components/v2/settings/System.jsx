import { useStore } from "../../../lib/store.jsx";
import DictationRow from "./Dictation.jsx";
import { Chip, Row } from "./v3.jsx";

// Ajustes › Navegador y dictado (group «Este ordenador»): what belongs to this machine and not to
// your accounts — the bots' own browser window (desktop app only) and who turns your voice into
// text. The folders your bots may open stay with the apps (Apps y carpetas), where you give them.

export default function SystemSection() {
  const { computer } = useStore();
  return (
    <section aria-label="Este ordenador" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden" }}>
      <Row first anchor="navegador" title="Navegador propio para cada bot" min="76px"
        sub="Navegan en una ventana de Colmena, no en tu Chrome ni con tus sesiones. Nunca escriben contraseñas: las de la bóveda las pone Colmena y el resto te las piden a ti. Navegar nunca te pregunta.">
        {computer?.available ? <Chip tone="green" style={{ height: "28px", padding: "0 12px", fontSize: "var(--t-meta)" }}>Activo</Chip> : <Chip tone="quiet" style={{ height: "28px", padding: "0 12px", fontSize: "var(--t-meta)" }}>Solo en la app de escritorio</Chip>}
      </Row>
      <DictationRow />
    </section>
  );
}
