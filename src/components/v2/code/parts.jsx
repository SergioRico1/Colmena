import { stepOf } from "../../../lib/type.js";
import BotFace from "../../BotFace.jsx";
import { useClickAway } from "../../../lib/useClickAway.js";
import { useRef, useState } from "react";
import { menuKey, useFocusFirst } from "./menuKeys.js";
import { Check, ChevronDown } from "../../Icon.js";

// Small pieces shared by the «Código» screen (design/V2Codigo.dc.html).

export const C = {
  ink: "var(--c-text)", body: "var(--c-text)", text: "var(--c-text-2)", muted: "var(--c-text-3)", faint: "var(--c-text-3)", quiet: "var(--c-text-3)", rule: "rgb(var(--c-ink-rgb) / .07)",
  paper: "var(--c-sunken)", soft: "var(--c-sunken)", white: "var(--c-card)", honey: "var(--c-honey)", honeyText: "var(--c-honey-text)", green: "var(--c-ok)", greenText: "var(--c-ok-ink)",
  greenSoft: "var(--c-ok-soft)", red: "var(--c-error)", redSoft: "var(--c-error-soft)", bruno: "var(--c-accent)", blue: "var(--c-accent-ink)", text2: "var(--c-text-2)", card: "var(--c-hover)", track: "var(--c-chip)",
};
export const MONO = "'Geist Mono', ui-monospace, monospace";
export const HEAD = "'Bricolage Grotesque', sans-serif";
export const CARD = "0 0 0 1px var(--c-line)";
export const SHEET = "0 0 0 1px var(--c-line), var(--c-shadow-pop)";

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
            style={{ height: small ? "24px" : "28px", padding: small ? "0 10px" : "0 12px", border: 0, borderRadius: "var(--r-pill)", cursor: "pointer", whiteSpace: "nowrap", fontSize: small ? "var(--t-caption)" : "var(--t-meta)", fontWeight: 600, background: on ? C.white : "transparent", color: on ? C.ink : C.muted, boxShadow: on ? "var(--c-shadow-lift)" : "none" }}>
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
  const pop = useRef(null);
  const btn = useRef(null);
  useClickAway(open, ref, () => setOpen(false));
  useFocusFirst(pop, open);
  const close = (back = false) => { setOpen(false); if (back) btn.current?.focus(); };
  return (
    <div ref={ref} className={className} style={{ position: "relative", minWidth: 0 }}>
      <button ref={btn} type="button" title={title} aria-label={label ? undefined : title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: "6px", maxWidth: "100%", height: "32px", padding: label ? "0 10px" : "0", width: label ? undefined : "34px", justifyContent: "center", border: 0, borderRadius: "var(--r-sm)", background: open ? C.soft : "transparent", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 500, color: C.text, whiteSpace: "nowrap", ...look }}>
        {icon}{label ? <span className={icon && !keepLabel ? "code-chip-label code-chip-label--icon" : "code-chip-label"}>{label}</span> : null}{chevron ? <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none" }} /> : null}
      </button>
      {open ? (
        <div ref={pop} role="menu" aria-label={title} onKeyDown={(e) => menuKey(e, close)} style={{ position: "absolute", zIndex: 40, [up ? "bottom" : "top"]: "42px", [align]: 0, width: width + "px", maxHeight: "min(70vh, 560px)", overflowY: "auto", overscrollBehavior: "contain", padding: "8px", borderRadius: "var(--r-2xl)", background: C.white, boxShadow: SHEET, animation: "rise .2s ease-out" }}>
          {children(() => close(true))}
        </div>
      ) : null}
    </div>
  );
}

/** A row of a menu: title, optional note, a tick when chosen. */
export function MenuItem({ title, text, on = false, onClick, right = null, icon = null }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} onClick={onClick} className="code-hover" data-label={typeof title === "string" ? title : undefined}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", border: 0, borderRadius: "var(--r-lg)", background: on ? C.soft : "transparent", cursor: "pointer", textAlign: "left" }}>
      {icon ? <span aria-hidden="true" style={{ flex: "none", display: "inline-flex", color: C.text, alignSelf: "flex-start", marginTop: "1px" }}>{icon}</span> : null}
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
  const mark = <BotFace bot={bot || { id: "bruno", shape: "arch", color: C.bruno, role: "Código" }} size={size} state={state} decorative />;
  if (state !== "wait") return mark;
  const ring = Math.round(size * 1.6);
  return <span aria-hidden="true" style={{ flex: "none", width: ring + "px", height: ring + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", boxShadow: "inset 0 0 0 2px var(--c-honey-ring)" }}>{mark}</span>;
}

/** The bot of a task, from the store (tasks say botId; Bruno codes). */
export const botOf = (bots, task) => (bots || []).find((b) => b.id === (task?.botId || "bruno")) || null;

/** A state in words (design/V3Sistema.dc.html «Estados en palabras»), from model.js pillOf. */
export function Pill({ pill, size = "sm" }) {
  return <span style={{ flex: "none", height: size === "sm" ? "24px" : "28px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: pill.bg, color: pill.ink, fontSize: size === "sm" ? "var(--t-caption)" : "var(--t-meta)", fontWeight: 600, whiteSpace: "nowrap" }}>{pill.text}</span>;
}

/** Buttons (v4 density): one ink action per screen, the others outlined, the rare ones quiet. */
export const BTN = {
  primary: { height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: 0, borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  outline: { height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-raised)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 400, cursor: "pointer", whiteSpace: "nowrap" },
  blocked: { height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px dashed rgb(var(--c-ink-rgb) / .2)", borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text-3)", fontSize: "var(--t-ui)", cursor: "not-allowed", whiteSpace: "nowrap" },
  quiet: { height: "36px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "8px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text-2)", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" },
};
/** The soft chips of the composers (project, engine): var(--c-hover) with a hairline. */
export const CHIP = { height: "32px", padding: "0 10px", gap: "8px", border: "1px solid var(--c-line)", borderRadius: "var(--r-sm)", background: "var(--c-sunken)", fontSize: "var(--t-meta)", fontWeight: 400, color: "var(--c-text)" };
export const SR = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };

export const CODE_CSS = `
.code-hover{transition:background .15s ease}
.code-hover:hover{background:rgb(var(--c-ink-rgb) / .035)}
.code-turn .code-tools{opacity:0;transition:opacity .15s ease}
.code-turn:hover .code-tools,.code-turn:focus-within .code-tools{opacity:1}
.code-task .code-x{opacity:0}
.code-task:hover .code-x,.code-task:focus-within .code-x{opacity:1}
.code-task:hover .code-pill,.code-task:focus-within .code-pill{opacity:0}
.code-rows>*:first-child{border-top:0!important}
.code-danger:hover{background:var(--c-error-soft)!important}
.code-pulse{animation:colmena-pulse 1.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.code-pulse{animation:none}}
@media (max-width: 1280px){.code-engine-name{display:none}}
.code-hunk-on{box-shadow:inset 2px 0 0 var(--c-focus)}
.code-flash{animation:c-reveal 1.6s ease-out}
.code-chat>.c-panel-resize::before{content:"";position:absolute;top:0;bottom:0;left:-7px;width:24px}
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
