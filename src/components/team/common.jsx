import { useEffect, useRef, useState } from "react";
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
    <p role={tone === "error" ? "alert" : "status"} style={{ margin: 0, padding: "12px 16px", borderRadius: "16px", fontSize: "14px", lineHeight: "1.45", ...tones[tone], ...style }}>
      {children}
    </p>
  );
}

// The six identity shapes, as drawn by the shape picker of «Nuevo bot · Ajusta».
export const SHAPE_DEFS = [
  { id: "circle", label: "Círculo", radius: "50%", clip: "none" },
  { id: "square", label: "Cuadrado", radius: "22%", clip: "none" },
  { id: "hex", label: "Hexágono", radius: "0", clip: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" },
  { id: "diamond", label: "Rombo", radius: "0", clip: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" },
  { id: "arch", label: "Arco", radius: "50% 50% 18% 18%", clip: "none" },
  { id: "leaf", label: "Hoja", radius: "50% 12% 50% 12%", clip: "none" },
];
export const shapeDef = (id) => SHAPE_DEFS.find((s) => s.id === id) || SHAPE_DEFS[0];

export const COLOR_DEFS = [
  { id: "#0E7C86", label: "Verde azulado" },
  { id: "#C2410C", label: "Teja" },
  { id: "#4D5BD9", label: "Índigo" },
  { id: "#2B2D36", label: "Grafito" },
];

export const AUTONOMY = [
  { id: "sugiere", title: "Solo sugiere", short: "Solo sugiere", desc: "Prepara el trabajo y espera a que tú lo apruebes todo." },
  { id: "avisa", title: "Actúa y te avisa", short: "Actúa y avisa", desc: "Hace el trabajo dentro de la sala y te cuenta lo que ha hecho. Recomendado." },
  { id: "solo", title: "Actúa solo", short: "Actúa solo", desc: "Trabaja sin interrumpirte, salvo en las líneas rojas de abajo." },
];
export const autonomyShort = (id) => (AUTONOMY.find((a) => a.id === id) || AUTONOMY[1]).short;
// Colmena es solo de escritorio por ahora: todos los bots trabajan en este ordenador.
export const locationLabel = () => "En este ordenador";

export const TOOL_KEYS = ["hojas", "correo", "calendario", "carpeta", "chat", "erp"];
export const TOOL_LABEL = { correo: "Correo", calendario: "Calendario", carpeta: "Carpeta compartida", hojas: "Hojas de cálculo", chat: "Chat del equipo", erp: "ERP" };

export const ACCESS = [
  { id: "none", label: "Sin acceso" },
  { id: "lee", label: "Solo lee" },
  { id: "escribe", label: "Lee y escribe" },
  { id: "pide", label: "Pide escribir" },
];
const accessLabel = (v) => (ACCESS.find((a) => a.id === v) || ACCESS[0]).label;

/** Badge styles of the permission chips (mockups: Ajusta «Puede usar», Perfil «Herramientas»). */
export function accessStyle(value) {
  if (value === "escribe") return { background: "#E1F4EC", border: "0", fontWeight: "600" };
  if (value === "lee") return { background: "#F4F4F0", border: "0", fontWeight: "600" };
  if (value === "pide") return { background: "#FFF4D1", border: "0", fontWeight: "600" };
  return { background: "transparent", border: "0", boxShadow: "inset 0 0 0 1.5px rgba(18,19,26,.12)", fontWeight: "500" };
}

/** Permission dropdown: the badge from the mockup opens a small menu with the 4 levels. */
export function AccessPicker({ value = "none", onChange, label, chevron = true, size = "profile" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const base = size === "profile"
    ? { display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 10px", borderRadius: "999px", cursor: "pointer", fontSize: "13px" }
    : { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", padding: "6px 10px", borderRadius: "8px", cursor: "pointer" };
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${accessLabel(value)}. Cambiar acceso`} onClick={() => setOpen((o) => !o)} style={{ ...base, ...accessStyle(value) }}>
        {accessLabel(value)}
        {chevron ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg> : null}
      </button>
      {open ? (
        <span role="listbox" aria-label={`Acceso a ${label}`} style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 5, minWidth: "180px", padding: "6px", background: "#FFFFFF", border: "0", borderRadius: "18px", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35), 0 0 0 1px rgba(18,19,26,.06)", display: "flex", flexDirection: "column", gap: "2px" }}>
          {ACCESS.map((a) => (
            <button key={a.id} type="button" role="option" aria-selected={a.id === value} onClick={() => { onChange(a.id); setOpen(false); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", minHeight: "38px", padding: "0 10px", background: a.id === value ? "#F4F4F0" : "transparent", border: "0", borderRadius: "12px", cursor: "pointer", fontSize: "13px", fontWeight: a.id === value ? "600" : "400", textAlign: "left" }}>
              {a.label}
              {a.id === value ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** iOS-like switch exactly as drawn in «Equipo y canales». */
export function Switch({ on, label, onClick, disabled, title }) {
  return (
    <button type="button" role="switch" aria-checked={on ? "true" : "false"} aria-label={label} aria-disabled={disabled ? "true" : undefined} title={title} onClick={onClick}
      style={on
        ? { width: "52px", height: "32px", flex: "none", padding: "3px", background: "#0B8A5F", border: "0", borderRadius: "16px", cursor: disabled ? "default" : "pointer", display: "flex", justifyContent: "flex-end", opacity: disabled ? 0.75 : 1 }
        : { width: "52px", height: "32px", flex: "none", padding: "3px", background: "rgba(18,19,26,.14)", border: "0", borderRadius: "16px", cursor: "pointer", display: "flex", justifyContent: "flex-start" }}>
      <span style={on ? { width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)" } : { width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)" }} />
    </button>
  );
}

/** Small spinner used inside buttons while a request runs. */
export function Spinner({ size = 16 }) {
  return <span aria-hidden="true" style={{ width: size + "px", height: size + "px", flex: "none", border: "2.5px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", animation: "colmena-spin .8s linear infinite" }} />;
}

// «Nuevo bot» draft kept between steps (and handed over by the template gallery).
const KEY = "colmena:newbot";
export function readDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null") || {};
  } catch {
    return {};
  }
}
export function writeDraft(next) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    // Materials can exceed the quota: keep the rest without their content.
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ ...next, materials: (next.materials || []).map(({ name, size }) => ({ name, size })) }));
      return true;
    } catch {
      return false;
    }
  }
}
export function clearDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
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

export const skillName = (s) => (typeof s === "string" ? s : s?.name || "");

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const longDay = (v) => (v ? `${new Date(v).getDate()} de ${MONTHS[new Date(v).getMonth()]}` : "");
export const monthName = (v) => (v ? MONTHS[new Date(v).getMonth()] : "");
export const shortDay = (v) => (v ? new Date(v).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "");

/** Normalises text for accent-insensitive searching. */
export const fold = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
