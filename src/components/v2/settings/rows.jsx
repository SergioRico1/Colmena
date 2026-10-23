import { ChevronDown, ChevronRight } from "lucide-react";
import { navigate } from "../../../lib/router.jsx";

// The v2 Ajustes rows (design/V2Ajustes.dc.html): white 26 px groups of 64–76 px rows, a
// small grey title above each group and a quiet note below. Every row can carry the anchor
// of its setting (`anchor`), which is what /ajustes/<section>#<anchor> scrolls to.

export const INK = "#12131A";
export const MUTED = "#5C606C";
export const FAINT = "#6B6F7A";
export const LINE = "1px solid rgba(18,19,26,.06)";

export function Group({ id, title, note, children, anchor }) {
  return (
    <section id={anchor || undefined} data-setting={anchor || undefined} aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: "10px", scrollMarginTop: "24px" }}>
      {title ? <h2 id={id} style={{ margin: "0 0 0 20px", fontSize: "13px", fontWeight: 500, color: FAINT }}>{title}</h2> : null}
      <div style={{ background: "#FFFFFF", borderRadius: "26px", overflow: "hidden" }}>{children}</div>
      {note ? <p style={{ margin: "0 20px", fontSize: "13px", lineHeight: 1.5, color: FAINT }}>{note}</p> : null}
    </section>
  );
}

export const Chevron = ({ open = false, right = false }) => (right
  ? <ChevronRight size={16} strokeWidth={2.4} color="#9A9DA6" aria-hidden="true" style={{ flex: "none" }} />
  : <ChevronDown size={16} strokeWidth={2.4} color="#9A9DA6" aria-hidden="true" style={{ flex: "none", transition: "transform .2s ease", transform: open ? "rotate(180deg)" : "none" }} />);

export const rowStyle = (last, min = "64px") => ({ width: "100%", display: "flex", alignItems: "center", gap: "16px", minHeight: min, padding: "12px 20px", border: 0, borderBottom: last ? 0 : LINE, background: "transparent", textAlign: "left", color: INK, scrollMarginTop: "24px" });
/** Anchor props for a row: id + the data attribute the highlight looks for. */
export const anchorOf = (anchor) => (anchor ? { id: anchor, "data-setting": anchor } : {});

export function Text({ title, sub, subColor = MUTED }) {
  return (
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
      <strong style={{ fontSize: "16px", fontWeight: sub ? 600 : 400 }}>{title}</strong>
      {sub ? <span style={{ fontSize: "14px", lineHeight: 1.45, color: subColor }}>{sub}</span> : null}
    </span>
  );
}
export function Knob({ on }) {
  return (
    <span aria-hidden="true" style={{ width: "52px", height: "32px", flex: "none", padding: "3px", borderRadius: "16px", transition: "background .25s ease", background: on ? "#0B8A5F" : "rgba(18,19,26,.14)" }}>
      <span style={{ display: "block", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(20px)" : "translateX(0)" }} />
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
      {value ? <span style={{ fontSize: "15px", color: MUTED, whiteSpace: "nowrap" }}>{value}</span> : null}
      <Chevron right />
    </a>
  );
}
/** A row whose control sits on the right and wraps under the label when the window is narrow. */
export function FieldRow({ title, sub, children, last, anchor, control = "1 1 340px" }) {
  return (
    <div {...anchorOf(anchor)} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "72px", padding: "12px 20px", borderBottom: last ? 0 : LINE, scrollMarginTop: "24px" }}>
      <span style={{ flex: "1 1 160px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ fontSize: "16px", fontWeight: sub ? 600 : 400 }}>{title}</span>
        {sub ? <span style={{ fontSize: "14px", lineHeight: 1.45, color: MUTED }}>{sub}</span> : null}
      </span>
      <span style={{ flex: control, minWidth: 0 }}>{children}</span>
    </div>
  );
}
export function Segmented({ label, items, value, onPick, busy }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
      {items.map(([v, text]) => {
        const on = value === v;
        return <button key={String(v)} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => onPick(v)} style={{ flex: 1, height: "38px", padding: "0 12px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" }}>{text}</button>;
      })}
    </div>
  );
}
export const pill = (dark) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600, flex: "none", whiteSpace: "nowrap", background: dark ? INK : "rgba(18,19,26,.06)", color: dark ? "#FFFFFF" : INK });
export const inputStyle = { flex: "1 1 240px", minWidth: 0, width: "100%", height: "46px", padding: "0 16px", border: 0, borderRadius: "14px", outline: "none", background: "#F4F4F0", fontSize: "15px", color: INK, boxSizing: "border-box" };

/** The big number of a group: Bricolage 44 px, with its unit beside it. */
export function Figure({ value, unit, small = false }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
      <strong style={{ font: `600 ${small ? 30 : 44}px/1 'Bricolage Grotesque', sans-serif`, letterSpacing: "-0.04em" }}>{value}</strong>
      {unit ? <span style={{ fontSize: "15px", color: MUTED }}>{unit}</span> : null}
    </span>
  );
}

/** A thin bar (8 px) that fills to `percent`; honey only when the limit is close. */
export function Bar({ percent, warn = false, height = 8, tick = null, label }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"} style={{ position: "relative", display: "block", height: height + "px", borderRadius: height / 2 + "px", background: "rgba(18,19,26,.07)", overflow: "hidden" }}>
      <span style={{ display: "block", height: "100%", width: p + "%", borderRadius: height / 2 + "px", background: warn ? "#FFC93C" : INK, transformOrigin: "left", animation: "grow .8s ease-out" }} />
      {tick != null ? <span title="Donde estarías gastando a ritmo constante" style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${Math.max(0, Math.min(100, tick))}% - 1px)`, width: "2px", background: "rgba(18,19,26,.35)" }} /> : null}
    </span>
  );
}
