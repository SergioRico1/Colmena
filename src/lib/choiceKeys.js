import { useEffect, useRef } from "react";

// Lettered choices: a question's options read A, B, C… and the letter key answers. Only the
// card that has the focus, or else the last question waiting on screen, listens; never while
// you type (a text field, the composer), never with Ctrl/Alt/Cmd, never under an open dialog.

/** A, B, C… for the option at `index` ("" past Z). */
export const letterOf = (index) => (Number.isInteger(index) && index >= 0 && index < 26 ? String.fromCharCode(65 + index) : "");

/** The option index a key press means among `count` options, or -1. */
export function choiceIndex(event, count) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) return -1;
  const key = String(event.key || "");
  if (key.length !== 1) return -1;
  const index = key.toUpperCase().charCodeAt(0) - 65;
  return index >= 0 && index < Math.min(count, 26) ? index : -1;
}

/** Whether keys pressed on this element are text being written (or belong to a widget of its own). */
export function isTypingTarget(el) {
  if (!el || typeof el.closest !== "function") return false;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // The nearest element that says so decides (an island marked "false" inside an editor is not text).
  const editable = el.closest("[contenteditable]");
  if (editable && editable.getAttribute("contenteditable") !== "false") return true;
  return !!el.closest("[role='textbox'], [role='combobox'], [role='searchbox'], [role='menu'], [role='listbox']");
}

/**
 * Which of the cards on the page the letters belong to: the one that holds the focus, else
 * the last one in the document (the latest question). Null while a dialog is open over them.
 */
export function choiceCardFor(doc, active) {
  const cards = [...doc.querySelectorAll("[data-choice-keys]")];
  if (!cards.length) return null;
  const dialog = [...doc.querySelectorAll("[role='dialog'], [role='alertdialog'], [aria-modal='true']")].at(-1) || null;
  const usable = dialog ? cards.filter((c) => dialog.contains(c)) : cards;
  const focused = active && active !== doc.body ? usable.find((c) => c.contains(active)) : null;
  return focused || usable.at(-1) || null;
}

/**
 * Makes the letters answer. Put the returned ref on the card (it gets `data-choice-keys`).
 * @param {object} o
 * @param {number} o.count how many options have a letter (0 turns it off)
 * @param {(index: number) => void} o.onChoose
 * @param {boolean} [o.enabled=true] false while the card cannot be answered (busy, answered)
 */
export function useChoiceKeys({ count, onChoose, enabled = true }) {
  const ref = useRef(null);
  const choose = useRef(onChoose);
  choose.current = onChoose;
  const on = enabled && count > 0;
  useEffect(() => {
    const node = ref.current;
    if (!on || !node) return undefined;
    node.setAttribute("data-choice-keys", "");
    const onKey = (e) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const index = choiceIndex(e, count);
      if (index < 0 || choiceCardFor(document, document.activeElement) !== node) return;
      e.preventDefault();
      choose.current?.(index);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      node.removeAttribute("data-choice-keys");
    };
  }, [on, count]);
  return ref;
}

/** The letter in front of an option (decorative: the button says its shortcut itself). */
export function letterStyle(dark = false, size = 22) {
  return { flex: "none", width: size + "px", height: size + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: dark ? "color-mix(in srgb, var(--c-btn-text) 16%, transparent)" : "rgb(var(--c-ink-rgb) / .07)", color: dark ? "var(--c-btn-text)" : "var(--c-text-3)", font: "600 var(--t-caption)/1 'Geist Mono', monospace" };
}
