import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

// The app's one menu (src/components/Menu.js, src/lib/menu.js): the pure helpers (groups,
// roles, the keyboard model, placement) and the component mounted with React in a linkedom
// document, as tests/dialog-focus.test.mjs does (linkedom has no focus or layout of its own:
// the test gives it focus(), document.activeElement and a measured size).

const { window, document } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
let active = document.body;
Object.defineProperty(document, "activeElement", { configurable: true, get: () => (active?.isConnected ? active : document.body) });
const proto = Object.getPrototypeOf(Object.getPrototypeOf(document.createElement("div"))); // HTMLElement.prototype
proto.focus = function focus() { active = this; };
proto.getBoundingClientRect = function rect() { return { left: 900, top: 40, right: 932, bottom: 72, width: 32, height: 32 }; };
Object.defineProperty(proto, "offsetWidth", { configurable: true, get() { return this.classList?.contains("c-menu") ? 240 : 0; } });
Object.defineProperty(proto, "scrollHeight", { configurable: true, get() { return this.classList?.contains("c-menu") ? 300 : 0; } });
window.innerWidth = 1440;
window.innerHeight = 900;
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Element: window.Element, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn) => setTimeout(fn, 0) });

const { menuGroups, menuRows, itemRole, menuKey, nextItem, firstItem, lastItem, placeMenu, shortcutKeys } = await import("../src/lib/menu.js");
const { MenuButton } = await import("../src/components/Menu.js");
const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");

const key = (k, more = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...more });

// ------------------------------------------------------------------ groups and rows
test("groups: loose entries form groups, empty ones go, destructive entries always end the menu", () => {
  const groups = menuGroups([
    { label: "Cambiar el nombre" },
    null,
    { label: "Archivar", danger: true },
    { group: "Panel lateral", items: [{ label: "Progreso", checked: true }, false, { label: "Terminal", checked: false }] },
    { group: "Vacío", items: [null] },
    { label: "Mover a Trabajo" },
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.label)]), [
    [null, ["Cambiar el nombre"]],
    ["Panel lateral", ["Progreso", "Terminal"]],
    [null, ["Mover a Trabajo"]],
    [null, ["Archivar"]],
  ]);
  assert.deepEqual(menuGroups([]), []);
  assert.deepEqual(menuGroups(null), []);
});

test("rows: a line between groups, a heading where a group has a name", () => {
  const rows = menuRows([{ label: "A" }, { group: "Ver", items: [{ label: "B" }] }, { label: "Borrar", danger: true }]);
  assert.deepEqual(rows.map((r) => r.kind + (r.label ? ":" + r.label : r.item ? ":" + r.item.label : "")), ["item:A", "separator", "heading:Ver", "item:B", "separator", "item:Borrar"]);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, "every row has its own key");
});

test("roles: a toggle is a checkbox, one of a set is a radio, the rest are plain items", () => {
  assert.equal(itemRole({ label: "x" }), "menuitem");
  assert.equal(itemRole({ label: "x", checked: false }), "menuitemcheckbox");
  assert.equal(itemRole({ label: "x", checked: true, radio: "team" }), "menuitemradio");
});

test("shortcuts are shown as keys, in the app's words", () => {
  assert.deepEqual(shortcutKeys("mod+shift+s"), ["Ctrl", "Mayús", "S"]);
  assert.deepEqual(shortcutKeys("Ctrl+,"), ["Ctrl", ","]);
  assert.deepEqual(shortcutKeys(""), []);
});

// ------------------------------------------------------------------ the keyboard model
const rows = menuRows([
  { label: "Cambiar el nombre" }, { label: "Reglas de la sala" },
  { group: "Ver", items: [{ label: "Posponer", items: [{ label: "Hasta mañana" }] }, { label: "Solo lectura", disabled: "No eres el creador" }] },
  { label: "Archivar la sala", danger: true },
]);
const idx = (label) => rows.findIndex((r) => r.item?.label === label);

test("arrows wrap round, skipping lines and headings; Home and End go to the ends", () => {
  assert.equal(firstItem(rows), idx("Cambiar el nombre"));
  assert.equal(lastItem(rows), idx("Archivar la sala"));
  assert.equal(menuKey(rows, { at: idx("Reglas de la sala") }, key("ArrowDown")).at, idx("Posponer"), "the line and the heading are skipped");
  assert.equal(menuKey(rows, { at: lastItem(rows) }, key("ArrowDown")).at, firstItem(rows), "down from the last wraps to the first");
  assert.equal(menuKey(rows, { at: firstItem(rows) }, key("ArrowUp")).at, lastItem(rows), "up from the first wraps to the last");
  assert.equal(menuKey(rows, { at: -1 }, key("ArrowUp")).at, lastItem(rows), "up with nothing active lands on the last");
  assert.equal(menuKey(rows, { at: idx("Posponer") }, key("Home")).at, firstItem(rows));
  assert.equal(menuKey(rows, { at: idx("Posponer") }, key("End")).at, lastItem(rows));
  assert.equal(nextItem([], 0, 1), -1);
});

test("a disabled item is landed on (its reason is read) but never run", () => {
  const at = idx("Solo lectura");
  assert.equal(menuKey(rows, { at: idx("Posponer") }, key("ArrowDown")).at, at);
  const enter = menuKey(rows, { at }, key("Enter"));
  assert.equal(enter.handled, true);
  assert.equal(enter.activate, undefined);
});

test("Enter and Space run an item; on a submenu they, and →, open it; ← and Escape come back", () => {
  assert.equal(menuKey(rows, { at: 0 }, key("Enter")).activate, true);
  assert.equal(menuKey(rows, { at: 0 }, key(" ")).activate, true);
  assert.equal(menuKey(rows, { at: 0 }, key("ArrowRight")).open, undefined, "→ on a plain item does nothing");
  assert.equal(menuKey(rows, { at: idx("Posponer") }, key("ArrowRight")).open, true);
  assert.equal(menuKey(rows, { at: idx("Posponer") }, key("Enter")).open, true);
  assert.equal(menuKey(rows, { at: 0, nested: true }, key("ArrowLeft")).back, true);
  assert.equal(menuKey(rows, { at: 0, nested: false }, key("ArrowLeft")).back, undefined, "← in the main menu stays");
  assert.equal(menuKey(rows, { at: 0, nested: true }, key("Escape")).back, true, "Escape in a submenu goes back one level");
  const esc = menuKey(rows, { at: 0 }, key("Escape"));
  assert.equal(esc.close && esc.refocus, true, "Escape in the menu closes it and gives focus back");
  const tab = menuKey(rows, { at: 0 }, key("Tab"));
  assert.equal(tab.close, true);
  assert.equal(tab.handled, false, "Tab is left to the browser");
});

test("typing finds an item by its first letters, accents aside", () => {
  assert.equal(menuKey(rows, { at: 0 }, key("r")).at, idx("Reglas de la sala"));
  assert.equal(menuKey(rows, { at: 0, buffer: "" }, key("a")).at, idx("Archivar la sala"));
  assert.equal(menuKey(rows, { at: 0, buffer: "p" }, key("o")).at, idx("Posponer"));
  assert.equal(menuKey(rows, { at: 0 }, key("z")).at, 0, "no match: stays");
  assert.equal(menuKey(rows, { at: 0 }, key("r", { ctrlKey: true })).handled, false, "a shortcut is not typing");
});

// ------------------------------------------------------------------ placement
const view = { width: 1440, height: 900 };
test("placement: under the button, flipped above or to the other side when it does not fit, never off the window", () => {
  const button = { left: 1380, top: 40, right: 1412, bottom: 72 };
  const below = placeMenu(button, { width: 260, height: 300 }, view, "bottom-end");
  assert.deepEqual([below.left, below.top, below.up], [1412 - 260, 76, false], "right edges lined up, 4 px under");
  const low = { left: 20, top: 820, right: 52, bottom: 852 };
  const up = placeMenu(low, { width: 260, height: 300 }, view, "bottom-start");
  assert.equal(up.up, true);
  assert.equal(up.top, 820 - 4 - 300);
  const wide = placeMenu({ left: 1430, top: 100, right: 1430, bottom: 100 }, { width: 260, height: 300 }, view, "point");
  assert.equal(wide.left, 1430 - 260, "a right-click at the edge opens to the left");
  const tall = placeMenu({ left: 10, top: 450, right: 10, bottom: 450 }, { width: 260, height: 2000 }, view, "point");
  assert.ok(tall.top >= 8 && tall.top + Math.min(2000, tall.maxHeight) <= 892, "a long menu scrolls inside the window");
  const sub = placeMenu({ left: 1200, top: 300, right: 1420, bottom: 332 }, { width: 240, height: 160 }, view, "right-start");
  assert.equal(sub.side, "left", "a submenu with no room on the right opens on the left");
  assert.equal(sub.left, 1200 - 4 - 240);
  const subRight = placeMenu({ left: 100, top: 880, right: 320, bottom: 900 }, { width: 240, height: 160 }, view, "right-start");
  assert.equal(subRight.left, 324);
  assert.equal(subRight.top, 900 - 8 - 160, "pushed up to stay in the window");
});

// ------------------------------------------------------------------ mounted
const press = (k, more = {}) => {
  const e = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(e, key(k, more));
  (document.activeElement || document.body).dispatchEvent(e);
  return e;
};
const log = [];
let api = null;
function App() {
  const [on, setOn] = useState(false);
  api = { on };
  return h("div", null,
    h("button", { id: "before" }, "antes"),
    h(MenuButton, { label: "Más opciones", items: () => [
      { label: "Cambiar el nombre", onSelect: () => log.push("rename") },
      { group: "Panel lateral", items: [{ label: "Progreso", checked: on, keepOpen: true, onSelect: () => setOn((v) => !v) }] },
      { label: "Posponer", items: [{ label: "Hasta mañana", onSelect: () => log.push("snooze") }] },
      { label: "Fijar", disabled: "Ya está fijada", onSelect: () => log.push("never") },
      { label: "Salir de la sala", danger: true, confirm: { title: "¿Salir?", text: "Dejarás de recibir lo que se escriba.", action: "Salir" }, onSelect: () => log.push("leave") },
    ] }, "…"));
}
const menu = () => document.querySelector("[role=menu]");
const items = (root = menu()) => [...(root?.querySelectorAll("[role^=menuitem]") || [])];
const flush = () => act(() => new Promise((r) => setTimeout(r, 5)));

test("mounted: roles, focus in and back, arrows, a toggle, a submenu, a confirmation", async () => {
  const root = createRoot(document.getElementById("root"));
  await act(() => root.render(h(App)));
  const button = document.querySelector("[aria-haspopup=menu]");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  button.focus();

  // ↓ on the button opens it on the first item.
  await act(() => { button.dispatchEvent(Object.assign(new window.Event("keydown", { bubbles: true, cancelable: true }), key("ArrowDown"))); });
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(button.getAttribute("aria-controls"), menu().id);
  assert.equal(menu().getAttribute("aria-label"), "Más opciones");
  assert.deepEqual(items().map((n) => n.getAttribute("role")), ["menuitem", "menuitemcheckbox", "menuitem", "menuitem", "menuitem"]);
  assert.equal(items()[1].getAttribute("aria-checked"), "false");
  assert.equal(items()[2].getAttribute("aria-haspopup"), "menu");
  assert.equal(items()[3].getAttribute("aria-disabled"), "true");
  assert.equal(items()[3].getAttribute("title"), "Ya está fijada", "the reason it cannot be used");
  assert.equal(items().at(-1).className.includes("danger"), true);
  assert.equal(menu().querySelector(".c-menu-head").textContent, "Panel lateral");
  assert.equal(menu().querySelectorAll("[role=separator]").length, 3);
  assert.equal(document.activeElement, items()[0], "focus goes to the first item");
  assert.equal(menu().style.visibility, "visible", "placed once measured");
  assert.equal(menu().style.left, (932 - 240) + "px", "right edges lined up with the button");

  // Arrows; a toggle that keeps the menu open and says its new state.
  await act(() => { press("ArrowDown"); });
  assert.equal(document.activeElement, items()[1]);
  await act(() => { press("Enter"); });
  await flush();
  assert.equal(api.on, true);
  assert.equal(items()[1].getAttribute("aria-checked"), "true", "the tick follows the state while open");

  // → opens the submenu on its first item; ← comes back to «Posponer».
  await act(() => { press("ArrowDown"); });
  await act(() => { press("ArrowRight"); });
  await flush();
  const menus = () => [...document.querySelectorAll("[role=menu]")];
  assert.equal(menus().length, 2);
  assert.equal(items()[2].getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement.textContent, "Hasta mañana");
  await act(() => { press("ArrowLeft"); });
  await flush();
  assert.equal(menus().length, 1);
  assert.equal(document.activeElement, items()[2]);

  // A disabled item does nothing; End goes to the destructive one, which asks first.
  await act(() => { press("ArrowDown"); });
  await act(() => { press("Enter"); });
  assert.ok(menu(), "Enter on a disabled item keeps the menu open");
  await act(() => { press("End"); });
  await act(() => { press("Enter"); });
  await flush();
  const ask = document.querySelector("[data-c-menu][role=dialog]");
  assert.ok(ask, "the confirmation is asked inside the menu");
  assert.equal(document.activeElement.textContent, "Cancelar", "focus on the safe answer");
  await act(() => { press("Escape"); });
  assert.ok(menu(), "Escape in the question goes back to the list");
  await act(() => { press("Enter"); });
  await flush();
  const yes = [...document.querySelectorAll(".c-menu-btn")].find((b) => b.textContent === "Salir");
  await act(() => { yes.click(); });
  await flush();
  assert.equal(menu(), null);
  assert.deepEqual(log, ["leave"]);
  assert.equal(document.activeElement, button, "focus goes back to the button");
  assert.equal(log.includes("never"), false);

  // Typing picks by letter; Escape closes and gives focus back.
  await act(() => { button.click(); });
  assert.equal(document.activeElement, items()[0]);
  await act(() => { press("p"); });
  assert.equal(document.activeElement.textContent.startsWith("Progreso"), true);
  await act(() => { press("Escape"); });
  assert.equal(menu(), null);
  assert.equal(document.activeElement, button);

  // A click on an item runs it after the menu closes.
  await act(() => { button.click(); });
  await act(() => { items()[0].click(); });
  await flush();
  assert.deepEqual(log, ["leave", "rename"]);
  assert.equal(menu(), null);

  // A pointer opens it with nothing lit (focus on the menu; ↓ lands on the first item).
  await act(() => { button.dispatchEvent(Object.assign(new window.Event("click", { bubbles: true, cancelable: true }), { detail: 1 })); });
  assert.equal(menu().querySelectorAll("[data-active]").length, 0, "no item lit under a pointer that has not moved");
  assert.equal(document.activeElement, menu());
  await act(() => { press("ArrowDown"); });
  assert.equal(document.activeElement, items()[0]);
  await act(() => { press("Escape"); });

  // ↑ on the button opens it on the last item; pressing outside closes it.
  await act(() => { button.dispatchEvent(Object.assign(new window.Event("keydown", { bubbles: true, cancelable: true }), key("ArrowUp"))); });
  assert.equal(document.activeElement.textContent, "Salir de la sala");
  await act(() => { document.getElementById("before").dispatchEvent(new window.Event("pointerdown", { bubbles: true })); });
  assert.equal(menu(), null);

  await act(() => root.unmount());
});
