import SettingsShell, { PageHeader, formCss } from "../components/settings/SettingsShell.jsx";
import Ordenador from "../components/settings/Ordenador.jsx";
import Personas from "../components/settings/Personas.jsx";
import Limites from "../components/settings/Limites.jsx";
import Seguridad from "../components/settings/Seguridad.jsx";
import Espacio from "../components/settings/Espacio.jsx";

// New Ajustes sections designed with the language of design/Ajustes.dc.html.
const SECTIONS = { ordenador: Ordenador, personas: Personas, limites: Limites, seguridad: Seguridad, espacio: Espacio };

export default function AjustesSeccion({ params }) {
  const Section = SECTIONS[params.section];
  return (
    <SettingsShell section={params.section} gap="24px" extraCss={formCss}>
      {Section ? <Section /> : (
        <>
          <PageHeader title="Esta sección no existe">Elige una de las secciones de la izquierda. Tus ajustes siguen como estaban.</PageHeader>
          <a href="/ajustes" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", height: "44px", padding: "0 18px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", fontWeight: "700", fontSize: "14px" }}>Ir a Conectores</a>
        </>
      )}
    </SettingsShell>
  );
}
