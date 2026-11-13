import { useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import SettingsLayout from "../components/v2/settings/Layout.jsx";
import GeneralSection from "../components/v2/settings/General.jsx";
import AccountsSection from "../components/v2/settings/Accounts.jsx";
import AutonomySection, { PauseButton } from "../components/v2/settings/Autonomy.jsx";
import AppsSection from "../components/v2/settings/Apps.jsx";
import NoticesSection from "../components/v2/settings/Notices.jsx";
import PrivacySection from "../components/v2/settings/Privacy.jsx";
import UsageSection, { UsageUnits } from "../components/v2/settings/Usage.jsx";
import HelpSection, { diagnosticsDot, useDiagnostics } from "../components/v2/settings/Diagnostics.jsx";
import AdvancedSection from "../components/v2/settings/Advanced.jsx";
import PeopleSettings from "../components/v2/settings/People.jsx";
import { DETAIL_ALIAS, PARENT, SECTION_OF, sectionId } from "../components/v2/settings/sections.js";
import { Go, btn } from "../components/v2/settings/v3.jsx";
import AjustesSeccion from "./AjustesSeccion.jsx";
import { C } from "../lib/theme.js";

// Colmena 3 · Ajustes (design/V3Ajustes.dc.html and its sibling boards): eight sections by what
// you want to do — General, Cuentas de IA, Permisos y autonomía, Apps y carpetas, Avisos,
// Privacidad y datos, Uso y límites, Ayuda y diagnóstico — plus Avanzado in expert mode, each
// at /ajustes/<section> and each setting at …#<anchor> (src/components/v2/settings/sections.js).
// Old addresses (/ajustes/inteligencia, /ajustes/acerca…) are aliases; the detail pages
// (/ajustes/ordenador, /ajustes/personas, /ajustes/seguridad) stay one click below.

const BODY = {
  general: GeneralSection, ia: AccountsSection, permisos: AutonomySection, apps: AppsSection, avisos: NoticesSection,
  privacidad: PrivacySection, uso: UsageSection, ayuda: HelpSection, avanzado: AdvancedSection, contactos: PeopleSettings,
};
const WIDTH = { ia: 840, permisos: 860, apps: 860, privacidad: 860, uso: 860 };
const ASIDE = { permisos: PauseButton, uso: UsageUnits };
// A lead with a link in it (the plain words stay in sections.js for the search).
const LEAD = { apps: <>Las apps, carpetas y webs con las que trabajan tus bots. Qué puede tocar cada uno se decide en <Go to="/ajustes/permisos">Permisos</Go>.</> };

export default function AjustesV2({ params = {}, query = {}, section: forced = null }) {
  const { ai = null, ready } = useStore();
  const { result } = useDiagnostics();
  const asked = forced || params.section || null;
  const raw = DETAIL_ALIAS[asked] || asked; // /ajustes/personas → «Quién usa este ordenador»
  // A detail page of a section (/ajustes/ordenador, /ajustes/personas, /ajustes/seguridad).
  if (raw && PARENT[raw] && !SECTION_OF[raw]) return <AjustesSeccion params={{ section: raw }} />;
  const id = sectionId(raw);
  const section = SECTION_OF[id];
  const noAI = ready && ai && !ai.engines?.some((e) => e.connected);
  const tags = {
    ...(noAI ? { ia: { text: "!", color: C.error, label: "Ninguna IA conectada" } } : {}),
    ...(diagnosticsDot(result) ? { ayuda: diagnosticsDot(result) } : {}),
  };
  if (!section) {
    return (
      <SettingsLayout active={null} open title="Esta sección no existe" lead="Elige una de la lista. Tus ajustes siguen como estaban." tags={tags}>
        <a href="/ajustes" onClick={(e) => { e.preventDefault(); navigate("/ajustes"); }} style={{ ...btn("dark", 42), alignSelf: "flex-start" }}>Ir a Ajustes</a>
      </SettingsLayout>
    );
  }
  const Body = BODY[id];
  const Aside = ASIDE[id];
  return (
    <SettingsLayout active={id} open={!!raw} tags={tags} width={WIDTH[id] || 820} lead={LEAD[id] || null} aside={Aside ? <Aside /> : null}>
      <Body query={query} />
    </SettingsLayout>
  );
}
