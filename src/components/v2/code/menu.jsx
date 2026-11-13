import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "../../Icon.js";
import { useClickAway } from "../../../lib/useClickAway.js";
import { C, MONO, SHEET } from "./parts.jsx";
import { menuKey, useFocusFirst } from "./menuKeys.js";

export { menuKey, useFocusFirst };

// The menus of «Código» (the task's «…», a row's «…», a project's archiving, the pickers): kept
// small and local so they can move to the app's shared menu later. Every item carries an icon;
// groups are split by intent; a checked state shows a tick; a disabled item says why; what
// destroys goes last, in the error colour, and asks a second click when it cannot be undone.
// Keys: ↑ ↓ Home End move, a letter jumps to the next item starting with it, Esc closes and
// gives the focus back to the button that opened the menu, Tab closes.

/** A menu anchored to a button, drawn above the page (fixed), closed by a click outside or Esc. */
export function useMenu(width = 280) {
  const [at, setAt] = useState(null);
  const ref = useRef(null);
  const opener = useRef(null);
  const close = (back = false) => { setAt(null); if (back) opener.current?.focus?.(); };
  useClickAway(!!at, ref, () => setAt(null));
  useEffect(() => {
    if (!at) return undefined;
    const shut = () => setAt(null);
    window.addEventListener("resize", shut, { once: true });
    return () => window.removeEventListener("resize", shut);
  }, [at]);
  const open = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (at) { setAt(null); return; }
    opener.current = e.currentTarget;
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ left: Math.min(r.right - width, window.innerWidth - width - 12), top: r.bottom + 6, up: r.bottom + 360 > window.innerHeight && r.top > 360, bottom: window.innerHeight - r.top + 6 });
  };
  return { at, ref, open, close };
}

export function MenuSheet({ menu, label, children, width = 280 }) {
  useFocusFirst(menu.ref, !!menu.at);
  if (!menu.at) return null;
  // Drawn in <body>: inside the task's link, a click on a field would open the task.
  return createPortal(
    <div ref={menu.ref} role="menu" aria-label={label} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => menuKey(e, menu.close)}
      style={{ position: "fixed", zIndex: 60, left: Math.max(8, menu.at.left) + "px", ...(menu.at.up ? { bottom: menu.at.bottom + "px" } : { top: menu.at.top + "px" }), width: width + "px", maxHeight: "min(76vh, 620px)", overflowY: "auto", overscrollBehavior: "contain", padding: "6px", borderRadius: "var(--r-lg)", background: "var(--c-raised)", boxShadow: SHEET, animation: "rise .16s ease-out" }}>
      {children}
    </div>,
    document.body,
  );
}

/**
 * One item. `checked` (true/false) makes it a checkbox with a tick; `why` says why it is disabled;
 * `danger` paints it in the error colour; `confirm` (a text) asks a second click before `onClick`.
 */
export function Item({ icon: Icon, text, note = null, onClick, tone = null, on = false, disabled = false, why = null, danger = false, checked = null, confirm = null }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  const off = disabled || !!why;
  const color = off ? C.quiet : danger || tone === C.red ? "var(--c-error)" : tone || C.ink;
  const role = checked === null ? (on ? "menuitemradio" : "menuitem") : "menuitemcheckbox";
  const label = armed ? confirm : text;
  return (
    <button type="button" role={role} aria-checked={checked === null ? (on ? true : undefined) : checked} aria-disabled={off || undefined} data-label={text} title={why || undefined}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (off) return; if (confirm && !armed) { setArmed(true); return; } setArmed(false); onClick(); }}
      className={off ? undefined : danger ? "code-hover code-danger" : "code-hover"}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", minHeight: "34px", padding: why ? "6px 10px" : "0 10px", border: 0, borderRadius: "var(--r-sm)", background: armed ? "var(--c-error-soft)" : on ? C.soft : "transparent", cursor: off ? "default" : "pointer", textAlign: "left", fontSize: "var(--t-meta)", fontWeight: armed ? 600 : 500, color }}>
      {Icon ? <Icon size={16} aria-hidden="true" style={{ flex: "none" }} /> : <span style={{ width: "16px", flex: "none" }} />}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <span>{label}</span>
        {why ? <span style={{ fontSize: "var(--t-caption)", fontWeight: 400, lineHeight: 1.35, color: C.muted }}>{why}</span> : null}
      </span>
      {note ? <span style={{ flex: "none", font: `400 var(--t-caption)/1 ${MONO}`, color: C.quiet, whiteSpace: "nowrap" }}>{note}</span> : null}
      {checked || on ? <Check size={16} weight="bold" aria-hidden="true" style={{ flex: "none", color: C.ink }} /> : checked === false ? <span style={{ width: "16px", flex: "none" }} /> : null}
    </button>
  );
}
export const Rule = () => <span role="separator" style={{ display: "block", height: "1px", margin: "4px 8px", background: C.rule }} />;
export const Heading = ({ children }) => <span role="presentation" style={{ display: "block", padding: "8px 10px 4px", fontSize: "var(--t-caption)", fontWeight: 600, color: C.muted }}>{children}</span>;
