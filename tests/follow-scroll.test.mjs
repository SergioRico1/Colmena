import test from "node:test";
import assert from "node:assert/strict";
import { createFollowScroll, isAtBottom } from "../src/lib/followScroll.js";

// A scrolling element as the browser keeps it: scrollTop is clamped, scrollTo and events.
class Node {
  constructor(parent = null, { overflowY = "visible", scrollTop = 0 } = {}) { this.parentElement = parent; this.nodeType = 1; this.overflowY = overflowY; this.scrollTop = scrollTop; this.attrs = {}; this.tagName = "DIV"; }
  closest(sel) {
    for (let n = this; n; n = n.parentElement) if (sel.split(",").some((s) => n.matches(s.trim()))) return n;
    return null;
  }
  matches(s) {
    if (s === "[data-index]") return "data-index" in this.attrs;
    if (s === "[aria-expanded]") return "aria-expanded" in this.attrs;
    return false;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
}
class Scroller extends Node {
  constructor() { super(null, { overflowY: "auto" }); this.scrollHeight = 2000; this.clientHeight = 500; this._top = 1500; this.listeners = {}; this.children = []; }
  get scrollTop() { return this._top; }
  set scrollTop(v) { this._top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)); }
  scrollTo({ top }) { this.scrollTop = top; this.emit("scroll", {}); }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  emit(t, e) { for (const fn of this.listeners[t] || []) fn({ target: this, ...e }); }
  grow(px) { this.scrollHeight += px; }
}
globalThis.getComputedStyle = (n) => ({ overflowY: n.overflowY });

const setup = () => {
  const el = new Scroller();
  const seen = [];
  const f = createFollowScroll({ onAtBottomChange: (v) => seen.push(v), raf: (fn) => { fn(); return 1; }, cancelRaf: () => {} });
  f.attach(el);
  return { el, f, seen };
};

test("at the end within 1 px; the composer's inset counts as the end", () => {
  assert.equal(isAtBottom({ scrollTop: 1499, scrollHeight: 2000, clientHeight: 500 }), true);
  assert.equal(isAtBottom({ scrollTop: 1498, scrollHeight: 2000, clientHeight: 500 }), false);
  assert.equal(isAtBottom({ scrollTop: 1400, scrollHeight: 2000, clientHeight: 500 }, 100), true);
});

test("it follows growing text, and stops the moment the reader goes up with the wheel", () => {
  const { el, f } = setup();
  el.grow(300); f.contentChanged();
  assert.equal(el.scrollTop, 1800, "follows the answer");
  el.emit("wheel", { deltaY: -120 });
  el.grow(300); f.contentChanged();
  assert.equal(el.scrollTop, 1800, "text keeps arriving but the reader is not pulled down");
  el.scrollTop = 1600; el.emit("scroll", {});
  el.grow(300); f.contentChanged();
  assert.equal(el.scrollTop, 1600);
  assert.equal(f.isAtBottom, false);
  // Back at the end (scrollbar, keys or the button): it follows again.
  el.scrollTop = el.scrollHeight; el.emit("scroll", {});
  el.grow(200); f.contentChanged();
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight);
});

test("going up with the keyboard, touch or the scrollbar also stops following", () => {
  for (const gesture of ["key", "touch", "bar"]) {
    const { el, f } = setup();
    if (gesture === "key") el.emit("keydown", { key: "PageUp" });
    if (gesture === "touch") { el.emit("touchstart", { touches: [{ clientY: 100 }] }); el.emit("touchmove", { touches: [{ clientY: 160 }] }); }
    if (gesture === "bar") { el.emit("pointerdown", {}); el.scrollTop = 1200; el.emit("scroll", {}); }
    el.grow(400); f.contentChanged();
    assert.notEqual(el.scrollTop, el.scrollHeight - el.clientHeight, gesture);
  }
});

test("a code block that can still scroll up takes the wheel first", () => {
  const { el, f } = setup();
  const code = new Node(el, { overflowY: "auto", scrollTop: 40 });
  el.emit("wheel", { deltaY: -100, target: code });
  el.grow(300); f.contentChanged();
  assert.equal(el.scrollTop, 1800, "still following: the gesture went to the code block");
});

test("opening something inside a message pauses following until the reader moves", () => {
  const { el, f } = setup();
  const row = new Node(el); row.attrs["data-index"] = "4";
  const button = new Node(row); button.attrs["aria-expanded"] = "false";
  for (const fn of el.listeners.click) fn({ target: button });
  el.grow(400); f.contentChanged();
  assert.equal(el.scrollTop, 1500, "what you opened stays where it is");
  el.emit("wheel", { deltaY: 100 });
  el.scrollTop = el.scrollHeight; el.emit("scroll", {});
  el.grow(100); f.contentChanged();
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight, "follows again once you went back to the end");
});

test("the window or composer resizing keeps the end in view", () => {
  const { el, f } = setup();
  el.clientHeight = 380; f.contentChanged();
  assert.equal(el.scrollTop, el.scrollHeight - 380);
});
