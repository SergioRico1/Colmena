import AjustesV2 from "./AjustesV2.jsx";

// /ajustes/ia · Ajustes › Cuentas de IA (design/V3AjustesIA.dc.html). The section lives in
// AjustesV2 with the others (src/components/v2/settings/Accounts.jsx); this screen keeps the
// address, which stays open before onboarding (main.jsx).
export default function AjustesIAV2({ query = {} }) {
  return <AjustesV2 section="ia" query={query} />;
}
