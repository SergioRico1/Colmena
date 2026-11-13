import { stepOf } from "../../../lib/type.js";
import { useClickAway } from "../../../lib/useClickAway.js";
import { useRef, useState } from "react";
import { Check, ChevronDown } from "../../Icon.js";
import { SHAPES } from "../Presence.jsx";

// Small pieces shared by the «Código» screen (design/V2Codigo.dc.html).

export const C = {
  ink: "#12131A", body: "#1E2029", text: "#3D404A", muted: "#5C606C", faint: "#6B6F7A", quiet: "#6B6F7A", rule: "rgba(18,19,26,.07)",
  paper: "#F5F5F2", soft: "#F4F4F0", white: "#FFFFFF", honey: "#FFC93C", honeyText: "#8A5A00", green: "#0B8A5F", greenText: "#0B6B4A",
  greenSoft: "#E1F4EC", red: "#B4232A", redSoft: "#FBE9EA", bruno: "#FF7A1A", blue: "#1F4FD1", text2: "#4A4D57", card: "#F6F6F3", track: "#F1F1EC",
};
export const MONO = "'Geist Mono', ui-monospace, monospace";
export const HEAD = "'Bricolage Grotesque', sans-serif";
export const CARD = "0 1px 2px rgba(18,19,26,.04)";
export const SHEET = "0 0 0 1px rgba(18,19,26,.06), 0 30px 60px -24px rgba(18,19,26,.45)";

export const MODEL_LABEL = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5" };
export const EFFORT_LABEL = { low: "Bajo", medium: "Medio", high: "Alto", xhigh: "Muy alto", max: "Máximo" };
export const ACCESS_INFO = {
  project: { label: "Su copia", title: "Su copia del proyecto", text: "Lee, edita, ejecuta e instala paquetes dentro del proyecto sin preguntarte." },
  ask: { label: "Pregunta", title: "Pregunta antes de cada cambio", text: "Te enseña cada edición y cada orden antes de hacerla." },
  full: { label: "Todo", title: "Todo el ordenador", text: "Sin límite de carpeta para editar. Solo para quien sabe lo que hace." },
};

/** Segmented control (the white pill on a soft track). */
export function Seg({ options, value, onChange, small = false, label }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "var(--r-pill)", background: C.soft }}>
      {options.map(([id, text]) => {
        const on = id === value;
        return (
          <button key={id} type="button" role="radio" aria-checked={on} onClick={() => onChange(id)}
            style={{ height: small ? "24px" : "28px", padding: small ? "0 10px" : "0 12px", border: 0, borderRadius: "var(--r-pill)", cursor: "pointer", whiteSpace: "nowrap", fontSize: small ? "var(--t-caption)" : "var(--t-meta)", fontWeight: 600, background: on ? C.white : "transparent", color: on ? C.ink : C.muted, boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none" }}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** A quiet chip that opens a menu above it (composer) or below it. */
export function MenuChip({ label, icon = null, title, children, up = true, width = 320, align = "left", chevron = true, className = "", keepLabel = false, look = null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(open, ref, () => setOpen(false));
  return (
    <div ref={ref} className={className} style={{ position: "relative", minWidth: 0 }}>
      <button type="button" title={title} aria-label={label ? undefined : title} aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: "6px", maxWidth: "100%", height: "34px", padding: label ? "0 10px" : "0", width: label ? undefined : "34px", justifyContent: "center", border: 0, borderRadius: "var(--r-pill)", background: open ? C.soft : "transparent", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 500, color: C.text, whiteSpace: "nowrap", ...look }}>
        {icon}{label ? <span className={icon && !keepLabel ? "code-chip-label code-chip-label--icon" : "code-chip-label"}>{label}</span> : null}{chevron ? <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none" }} /> : null}
      </button>
      {open ? (
        <div role="menu" style={{ position: "absolute", zIndex: 40, [up ? "bottom" : "top"]: "42px", [align]: 0, width: width + "px", maxHeight: "min(70vh, 560px)", overflowY: "auto", overscrollBehavior: "contain", padding: "8px", borderRadius: "var(--r-2xl)", background: C.white, boxShadow: SHEET, animation: "rise .2s ease-out" }}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** A row of a menu: title, optional note, a tick when chosen. */
export function MenuItem({ title, text, on = false, onClick, right = null }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} onClick={onClick} className="code-hover"
      style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", border: 0, borderRadius: "var(--r-lg)", background: on ? C.soft : "transparent", cursor: "pointer", textAlign: "left" }}>
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
        <strong style={{ fontSize: "var(--t-ui)", fontWeight: 600, color: C.ink }}>{title}</strong>
        {text ? <span style={{ fontSize: "var(--t-caption)", lineHeight: 1.45, color: C.muted }}>{text}</span> : null}
      </span>
      {right}
      {on ? <Check size={15} strokeWidth={2.6} color={C.ink} aria-hidden="true" /> : null}
    </button>
  );
}

/** «+12 −3» in the code font. */
export function Stat({ add, del, size = 12 }) {
  if (!add && !del) return null;
  return (
    <span className="code-stat" style={{ font: `500 ${stepOf(size)}px/1 ${MONO}`, whiteSpace: "nowrap" }}>
      {add ? <span style={{ color: C.greenText }}>+{add}</span> : null}{add && del ? " " : ""}{del ? <span style={{ color: C.red }}>−{del}</span> : null}
    </span>
  );
}

/**
 * A bot as Colmena 3 draws it (design/V3Sistema.dc.html): a flat shape in its colour, breathing
 * while it works, a honey ring when it waits for you. `bot` comes from the store (Bruno by default).
 */
export function BotShape({ bot = null, size = 16, state = "rest" }) {
  const color = bot?.color || C.bruno;
  const shape = SHAPES[bot?.shape] || (bot ? SHAPES.circle : SHAPES.arch);
  const mark = <span aria-hidden="true" style={{ flex: "none", display: "block", width: size + "px", height: size + "px", background: color, clipPath: shape.clip, borderRadius: shape.radius, animation: state === "work" ? "breathe 2.4s ease-in-out infinite" : "none" }} />;
  if (state !== "wait") return mark;
  const ring = Math.round(size * 1.6);
  return <span aria-hidden="true" style={{ flex: "none", width: ring + "px", height: ring + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", boxShadow: "inset 0 0 0 2px #FFC93C" }}>{mark}</span>;
}

/** The bot of a task, from the store (tasks say botId; Bruno codes). */
export const botOf = (bots, task) => (bots || []).find((b) => b.id === (task?.botId || "bruno")) || null;

/** A state in words (design/V3Sistema.dc.html «Estados en palabras»), from model.js pillOf. */
export function Pill({ pill, size = "sm" }) {
  return <span style={{ flex: "none", height: size === "sm" ? "24px" : "28px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: pill.bg, color: pill.ink, fontSize: size === "sm" ? "var(--t-caption)" : "var(--t-meta)", fontWeight: 600, whiteSpace: "nowrap" }}>{pill.text}</span>;
}

/** Buttons of Colmena 3: one ink action per screen, the others outlined, the rare ones quiet. */
export const BTN = {
  primary: { height: "40px", padding: "0 18px", display: "inline-flex", alignItems: "center", gap: "8px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  outline: { height: "40px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 400, cursor: "pointer", whiteSpace: "nowrap" },
  blocked: { height: "40px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px dashed rgb(var(--c-ink-rgb) / .2)", borderRadius: "var(--r-pill)", background: "transparent", color: "var(--c-text-3)", fontSize: "var(--t-ui)", cursor: "not-allowed", whiteSpace: "nowrap" },
  quiet: { height: "40px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "8px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", color: "var(--c-text-2)", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" },
};
/** The soft chips of the composers (project, engine): #F6F6F3 with a hairline. */
export const CHIP = { height: "34px", padding: "0 12px", gap: "8px", border: "1px solid rgb(var(--c-ink-rgb) / .1)", borderRadius: "var(--r-pill)", background: "var(--c-hover)", fontSize: "var(--t-ui)", fontWeight: 400, color: "var(--c-text)" };
export const SR = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };

export const CODE_CSS = `
.code-hover{transition:background .15s ease}
.code-hover:hover{background:rgba(18,19,26,.035)}
.code-turn .code-tools{opacity:0;transition:opacity .15s ease}
.code-turn:hover .code-tools,.code-turn:focus-within .code-tools{opacity:1}
.code-task .code-x{opacity:0}
.code-task:hover .code-x,.code-task:focus-within .code-x{opacity:1}
.code-task:hover .code-stat,.code-task:focus-within .code-stat,.code-task:hover .code-pill,.code-task:focus-within .code-pill{opacity:0}
.code-chip-label{overflow:hidden;text-overflow:ellipsis}
@media (max-width: 1100px){[data-codepanel]{display:none!important}.code-chat{flex:1 1 auto!important;width:auto!important;max-width:none!important;border-right:0!important}}
`;

export const timeAgo = (iso) => {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "ahora";
  if (s < 3600) return Math.floor(s / 60) + " min";
  const d = new Date(t), today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toTimeString().slice(0, 5);
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "ayer";
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
};
