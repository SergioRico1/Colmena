import SettingsLayout from "../v2/settings/Layout.jsx";
import { BotPresence } from "../v2/Presence.jsx";
import { PARENT } from "../v2/settings/sections.js";

// Colmena 2.0 chrome for every Ajustes detail page (/ajustes/ia, /ajustes/conexiones,
// /ajustes/ordenador…): the Ajustes frame with its section list (src/components/v2/settings/
// Layout.jsx), the section the page belongs to marked, «‹ <sección>» back to it, and the
// shared pieces below, all in the v2 language (white 26 px cards, pills, soft fills).

const INK = "#12131A";
const MUTED = "#5C606C";

/**
 * @param {{ section: string, gap?: string, extraCss?: string, wide?: boolean, children: any }} props
 */
export default function SettingsShell({ section, gap = "28px", extraCss = "", wide = false, children }) {
  const parent = PARENT[section] || "cuenta";
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
      <h2 style={{ margin: 0, font: "600 clamp(34px, 4.4vw, 44px)/1.02 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>{title}</h2>
      {children ? <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: MUTED }}>{children}</p> : null}
    </div>
  );
}

/** v2 switch: 52×32, green when on. */
export function Toggle({ on, onChange, label, disabled = false }) {
  return (
    <button type="button" role="switch" aria-checked={on ? "true" : "false"} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: "52px", height: "32px", flex: "none", padding: "3px", border: 0, borderRadius: "16px", cursor: disabled ? "default" : "pointer", transition: "background .25s ease", background: on ? "#0B8A5F" : "rgba(18,19,26,.14)", opacity: disabled ? 0.6 : 1 }}>
      <span style={{ display: "block", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(20px)" : "translateX(0)" }} />
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
    error: { background: "#FBEAE7", color: "#8F1D22" },
    info: { background: "#F6F6F3", color: INK },
    ok: { background: "#E1F4EC", color: "#0B5A3E" },
  };
  return (
    <p role={tone === "error" ? "alert" : "status"} style={{ margin: 0, padding: "12px 16px", borderRadius: "16px", fontSize: "14px", lineHeight: 1.45, ...tones[tone], ...style }}>{children}</p>
  );
}

/** White v2 card: radius 26, no border. */
export function Card({ id, title, aside, children, style, titleSize = 22 }) {
  return (
    <section aria-labelledby={id} style={{ background: "#FFFFFF", borderRadius: "26px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", ...style }}>
      {title ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <h2 id={id} style={{ margin: 0, font: `600 ${titleSize}px/1.1 'Bricolage Grotesque', sans-serif`, letterSpacing: "-0.02em" }}>{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const pillBase = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap" };
export const btn = {
  dark: { ...pillBase, background: INK, color: "#FFFFFF" },
  // Honey is only for «te necesitamos»; a main action elsewhere is ink.
  honey: { ...pillBase, height: "46px", padding: "0 22px", background: INK, color: "#FFFFFF" },
  outline: { ...pillBase, background: "rgba(18,19,26,.06)", color: INK },
  quiet: { ...pillBase, height: "36px", padding: "0 14px", background: "transparent", color: INK, boxShadow: "inset 0 0 0 1.5px rgba(18,19,26,.12)", fontSize: "13px" },
  dashed: { ...pillBase, background: "transparent", color: INK, boxShadow: "inset 0 0 0 1.5px rgba(18,19,26,.15)" },
};

export const field = {
  label: { display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px", fontWeight: 500, color: MUTED },
  input: { height: "48px", padding: "0 16px", background: "#F4F4F0", border: 0, borderRadius: "14px", fontSize: "15px", color: INK, outline: "none", minWidth: "0" },
  mono: { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
};

/** Visible focus for every control. */
export const formCss = "\ninput:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #12131A;outline-offset:1px}\nbutton:focus-visible,a:focus-visible{outline:2px solid #12131A;outline-offset:2px}\nbutton:not(:disabled){cursor:pointer}";

/** Segmented Lee / Escribe selector. */
export function AccessPills({ value, onChange, label = "Acceso" }) {
  const seg = (on) => ({ height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" });
  return (
    <span role="radiogroup" aria-label={label} style={{ display: "inline-flex", gap: "2px", padding: "3px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
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
            style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 14px 0 10px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, background: on ? INK : "rgba(18,19,26,.05)", color: on ? "#FFFFFF" : INK }}>
            <BotPresence bot={b} size={16} />
            {b.name}
          </button>
        );
      })}
    </div>
  );
}
