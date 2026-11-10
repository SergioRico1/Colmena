import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

// Keyboard focus in modal dialogs (src/lib/useDialogFocus.js): the pure helpers, and the hook
// mounted with React in a linkedom document. linkedom has no focus of its own, so the test
// gives it the small part the hook uses: focus(), document.activeElement and «focusin».

const { window, document } = parseHTML("<!doctype html><html><body><button id='opener'>Abrir</button><div id='root'></div></body></html>");
let active = document.body;
Object.defineProperty(document, "activeElement", { configurable: true, get: () => (active?.isConnected ? active : document.body) });
const proto = Object.getPrototypeOf(Object.getPrototypeOf(document.createElement("div"))); // HTMLElement.prototype
proto.focus = function focus() {
  if (this.disabled) return;
  active = this;
  this.dispatchEvent(new window.Event("focusin", { bubbles: true }));
};
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });

const { focusableIn, tabTarget, initialTarget, useDialogFocus } = await import("../src/lib/useDialogFocus.js");
const { isKeyboardMove } = await import("../src/lib/focusModality.js");
const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");

const dom = (html) => { const box = document.createElement("div"); box.innerHTML = html; document.body.appendChild(box); return box; };
const press = (key, more = {}) => {
  const e = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(e, { key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }, more);
  (document.activeElement || document.body).dispatchEvent(e);
  return e;
};

test("only what Tab can reach counts as focusable", () => {
  const box = dom(`
    <a href="/x" id="a">x</a><a id="no-href">x</a>
    <button id="b">x</button><button disabled id="off">x</button>
    <input id="i"><input type="hidden" id="hid">
    <div tabindex="0" id="t0">x</div><div tabindex="-1" id="t1">x</div>
    <div hidden><button id="in-hidden">x</button></div>
    <textarea id="ta"></textarea><select id="s"></select>`);
  assert.deepEqual(focusableIn(box).map((el) => el.id), ["a", "b", "i", "t0", "ta", "s"]);
  assert.deepEqual(focusableIn(null), []);
  box.remove();
});

test("Tab wraps at the ends and is left to the browser in the middle", () => {
  const box = dom(`<button id="one">1</button><button id="two">2</button><button id="three">3</button><p id="text" tabindex="-1">x</p>`);
  const [one, two, three] = focusableIn(box);
  const list = [one, two, three];
  assert.equal(tabTarget(list, three, false, box), one, "Tab on the last goes to the first");
  assert.equal(tabTarget(list, one, true, box), three, "Shift+Tab on the first goes to the last");
  assert.equal(tabTarget(list, two, false, box), null);
  assert.equal(tabTarget(list, two, true, box), null);
  assert.equal(tabTarget(list, document.body, false, box), one, "focus outside comes in at the start");
  assert.equal(tabTarget(list, document.body, true, box), three, "…or at the end going backwards");
  assert.equal(tabTarget(list, box, false, box), one, "focus on the dialog itself");
  assert.equal(tabTarget(list, box.querySelector("#text"), false, box), null, "a focused text inside: the browser's next stop is inside too");
  assert.equal(tabTarget([], box, false, box), box, "a dialog with no controls keeps focus on itself");
  box.remove();
});

test("the first focus: an autofocused field keeps it, then the marked element, then the first control", () => {
  const box = dom(`<button id="x">x</button><input id="field"><button id="cancel" data-autofocus="">Cancelar</button>`);
  assert.equal(initialTarget(box, box.querySelector("#field")), null, "focus already inside is not stolen");
  assert.equal(initialTarget(box, document.body).id, "cancel");
  box.querySelector("#cancel").removeAttribute("data-autofocus");
  assert.equal(initialTarget(box, document.body).id, "x");
  box.innerHTML = "<p>Solo texto</p>";
  assert.equal(initialTarget(box, document.body), box);
  box.setAttribute("data-autofocus", "");
  box.innerHTML = "<button>x</button>";
  assert.equal(initialTarget(box, document.body), box, "the dialog itself can ask for the first focus");
  box.remove();
});

test("only Tab alone counts as moving with the keyboard", () => {
  assert.equal(isKeyboardMove({ key: "Tab" }), true);
  assert.equal(isKeyboardMove({ key: "Tab", shiftKey: true }), true);
  assert.equal(isKeyboardMove({ key: "Tab", ctrlKey: true }), false);
  assert.equal(isKeyboardMove({ key: "a" }), false);
});

// ------------------------------------------------------------------ the hook, mounted
function Dialog({ id, onClose, children, blocking = false }) {
  const ref = useDialogFocus(blocking ? {} : { onEscape: onClose });
  return h("div", { ref, id, role: "dialog", "aria-modal": "true" }, children);
}
let api = null;
function App() {
  const [open, setOpen] = useState(null); // null | "one" | "two" (a second dialog over the first) | "blocking"
  api = { setOpen };
  return h("div", null,
    open ? h(Dialog, { id: "first", onClose: () => setOpen(null), blocking: open === "blocking" },
      h("button", { id: "d1" }, "uno"), h("input", { id: "d2" }), h("button", { id: "d3" }, "tres")) : null,
    open === "two" ? h(Dialog, { id: "second", onClose: () => setOpen("one") }, h("button", { id: "s1" }, "a"), h("button", { id: "s2" }, "b")) : null);
}

test("the hook: focus goes in, Tab stays in, Escape closes the top dialog, focus goes back", async () => {
  const opener = document.getElementById("opener");
  const root = createRoot(document.getElementById("root"));
  await act(() => root.render(h(App)));
  opener.focus();

  await act(() => api.setOpen("one"));
  assert.equal(document.activeElement.id, "d1", "the first control gets focus on open");

  document.getElementById("d3").focus();
  let e = press("Tab");
  assert.equal(e.defaultPrevented, true);
  assert.equal(document.activeElement.id, "d1", "Tab on the last wraps to the first");
  e = press("Tab", { shiftKey: true });
  assert.equal(document.activeElement.id, "d3", "Shift+Tab on the first wraps to the last");
  document.getElementById("d2").focus();
  assert.equal(press("Tab").defaultPrevented, false, "in the middle the browser moves focus");

  // A key somebody already handled (a menu inside the dialog, the palette's Tab) is left alone.
  document.getElementById("d3").focus();
  const handled = (ev) => ev.preventDefault();
  document.getElementById("first").addEventListener("keydown", handled);
  press("Tab");
  assert.equal(document.activeElement.id, "d3");
  await act(() => { press("Escape"); });
  assert.ok(document.getElementById("first"), "a handled Escape does not close the dialog");
  document.getElementById("first").removeEventListener("keydown", handled);

  // A dialog over the dialog: only the top one answers.
  await act(() => api.setOpen("two"));
  assert.equal(document.activeElement.id, "s1");
  document.getElementById("s2").focus();
  press("Tab");
  assert.equal(document.activeElement.id, "s1", "Tab stays in the top dialog");
  await act(() => { press("Escape"); });
  assert.equal(document.getElementById("second"), null, "Escape closes the top dialog…");
  assert.ok(document.getElementById("first"), "…and not the one under it");
  assert.equal(document.activeElement.id, "d3", "focus returns to where it was in the first dialog");

  await act(() => { press("Escape"); });
  assert.equal(document.getElementById("first"), null);
  assert.equal(document.activeElement, opener, "focus returns to what opened the dialog");

  // A dialog that must be answered: no onEscape, so Escape does nothing, and Tab still stays in.
  await act(() => api.setOpen("blocking"));
  await act(() => { press("Escape"); });
  assert.ok(document.getElementById("first"), "Escape does not close a blocking dialog");
  document.getElementById("d3").focus();
  press("Tab");
  assert.equal(document.activeElement.id, "d1");
  await act(() => api.setOpen(null));
  assert.equal(document.activeElement, opener);

  await act(() => root.unmount());
});
