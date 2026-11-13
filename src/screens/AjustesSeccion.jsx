import SettingsShell, { PageHeader, formCss } from "../components/settings/SettingsShell.jsx";
import Ordenador from "../components/settings/Ordenador.jsx";
import Personas from "../components/settings/Personas.jsx";
import Limites from "../components/settings/Limites.jsx";
import Seguridad from "../components/settings/Seguridad.jsx";
import Espacio from "../components/settings/Espacio.jsx";

// New Ajustes sections designed with the language of design/Ajustes.dc.html.
// «quien-usa» is «Quién usa este ordenador» (its old address, /ajustes/personas, is an alias).
const SECTIONS = { ordenador: Ordenador, "quien-usa": Personas, personas: Personas, limites: Limites, seguridad: Seguridad, espacio: Espacio };

export default function AjustesSeccion({ params }) {
  const Section = SECTIONS[params.section];
  return (
    <SettingsShell section={params.section} gap="24px" extraCss={formCss}>
      {Section ? <Section /> : (
        <>
          <PageHeader title="Esta sección no existe">Elige una de las secciones de la izquierda. Tus ajustes siguen como estaban.</PageHeader>
          <a href="/ajustes" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", height: "36px", padding: "0 14px", background: "var(--c-btn)", color: "var(--c-btn-text)", borderRadius: "var(--r-sm)", fontWeight: "600", fontSize: "var(--t-ui)" }}>Ir a Ajustes</a>
        </>
      )}
    </SettingsShell>
  );
}
