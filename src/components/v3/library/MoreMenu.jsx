import { Ellipsis } from "../../Icon.js";
import { MenuButton } from "../../Menu.js";
import { withRun } from "../team/parts.jsx";

// «···» (design/V3Habilidades.dc.html): what is used rarely, behind one small button, in the
// app's one menu (components/Menu.js): icons, groups, destructive actions last in red.
export default function MoreMenu({ label, items, style = null }) {
  return (
    <span style={{ flex: "none", display: "inline-flex", ...style }}>
      <MenuButton label={label} items={withRun(items)} style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text-2)", cursor: "pointer" }}>
        <Ellipsis size={18} weight="bold" />
      </MenuButton>
    </span>
  );
}
