import { useEffect } from "react";
import { useResource, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { useUpdates } from "../lib/updates.js";
import SettingsLayout from "../components/v2/settings/Layout.jsx";
import GeneralSection from "../components/v2/settings/General.jsx";
import AccountsSection from "../components/v2/settings/Accounts.jsx";
import AutonomySection, { PauseButton } from "../components/v2/settings/Autonomy.jsx";
import AppsSection from "../components/v2/settings/Apps.jsx";
import NoticesSection from "../components/v2/settings/Notices.jsx";
import PrivacySection from "../components/v2/settings/Privacy.jsx";
import CopiesSection from "../components/v2/settings/Copies.jsx";
import SystemSection from "../components/v2/settings/System.jsx";
import UpdatesSection from "../components/v2/settings/Updates.jsx";
import DevicesSection from "../components/v2/settings/Devices.jsx";
import UsageSection, { UsageUnits } from "../components/v2/settings/Usage.jsx";
import HelpSection, { useDiagnostics } from "../components/v2/settings/Diagnostics.jsx";
import AdvancedSection from "../components/v2/settings/Advanced.jsx";
import PeopleSettings from "../components/v2/settings/People.jsx";
import { DETAIL_ALIAS, PARENT, SECTION_OF, homeOf, sectionId } from "../components/v2/settings/sections.js";
import { sectionTags } from "../components/v2/settings/status.js";
import { Go, btn } from "../components/v2/settings/v3.jsx";
import AjustesSeccion from "./AjustesSeccion.jsx";

// Colmena 4 · Ajustes: thirteen sections in six groups by what people think about — «Tú»,
// «Tu equipo y tus contactos», «Inteligencia y apps», «Privacidad y seguridad», «Este ordenador»
// and «Avanzado» — each at /ajustes/<section> and each setting at …#<anchor>
// (src/components/v2/settings/sections.js), with its status at a glance (status.js). Old
// addresses (/ajustes/inteligencia, /ajustes/acerca…) are aliases, and an anchor that moved
// (/ajustes/privacidad#copias) is followed to its new section. The detail pages
// (/ajustes/ordenador, /ajustes/quien-usa, /ajustes/seguridad) stay one click below a section.

const BODY = {
  general: GeneralSection, avisos: NoticesSection, contactos: PeopleSettings, permisos: AutonomySection,
  ia: AccountsSection, apps: AppsSection, uso: UsageSection, privacidad: PrivacySection, copias: CopiesSection,
  sistema: SystemSection, actualizaciones: UpdatesSection, ayuda: HelpSection, avanzado: AdvancedSection,
  dispositivos: DevicesSection,
};
const WIDTH = { dispositivos: 860, ia: 840, permisos: 860, apps: 860, copias: 860, uso: 860, contactos: 860 };
const ASIDE = { permisos: PauseButton, uso: UsageUnits };
// A lead with a link in it (the plain words stay in sections.js for the search).
const LEAD = { apps: <>Las apps y carpetas con las que trabajan tus bots. Qué puede tocar cada uno se decide en <Go to="/ajustes/permisos#que-app">Autonomía y permisos</Go>.</> };

/** What every section's status needs, read once for the whole screen. */
function useTags() {
  const { ai = null, planLimits = null, connectors = null, folders = [], peers = null, paused, settings = {} } = useStore();
  const { result } = useDiagnostics();
  const backup = useResource("/backup");
  const updates = useUpdates();
  return sectionTags({ ai, planLimits, connectors, folders, peers, backup: backup.data, updates, diagnostics: result, paused: paused || settings.paused, settings });
}

export default function AjustesV2({ params = {}, query = {}, section: forced = null }) {
  const tags = useTags();
  const asked = forced || params.section || null;
  const raw = DETAIL_ALIAS[asked] || asked; // /ajustes/personas → «Quién usa este ordenador»
  const detail = raw && PARENT[raw] && !SECTION_OF[raw];
  const id = sectionId(raw);
  // An old link to a setting that moved lands where it lives now.
  useEffect(() => {
    if (detail) return undefined;
    const go = () => { const to = homeOf(sectionId(raw), decodeURIComponent(location.hash.slice(1))); if (to) navigate(to, { replace: true }); };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [raw, detail]);
  // A detail page of a section (/ajustes/ordenador, /ajustes/quien-usa, /ajustes/seguridad).
  if (detail) return <AjustesSeccion params={{ section: raw }} />;
  const section = SECTION_OF[id];
  if (!section) {
    return (
      <SettingsLayout active={null} open title="Esta sección no existe" lead="Búscala arriba o elige una de la lista. Tus ajustes siguen como estaban." tags={tags}>
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
