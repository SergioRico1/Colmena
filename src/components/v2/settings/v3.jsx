import { useEffect, useState } from "react";
import { useStore } from "../../../lib/store.jsx";
import { patch } from "../../../lib/api.js";
import { reversible } from "../../../lib/undoToast.js";
import { useExpert } from "../../../lib/expert.js";
import { navigate } from "../../../lib/router.jsx";
import { shapeOf } from "../Presence.jsx";

// The Colmena 3 Ajustes pieces (design/V3Ajustes.dc.html and its sibling boards): white 20 px
// cards, 64–76 px rows with the label on the left and the control on the right (it wraps under
// the label in a narrow window), the 40 × 24 switch, 40 px fields and pill buttons. Every row
// can carry its setting's anchor (`anchor`), which is what /ajustes/<section>#<anchor> scrolls to.

export const INK = "#12131A";
export const SOFT = "#4A4D57";
export const MUTED = "#5C606C";
export const LINE = "1px solid rgba(18,19,26,.06)";
export const UNDO_MS = 10000;

/** Anchor props: id + the data attribute the highlight looks for. */
export const anchorOf = (anchor) => (anchor ? { id: anchor, "data-setting": anchor } : {});
export const srOnly = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };

export const card = { display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "#FFFFFF", overflow: "hidden", scrollMarginTop: "24px" };
export const panel = { display: "flex", flexDirection: "column", gap: "10px", padding: "20px 22px", borderRadius: "var(--r-xl)", background: "#FFFFFF", scrollMarginTop: "24px" };
export const h3 = { margin: 0, fontSize: "var(--t-body)", fontWeight: 600 };
export const field = { width: "240px", maxWidth: "100%", height: "40px", padding: "0 12px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-md)", background: "#FFFFFF", fontSize: "var(--t-body)", color: INK, boxSizing: "border-box" };
export const select = { ...field, padding: "0 10px" };
export const mono = "'Geist Mono', monospace";

/** Pill buttons: «outline» (white with a line), «dark» (ink) and «ghost» (text only). */
export const btn = (kind = "outline", size = 34) => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: "none", height: size + "px",
  padding: size >= 40 ? "0 16px" : "0 12px", borderRadius: "var(--r-pill)", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none",
  fontSize: size >= 40 ? "var(--t-ui)" : "var(--t-meta)", fontWeight: kind === "dark" ? 600 : 500,
  border: kind === "outline" ? "1px solid rgba(18,19,26,.14)" : 0,
  background: kind === "dark" ? INK : kind === "ghost" ? "transparent" : "#FFFFFF",
  color: kind === "dark" ? "#FFFFFF" : kind === "ghost" ? SOFT : INK,
});

/** A card of rows (the board's white 20 px box). */
export function Card({ children, anchor, label, style = null }) {
  return <section {...anchorOf(anchor)} aria-label={label} style={{ ...card, ...style }}>{children}</section>;
}

/** A titled card: «Atajos de teclado», «Servidores MCP»… */
export function Panel({ title, sub, aside, anchor, children, style = null, id, big = false }) {
  const head = id || (anchor ? anchor + "-t" : undefined);
  return (
    <section {...anchorOf(anchor)} aria-labelledby={title ? head : undefined} style={{ ...panel, ...style }}>
      {title ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: big ? "4px" : "2px", marginBottom: big ? "8px" : 0 }}>
            <h3 id={head} style={{ ...h3, fontSize: big ? "var(--t-read)" : "var(--t-body)" }}>{title}</h3>
            {sub ? <span style={{ fontSize: big ? "var(--t-ui)" : "var(--t-meta)", lineHeight: 1.45, color: MUTED }}>{sub}</span> : null}
          </span>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The label of a row: title and a quiet line under it. */
export function Label({ title, sub, strong = false, subColor = MUTED, basis = "220px" }) {
  return (
    <span style={{ flex: `1 1 ${basis}`, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "var(--t-body)", fontWeight: strong ? 600 : 500 }}>{title}</span>
      {sub ? <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: subColor }}>{sub}</span> : null}
    </span>
  );
}

/** One row: label on the left, control on the right. `first` drops the line above it. */
export function Row({ title, sub, children, anchor, first = false, as = "div", min = "68px", tint = null, strong = false, subColor, htmlFor }) {
  const Tag = as;
  return (
    <Tag {...anchorOf(anchor)} htmlFor={htmlFor} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 20px", minHeight: min, padding: "12px 22px", borderTop: first ? 0 : LINE, background: tint || undefined, scrollMarginTop: "24px" }}>
      <Label title={title} sub={sub} strong={strong} subColor={subColor} />
      {children}
    </Tag>
  );
}

/** The 40 × 24 switch of the boards. */
export function Switch({ on, onChange, label, busy = false, labelledBy }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} disabled={busy} onClick={() => onChange(!on)}
      style={{ flex: "none", position: "relative", width: "40px", height: "24px", padding: 0, border: 0, borderRadius: "var(--r-pill)", background: on ? INK : "#8A8D96", cursor: busy ? "wait" : "pointer", transition: "background .2s ease" }}>
      <span aria-hidden="true" style={{ position: "absolute", top: "3px", left: on ? "19px" : "3px", width: "18px", height: "18px", borderRadius: "var(--r-circle)", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.3)", transition: "left .2s cubic-bezier(.2,.8,.2,1)" }} />
    </button>
  );
}
export function SwitchRow({ title, sub, on, onChange, anchor, first, busy, strong, tint, min }) {
  return (
    <Row title={title} sub={sub} anchor={anchor} first={first} strong={strong} tint={tint} min={min}>
      <Switch on={on} onChange={onChange} label={title} busy={busy} />
    </Row>
  );
}

/** The grey pill of choices (Apariencia, Unidad). */
export function Pills({ label, items, value, onPick, busy = false, background = "#F1F1EC" }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "inline-flex", flexWrap: "wrap", padding: "3px", gap: "2px", borderRadius: "var(--r-pill)", background }}>
      {items.map(([v, text]) => {
        const on = value === v;
        return <button key={String(v)} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => onPick(v)} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none", fontSize: "var(--t-ui)", fontWeight: 500, color: INK, cursor: "pointer" }}>{text}</button>;
      })}
    </div>
  );
}

/** Big choice cards with a 2 px ink border on the chosen one (Avísame de…, Cuánto piensan). */
export function Choices({ label, items, value, onPick, busy = false, min = 200 }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap: "8px" }}>
      {items.map(([v, text, desc]) => {
        const on = value === v;
        return (
          <button key={String(v)} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => onPick(v)}
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "14px", border: `2px solid ${on ? INK : "rgba(18,19,26,.1)"}`, borderRadius: "var(--r-lg)", background: "#FFFFFF", textAlign: "left", color: INK, cursor: "pointer", transition: "border-color .2s ease" }}>
            <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{text}</span>
            {desc ? <span style={{ fontSize: "var(--t-meta)", color: MUTED }}>{desc}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** A text setting saved when you leave the field or press Enter. */
export function TextInput({ label, value, onSave, max = 80, placeholder, list, width = "240px" }) {
  const [draft, setDraft] = useState(value || "");
  useEffect(() => { setDraft(value || ""); }, [value]);
  const keep = () => { const v = draft.trim(); if (v && v !== (value || "")) onSave(v); else setDraft(value || ""); };
  return (
    <input type="text" aria-label={label} value={draft} maxLength={max} placeholder={placeholder} list={list}
      onChange={(e) => setDraft(e.target.value)} onBlur={keep}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(value || ""); e.currentTarget.blur(); } }}
      style={{ ...field, width }} />
  );
}

/** A link that moves inside the app. */
export const LINK = "#1F4FD1";
export function Go({ to, children, style = null, ...rest }) {
  return <a href={to} onClick={(e) => { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); navigate(to); }} style={{ color: LINK, ...style }} {...rest}>{children}</a>;
}

/**
 * A technical word. In simple mode it carries a dotted line and explains itself when you rest
 * the pointer on it; in expert mode it is just the word.
 */
export function Term({ tip, children }) {
  const [expert] = useExpert();
  if (expert) return children;
  return <abbr title={tip} style={{ textDecoration: "underline dotted rgba(18,19,26,.35)", textUnderlineOffset: "3px", cursor: "help" }}>{children}</abbr>;
}

/** A status chip: ✓ Cifrada, Principal, Sin conectar… */
export function Chip({ children, tone = "grey", style = null }) {
  const look = { green: ["#E3F4EC", "#0B6B4A"], dark: [INK, "#FFFFFF"], grey: ["#F1F1EC", "#3D404A"], quiet: ["#F1F1EC", MUTED], red: ["#FBEAE7", "#B4232A"] }[tone] || ["#F1F1EC", "#3D404A"];
  return <span style={{ height: "22px", padding: "0 8px", display: "inline-flex", alignItems: "center", flex: "none", borderRadius: "var(--r-pill)", background: look[0], color: look[1], fontSize: "var(--t-caption)", fontWeight: 600, whiteSpace: "nowrap", ...style }}>{children}</span>;
}

/** A thin bar (6–10 px) of the boards, filled to `percent`. */
export function Meter({ percent, height = 6, color = INK, tick = null, tickColor = "#8A5A00", label }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"} style={{ position: "relative", display: "block", height: height + "px", borderRadius: "var(--r-pill)", background: "#EEEEEA", overflow: "hidden" }}>
      <span style={{ position: "absolute", inset: "0 auto 0 0", width: p + "%", background: color, transformOrigin: "left", animation: "grow .8s ease-out" }} />
      {tick != null ? <span style={{ position: "absolute", top: 0, bottom: 0, left: Math.max(0, Math.min(99, tick)) + "%", width: "2px", background: tickColor }} /> : null}
    </span>
  );
}

/** A bot's shape and colour, small (the boards' 12–18 px marks). */
export function BotMark({ bot, size = 16 }) {
  const { clip, radius } = shapeOf(bot);
  return <span aria-hidden="true" style={{ flex: "none", width: size + "px", height: size + "px", background: bot?.color || "#C9CBD1", clipPath: clip, borderRadius: radius }} />;
}

/**
 * Saves settings at once (PATCH /api/settings) and shows «Deshacer» for ten seconds. The new
 * value shows before the server answers; `before` is what «Deshacer» puts back (by default the
 * values the settings had).
 */
export function useSettings() {
  const { settings = {}, run } = useStore();
  const [over, setOver] = useState({});
  const [error, setError] = useState(null);
  const drop = (keys) => setOver((o) => { const n = { ...o }; for (const k of keys) delete n[k]; return n; });
  const save = (changes, text = null, before = null) => {
    const keys = Object.keys(changes);
    const back = before || Object.fromEntries(keys.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]]));
    setOver((o) => ({ ...o, ...changes }));
    setError(null);
    return run(() => patch("/settings", changes)).then(() => {
      drop(keys);
      if (text && Object.keys(back).length) reversible({ id: "setting:" + keys.join(","), text, ms: UNDO_MS, undo: () => run(() => patch("/settings", back)) });
      return true;
    }, (e) => { drop(keys); setError(e.message); return false; });
  };
  const shown = { ...settings };
  for (const [k, v] of Object.entries(over)) shown[k] = k === "limits" ? { ...(settings.limits || {}), ...v } : v;
  return { settings: shown, save, error };
}

export function Alert({ children }) {
  return children ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "#B4232A" }}>{children}</p> : null;
}
