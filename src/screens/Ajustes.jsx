import AjustesV2 from "./AjustesV2.jsx";

// /ajustes/permisos · Ajustes › Permisos y autonomía (design/V3Permisos.dc.html): the red lines,
// how much each bot does alone, which app each one may touch and the permissions for ever. The
// section lives in AjustesV2 with the others (src/components/v2/settings/Autonomy.jsx).
export default function Ajustes({ query = {} }) {
  return <AjustesV2 section="permisos" query={query} />;
}
