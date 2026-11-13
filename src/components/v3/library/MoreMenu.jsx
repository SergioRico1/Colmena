import { useClickAway } from "../../../lib/useClickAway.js";
import { useRef, useState } from "react";

// «···» (design/V3Habilidades.dc.html): what is used rarely, behind one small button. A plain
// list of actions that opens below the button and closes on Escape, outside clicks or a pick.
export default function MoreMenu({ label, items, style = null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(open, ref, () => setOpen(false));
  const shown = items.filter(Boolean);
  return (
    <span ref={ref} style={{ position: "relative", flex: "none", display: "inline-flex", ...style }}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)} style={{ width: "32px", height: "32px", padding: "0", border: "0", borderRadius: "9px", background: open ? "#F1F1EC" : "transparent", color: "#4A4D57", cursor: "pointer" }}>
        {"···"}
      </button>
      {open ? (
        <span role="menu" style={{ position: "absolute", right: "0", top: "36px", zIndex: 20, minWidth: "200px", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "14px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.06), 0 18px 40px -16px rgba(18,19,26,.35)", animation: "rise .18s ease-out" }}>
          {shown.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.run(); }} style={{ minHeight: "36px", padding: "0 12px", border: "0", borderRadius: "9px", background: "transparent", textAlign: "left", fontSize: "var(--t-ui)", color: it.danger ? "#B4232A" : "#12131A", cursor: it.disabled ? "default" : "pointer", opacity: it.disabled ? 0.5 : 1 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#F6F6F3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
              {it.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
