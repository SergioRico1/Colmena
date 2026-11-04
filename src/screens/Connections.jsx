import AjustesV2 from "./AjustesV2.jsx";

// /ajustes/conexiones (and ?q=gmail from other screens) · Ajustes › Apps y carpetas
// (design/V3Conexiones.dc.html). The section lives in AjustesV2 with the others
// (src/components/v2/settings/Apps.jsx), which keeps the catalogue and its sign-in flow.
export default function Connections({ query = {} }) {
  return <AjustesV2 section="apps" query={query} />;
}
