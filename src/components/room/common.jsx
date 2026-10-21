import { BotPresence, PersonPresence } from "../v2/Presence.jsx";
import WorkingDots from "./Dots.jsx";
import { useEffect, useRef } from "react";
import { avatarStyle, initial, faceOf } from "../../lib/bots.js";

// Shared pieces for Chat, Sala, En directo and Debate. Every style here is
// copied from design/Chat|Sala|EnVivo|Debate.dc.html.

export const roomCss = `
.rm-item:hover{background:#F7F8FA}
.rm-item:focus-visible,.rm-focus:focus-visible{outline:2px solid #2F6BFF;outline-offset:2px}
.rm-md>*:first-child{margin-top:0}
.rm-md a{color:#1F4FD1;font-weight:600}
.rm-md a:hover{text-decoration:underline}
@keyframes rm-blink{50%{opacity:0}}
@keyframes rm-dots{0%,80%,100%{opacity:.25}40%{opacity:1}}
@keyframes rm-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

const FONT = { 20: 11, 22: 11, 24: 11, 26: 12, 28: 13, 30: 13, 32: 14, 40: 17, 56: 24 };
const DIAMOND_FONT = { 20: 9, 22: 9, 24: 10, 26: 10, 28: 11, 30: 12, 32: 12, 40: 15, 56: 20 };

export function botFont(bot, size) {
  const table = bot?.shape === "diamond" ? DIAMOND_FONT : FONT;
  return table[size] || Math.round(size * (bot?.shape === "diamond" ? 0.38 : 0.43));
}

/** Bot avatar — Colmena 2.0: a presence (shape + colour + gloss, no letters). */
export function BotAvatar({ bot, size = 28, style, ring = false, mood = null, state = "rest" }) {
  return <BotPresence bot={bot} size={size} state={state} style={style} />;
}

/** «TÚ» — Colmena 2.0: people are neutral circles; you, in ink. */
export function UserAvatar({ size = 40 }) {
  return <PersonPresence me size={size} />;
}

export function findBot(bots, id) {
  return bots.find((b) => b.id === id) || (id ? { id, name: id.charAt(0).toUpperCase() + id.slice(1), shape: "circle", color: "#C9CCD6" } : null);
}

export const KIND_LABEL = { document: "Documento", table: "Tabla", slides: "Diapositivas", design: "Diseño", code: "Código", sheet: "Hoja" };

export function fileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

const EXT_STYLE = {
  pdf: { background: "#FDE7E7", color: "#A3201B", label: "PDF" },
  xls: { background: "#E1F4EC", color: "#0B6B4A", label: "XLS" },
  xlsx: { background: "#E1F4EC", color: "#0B6B4A", label: "XLS" },
  csv: { background: "#E1F4EC", color: "#0B6B4A", label: "CSV" },
  doc: { background: "#E7EEFF", color: "#1F4FD1", label: "DOC" },
  docx: { background: "#E7EEFF", color: "#1F4FD1", label: "DOC" },
  md: { background: "#E7EEFF", color: "#1F4FD1", label: "MD" },
  txt: { background: "#E7EEFF", color: "#1F4FD1", label: "TXT" },
};
export function extStyle(name) {
  const ext = (String(name || "").split(".").pop() || "").toLowerCase();
  return EXT_STYLE[ext] || { background: "#EEF0F4", color: "#4A4F5C", label: (ext || "ARCH").slice(0, 4).toUpperCase() };
}

/** Attachment card from the Chat mockup (user bubble). */
export function FileCard({ file, onRemove }) {
  const s = extStyle(file.name);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px 10px 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", fontSize: "14px" }}>
      <span aria-hidden="true" style={{ width: "32px", height: "38px", borderRadius: "5px", background: s.background, color: s.color, display: "grid", placeItems: "center", font: "700 10px/1 'Geist Mono', monospace" }}>{s.label}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
        <strong style={{ overflowWrap: "anywhere" }}>{file.name}</strong>
        <span style={{ fontSize: "12px", color: "#555A68" }}>{fileSize(file.size)}</span>
      </span>
      {onRemove ? (
        <button type="button" className="rm-focus" aria-label={`Quitar ${file.name}`} onClick={onRemove} style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "#555A68" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      ) : null}
    </span>
  );
}

/** Attachment chip from the Sala mockup (room message). */
export function FileChip({ file, onRemove }) {
  const s = extStyle(file.name);
  return (
    <span style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px 8px 8px", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px", background: "#FFFFFF" }}>
      <span aria-hidden="true" style={{ width: "28px", height: "28px", borderRadius: "6px", background: s.background, color: s.color, display: "grid", placeItems: "center", font: "700 9px/1 'Geist Mono', monospace" }}>{s.label}</span>
      {file.name}
      {onRemove ? (
        <button type="button" className="rm-focus" aria-label={`Quitar ${file.name}`} onClick={onRemove} style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "6px", cursor: "pointer", color: "#555A68" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      ) : null}
    </span>
  );
}

/** Closes on outside click / Escape. */
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const key = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  return ref;
}

export const popoverStyle = {
  animation: "c-pop-in 120ms cubic-bezier(.2,.8,.2,1) both",
  position: "absolute",
  zIndex: 30,
  minWidth: "260px",
  maxWidth: "min(360px, calc(100vw - 32px))",
  maxHeight: "360px",
  overflowY: "auto",
  padding: "6px",
  background: "#FFFFFF",
  border: "1px solid #DCE0E8",
  borderRadius: "12px",
  boxShadow: "0 14px 34px rgba(18,19,26,.16)",
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

export const popoverItem = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  minHeight: "44px",
  padding: "6px 10px",
  background: "transparent",
  border: "0",
  borderRadius: "8px",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "14px",
  width: "100%",
};

/** Inline error line (never an alert). */
export function ErrorLine({ children, style }) {
  if (!children) return null;
  return (
    <p role="alert" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#B4372A", ...style }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17v.5" /></svg>
      {children}
    </p>
  );
}

/** Designed loading / error / empty state for a whole room. */
export function StateCard({ title, text, href, cta, tone = "neutral" }) {
  const alert = tone === "error";
  return (
    <div style={{ flex: "1", display: "grid", placeItems: "center", padding: "48px clamp(16px, 3vw, 32px)" }}>
      <div role={alert ? "alert" : "status"} style={{ width: "min(100%, 520px)", background: "#FFFFFF", border: alert ? "2px solid #12131A" : "1px solid #DCE0E8", boxShadow: alert ? "6px 6px 0 #FFC93C" : "none", borderRadius: "16px", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <strong style={{ font: "700 20px/1.2 'Bricolage Grotesque', sans-serif" }}>{title}</strong>
        {text ? <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#2B2D36" }}>{text}</p> : null}
        {href ? (
          <a href={href} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", height: "40px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", borderRadius: "10px", fontSize: "14px", fontWeight: "600" }}>{cta}</a>
        ) : null}
      </div>
    </div>
  );
}

/**
 * «está pensando» dots. They used the «blink» keyframes of the v1 Sala sheet, which v2
 * screens no longer load (so they stood still): now the shared working dots (base.css).
 */
export function Dots() {
  return <WorkingDots style={{ color: "#5C606C" }} />;
}

/** Splits text and colours @Mentions like the thread mockup. */
export function MentionText({ text, bots }) {
  const names = new Set(bots.map((b) => b.name.toLowerCase()).concat(["tú", "tu"]));
  const parts = String(text || "").split(/(@[\p{L}\d_-]+)/u);
  return parts.map((part, i) =>
    part.startsWith("@") && names.has(part.slice(1).toLowerCase())
      ? <span key={i} style={{ color: "#1F4FD1", fontWeight: "600" }}>{part}</span>
      : part,
  );
}

export function dayLabel(value) {
  if (!value) return "";
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text || "");
  const area = document.createElement("textarea");
  area.value = text || "";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
  return Promise.resolve();
}

export function seconds(s) {
  if (!s && s !== 0) return "";
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(Math.round(s / 360) / 10).toLocaleString("es-ES")} h`;
  const d = Math.round(s / 8640) / 10;
  return `${d.toLocaleString("es-ES")} ${d === 1 ? "día" : "días"}`;
}
