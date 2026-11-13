import { createElement as h, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "./Icon.js";
import { firstItem, itemRole, lastItem, menuKey, menuRows, placeMenu, shortcutKeys } from "../lib/menu.js";
import { useClickAway } from "../lib/useClickAway.js";

// The app's one menu: every «…», «Nuevo», a team or profile menu, a right-click. Written with
// createElement (no JSX) so the tests can mount it (tests/menu.test.mjs).
//
//   <MenuButton label="Más opciones" items={[
//     { group: null, items: [{ label: "Cambiar el nombre", icon: Pencil, onSelect: rename }] },
//     { group: "Panel lateral", items: [{ label: "Progreso", icon: ListChecks, checked: on, shortcut: "Ctrl+Alt+Mayús+E", onSelect: toggle }] },
//     { label: "Posponer", icon: AlarmClock, items: [{ label: "Hasta mañana", hint: "09:00", onSelect: … }] },
//     { label: "Salir de la sala", icon: DoorOpen, danger: true, confirm: { title: "¿Salir de #precios?", text: "…", action: "Salir" }, onSelect: leave },
//   ]}><Ellipsis size={18} /></MenuButton>
//
//   const ctx = useContextMenu((e) => ({ label: "Mensaje", items: […] }));   right-click
//   <div onContextMenu={ctx.onContextMenu}>…</div>{ctx.menu}
//
// Entries and rows: src/lib/menu.js (groups, destructive last, the keyboard model, placement).
// Look: design/v4 › .menu (the profile menu): the raised surface, a hairline and the pop shadow,
// 6 px padding, 32 px rows of 14 px text with a regular Phosphor icon, the error colour for what
// destroys. Styles in styles/base.css (.c-menu, .c-mi…). Keyboard: arrows (wrapping), Home/End,
// typing a letter, Enter/Space, Escape (back to what opened it), → and ← for submenus, Tab
// leaves. A destructive item with `confirm` asks inside the menu before it runs.

const TYPE_PAUSE = 700;

const nodeOf = (panel, i) => panel?.querySelector(`[data-row="${i}"]`) || null;
const rectOf = (anchor) => {
  if (!anchor) return { left: 0, top: 0, right: 0, bottom: 0 };
  if (typeof anchor.getBoundingClientRect === "function") return anchor.getBoundingClientRect();
  if ("x" in anchor && "y" in anchor && !("left" in anchor)) return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };
  return anchor;
};
const viewSize = () => ({ width: window.innerWidth || document.documentElement?.clientWidth || 1024, height: window.innerHeight || document.documentElement?.clientHeight || 768 });

function glyph(icon, size = 16) {
  if (!icon) return null;
  return isValidElement(icon) ? icon : h(icon, { size, "aria-hidden": "true" });
}

/** One item row. */
function Row({ row, index, active, onPointer, onPick, expanded, menuId }) {
  const it = row.item;
  const role = itemRole(it);
  const reason = typeof it.disabled === "string" ? it.disabled : null;
  const end = it.items
    ? h(ChevronRight, { size: 14, "aria-hidden": "true" })
    : typeof it.checked === "boolean"
      ? (it.checked ? h(Check, { size: 16, weight: "bold", "aria-hidden": "true", style: { color: "var(--c-text)" } }) : null)
      : it.shortcut
        ? shortcutKeys(it.shortcut).map((k, i) => h("kbd", { key: i }, k))
        : it.meta != null ? h("span", { className: "c-mi-meta" }, it.meta) : null;
  const props = {
    role, tabIndex: -1, "data-row": index, "data-active": active ? "" : undefined,
    className: "c-mi" + (it.danger ? " danger" : "") + (it.hint ? " has-hint" : ""),
    "aria-disabled": it.disabled ? "true" : undefined,
    "aria-checked": role === "menuitem" ? undefined : it.checked ? "true" : "false",
    "aria-haspopup": it.items ? "menu" : undefined,
    "aria-expanded": it.items ? (expanded ? "true" : "false") : undefined,
    "aria-controls": it.items && expanded ? menuId + "-sub" : undefined,
    title: reason || it.title || undefined,
    "aria-description": reason || undefined,
    onMouseMove: () => onPointer(index),
    onClick: (e) => onPick(index, e),
  };
  const body = [
    h("span", { key: "i", className: "c-mi-icon", "aria-hidden": "true" }, glyph(it.icon)),
    h("span", { key: "l", className: "c-mi-text" }, h("span", { className: "c-mi-label" }, it.label), it.hint ? h("span", { className: "c-mi-hint" }, it.hint) : null),
    end ? h("span", { key: "e", className: "c-mi-end", "aria-hidden": it.shortcut || it.items || typeof it.checked === "boolean" ? "true" : undefined }, end) : null,
  ];
  if (it.href && !it.disabled) return h("a", { ...props, href: it.href }, body);
  return h("button", { ...props, type: "button" }, body);
}

/** The question a destructive item asks in place: what it does, «Cancelar» and the action. */
function Confirm({ item, onYes, onNo }) {
  const c = item.confirm || {};
  const id = useId();
  return h("div", { className: "c-menu-confirm", role: "group", "aria-labelledby": id + "-t", "aria-describedby": c.text ? id + "-d" : undefined },
    h("strong", { id: id + "-t" }, c.title || item.label),
    c.text ? h("p", { id: id + "-d" }, c.text) : null,
    h("div", { className: "c-menu-confirm-row" },
      h("button", { type: "button", className: "c-menu-btn", "data-autofocus": "", onClick: onNo }, c.cancel || "Cancelar"),
      h("button", { type: "button", className: "c-menu-btn danger", onClick: onYes }, c.action || item.label)));
}

/**
 * The menu itself, floating over the page (a portal on <body>, position: fixed): a stack of
 * panels, the root and any open submenu beside its item.
 *   entries     what it offers (src/lib/menu.js)
 *   label       its name for a screen reader
 *   anchor      what it hangs from: an element, a DOMRect, or a point { x, y } (right-click)
 *   placement   see placeMenu(): "bottom-end" by default
 *   initial     "first" | "last" | "none": the item made active on open
 *   autoFocus   false keeps focus where it is (a text field keeps its caret); keys still work
 *   returnFocus the element focus goes back to when the menu is left with Escape or a pick
 *   onClose     called once, when it closes for any reason
 */
export function MenuSurface({ entries, label, anchor, placement = "bottom-end", initial = "first", autoFocus = true, returnFocus = null, onClose, id: givenId, header = null }) {
  const autoId = useId();
  const menuId = givenId || "menu" + autoId.replace(/:/g, "");
  const rootRows = menuRows(entries);
  const start = (rows) => (initial === "last" ? lastItem(rows) : initial === "none" ? -1 : firstItem(rows));
  const [stack, setStack] = useState(() => [{ rows: rootRows, at: start(rootRows), anchor: null, label, confirm: -1 }]);
  const panels = useRef([]);
  const buffer = useRef({ text: "", timer: 0 });
  const closed = useRef(false);
  const latest = useRef({ onClose, returnFocus });
  latest.current = { onClose, returnFocus };
  // The root's rows follow the entries (a toggle's tick changes while the menu is open).
  const live = stack.map((lv, i) => (i === 0 ? { ...lv, rows: rootRows } : lv));
  const top = live.length - 1;

  const close = useCallback((refocus) => {
    if (closed.current) return;
    closed.current = true;
    const back = latest.current.returnFocus;
    if (refocus && back && typeof back.focus === "function" && back.isConnected !== false) back.focus({ preventScroll: true });
    latest.current.onClose?.();
  }, []);
  useEffect(() => () => clearTimeout(buffer.current.timer), []);

  // Pressing outside closes it (what opened it counts as inside: its own click toggles).
  useClickAway(true, (target) => !!target.closest?.("[data-c-menu]") || (anchor && typeof anchor.contains === "function" && anchor.contains(target)), () => close(false), { escape: false, event: "pointerdown" });
  // It floats over the page: it closes when the window goes away or what is under it moves.
  useEffect(() => {
    const shut = () => close(false);
    const moved = (e) => { if (!(e.target instanceof Element) || !e.target.closest?.("[data-c-menu]")) close(false); };
    window.addEventListener("blur", shut);
    window.addEventListener("resize", shut);
    document.addEventListener("scroll", moved, true);
    return () => { window.removeEventListener("blur", shut); window.removeEventListener("resize", shut); document.removeEventListener("scroll", moved, true); };
  }, [close]);

  // Each panel is placed once it is measured: below or above, flipped at the window's edges.
  useLayoutEffect(() => {
    live.forEach((lv, i) => {
      const node = panels.current[i];
      if (!node || node.dataset.placed === String(lv.rows.length) + ":" + (lv.confirm >= 0)) return;
      node.style.maxHeight = "none";
      const size = { width: node.offsetWidth || 240, height: node.scrollHeight || node.offsetHeight || 200 };
      const spot = i === 0 ? placeMenu(rectOf(anchor), size, viewSize(), placement) : placeMenu(rectOf(lv.anchor), size, viewSize(), "right-start");
      Object.assign(node.style, { left: spot.left + "px", top: spot.top + "px", maxHeight: spot.maxHeight + "px", visibility: "visible", transformOrigin: (spot.up ? "bottom " : "top ") + (spot.side === "end" || spot.side === "left" ? "right" : "left") });
      node.dataset.placed = String(lv.rows.length) + ":" + (lv.confirm >= 0);
    });
  });
  // Roving focus: the active item has it (unless focus is to stay where it was).
  useLayoutEffect(() => {
    const lv = live[top], panel = panels.current[top];
    if (!panel || !autoFocus) return;
    if (lv.confirm >= 0) { panel.querySelector("[data-autofocus]")?.focus({ preventScroll: true }); return; }
    const node = nodeOf(panel, lv.at);
    if (node) { node.focus({ preventScroll: true }); node.scrollIntoView?.({ block: "nearest" }); } else panel.focus({ preventScroll: true });
  }, [top, live[top]?.at, live[top]?.confirm, autoFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLevel = (i, patch) => setStack((s) => s.slice(0, i + 1).map((lv, j) => (j === i ? { ...lv, ...patch } : lv)));
  const openSub = (level, index) => {
    const item = live[level].rows[index]?.item;
    if (!item?.items || item.disabled) return;
    const rows = menuRows(item.items);
    const node = nodeOf(panels.current[level], index);
    setStack((s) => [...s.slice(0, level + 1).map((lv, j) => (j === level ? { ...lv, at: index } : lv)), { rows, at: firstItem(rows), anchor: node, label: item.subLabel || item.label, confirm: -1, parent: index }]);
  };
  const back = (level) => {
    if (level <= 0) return;
    setStack((s) => s.slice(0, level));
    if (autoFocus) requestAnimationFrame(() => nodeOf(panels.current[level - 1], live[level - 1].at)?.focus({ preventScroll: true }));
  };
  const run = (item, e) => {
    close(!item.href);
    if (item.onSelect) Promise.resolve().then(() => item.onSelect(e)).catch(() => {});
  };
  const pick = (level, index, e) => {
    const item = live[level].rows[index]?.item;
    if (!item) return;
    if (item.disabled) { e?.preventDefault?.(); return; }
    if (item.items) { e?.preventDefault?.(); openSub(level, index); return; }
    if (item.confirm) { e?.preventDefault?.(); setLevel(level, { at: index, confirm: index }); return; }
    if (item.keepOpen) { item.onSelect?.(e); return; }
    run(item, e);
  };
  const hover = (level, index) => {
    if (live[level].at === index && top === level) return;
    if (live[level].confirm >= 0) return;
    const item = live[level].rows[index]?.item;
    setStack((s) => s.slice(0, level + 1).map((lv, j) => (j === level ? { ...lv, at: index } : lv)));
    if (item?.items && !item.disabled) requestAnimationFrame(() => openSub(level, index));
  };

  // Keys are read for the whole document while it is open, so they work with focus in a field.
  const keys = useRef(null);
  keys.current = (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const lv = live[top];
    if (lv.confirm >= 0) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setLevel(top, { confirm: -1 }); }
      return;
    }
    const next = menuKey(lv.rows, { at: lv.at, buffer: buffer.current.text, nested: top > 0 }, e);
    if (next.handled) { e.preventDefault(); e.stopPropagation(); }
    clearTimeout(buffer.current.timer);
    buffer.current = { text: next.buffer, timer: next.buffer ? setTimeout(() => { buffer.current.text = ""; }, TYPE_PAUSE) : 0 };
    if (next.close) { close(next.refocus); return; }
    if (next.back) { back(top); return; }
    if (next.at !== lv.at) setLevel(top, { at: next.at });
    if (next.open) openSub(top, next.at);
    else if (next.activate) {
      const node = nodeOf(panels.current[top], next.at);
      if (node) node.click(); else pick(top, next.at);
    }
  };
  useEffect(() => {
    const onKey = (e) => keys.current(e);
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const panel = (lv, level) => {
    const confirming = lv.confirm >= 0 ? lv.rows[lv.confirm]?.item : null;
    return h("div", {
      key: level, ref: (el) => { panels.current[level] = el; }, id: level ? menuId + "-sub" : menuId, "data-c-menu": "",
      role: confirming ? "dialog" : "menu", "aria-label": confirming ? (confirming.confirm?.title || confirming.label) : lv.label || undefined,
      tabIndex: -1, className: "c-menu", style: { left: 0, top: 0, visibility: "hidden" },
      onContextMenu: (e) => e.preventDefault(),
      onMouseDown: autoFocus ? undefined : (e) => e.preventDefault(),
      onBlur: (e) => { const to = e.relatedTarget; if (to && !to.closest?.("[data-c-menu]") && !(anchor?.contains?.(to))) close(false); },
    }, confirming
      ? h(Confirm, { item: confirming, onYes: () => run(confirming), onNo: () => setLevel(level, { confirm: -1 }) })
      : [level === 0 && header ? h("div", { key: "header", className: "c-menu-header", role: "presentation" }, header) : null, ...lv.rows.map((row, i) => (row.kind === "separator" ? h("div", { key: row.key, role: "separator", className: "c-menu-sep" })
        : row.kind === "heading" ? h("div", { key: row.key, role: "presentation", className: "c-menu-head" }, row.label)
          : h(Row, { key: row.key, row, index: i, active: lv.at === i, expanded: live[level + 1]?.parent === i, menuId, onPointer: (j) => hover(level, j), onPick: (j, e) => pick(level, j, e) })))]);
  };

  if (typeof document === "undefined") return null;
  return createPortal(h(Fragment, null, live.map(panel)), document.body);
}

/**
 * A button that opens a menu: aria-haspopup, aria-expanded, ↓ / Enter / Space open it on the
 * first item, ↑ on the last; focus comes back to it after.
 *   items       entries, or a function returning them (read each time it draws open)
 *   label       the button's name (aria-label and title) unless `children` says it in words
 *   menuLabel   the menu's name (default: label)
 *   openStyle   added to `style` while open (default: the chip background)
 */
export function MenuButton({ items, label, menuLabel, placement = "bottom-end", children, className, style, openStyle = OPEN, title, disabled = false, open: openProp, onOpenChange, buttonProps = null, showTitle = true, header = null }) {
  const [own, setOwn] = useState(null); // null | "first" | "last"
  // Controlled when `open` is given (a shortcut elsewhere opens it): true | "first" | "last" | false.
  const open = openProp === undefined ? own : openProp ? (typeof openProp === "string" ? openProp : "first") : null;
  const button = useRef(null);
  const setOpen = (v) => { if (openProp === undefined) setOwn(v); onOpenChange?.(v || false); };
  const menuId = "mb" + useId().replace(/:/g, "");
  const entries = open ? (typeof items === "function" ? items() : items) : null;
  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(e.key === "ArrowUp" ? "last" : "first"); }
  };
  return h(Fragment, null,
    h("button", {
      ref: button, type: "button", className, disabled, title: showTitle ? (title ?? label) : title,
      "aria-label": label, "aria-haspopup": "menu", "aria-expanded": open ? "true" : "false", "aria-controls": open ? menuId : undefined,
      onClick: () => setOpen(open ? null : "first"), onKeyDown,
      style: open ? { ...style, ...openStyle } : style,
      ...buttonProps,
    }, children),
    open ? h(MenuSurface, { id: menuId, entries, label: menuLabel || label, anchor: button.current, placement, initial: open, header, returnFocus: button.current, onClose: () => setOpen(null) }) : null);
}
const OPEN = { background: "var(--c-chip)" };

/**
 * A right-click menu for one part of the page. `build(event)` returns { label, items } or
 * null (no menu: the app-wide one, components/ContextMenu.jsx, answers instead). The keyboard's
 * context-menu key (or Shift+F10) opens it under the focused element.
 */
export function useContextMenu(build) {
  const [state, setState] = useState(null);
  const onContextMenu = useCallback((e) => {
    if (e.defaultPrevented) return;
    const spec = build(e);
    if (!spec || !spec.items?.length) return;
    e.preventDefault();
    const keyboard = !e.clientX && !e.clientY;
    const target = e.currentTarget;
    setState({ ...spec, anchor: keyboard ? target.getBoundingClientRect() : { x: e.clientX, y: e.clientY }, back: document.activeElement, keyboard });
  }, [build]);
  const menu = state ? h(MenuSurface, { entries: state.items, label: state.label, anchor: state.anchor, placement: state.keyboard ? "bottom-start" : "point", returnFocus: state.back, onClose: () => setState(null) }) : null;
  return { onContextMenu, menu, open: !!state, close: () => setState(null) };
}
