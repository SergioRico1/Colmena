import { useClickAway } from "../../../lib/useClickAway.js";
import BotFace from "../../BotFace.jsx";
import { useRef, useState } from "react";
import { Ellipsis } from "../../Icon.js";
import { C } from "../../../lib/theme.js";

// Small pieces shared by Equipo, a bot's profile and «Nuevo bot» (design/V3Equipo,
// V3Bot and V3NuevoBot.dc.html, in the v4 density): the hairline section card, its title, the
// segmented control, the switch and the «Más» menu.

export const INK = C.text;
export const TEXT2 = C.text2;
export const TEXT3 = C.text3;
export const LINE = "1px solid var(--c-line)";
export const card = { display: "flex", flexDirection: "column", gap: "14px", padding: "18px 20px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", scrollMarginTop: "16px" };
export const h2 = { margin: "0", fontSize: "var(--t-lead)", fontWeight: 600, lineHeight: 1.25, color: "var(--c-text)" };
export const sub = { fontSize: "var(--t-meta)", color: "var(--c-text-3)" };
export const outline = { height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-raised)", color: "var(--c-text)", fontSize: "var(--t-meta)", fontWeight: 600, cursor: "pointer" };
export const dark = { height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid var(--c-btn)", borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-meta)", fontWeight: "600", cursor: "pointer" };
export const quiet = { height: "30px", padding: "0 10px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", fontSize: "var(--t-meta)", color: "var(--c-text-2)", cursor: "pointer" };

/** A bot as its pixel character (BotFace; a portrait it was given still fills its shape). */
export function Shape({ bot, size = 48, style = null, color = null, state = null }) {
  return <BotFace bot={color ? { ...bot, color } : bot} size={size} state={state} decorative style={style} />;
}

/** The pill segmented control of «Apps que usa» (No · Lee · Escribe). */
export function Seg({ label, items, value, onPick, disabled = false }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "inline-flex", flexWrap: "wrap", padding: "2px", gap: "2px", borderRadius: "var(--r-sm)", background: "var(--c-chip)" }}>
      {items.map(([id, text]) => {
        const on = id === value;
        return (
          <button key={String(id)} type="button" role="radio" aria-checked={on ? "true" : "false"} disabled={disabled} onClick={() => !on && onPick(id)}
            style={{ height: "28px", padding: "0 10px", border: "0", borderRadius: "var(--r-xs)", background: on ? "var(--c-selected)" : "transparent", boxShadow: on ? "var(--c-shadow-lift)" : "none", color: on ? "var(--c-text)" : "var(--c-text-2)", fontSize: "var(--t-meta)", fontWeight: on ? "600" : "500", cursor: disabled ? "default" : "pointer", transition: "background .2s ease" }}>
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
      style={{ width: "46px", height: "28px", flex: "none", padding: "3px", border: "0", borderRadius: "var(--r-pill)", boxSizing: "border-box", background: on ? C.ok : "rgb(var(--c-ink-rgb) / .14)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, transition: "background .25s ease" }}>
      <span style={{ display: "block", width: "22px", height: "22px", borderRadius: "var(--r-circle)", background: "var(--c-knob)", boxShadow: "var(--c-shadow-lift)", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(18px)" : "translateX(0)" }} />
    </button>
  );
}

/** «···»: what is used rarely. `round` draws it as a 36 px outlined button for a header. */
export function More({ label = "Más", items, round = false, light = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(open, ref, () => setOpen(false));
  const shown = items.filter(Boolean);
  const trigger = round
    ? { width: "36px", height: "36px", display: "grid", placeItems: "center", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: light ? "color-mix(in srgb, var(--c-raised) 70%, transparent)" : "var(--c-raised)" }
    : { width: "32px", height: "32px", display: "grid", placeItems: "center", border: "0", borderRadius: "var(--r-sm)", background: open ? "var(--c-chip)" : "transparent" };
  return (
    <span ref={ref} style={{ position: "relative", flex: "none", display: "inline-flex" }}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)} style={{ ...trigger, padding: "0", color: "var(--c-text-2)", cursor: "pointer" }}><Ellipsis size={18} weight="bold" /></button>
      {open ? (
        <span role="menu" style={{ position: "absolute", right: "0", top: round ? "42px" : "36px", zIndex: 20, minWidth: "220px", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-md)", background: "var(--c-raised)", border: "1px solid var(--c-line)", boxShadow: "var(--c-shadow-pop)", animation: "rise .18s ease-out" }}>
          {shown.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.run(); }}
              style={{ minHeight: "34px", padding: "0 10px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", textAlign: "left", fontSize: "var(--t-ui)", color: it.danger ? "var(--c-error)" : "var(--c-text)", cursor: it.disabled ? "default" : "pointer", opacity: it.disabled ? 0.5 : 1 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
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
