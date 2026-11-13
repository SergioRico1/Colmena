// The app's menus (components/Menu.js), as pure functions so they can be tested without a
// browser: how a list of entries becomes rows, how a key moves through them, where the menu
// goes on screen.
//
// Entries, as call sites write them:
//   { label, icon?, hint?, shortcut?, meta?, onSelect?, href?, disabled?, danger?, checked?,
//     radio?, items?, confirm?, keepOpen?, id? }
//   { group: "Ver" | null, items: [entry, …] }        a group, with an optional small heading
//   null / false / undefined                          left out (so `cond ? {...} : null` works)
// Loose entries between groups form groups of their own. `danger` entries (irreversible or
// destructive) always end the menu, in a last group of their own. `disabled` may be a string:
// the reason it cannot be used now (said as the item's title and to a screen reader).
//
// Rows, as the menu draws them: { kind: "item", item, key } · { kind: "separator", key } ·
// { kind: "heading", label, key }.

import { typeahead } from "./select.js";

const isGroup = (e) => !!e && typeof e === "object" && Array.isArray(e.items) && "group" in e;
const present = (list) => (Array.isArray(list) ? list.filter((e) => e !== null && e !== undefined && e !== false) : []);

/** The groups of a menu: [{ label, items }], destructive entries last, empty groups dropped. */
export function menuGroups(entries) {
  const groups = [];
  let loose = null;
  for (const e of present(entries)) {
    if (isGroup(e)) { loose = null; groups.push({ label: e.group || null, items: present(e.items) }); continue; }
    if (!loose) { loose = { label: null, items: [] }; groups.push(loose); }
    loose.items.push(e);
  }
  const danger = [];
  for (const g of groups) {
    danger.push(...g.items.filter((it) => it.danger));
    g.items = g.items.filter((it) => !it.danger);
  }
  const out = groups.filter((g) => g.items.length);
  if (danger.length) out.push({ label: null, items: danger });
  return out;
}

/** The rows to draw: groups split by a line, each with its heading when it has one. */
export function menuRows(entries) {
  const rows = [];
  menuGroups(entries).forEach((g, gi) => {
    if (gi) rows.push({ kind: "separator", key: "sep:" + gi });
    if (g.label) rows.push({ kind: "heading", label: g.label, key: "head:" + gi });
    g.items.forEach((item, ii) => rows.push({ kind: "item", item, key: item.id || `${gi}:${ii}:${item.label}` }));
  });
  return rows;
}

/** The ARIA role of an item: a toggle is a checkbox, one of a set a radio, the rest plain. */
export function itemRole(item) {
  if (item.radio) return "menuitemradio";
  if (typeof item.checked === "boolean") return "menuitemcheckbox";
  return "menuitem";
}

/** Rows as the select's keyboard helpers read options: only items can be landed on. */
const asOptions = (rows) => rows.map((r) => (r.kind === "item" ? { label: r.item.label, disabled: false } : { label: "", disabled: true }));
const landable = (rows, i) => i >= 0 && i < rows.length && rows[i].kind === "item";

/** The first row from `from` walking by `step` (wrapping round), or -1 when there is none. */
export function nextItem(rows, from, step) {
  const n = rows.length;
  for (let k = 1; k <= n; k += 1) {
    const i = (((from + step * k) % n) + n) % n;
    if (landable(rows, i)) return i;
  }
  return -1;
}
export const firstItem = (rows) => nextItem(rows, -1, 1);
export const lastItem = (rows) => nextItem(rows, rows.length, -1);

const printable = (e) => e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * One key in an open menu (WAI-ARIA menu pattern). `state`: { at (active row), buffer (what was
 * typed in the last moment), nested (this is a submenu) }. Returns the next `at` and `buffer`,
 * plus what to do:
 *   handled   the key was the menu's (prevent its default)
 *   activate  run the active item (Enter, Space)
 *   open      open the active item's submenu (ArrowRight, or Enter/Space on one)
 *   back      close this submenu and return to its parent (ArrowLeft, Escape in a submenu)
 *   close     close the whole menu; `refocus` gives focus back to what opened it
 * Disabled items are landed on (a screen reader says why they cannot be used) but never run.
 */
export function menuKey(rows, state, e) {
  const { at = -1, buffer = "", nested = false } = state;
  const same = { at, buffer, handled: false };
  const item = landable(rows, at) ? rows[at].item : null;
  const usable = !!item && !item.disabled;
  switch (e.key) {
    case "ArrowDown": return { ...same, at: nextItem(rows, at, 1), buffer: "", handled: true };
    case "ArrowUp": return { ...same, at: nextItem(rows, at < 0 ? rows.length : at, -1), buffer: "", handled: true };
    case "Home": case "PageUp": return { ...same, at: firstItem(rows), buffer: "", handled: true };
    case "End": case "PageDown": return { ...same, at: lastItem(rows), buffer: "", handled: true };
    case "ArrowRight": return usable && item.items ? { ...same, buffer: "", handled: true, open: true } : { ...same, handled: true };
    case "ArrowLeft": return nested ? { ...same, buffer: "", handled: true, back: true } : { ...same, handled: true };
    case "Escape": return nested ? { ...same, buffer: "", handled: true, back: true } : { ...same, buffer: "", handled: true, close: true, refocus: true };
    // Tab leaves the menu: focus goes back to its button and the browser moves on from there.
    case "Tab": return { ...same, buffer: "", close: true, refocus: true };
    case "Enter": case " ":
      if (!usable) return { ...same, buffer: "", handled: true };
      return item.items ? { ...same, buffer: "", handled: true, open: true } : { ...same, buffer: "", handled: true, activate: true };
    default:
      if (!printable(e)) return same;
      {
        const next = buffer + e.key, i = typeahead(asOptions(rows), next, at);
        return { ...same, at: i < 0 ? at : i, buffer: next, handled: true };
      }
  }
}

/**
 * Where a menu goes. `anchor`: the box it hangs from (a button's rect, or a point as a box of no
 * size); `size`: the menu's natural { width, height }; `view`: the window's { width, height }.
 * `placement`: "bottom-end" (under the button, right edges lined up: the «…» of a header),
 * "bottom-start", "top-start" / "top-end" (above, as over a composer), "right-start" (a submenu
 * beside its item) or "point" (a right-click). It flips to the side with room and never leaves
 * the window; `maxHeight` is what fits (the menu scrolls beyond it).
 */
export function placeMenu(anchor, size, view, placement = "bottom-end", { gap = 4, margin = 8 } = {}) {
  const a = { left: anchor.left, top: anchor.top, right: anchor.right ?? anchor.left, bottom: anchor.bottom ?? anchor.top };
  const fullHeight = Math.max(80, view.height - margin * 2);
  if (placement === "right-start") {
    const height = Math.min(size.height, fullHeight);
    let left = a.right + gap, side = "right";
    if (left + size.width > view.width - margin && a.left - gap - size.width >= margin) { left = a.left - gap - size.width; side = "left"; }
    left = Math.max(margin, Math.min(left, view.width - size.width - margin));
    const top = Math.max(margin, Math.min(a.top - 6, view.height - margin - height));
    return { left, top, maxHeight: fullHeight, up: false, side };
  }
  const g = placement === "point" ? 0 : gap;
  const below = view.height - a.bottom - g - margin, above = a.top - g - margin;
  const wantsUp = placement.startsWith("top");
  const up = wantsUp ? !(size.height > above && below > above) : size.height > below && above > below;
  const room = up ? above : below;
  const maxHeight = Math.max(80, Math.floor(placement === "point" ? Math.max(room, Math.min(fullHeight, size.height)) : room));
  const height = Math.min(size.height, maxHeight);
  const end = placement.endsWith("end");
  let left = end ? a.right - size.width : a.left;
  if (placement === "point" && left + size.width > view.width - margin) left = a.left - size.width; // a right-click near the edge opens to the left
  left = Math.max(margin, Math.min(left, view.width - size.width - margin));
  let top = up ? a.top - g - height : a.bottom + g;
  top = Math.max(margin, Math.min(top, view.height - margin - height));
  return { left, top, maxHeight, up, side: end ? "end" : "start" };
}

/** «Ctrl+Shift+S» as the keys a menu row shows: ["Ctrl", "Mayús", "S"]. */
export function shortcutKeys(text) {
  if (!text) return [];
  const words = { mod: "Ctrl", ctrl: "Ctrl", control: "Ctrl", shift: "Mayús", alt: "Alt", meta: "Ctrl", cmd: "Ctrl" };
  return String(text).split("+").map((k) => k.trim()).filter(Boolean).map((k) => words[k.toLowerCase()] || (k.length === 1 ? k.toUpperCase() : k));
}
