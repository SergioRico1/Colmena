import { stepOf } from "../../lib/type.js";
import SettingsLayout from "../v2/settings/Layout.jsx";
import { BotPresence } from "../v2/Presence.jsx";
import { ALIAS, PARENT, SECTION_OF } from "../v2/settings/sections.js";
import { C } from "../../lib/theme.js";

// Colmena 2.0 chrome for every Ajustes detail page (/ajustes/ia, /ajustes/conexiones,
// /ajustes/ordenador…): the Ajustes frame with its section list (src/components/v2/settings/
// Layout.jsx), the section the page belongs to marked, «‹ <sección>» back to it, and the
// shared pieces below, all in the v2 language (white 26 px cards, pills, soft fills).

const INK = C.text;

/**
 * @param {{ section: string, gap?: string, extraCss?: string, wide?: boolean, children: any }} props
 */
export default function SettingsShell({ section, gap = "28px", extraCss = "", wide = false, children }) {
  const parent = PARENT[section] || ALIAS[section] || (SECTION_OF[section] ? section : "general");
  return (
    <SettingsLayout active={parent} back={parent} title="" lead="" wide={wide} extraCss={formCss + extraCss}>
      <div data-section={section} style={{ display: "flex", flexDirection: "column", gap, marginTop: "-14px" }}>{children}</div>
    </SettingsLayout>
  );
}


/** Page title block: the Bricolage 600 headline of a detail page and its 16 px lead. */
export function PageHeader({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "720px" }}>
      <h2 style={{ margin: 0, font: "600 clamp(var(--t-display-s), 4.4vw, var(--t-display-m))/1.02 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>{title}</h2>
      {children ? <p style={{ margin: 0, fontSize: "var(--t-read)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{children}</p> : null}
    </div>
  );
}

/** v2 switch: 52×32, green when on. */
export function Toggle({ on, onChange, label, disabled = false }) {
  return (
    <button type="button" role="switch" aria-checked={on ? "true" : "false"} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: "52px", height: "32px", flex: "none", padding: "3px", border: 0, borderRadius: "var(--r-pill)", cursor: disabled ? "default" : "pointer", transition: "background .25s ease", background: on ? C.ok : "rgb(var(--c-ink-rgb) / .14)", opacity: disabled ? 0.6 : 1 }}>
      <span style={{ display: "block", width: "26px", height: "26px", borderRadius: "var(--r-circle)", background: "var(--c-knob)", boxShadow: "var(--c-shadow-lift)", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(20px)" : "translateX(0)" }} />
    </button>
  );
}

/** A bot as a v2 presence (shape and colour, never a letter). */
export function BotAvatar({ bot, size = 22 }) {
  return <BotPresence bot={bot} size={size} />;
}

/** Inline feedback line (error, info or ok). */
export function Notice({ tone = "error", children, style }) {
  if (!children) return null;
  const tones = {
    error: { background: "var(--c-error-soft)", color: "var(--c-error)" },
    info: { background: "var(--c-hover)", color: "var(--c-text)" },
    ok: { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" },
  };
  return (
    <p role={tone === "error" ? "alert" : "status"} style={{ margin: 0, padding: "12px 16px", borderRadius: "var(--r-lg)", fontSize: "var(--t-ui)", lineHeight: 1.45, ...tones[tone], ...style }}>{children}</p>
  );
}

/** White v2 card: radius 26, no border. */
export function Card({ id, title, aside, children, style, titleSize = 22 }) {
  return (
    <section aria-labelledby={id} style={{ background: "var(--c-card)", border: "1px solid var(--c-line)", borderRadius: "var(--r-lg)", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", ...style }}>
      {title ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <h2 id={id} style={{ margin: 0, font: `600 ${stepOf(titleSize)}px/1.1 'Bricolage Grotesque', sans-serif`, letterSpacing: "-0.02em" }}>{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const pillBase = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "36px", padding: "0 14px", border: 0, borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, whiteSpace: "nowrap" };
export const btn = {
  dark: { ...pillBase, background: "var(--c-btn)", color: "var(--c-btn-text)" },
  // Honey is only for «te necesitamos»; a main action elsewhere is ink.
  honey: { ...pillBase, height: "46px", padding: "0 22px", background: "var(--c-btn)", color: "var(--c-btn-text)" },
  outline: { ...pillBase, background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)" },
  quiet: { ...pillBase, height: "36px", padding: "0 14px", background: "transparent", color: "var(--c-text)", boxShadow: "inset 0 0 0 1.5px rgb(var(--c-ink-rgb) / .12)", fontSize: "var(--t-meta)" },
  dashed: { ...pillBase, background: "transparent", color: "var(--c-text)", boxShadow: "inset 0 0 0 1.5px rgb(var(--c-ink-rgb) / .15)" },
};

export const field = {
  label: { display: "flex", flexDirection: "column", gap: "8px", fontSize: "var(--t-meta)", fontWeight: 500, color: "var(--c-text-3)" },
  input: { height: "48px", padding: "0 16px", background: "var(--c-sunken)", border: 0, borderRadius: "var(--r-lg)", fontSize: "var(--t-body)", color: "var(--c-text)", minWidth: "0" },
  mono: { fontFamily: "'Geist Mono', monospace", fontSize: "var(--t-meta)" },
};

/** Visible focus for every control. */
export const formCss = "\ninput:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--c-text);outline-offset:1px}\nbutton:focus-visible,a:focus-visible{outline:2px solid var(--c-text);outline-offset:2px}\nbutton:not(:disabled){cursor:pointer}";

/** Segmented Lee / Escribe selector. */
export function AccessPills({ value, onChange, label = "Acceso" }) {
  const seg = (on) => ({ height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)", background: on ? "var(--c-card)" : "transparent", boxShadow: on ? "0 1px 3px rgb(var(--c-ink-rgb) / .15)" : "none" });
  return (
    <span role="radiogroup" aria-label={label} style={{ display: "inline-flex", gap: "2px", padding: "3px", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .05)" }}>
      <button type="button" role="radio" aria-checked={value === "lee"} onClick={() => onChange("lee")} style={seg(value === "lee")}>Solo leer</button>
      <button type="button" role="radio" aria-checked={value === "escribe"} onClick={() => onChange("escribe")} style={seg(value === "escribe")}>Leer y escribir</button>
    </span>
  );
}

/** Toggleable bot pills (who has access). */
export function BotChips({ bots, selected, onToggle, label = "Bots con acceso" }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {bots.map((b) => {
        const on = selected.includes(b.id);
        return (
          <button key={b.id} type="button" aria-pressed={on} onClick={() => onToggle(b.id)}
            style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "32px", padding: "0 14px 0 10px", border: 0, borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, background: on ? "var(--c-btn)" : "rgb(var(--c-ink-rgb) / .05)", color: on ? "var(--c-btn-text)" : INK }}>
            <BotPresence bot={b} size={16} />
            {b.name}
          </button>
        );
      })}
    </div>
  );
}
