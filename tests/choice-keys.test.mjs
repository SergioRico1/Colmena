import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

// Lettered choices (src/lib/choiceKeys.js): the pure mapping from a key to an option, when a
// key is typing rather than answering, which card the letters belong to, and the hook
// mounted with React in a linkedom document (focus is given by hand, as in dialog-focus).

const { window, document } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
let active = document.body;
Object.defineProperty(document, "activeElement", { configurable: true, get: () => (active?.isConnected ? active : document.body) });
const proto = Object.getPrototypeOf(Object.getPrototypeOf(document.createElement("div"))); // HTMLElement.prototype
proto.focus = function focus() { active = this; };
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });

const { letterOf, choiceIndex, isTypingTarget, choiceCardFor, useChoiceKeys } = await import("../src/lib/choiceKeys.js");
const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");

const key = (k, more = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...more });
const press = (k, more = {}) => {
  const e = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(e, key(k, more));
  (document.activeElement || document.body).dispatchEvent(e);
  return e;
};
const dom = (html) => { const box = document.createElement("div"); box.innerHTML = html; document.body.appendChild(box); return box; };

test("options read A, B, C…", () => {
  assert.deepEqual([0, 1, 2, 25].map(letterOf), ["A", "B", "C", "Z"]);
  assert.equal(letterOf(26), "");
  assert.equal(letterOf(-1), "");
  assert.equal(letterOf(1.5), "");
});

test("a letter key means its option, in either case, only among the options there are", () => {
  assert.equal(choiceIndex(key("a"), 3), 0);
  assert.equal(choiceIndex(key("B"), 3), 1);
  assert.equal(choiceIndex(key("c"), 3), 2);
  assert.equal(choiceIndex(key("d"), 3), -1, "no fourth option");
  assert.equal(choiceIndex(key("a"), 0), -1);
  assert.equal(choiceIndex(key("z"), 40), 25);
  for (const k of ["1", "Enter", " ", "Escape", "Tab", "ArrowDown", "ñ", "á", "F1", ""]) assert.equal(choiceIndex(key(k), 3), -1, k);
});

test("shortcuts, held keys and text being composed never answer", () => {
  assert.equal(choiceIndex(key("a", { ctrlKey: true }), 3), -1, "Ctrl+A selects all");
  assert.equal(choiceIndex(key("c", { metaKey: true }), 3), -1);
  assert.equal(choiceIndex(key("b", { altKey: true }), 3), -1);
  assert.equal(choiceIndex(key("a", { repeat: true }), 3), -1);
  assert.equal(choiceIndex(key("a", { isComposing: true }), 3), -1);
  assert.equal(choiceIndex(key("A", { shiftKey: true }), 3), 0, "Shift+A is still the letter");
  assert.equal(choiceIndex(null, 3), -1);
});

test("a key pressed in a text field is typing", () => {
  const box = dom(`
    <input id="i"><textarea id="ta"></textarea><select id="s"></select>
    <div contenteditable="true" id="ce"><span id="in-ce">x</span></div>
    <div role="textbox" id="rt"><b id="in-rt">x</b></div>
    <div role="menu"><button id="in-menu">x</button></div>
    <button id="b">x</button><a href="/x" id="a">x</a><div id="d" contenteditable="false">x</div>`);
  const el = (id) => box.querySelector("#" + id);
  for (const id of ["i", "ta", "s", "ce", "in-ce", "rt", "in-rt", "in-menu"]) assert.equal(isTypingTarget(el(id)), true, id);
  for (const id of ["b", "a", "d"]) assert.equal(isTypingTarget(el(id)), false, id);
  assert.equal(isTypingTarget(document.body), false);
  assert.equal(isTypingTarget(null), false);
  box.remove();
});

test("the letters belong to the card in focus, else to the last question on screen", () => {
  const box = dom(`
    <button id="out">x</button>
    <div data-choice-keys id="one"><button id="in-one">x</button></div>
    <div data-choice-keys id="two"><button id="in-two">x</button></div>`);
  const el = (id) => box.querySelector("#" + id);
  assert.equal(choiceCardFor(document, document.body), el("two"), "nothing focused: the latest");
  assert.equal(choiceCardFor(document, el("out")), el("two"), "focus elsewhere: the latest");
  assert.equal(choiceCardFor(document, el("in-one")), el("one"), "focus inside an earlier card: that one");
  assert.equal(choiceCardFor(document, el("in-two")), el("two"));
  // An open dialog over the page: its own question, or nothing.
  const dialog = dom(`<div role="dialog" id="dlg"><button id="in-dlg">x</button></div>`);
  assert.equal(choiceCardFor(document, document.body), null, "the cards under a dialog do not listen");
  dialog.querySelector("#dlg").innerHTML += `<div data-choice-keys id="three"></div>`;
  assert.equal(choiceCardFor(document, document.body)?.id, "three");
  dialog.remove();
  box.remove();
  assert.equal(choiceCardFor(document, document.body), null, "no question on screen");
});

// Two question cards and a composer, as in a chat.
function Card({ name, count, enabled = true, log }) {
  const ref = useChoiceKeys({ count, enabled, onChoose: (i) => log.push(name + ":" + letterOf(i)) });
  return h("div", { ref, id: name }, h("button", { id: name + "-button" }, "x"));
}

test("mounted: the letter answers the latest question, the focused one, and never while typing", async () => {
  const root = createRoot(document.getElementById("root"));
  const log = [];
  const view = (props = {}) => h("div", null,
    h(Card, { name: "first", count: 3, log, ...props.first }),
    h(Card, { name: "second", count: 2, log, ...props.second }),
    h("a", { id: "link", href: "/x" }, "x"));
  await act(async () => root.render(view()));
  // The composer (plain DOM: linkedom has no input events for React to follow).
  const composer = dom(`<textarea id="composer"></textarea>`);
  const el = (id) => document.getElementById(id);
  assert.ok(el("first").hasAttribute("data-choice-keys"));

  active = document.body;
  assert.equal(press("a").defaultPrevented, true);
  assert.deepEqual(log, ["second:A"], "the latest question");
  press("B");
  assert.deepEqual(log, ["second:A", "second:B"]);
  assert.equal(press("c").defaultPrevented, false, "the latest question has two options: C is nobody's");
  assert.equal(log.length, 2);

  // Focus inside the first card: the letters are its own, with its three options.
  el("first-button").focus();
  press("c");
  assert.deepEqual(log.at(-1), "first:C");

  // Focus on a link elsewhere: back to the latest.
  el("link").focus();
  press("a");
  assert.deepEqual(log.at(-1), "second:A");

  // Typing in the composer is typing.
  const before = log.length;
  el("composer").focus();
  for (const k of ["a", "b", "c"]) assert.equal(press(k).defaultPrevented, false);
  assert.equal(log.length, before, "the composer keeps every letter");

  // Shortcuts and other keys pass through.
  active = document.body;
  for (const [k, more] of [["a", { ctrlKey: true }], ["k", { ctrlKey: true }], ["Enter", {}], ["1", {}]]) assert.equal(press(k, more).defaultPrevented, false);
  assert.equal(log.length, before);

  // A key someone else already handled is left alone.
  const handled = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(handled, key("a"));
  handled.preventDefault();
  document.body.dispatchEvent(handled);
  assert.equal(log.length, before);

  // The latest question is answered (disabled): the earlier one is now the one that listens.
  await act(async () => root.render(view({ second: { enabled: false } })));
  assert.equal(el("second").hasAttribute("data-choice-keys"), false);
  press("a");
  assert.deepEqual(log.at(-1), "first:A");

  // Nothing left to answer: the keys do nothing, and unmounting removes the listeners.
  await act(async () => root.render(view({ first: { enabled: false }, second: { count: 0 } })));
  const quiet = log.length;
  assert.equal(press("a").defaultPrevented, false);
  await act(async () => root.unmount());
  assert.equal(press("a").defaultPrevented, false);
  assert.equal(log.length, quiet);
  composer.remove();
});
