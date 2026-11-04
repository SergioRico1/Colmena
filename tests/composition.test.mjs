import test from "node:test";
import assert from "node:assert/strict";
import { createComposition, isCompositionKey, shouldRefocus } from "../src/lib/composition.js";

test("keys that belong to an input method are recognised, Enter with keyCode 229 included", () => {
  assert.equal(isCompositionKey({ key: "Enter", isComposing: true, keyCode: 13 }), true);
  assert.equal(isCompositionKey({ key: "Enter", isComposing: false, keyCode: 229 }), true);
  assert.equal(isCompositionKey({ key: "Enter", isComposing: false, keyCode: 13 }), false);
});

test("a composition that never ends is recovered by the next ordinary change", () => {
  const ime = createComposition();
  ime.start();
  assert.equal(ime.change({ isComposing: true }), true, "composing: no menus");
  assert.equal(ime.key({ key: "Enter", keyCode: 13 }), true, "Enter belongs to the IME");
  // compositionend never came; a plain change clears it.
  assert.equal(ime.change({ isComposing: false }), false);
  assert.equal(ime.composing, false);
  assert.equal(ime.key({ key: "Enter", keyCode: 13 }), false);
});

test("a turn refocuses the box only when you were still in that chat", () => {
  const box = { id: "box" };
  const inside = { id: "panel-button" };
  const body = { id: "body" };
  const root = { contains: (n) => n === inside || n === box };
  assert.equal(shouldRefocus(body, root, box, body), true, "nothing focused");
  assert.equal(shouldRefocus(null, root, box, body), true);
  assert.equal(shouldRefocus(inside, root, box, body), true, "a button of this chat");
  assert.equal(shouldRefocus({ id: "settings" }, root, box, body), false, "another panel keeps its focus");
  assert.equal(shouldRefocus(box, root, box, body), false, "already there");
});
