import SettingsShell, { PageHeader, formCss } from "../components/settings/SettingsShell.jsx";
import Ordenador from "../components/settings/Ordenador.jsx";
import Personas from "../components/settings/Personas.jsx";
import Seguridad from "../components/settings/Seguridad.jsx";

// The Ajustes detail pages, one click below their section (sections.js › PARENT): the folders
// each bot may open (/ajustes/ordenador, in Apps y carpetas), who signs on this computer
// (/ajustes/quien-usa, in Contactos y equipos; /ajustes/personas is its old address) and the log
// of actions (/ajustes/seguridad, in Memoria y privacidad).
const SECTIONS = { ordenador: Ordenador, "quien-usa": Personas, personas: Personas, seguridad: Seguridad };

export default function AjustesSeccion({ params }) {
  const Section = SECTIONS[params.section];
  return (
    <SettingsShell section={params.section} gap="24px" extraCss={formCss}>
      {Section ? <Section /> : (
        <>
          <PageHeader title="Esta página no existe">Búscala arriba o elige una sección de la lista. Tus ajustes siguen como estaban.</PageHeader>
          <a href="/ajustes" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", height: "36px", padding: "0 14px", background: "var(--c-btn)", color: "var(--c-btn-text)", borderRadius: "var(--r-sm)", fontWeight: "600", fontSize: "var(--t-ui)" }}>Ir a Ajustes</a>
        </>
      )}
    </SettingsShell>
  );
}
