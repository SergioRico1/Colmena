import { useClickAway } from "../../lib/useClickAway.js";
import { TriangleAlert, X } from "../Icon.js";
import { BotPresence, PersonPresence } from "../v2/Presence.jsx";
import WorkingDots from "./Dots.jsx";
import { useRef } from "react";
import { dragOutProps } from "../../lib/dragOut.js";
import { avatarStyle, initial, faceOf } from "../../lib/bots.js";
import { navigate } from "../../lib/router.jsx";

/** « · Ver en Código» after a quiet line that points into the app (a task handed to Código). */
export function NoteLink({ link }) {
  if (!link || typeof link.href !== "string" || !link.href.startsWith("/codigo/")) return null;
  return (
    <>
      {" · "}
      <a href={link.href} className="rm-focus" onClick={(e) => { e.preventDefault(); navigate(link.href); }} style={{ fontWeight: "600", color: "var(--c-accent-ink)" }}>{link.label || "Abrir"}</a>
    </>
  );
}

// Shared pieces for Chat, Sala, En directo and Debate. Every style here is
// copied from design/Chat|Sala|EnVivo|Debate.dc.html.

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
    <span style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px 10px 10px", background: "var(--c-card)", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)" }}>
      <span aria-hidden="true" style={{ width: "32px", height: "38px", borderRadius: "var(--r-xs)", background: s.background, color: s.color, display: "grid", placeItems: "center", font: "700 var(--t-micro)/1 'Geist Mono', monospace" }}>{s.label}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
        <strong style={{ overflowWrap: "anywhere" }}>{file.name}</strong>
        <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{fileSize(file.size)}</span>
      </span>
      {onRemove ? (
        <button type="button" className="rm-focus" aria-label={`Quitar ${file.name}`} onClick={onRemove} style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "var(--r-sm)", cursor: "pointer", color: "var(--c-text-3)" }}>
          <X size={14} />
        </button>
      ) : null}
    </span>
  );
}

/** Attachment chip from the Sala mockup (room message). */
export function FileChip({ file, onRemove, dragUrl = null }) {
  const s = extStyle(file.name);
  return (
    <span {...dragOutProps(dragUrl)} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px 8px 8px", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)", background: "var(--c-card)" }}>
      <span aria-hidden="true" style={{ width: "28px", height: "28px", borderRadius: "var(--r-sm)", background: s.background, color: s.color, display: "grid", placeItems: "center", font: "700 var(--t-micro)/1 'Geist Mono', monospace" }}>{s.label}</span>
      {file.name}
      {onRemove ? (
        <button type="button" className="rm-focus" aria-label={`Quitar ${file.name}`} onClick={onRemove} style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "var(--r-sm)", cursor: "pointer", color: "var(--c-text-3)" }}>
          <X size={12} weight="bold" />
        </button>
      ) : null}
    </span>
  );
}

/** Closes on outside click / Escape. */
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  useClickAway(open, (target) => !ref.current || ref.current.contains(target), () => onClose());
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
  background: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-md)",
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
  borderRadius: "var(--r-sm)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "var(--t-ui)",
  width: "100%",
};

/** Inline error line (never an alert). */
export function ErrorLine({ children, style }) {
  if (!children) return null;
  return (
    <p role="alert" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: "var(--c-error)", ...style }}>
      <TriangleAlert size={14} weight="bold" />
      {children}
    </p>
  );
}

/**
 * «está pensando» dots. They used the «blink» keyframes of the v1 Sala sheet, which v2
 * screens no longer load (so they stood still): now the shared working dots (base.css).
 */
export function Dots() {
  return <WorkingDots style={{ color: "var(--c-text-3)" }} />;
}

/** Splits text and colours @Mentions like the thread mockup. */
export function MentionText({ text, bots }) {
  const names = new Set(bots.map((b) => b.name.toLowerCase()).concat(["tú", "tu"]));
  const parts = String(text || "").split(/(@[\p{L}\d_-]+)/u);
  return parts.map((part, i) =>
    part.startsWith("@") && names.has(part.slice(1).toLowerCase())
      ? <span key={i} style={{ color: "var(--c-accent-ink)", fontWeight: "600" }}>{part}</span>
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
