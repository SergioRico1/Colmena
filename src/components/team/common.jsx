import { BotPresence } from "../v2/Presence.jsx";

// Shared pieces for the team screens (Equipo, Nuevo bot, Perfil del bot).

/** A bot as a v2 presence: shape and colour, never a letter. */
export function BotAvatar({ bot, size = 24, style }) {
  return <BotPresence bot={bot} size={size} style={style} />;
}

/** Error / info line in the mockups' language. */
export function Notice({ children, tone = "error", style }) {
  if (!children) return null;
  const tones = {
    error: { background: "#FBEAE7", color: "#8F1D22" },
    info: { background: "#F6F6F3", color: "#12131A" },
    ok: { background: "#E1F4EC", color: "#0B5A3E" },
  };
  return (
    <p role={tone === "error" ? "alert" : "status"} style={{ margin: 0, padding: "12px 16px", borderRadius: "var(--r-lg)", fontSize: "var(--t-ui)", lineHeight: "1.45", ...tones[tone], ...style }}>
      {children}
    </p>
  );
}

export const TOOL_KEYS = ["hojas", "correo", "calendario", "carpeta", "chat", "erp"];
export const TOOL_LABEL = { correo: "Correo", calendario: "Calendario", carpeta: "Carpeta compartida", hojas: "Hojas de cálculo", chat: "Chat del equipo", erp: "ERP" };

/** iOS-like switch exactly as drawn in «Equipo y canales». */
export function Switch({ on, label, onClick, disabled, title }) {
  return (
    <button type="button" role="switch" aria-checked={on ? "true" : "false"} aria-label={label} aria-disabled={disabled ? "true" : undefined} title={title} onClick={onClick}
      style={on
        ? { width: "52px", height: "32px", flex: "none", padding: "3px", background: "#0B8A5F", border: "0", borderRadius: "var(--r-pill)", cursor: disabled ? "default" : "pointer", display: "flex", justifyContent: "flex-end", opacity: disabled ? 0.75 : 1 }
        : { width: "52px", height: "32px", flex: "none", padding: "3px", background: "rgba(18,19,26,.14)", border: "0", borderRadius: "var(--r-pill)", cursor: "pointer", display: "flex", justifyContent: "flex-start" }}>
      <span style={on ? { width: "26px", height: "26px", borderRadius: "var(--r-circle)", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)" } : { width: "26px", height: "26px", borderRadius: "var(--r-circle)", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)" }} />
    </button>
  );
}

/** Small spinner used inside buttons while a request runs. */
export function Spinner({ size = 16 }) {
  return <span aria-hidden="true" style={{ width: size + "px", height: size + "px", flex: "none", border: "2.5px solid currentColor", borderRightColor: "transparent", borderRadius: "var(--r-circle)", animation: "colmena-spin .8s linear infinite" }} />;
}

/** Minimal SKILL.md for a skill proposed while hiring (imported as pending, reviewed later). */
export function skillMarkdown(skill, bot) {
  const name = typeof skill === "string" ? skill : skill.name;
  const description = (typeof skill === "string" ? "" : skill.description) || `${name}, propuesta al contratar a ${bot.name}.`;
  const steps = typeof skill === "string" ? [] : skill.steps || [];
  const body = steps.length ? steps.map((s, i) => `${i + 1}. ${typeof s === "string" ? s : s.text || s.title || ""}`).join("\n") : `1. ${description}`;
  const esc = (s) => String(s).replace(/"/g, "'");
  return `---\nname: "${esc(name)}"\ndescription: "${esc(description)}"\n---\n\n# ${name}\n\n${body}\n`;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const longDay = (v) => (v ? `${new Date(v).getDate()} de ${MONTHS[new Date(v).getMonth()]}` : "");
export const monthName = (v) => (v ? MONTHS[new Date(v).getMonth()] : "");
export const shortDay = (v) => (v ? new Date(v).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "");
