import { shapeOf } from "../../v2/Presence.jsx";
import { useUndoable } from "../../../lib/undoable.js";

// Small pieces the «Tu día» screens share (design/V3Inicio, V3Actividad, V3Revisar): a bot as a
// flat shape (the boards draw them without gloss at these sizes), the honey label of what
// waits, and the dark «Se envía en 9 s · Deshacer» bar of a send that can still be undone.

/** A bot as its flat shape. `anim` breathes while it works; `halo` rings it in honey. */
export function Shape({ bot, size = 20, anim = false, halo = false, style = null }) {
  const s = shapeOf(bot);
  const dot = <span aria-hidden="true" style={{ flex: "none", width: size + "px", height: size + "px", background: bot?.color || "#C9CBD3", clipPath: s.clip, borderRadius: s.radius, animation: anim ? "breathe 2.4s ease-in-out infinite" : "none", ...(halo ? null : style) }} />;
  if (!halo) return dot;
  return <span aria-hidden="true" style={{ flex: "none", width: size + 10 + "px", height: size + 10 + "px", margin: "-5px", display: "grid", placeItems: "center", borderRadius: "50%", boxShadow: "inset 0 0 0 2px #FFC93C", ...style }}>{dot}</span>;
}

/** «Aprobar un envío», «Decidir»…: honey label, only for what needs you. */
export function NeedLabel({ children }) {
  return <span style={{ flex: "none", marginLeft: "auto", height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: "#FFF1C7", color: "#8A5A00", fontSize: "var(--t-caption)", fontWeight: "600" }}>{children}</span>;
}

/** The 10-second window of a send or decision, with «Deshacer». */
export function UndoBar({ id, text = "Se envía en", onUndo, tail = "" }) {
  const { secs } = useUndoable(id);
  return (
    <div role="status" style={{ flex: "1", display: "flex", alignItems: "center", gap: "14px", padding: "8px 8px 8px 18px", borderRadius: "14px", background: "#12131A", color: "#FFFFFF", fontSize: "var(--t-body)", animation: "fade .25s ease-out" }}>
      <span style={{ flex: "1" }}>{`${text} ${secs} s${tail}`}</span>
      <button type="button" onClick={onUndo} style={{ height: "34px", padding: "0 14px", border: "0", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", fontSize: "var(--t-ui)", fontWeight: "600", cursor: "pointer" }}>{"Deshacer"}</button>
    </div>
  );
}

export const btn = {
  dark: { height: "40px", padding: "0 18px", display: "inline-flex", alignItems: "center", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "var(--t-body)", fontWeight: "600", cursor: "pointer", textDecoration: "none" },
  line: { height: "40px", padding: "0 16px", display: "inline-flex", alignItems: "center", border: "0", borderRadius: "999px", background: "#FFFFFF", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.16)", color: "#12131A", fontSize: "var(--t-body)", fontWeight: "500", cursor: "pointer", textDecoration: "none" },
  text: { height: "40px", padding: "0 10px", border: "0", background: "transparent", fontSize: "var(--t-body)", fontWeight: "500", color: "#4A4D57", cursor: "pointer" },
};

export const sectionTitle = { margin: "0", font: "600 var(--t-heading)/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" };
export const srOnly = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };
