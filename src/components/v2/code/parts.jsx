import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

// Small pieces shared by the «Código» screen (design/V2Codigo.dc.html).

export const C = {
  ink: "#12131A", body: "#1E2029", text: "#3D404A", muted: "#5C606C", faint: "#6B6F7A", quiet: "#8A8D96", rule: "rgba(18,19,26,.07)",
  paper: "#F5F5F2", soft: "#F4F4F0", white: "#FFFFFF", honey: "#FFC93C", honeyText: "#8A5A00", green: "#0B8A5F", greenText: "#0B6B4A",
  greenSoft: "#E1F4EC", red: "#A33A2C", bruno: "#FF7A1A", blue: "#1F4FD1",
};
export const MONO = "'Geist Mono', ui-monospace, monospace";
export const HEAD = "'Bricolage Grotesque', sans-serif";
export const CARD = "0 1px 2px rgba(18,19,26,.04)";
export const SHEET = "0 0 0 1px rgba(18,19,26,.06), 0 30px 60px -24px rgba(18,19,26,.45)";
export const FRAME = "0 1px 2px rgba(18,19,26,.05), 0 30px 70px -40px rgba(18,19,26,.35)";

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
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "999px", background: C.soft }}>
      {options.map(([id, text]) => {
        const on = id === value;
        return (
          <button key={id} type="button" role="radio" aria-checked={on} onClick={() => onChange(id)}
            style={{ height: small ? "24px" : "28px", padding: small ? "0 10px" : "0 12px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: small ? "12px" : "13px", fontWeight: 600, background: on ? C.white : "transparent", color: on ? C.ink : C.muted, boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none" }}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** A quiet chip that opens a menu above it (composer) or below it. */
export function MenuChip({ label, icon = null, title, children, up = true, width = 320, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" title={title} aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 10px", border: 0, borderRadius: "999px", background: open ? C.soft : "transparent", cursor: "pointer", fontSize: "13px", fontWeight: 500, color: C.text, whiteSpace: "nowrap" }}>
        {icon}<span className={icon ? "code-chip-label code-chip-label--icon" : "code-chip-label"}>{label}</span><ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" style={{ position: "absolute", zIndex: 40, [up ? "bottom" : "top"]: "42px", [align]: 0, width: width + "px", maxHeight: "min(70vh, 560px)", overflowY: "auto", overscrollBehavior: "contain", padding: "8px", borderRadius: "22px", background: C.white, boxShadow: SHEET, animation: "rise .2s ease-out" }}>
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
      style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", border: 0, borderRadius: "14px", background: on ? C.soft : "transparent", cursor: "pointer", textAlign: "left" }}>
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
        <strong style={{ fontSize: "14px", fontWeight: 600, color: C.ink }}>{title}</strong>
        {text ? <span style={{ fontSize: "12px", lineHeight: 1.45, color: C.muted }}>{text}</span> : null}
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
    <span className="code-stat" style={{ font: `500 ${size}px/1 ${MONO}`, whiteSpace: "nowrap" }}>
      {add ? <span style={{ color: C.greenText }}>+{add}</span> : null}{add && del ? " " : ""}{del ? <span style={{ color: C.red }}>−{del}</span> : null}
    </span>
  );
}

/** Bruno's shape (orange arch) in its state: breathing at work, honey glow when waiting. */
export function BrunoMark({ size = 18, state = "rest", bot = null }) {
  const color = bot?.color || C.bruno;
  const anim = state === "work" ? "breathe 1.4s ease-in-out infinite" : state === "wait" ? "beckon 1.8s ease-out infinite" : "none";
  const filter = state === "work" ? `drop-shadow(0 3px 7px ${color}88)` : "drop-shadow(0 2px 3px rgba(18,19,26,.16))";
  return (
    <span aria-hidden="true" style={{ display: "inline-grid", flex: "none", animation: anim, filter }}>
      <span style={{ display: "block", width: size + "px", height: size + "px", background: `radial-gradient(circle at 32% 26%, rgba(255,255,255,.62), rgba(255,255,255,0) 54%), ${color}`, borderRadius: "50% 50% 14% 14%" }} />
    </span>
  );
}

export const CODE_CSS = `
.code-hover{transition:background .15s ease}
.code-hover:hover{background:rgba(18,19,26,.035)}
.code-turn .code-tools{opacity:0;transition:opacity .15s ease}
.code-turn:hover .code-tools,.code-turn:focus-within .code-tools{opacity:1}
.code-task .code-x{opacity:0}
.code-task:hover .code-x,.code-task:focus-within .code-x{opacity:1}
.code-task:hover .code-stat,.code-task:focus-within .code-stat{opacity:0}
@media (max-width: 1180px){[data-codepanel]{display:none!important}}
.code-composer{container-type:inline-size}
@container (max-width: 760px){.code-ring-text{display:none}}
@container (max-width: 640px){.code-chip-label--icon{display:none}}
@media (max-width: 860px){[data-projects]{display:none!important}}
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
