import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "./Icon.js";
import { normalizeOptions, placeList, selectKey } from "../lib/select.js";
import { useClickAway } from "../lib/useClickAway.js";

// The app's select: one control wherever you choose one value from a short list («Orden»,
// «Rol», «Piensan con», «Tu estado»…), instead of the system's own drop-down beside
// Colmena's pills and menus.
//
//   <Select label="Orden" value={sort} onChange={(e) => setSort(e.target.value)} options={[["recent", "Recientes"], ["title", "Título"]]} />
//
// `options`: [value, label] pairs, plain values, or { value, label, disabled }. `onChange` is
// called as the native control calls it, with `{ target: { value } }` (the value as text) and
// the chosen option as a second argument, so it drops in where a <select> was. `label` is the name read by a
// screen reader; leave it out only when a visible <label> wraps the control. `style` dresses
// the button (height, radius, background…) exactly as the field it replaces.
//
// Keyboard (lib/select.js): as the native control. The button says what it is
// (aria-haspopup="listbox") and what is chosen; the list is a listbox whose options take
// focus one at a time; typing finds an option; Escape and a press outside close it.

const LIST_Z = 2147482400; // over dialogs, under the «sin conexión» notice

export default function Select({ value, onChange, options, label, "aria-label": ariaLabel, disabled = false, style = null, className = "", title, id, placeholder = "", fit = true, listMinWidth = 0 }) {
  const opts = useMemo(() => normalizeOptions(options), [options]);
  const selected = opts.findIndex((o) => String(o.value) === String(value));
  const name = label || ariaLabel || "";
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  const button = useRef(null), list = useRef(null), buffer = useRef({ text: "", timer: 0 });
  const listId = useId();

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  const choose = (i) => { const o = opts[i]; if (o && !o.disabled && String(o.value) !== String(value)) onChange?.({ target: { value: String(o.value) } }, o); };
  const typed = (text) => {
    clearTimeout(buffer.current.timer);
    buffer.current = { text, timer: text ? setTimeout(() => { buffer.current.text = ""; }, 700) : 0 };
  };
  useEffect(() => () => clearTimeout(buffer.current.timer), []);

  const onKeyDown = (e) => {
    if (disabled) return;
    const next = selectKey(opts, { open, at, selected, buffer: buffer.current.text }, e);
    if (next.handled) { e.preventDefault(); e.stopPropagation(); }
    typed(next.buffer);
    if (next.choose !== undefined) choose(next.choose);
    if (next.open !== open) { if (next.open) setOpen(true); else close(next.refocus); }
    if (next.at !== at) setAt(next.at);
  };

  useClickAway(open, [button, list], () => close(false), { escape: false });
  // The list floats over the page: it closes when what is under it moves.
  useEffect(() => {
    if (!open) return undefined;
    const gone = (e) => { if (!list.current?.contains(e.target)) close(false); };
    const shut = () => close(false);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("resize", shut);
    window.addEventListener("blur", shut);
    // A press on the list is never «outside» for a menu or panel this select sits in.
    const node = list.current, keep = (e) => e.stopPropagation();
    node?.addEventListener("mousedown", keep);
    node?.addEventListener("pointerdown", keep);
    return () => {
      window.removeEventListener("scroll", gone, true); window.removeEventListener("resize", shut); window.removeEventListener("blur", shut);
      node?.removeEventListener("mousedown", keep); node?.removeEventListener("pointerdown", keep);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const node = list.current, anchor = button.current;
    if (!open || !node || !anchor) return;
    node.style.maxHeight = "none";
    const spot = placeList(anchor.getBoundingClientRect(), { width: Math.max(node.offsetWidth, listMinWidth), height: node.scrollHeight + 2 }, { width: window.innerWidth, height: window.innerHeight });
    Object.assign(node.style, { left: spot.left + "px", top: spot.top + "px", minWidth: Math.max(spot.minWidth, listMinWidth) + "px", maxHeight: spot.maxHeight + "px", visibility: "visible" });
  }, [open, opts.length, listMinWidth]);
  // Roving focus: the active option is the one that has it.
  useLayoutEffect(() => {
    if (!open) return;
    const node = list.current?.querySelector(`[data-index="${at}"]`);
    if (node) { node.focus({ preventScroll: true }); node.scrollIntoView?.({ block: "nearest" }); } else list.current?.focus({ preventScroll: true });
  }, [open, at]);

  const current = selected >= 0 ? opts[selected].label : placeholder;
  const toggle = () => {
    if (open) { close(false); return; }
    setAt(selected >= 0 && !opts[selected].disabled ? selected : opts.findIndex((o) => !o.disabled));
    setOpen(true);
  };
  const ellipsis = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <>
      <button ref={button} id={id} type="button" className={("c-select " + className).trim()} title={title} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open ? "true" : "false"} aria-controls={open ? listId : undefined} aria-label={name ? `${name}: ${current}` : undefined}
        onClick={toggle} onKeyDown={onKeyDown}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minWidth: 0, margin: 0, textAlign: "left", fontFamily: "inherit", color: "var(--c-text)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, ...style }}>
        {/* As wide as its longest option, like the native control: choosing never moves the layout. */}
        <span style={{ display: "grid", minWidth: 0 }}>
          <span style={{ gridArea: "1 / 1", ...ellipsis }}>{current}</span>
          {fit ? opts.map((o, i) => <span key={i} aria-hidden="true" style={{ gridArea: "1 / 1", height: 0, visibility: "hidden", whiteSpace: "nowrap", overflow: "hidden" }}>{o.label}</span>) : null}
        </span>
        <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none", opacity: 0.7, transition: "transform .2s ease", transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open ? createPortal(
        <ul ref={list} id={listId} role="listbox" aria-label={name || undefined} tabIndex={-1} onKeyDown={onKeyDown}
          onBlur={(e) => { const to = e.relatedTarget; if (to && !list.current?.contains(to) && to !== button.current) close(false); }}
          style={{ position: "fixed", left: 0, top: 0, zIndex: LIST_Z, visibility: "hidden", boxSizing: "border-box", margin: 0, padding: "6px", listStyle: "none", display: "flex", flexDirection: "column", overflowY: "auto", overscrollBehavior: "contain", borderRadius: "var(--r-lg)", background: "var(--c-card)", color: "var(--c-text)", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", fontSize: "var(--t-ui)", boxShadow: "0 0 0 1px rgb(var(--c-ink-rgb) / .08), var(--c-shadow-pop)", WebkitAppRegion: "no-drag" }}>
          {opts.map((o, i) => {
            const on = i === selected, active = i === at;
            return (
              <li key={i} id={`${listId}-${i}`} role="option" data-index={i} aria-selected={on ? "true" : "false"} aria-disabled={o.disabled ? "true" : undefined} tabIndex={active ? 0 : -1}
                onClick={() => { if (o.disabled) return; choose(i); close(true); }} onMouseMove={() => { if (!o.disabled && at !== i) setAt(i); }}
                style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", minHeight: "36px", padding: "0 12px", borderRadius: "var(--r-sm)", background: active ? "var(--c-chip)" : "transparent", fontWeight: on ? 600 : 400, whiteSpace: "nowrap", cursor: o.disabled ? "default" : "pointer", opacity: o.disabled ? 0.5 : 1, outlineOffset: "-2px" }}>
                <span>{o.label}</span>
                {on ? <Check size={15} strokeWidth={2.6} aria-hidden="true" style={{ flex: "none" }} /> : <span aria-hidden="true" style={{ flex: "none", width: "15px" }} />}
              </li>
            );
          })}
        </ul>, document.body) : null}
    </>
  );
}
