import { ChevronDown, ChevronRight } from "../../Icon.js";
import { navigate } from "../../../lib/router.jsx";
import { C } from "../../../lib/theme.js";

// The rows of Contactos y equipos, in the same language as the other sections (v3.jsx): cards of
// 64–76 px rows with a title above each card and a quiet note below; 40 × 24 switches. Every row can carry the anchor
// of its setting (`anchor`), which is what /ajustes/<section>#<anchor> scrolls to.

export const INK = C.text;
export const MUTED = C.text3;
export const FAINT = C.text3;
export const LINE = "1px solid rgb(var(--c-ink-rgb) / .06)";

export function Group({ id, title, note, children, anchor }) {
  return (
    <section id={anchor || undefined} data-setting={anchor || undefined} aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: "10px", scrollMarginTop: "24px" }}>
      {title ? <h3 id={id} style={{ margin: "0 0 0 2px", fontSize: "var(--t-body)", fontWeight: 600, color: "var(--c-text)" }}>{title}</h3> : null}
      <div style={{ background: "var(--c-card)", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", overflow: "hidden" }}>{children}</div>
      {note ? <p style={{ margin: "0 2px", fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{note}</p> : null}
    </section>
  );
}

export const Chevron = ({ open = false, right = false }) => (right
  ? <ChevronRight size={16} strokeWidth={2.4} color={C.text4} aria-hidden="true" style={{ flex: "none" }} />
  : <ChevronDown size={16} strokeWidth={2.4} color={C.text4} aria-hidden="true" style={{ flex: "none", transition: "transform .2s ease", transform: open ? "rotate(180deg)" : "none" }} />);

export const rowStyle = (last, min = "64px") => ({ width: "100%", display: "flex", alignItems: "center", gap: "16px", minHeight: min, padding: "12px 22px", border: 0, borderBottom: last ? 0 : LINE, background: "transparent", textAlign: "left", color: "var(--c-text)", scrollMarginTop: "24px" });
/** Anchor props for a row: id + the data attribute the highlight looks for. */
export const anchorOf = (anchor) => (anchor ? { id: anchor, "data-setting": anchor } : {});

export function Text({ title, sub, subColor = MUTED }) {
  return (
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
      <strong style={{ fontSize: "var(--t-body)", fontWeight: 500 }}>{title}</strong>
      {sub ? <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: subColor }}>{sub}</span> : null}
    </span>
  );
}
export function Knob({ on }) {
  return (
    <span aria-hidden="true" style={{ width: "40px", height: "24px", flex: "none", padding: "3px", boxSizing: "border-box", borderRadius: "var(--r-pill)", transition: "background .2s ease", background: on ? C.ok : "rgb(var(--c-ink-rgb) / .22)" }}>
      <span style={{ display: "block", width: "18px", height: "18px", borderRadius: "var(--r-circle)", background: "var(--c-knob)", boxShadow: "var(--c-shadow-lift)", transition: "transform .2s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(16px)" : "translateX(0)" }} />
    </span>
  );
}
export function SwitchRow({ title, sub, on, onChange, busy, last, anchor }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={() => onChange(!on)} {...anchorOf(anchor)} style={{ ...rowStyle(last, sub ? "72px" : "64px"), cursor: busy ? "wait" : "pointer" }}>
      <Text title={title} sub={sub} />
      <Knob on={on} />
    </button>
  );
}
export function LinkRow({ title, sub, value, to, last, icon = null, anchor }) {
  return (
    <a href={to} onClick={(e) => { e.preventDefault(); navigate(to); }} {...anchorOf(anchor)} style={{ ...rowStyle(last, sub ? "72px" : "64px"), textDecoration: "none", cursor: "pointer" }}>
      {icon}
      <Text title={title} sub={sub} />
      {value ? <span style={{ fontSize: "var(--t-body)", color: "var(--c-text-3)", whiteSpace: "nowrap" }}>{value}</span> : null}
      <Chevron right />
    </a>
  );
}
/** A row whose control sits on the right and wraps under the label when the window is narrow. */
export function FieldRow({ title, sub, children, last, anchor, control = "1 1 340px" }) {
  return (
    <div {...anchorOf(anchor)} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "72px", padding: "12px 20px", borderBottom: last ? 0 : LINE, scrollMarginTop: "24px" }}>
      <span style={{ flex: "1 1 160px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ fontSize: "var(--t-body)", fontWeight: 500 }}>{title}</span>
        {sub ? <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>{sub}</span> : null}
      </span>
      <span style={{ flex: control, minWidth: 0 }}>{children}</span>
    </div>
  );
}
export function Segmented({ label, items, value, onPick, busy }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .05)" }}>
      {items.map(([v, text]) => {
        const on = value === v;
        return <button key={String(v)} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => onPick(v)} style={{ flex: 1, height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, whiteSpace: "nowrap", color: "var(--c-text)", background: on ? "var(--c-card)" : "transparent", boxShadow: on ? "var(--c-shadow-lift)" : "none" }}>{text}</button>;
      })}
    </div>
  );
}
export const pill = (dark) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "36px", padding: "0 14px", border: 0, borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, flex: "none", whiteSpace: "nowrap", background: dark ? "var(--c-btn)" : "rgb(var(--c-ink-rgb) / .06)", color: dark ? "var(--c-btn-text)" : INK });
export const inputStyle = { flex: "1 1 240px", minWidth: 0, width: "100%", height: "36px", padding: "0 10px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-card)", fontSize: "var(--t-body)", color: "var(--c-text)", boxSizing: "border-box" };
