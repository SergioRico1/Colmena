import { useClickAway } from "../../../lib/useClickAway.js";
import { useRef, useState } from "react";
import { shapeOf } from "../../v2/Presence.jsx";
import { portraitOf } from "../../../lib/bots.js";

// Small pieces shared by Equipo, a bot's profile and «Nuevo bot» (design/V3Equipo,
// V3Bot and V3NuevoBot.dc.html): the white section card, its title, the pill segmented
// control, the switch and the round «Más» menu.

export const INK = "#12131A";
export const TEXT2 = "#4A4D57";
export const TEXT3 = "#5C606C";
export const LINE = "1px solid rgba(18,19,26,.06)";
export const card = { display: "flex", flexDirection: "column", gap: "16px", padding: "24px 26px", borderRadius: "var(--r-2xl)", background: "#FFFFFF", scrollMarginTop: "16px" };
export const h2 = { margin: "0", font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" };
export const sub = { fontSize: "var(--t-ui)", color: TEXT3 };
export const outline = { height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-pill)", background: "#FFFFFF", color: INK, fontSize: "var(--t-ui)", cursor: "pointer" };
export const dark = { height: "38px", padding: "0 16px", display: "inline-flex", alignItems: "center", gap: "6px", border: "0", borderRadius: "var(--r-pill)", background: INK, color: "#FFFFFF", fontSize: "var(--t-ui)", fontWeight: "600", cursor: "pointer" };
export const quiet = { height: "30px", padding: "0 10px", border: "0", background: "transparent", fontSize: "var(--t-meta)", color: TEXT2, cursor: "pointer" };

/** A bot's flat shape as the V3 boards draw it (a portrait fills the shape when it has one). */
export function Shape({ bot, size = 48, style = null, color = null }) {
  const sh = shapeOf(bot);
  const c = color || bot?.color || "#C9CBD1";
  const portrait = portraitOf(bot);
  return <span aria-hidden="true" style={{ flex: "none", display: "block", width: size + "px", height: size + "px", background: portrait ? `${c} url("${portrait}") center / cover no-repeat` : c, clipPath: sh.clip, borderRadius: sh.radius, ...style }} />;
}

/** The pill segmented control of «Apps que usa» (No · Lee · Escribe). */
export function Seg({ label, items, value, onPick, disabled = false }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "inline-flex", flexWrap: "wrap", padding: "3px", gap: "2px", borderRadius: "var(--r-pill)", background: "#F1F1EC" }}>
      {items.map(([id, text]) => {
        const on = id === value;
        return (
          <button key={String(id)} type="button" role="radio" aria-checked={on ? "true" : "false"} disabled={disabled} onClick={() => !on && onPick(id)}
            style={{ height: "30px", padding: "0 12px", border: "0", borderRadius: "var(--r-pill)", background: on ? INK : "transparent", color: on ? "#FFFFFF" : "#3D404A", fontSize: "var(--t-meta)", fontWeight: "500", cursor: disabled ? "default" : "pointer", transition: "background .2s ease" }}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** A switch (green when on). */
export function Toggle({ on, label, onClick, disabled = false, title = null }) {
  return (
    <button type="button" role="switch" aria-checked={on ? "true" : "false"} aria-label={label} title={title || undefined} disabled={disabled} onClick={onClick}
      style={{ width: "46px", height: "28px", flex: "none", padding: "3px", border: "0", borderRadius: "var(--r-pill)", boxSizing: "border-box", background: on ? "#0B8A5F" : "rgba(18,19,26,.14)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, transition: "background .25s ease" }}>
      <span style={{ display: "block", width: "22px", height: "22px", borderRadius: "var(--r-circle)", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(18px)" : "translateX(0)" }} />
    </button>
  );
}

/** «···»: what is used rarely. `round` draws it as a 44 px pill button for a header. */
export function More({ label = "Más", items, round = false, light = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(open, ref, () => setOpen(false));
  const shown = items.filter(Boolean);
  const trigger = round
    ? { width: "44px", height: "44px", border: "1px solid rgba(18,19,26,.18)", borderRadius: "var(--r-pill)", background: light ? "rgba(255,255,255,.6)" : "#FFFFFF", fontSize: "var(--t-body)" }
    : { width: "32px", height: "32px", border: "0", borderRadius: "var(--r-sm)", background: open ? "#F1F1EC" : "transparent", fontSize: "var(--t-ui)" };
  return (
    <span ref={ref} style={{ position: "relative", flex: "none", display: "inline-flex" }}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)} style={{ ...trigger, padding: "0", color: TEXT2, cursor: "pointer" }}>{"···"}</button>
      {open ? (
        <span role="menu" style={{ position: "absolute", right: "0", top: round ? "50px" : "36px", zIndex: 20, minWidth: "220px", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-lg)", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.06), 0 18px 40px -16px rgba(18,19,26,.35)", animation: "rise .18s ease-out" }}>
          {shown.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.run(); }}
              style={{ minHeight: "38px", padding: "0 12px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", textAlign: "left", fontSize: "var(--t-ui)", color: it.danger ? "#B4232A" : INK, cursor: it.disabled ? "default" : "pointer", opacity: it.disabled ? 0.5 : 1 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#F6F6F3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
              {it.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** The autonomy levels in the V3 boards' words. */
export const AUTONOMY = [
  ["sugiere", "Solo sugiere", "Te propone cada paso y espera tu OK."],
  ["avisa", "Hace y te avisa", "Trabaja dentro de Colmena y te cuenta lo que hizo."],
  ["solo", "Hace solo", "Solo te molesta para las líneas rojas."],
];
export const autonomyLabel = (id) => (AUTONOMY.find((a) => a[0] === id) || AUTONOMY[1])[1];
export const autonomyHint = (id) => (AUTONOMY.find((a) => a[0] === id) || AUTONOMY[1])[2];
/** The usual level («Hace y te avisa») goes without saying on a bot's card; the others are said. */
export const DEFAULT_AUTONOMY = "avisa";
export const autonomyShown = (id) => (id || DEFAULT_AUTONOMY) !== DEFAULT_AUTONOMY;
