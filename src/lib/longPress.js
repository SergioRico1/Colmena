// A long press is a right-click on a touch screen. Android's browsers already fire «contextmenu»
// after a long press; iOS Safari does not, so a message's or a row's menu (components/Menu.js ›
// useContextMenu) would have no way in. This fires one where the browser did not: a finger held
// still for LONG_PRESS ms on something that is not a field. Installed once, in a browser only.
export const LONG_PRESS = 550;

/**
 * A message's toolbar (react, reply, copy…: .msg-actions, styles/base.css) shows on hover. A tap on
 * the message with a finger shows it too (.is-touched, styles/responsive.css); a tap on another
 * message, or the same one again, hides it. Taps on its links and buttons do what they do.
 */
export function installTouchReveal(target = typeof window !== "undefined" ? window : null) {
  if (!target || typeof target.addEventListener !== "function") return () => {};
  const onUp = (e) => {
    if (e.pointerType !== "touch" || !e.target?.closest) return;
    const row = e.target.closest(".msg-row");
    const shown = typeof document !== "undefined" ? document.querySelector(".msg-row.is-touched") : null;
    if (shown && shown !== row) shown.classList.remove("is-touched");
    if (row && !e.target.closest("a[href], button, input, textarea, select, [role=button], [role=menuitem]")) row.classList.toggle("is-touched");
  };
  target.addEventListener("pointerup", onUp, { passive: true });
  return () => target.removeEventListener("pointerup", onUp);
}
const SLOP = 10; // px a finger may drift and still be «held»

export function installLongPress(target = typeof window !== "undefined" ? window : null) {
  if (!target || typeof target.addEventListener !== "function") return () => {};
  let timer = 0, start = null, native = false;
  const cancel = () => { clearTimeout(timer); timer = 0; start = null; };
  const onStart = (e) => {
    if (e.touches?.length !== 1) return cancel();
    const t = e.touches[0];
    const el = e.target;
    if (!el?.closest || el.closest("input, textarea, select, [contenteditable=''], [contenteditable=true], [data-no-long-press]")) return;
    native = false;
    start = { x: t.clientX, y: t.clientY, el };
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = start;
      cancel();
      if (!s || native || !s.el.isConnected) return;
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: s.x, clientY: s.y, button: 2 });
      s.el.dispatchEvent(ev);
      // Something opened a menu: the finger lifting must not also click what is under it.
      if (ev.defaultPrevented) target.addEventListener("click", (c) => { c.preventDefault(); c.stopPropagation(); }, { capture: true, once: true });
    }, LONG_PRESS);
  };
  const onMove = (e) => {
    if (!start) return;
    const t = e.touches?.[0];
    if (!t || Math.abs(t.clientX - start.x) > SLOP || Math.abs(t.clientY - start.y) > SLOP) cancel();
  };
  const onNative = () => { native = true; cancel(); };
  target.addEventListener("touchstart", onStart, { passive: true });
  target.addEventListener("touchmove", onMove, { passive: true });
  target.addEventListener("touchend", cancel, { passive: true });
  target.addEventListener("touchcancel", cancel, { passive: true });
  target.addEventListener("contextmenu", onNative, { capture: true });
  return () => {
    cancel();
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchmove", onMove);
    target.removeEventListener("touchend", cancel);
    target.removeEventListener("touchcancel", cancel);
    target.removeEventListener("contextmenu", onNative, { capture: true });
  };
}
