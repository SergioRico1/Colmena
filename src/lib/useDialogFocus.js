import { useEffect, useRef } from "react";

// Keyboard focus for modal dialogs, in one place. While a dialog is open:
//   - focus moves inside it (an autofocused field keeps it; otherwise the element marked
//     `data-autofocus`, otherwise the first control, otherwise the dialog itself);
//   - Tab and Shift+Tab stay inside;
//   - Escape runs `onEscape` (only if given: a dialog that must be answered passes none);
//   - on close, focus returns to what had it before the dialog opened.
// Dialogs stack: only the one opened last answers the keys, so a dialog over another (the
// command palette over a sheet) closes alone. A key somebody already handled
// (`preventDefault`: a menu inside the dialog, the palette's own Tab) is left alone.

/** The backdrop of every modal dialog: a plain ink veil over the app, never a blur. */
export const DIALOG_VEIL = "rgba(18, 19, 26, 0.55)";

const FOCUSABLE = [
  "a[href]", "button", "input", "select", "textarea", "summary", "iframe",
  "audio[controls]", "video[controls]", "[contenteditable='']", "[contenteditable='true']", "[tabindex]",
].join(",");

function reachable(el) {
  if (el.disabled || el.getAttribute("tabindex") === "-1") return false;
  if (el.tagName === "INPUT" && el.type === "hidden") return false;
  if (el.closest?.("[inert],[hidden]")) return false;
  // Not laid out (display:none, a closed <details>): the browser would skip it too.
  if (typeof el.getClientRects === "function" && el.isConnected && typeof getComputedStyle === "function") {
    try {
      if (!el.getClientRects().length) return false;
      if (getComputedStyle(el).visibility === "hidden") return false;
    } catch { /* a document without layout (tests): everything counts */ }
  }
  return true;
}

/** The controls Tab stops at inside `container`, in document order. */
export function focusableIn(container) {
  if (!container?.querySelectorAll) return [];
  return [...container.querySelectorAll(FOCUSABLE)].filter(reachable);
}

/**
 * Where Tab must go so that focus stays in the list: the element to focus, or null when
 * the browser's own step already stays inside (so radio groups and the like keep working).
 * `container` is returned for a dialog with no controls at all.
 */
export function tabTarget(list, current, backwards, container = null) {
  if (!list.length) return container;
  const at = list.indexOf(current);
  if (at < 0) {
    // Focus is on the dialog itself, on something not tabbable inside it, or outside.
    const inside = container && current && container !== current && container.contains(current);
    if (inside) return null;
    return backwards ? list[list.length - 1] : list[0];
  }
  if (backwards && at === 0) return list[list.length - 1];
  if (!backwards && at === list.length - 1) return list[0];
  return null;
}

/** What gets focus when the dialog opens (null: leave focus where it is). */
export function initialTarget(container, active) {
  if (!container) return null;
  if (active && active !== container && container.contains(active)) return null; // an autofocused field
  if (container.matches?.("[data-autofocus]")) return container;
  const marked = [...container.querySelectorAll("[data-autofocus]")].find((el) => !el.disabled);
  return marked || focusableIn(container)[0] || container;
}

const stack = []; // open dialogs, the last one on top
// The last elements that had focus: an autofocused field takes focus before the dialog's
// effect runs, so «what opened it» is read from here.
const trail = [];
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("focusin", (e) => {
    if (trail[trail.length - 1] !== e.target) trail.push(e.target);
    if (trail.length > 4) trail.shift();
  }, true);
}

const focus = (el) => { try { el.focus({ preventScroll: true }); } catch { /* gone */ } };

/**
 * @param {object} [options]
 * @param {() => void} [options.onEscape] closes the dialog; omit for one that must be answered
 * @param {boolean} [options.active=true] for dialogs that stay mounted while closed
 * @param {boolean} [options.restoreFocus=true] return focus to the opener on close
 * @param {{current: HTMLElement|null}} [options.ref] use this ref instead of a new one
 * @returns {{current: HTMLElement|null}} the ref to put on the dialog element
 */
export function useDialogFocus({ onEscape, active = true, restoreFocus = true, ref } = {}) {
  const own = useRef(null);
  const box = ref || own;
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    const node = box.current;
    if (!active || !node) return undefined;
    const body = document.body;
    const opener = [...trail, document.activeElement].reverse().find((el) => el && el !== body && el !== node && !node.contains(el) && el.isConnected) || null;

    const first = initialTarget(node, document.activeElement);
    if (first) {
      if (first === node && !node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
      focus(first);
    }

    const entry = { node };
    stack.push(entry);
    const onKey = (e) => {
      if (stack[stack.length - 1] !== entry || e.defaultPrevented) return;
      if (e.key === "Escape") {
        if (escape.current) escape.current(e);
        return;
      }
      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
      const to = tabTarget(focusableIn(node), document.activeElement, e.shiftKey, node);
      if (!to) return;
      e.preventDefault();
      focus(to);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = stack.indexOf(entry);
      if (at >= 0) stack.splice(at, 1);
      if (!restoreFocus || !opener || !opener.isConnected) return;
      // Only when focus was left behind in the dialog: a close that already sent focus
      // somewhere (a new screen's field) keeps it there.
      const now = document.activeElement;
      if (!now || now === body || now === node || node.contains(now)) focus(opener);
    };
  }, [active, restoreFocus, box]);

  return box;
}
