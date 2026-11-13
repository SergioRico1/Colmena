// The keyboard of the «Código» menus (menu.jsx, parts.jsx MenuChip): ↑ ↓ Home End move, a letter
// jumps to the next item starting with it, Esc closes and gives the focus back, Tab closes.
import { useEffect } from "react";

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
let typed = { text: "", at: 0 };

/** The keyboard of a menu (`close(back)`: back = give the focus back to the opener). */
export function menuKey(e, close) {
  const box = e.currentTarget;
  const items = [...box.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  const go = (k) => { e.preventDefault(); items[(k + items.length) % items.length].focus(); };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i < 0 ? items.length - 1 : i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(items.length - 1);
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
  else if (e.key === "Tab") close(false);
  else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) {
    const now = Date.now();
    typed = { text: (now - typed.at < 700 ? typed.text : "") + fold(e.key), at: now };
    const order = [...items.slice(i + 1), ...items.slice(0, i + 1)];
    const hit = order.find((el) => fold(el.getAttribute("data-label") || el.textContent).startsWith(typed.text));
    if (hit) { e.preventDefault(); hit.focus(); }
  }
}

/** The first item gets the focus when a menu opens (keyboard users land inside it). */
export function useFocusFirst(ref, open) {
  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => ref.current?.querySelector('[role^="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open, ref]);
}
