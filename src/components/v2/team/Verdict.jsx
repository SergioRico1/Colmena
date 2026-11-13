import { CircleHelp, Minus, TrendingDown, TrendingUp } from "../../Icon.js";
import { C, alpha } from "../../../lib/theme.js";

// «¿Le ayuda?» (verdicts.mjs): whether something a bot learned made its work better, measured
// on the work that followed. Quiet by design: a small mark, the words only where there is room.

const LOOK = {
  ayudo: { Icon: TrendingUp, label: "Ayudó", color: C.okInk, bg: C.okSoft },
  empeoro: { Icon: TrendingDown, label: "Empeoró", color: C.error, bg: C.errorSoft },
  "sin-efecto": { Icon: Minus, label: "Sin efecto observado", color: C.text3, bg: alpha(.06) },
  dudoso: { Icon: CircleHelp, label: "Dudoso", color: C.text3, bg: alpha(.06) },
};
const CONFIDENCE = { baja: "confianza baja", media: "confianza media", alta: "confianza alta" };

export const verdictText = (v) => (v && LOOK[v.value] ? `${LOOK[v.value].label} · ${CONFIDENCE[v.confidence] || "confianza baja"}` : "");

/** Pill: «Ayudó · confianza media». `compact` shows only the icon (with the words as its label). */
export function VerdictMark({ verdict, compact = false, consolidated = false }) {
  const look = verdict && LOOK[verdict.value];
  if (!look) return null;
  const { Icon } = look;
  const words = verdictText(verdict) + (consolidated ? " · consolidada" : "");
  if (compact)
    return <span role="img" aria-label={words} title={words} style={{ display: "inline-flex", flex: "none", color: look.color }}><Icon size={13} strokeWidth={2.4} aria-hidden="true" /></span>;
  return (
    <span title={verdict.summary || undefined} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "5px 11px", borderRadius: "var(--r-pill)", fontSize: "var(--t-meta)", fontWeight: 600, background: look.bg, color: look.color, whiteSpace: "nowrap" }}>
      <Icon size={13} strokeWidth={2.4} aria-hidden="true" />
      {words}
    </span>
  );
}

/** The verdict with its hint (when it applies) and what it is based on, for a detail view. */
export function VerdictNote({ verdict, style = null }) {
  if (!verdict || !LOOK[verdict.value]) {
    return <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-3)", ...style }}>Aún no se ha medido si le ayuda: se verá en las próximas tareas en las que la use.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", ...style }}>
      <VerdictMark verdict={verdict} />
      {verdict.hint ? <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>{verdict.hint}</span> : null}
      {verdict.summary ? <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{verdict.summary}</span> : null}
    </div>
  );
}

const ORDER = { empeoro: 0, ayudo: 1, "sin-efecto": 2, dudoso: 3 };
const KIND = { skill: "Habilidad", memory: "Recuerdo", soul: "Carácter" };

/** «¿Le ayuda lo que aprende?» in a bot profile: what was measured, worse first. */
export function VerdictList({ verdicts = [], limit = 4 }) {
  const list = verdicts.filter((v) => v.title && LOOK[v.value]).sort((a, b) => ORDER[a.value] - ORDER[b.value]).slice(0, limit);
  if (!list.length) return null;
  return (
    <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
      {list.map((v) => (
        <li key={v.id} title={[v.hint, v.summary].filter(Boolean).join(" · ")} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", fontSize: "var(--t-ui)" }}>
          <VerdictMark verdict={v} compact />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: "var(--c-text-3)" }}>{KIND[v.kind] + " "}</span>{v.title}
          </span>
          <span style={{ flex: "none", fontSize: "var(--t-meta)", color: LOOK[v.value].color }}>{LOOK[v.value].label}</span>
        </li>
      ))}
    </ul>
  );
}
