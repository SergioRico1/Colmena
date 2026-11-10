// Keyboard or pointer? Browsers match `:focus-visible` on a text field however it got
// focus, so a click would draw the ring too. The fields that sit in a box of their own
// (classes c-quiet / c-bare, styles/base.css) only show it while <html data-kbd> is set:
// Tab sets it, any press of the mouse, pen or finger clears it.

/** Whether this key press means «I am moving with the keyboard». */
export const isKeyboardMove = (e) => e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey;

let watching = false;
export function watchFocusModality(doc = typeof document === "undefined" ? null : document) {
  if (!doc || watching) return;
  watching = true;
  const root = doc.documentElement;
  doc.addEventListener("keydown", (e) => { if (isKeyboardMove(e)) root.setAttribute("data-kbd", ""); }, true);
  const pointer = () => root.removeAttribute("data-kbd");
  doc.addEventListener("pointerdown", pointer, true);
  doc.addEventListener("mousedown", pointer, true);
}
