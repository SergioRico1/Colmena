import test from "node:test";
import assert from "node:assert/strict";
import { fold, moveIndex, normalizeOptions, placeList, seek, selectKey, typeahead } from "../src/lib/select.js";
import { isInside } from "../src/lib/useClickAway.js";

// The keyboard model of the app's select (src/components/Select.jsx): at least what the
// native control does.

const OPTS = normalizeOptions([["recent", "Recientes"], ["title", "Título"], ["old", "Antiguas", ], { value: "x", label: "Oculta", disabled: true }, ["az", "Alfabético"], ["relevance", "Relevancia"]]);
const key = (k, more = {}) => ({ key: k, ...more });
const closed = (selected = 0) => ({ open: false, at: -1, selected, buffer: "" });
const opened = (at = 0, selected = 0) => ({ open: true, at, selected, buffer: "" });

test("options come from pairs, plain values and objects", () => {
  assert.deepEqual(normalizeOptions([["a", "Uno"], "Dos", 3, { value: "d", label: "Cuatro", disabled: true }, null, false]), [
    { value: "a", label: "Uno" }, { value: "Dos", label: "Dos" }, { value: 3, label: "3" }, { value: "d", label: "Cuatro", disabled: true },
  ]);
  // A third element of a pair (a handler, a hint) is ignored.
  assert.deepEqual(normalizeOptions([["a", "Uno", () => {}]]), [{ value: "a", label: "Uno" }]);
  assert.deepEqual(normalizeOptions(null), []);
});

test("closed: arrows, Enter and Space open on the chosen option", () => {
  for (const k of ["ArrowDown", "ArrowUp", "Enter", " "]) {
    const next = selectKey(OPTS, closed(2), key(k));
    assert.equal(next.open, true, k);
    assert.equal(next.at, 2, k);
    assert.equal(next.handled, true, k);
    assert.equal(next.choose, undefined, k);
  }
  assert.equal(selectKey(OPTS, closed(2), key("ArrowDown", { altKey: true })).open, true);
});

test("closed: Home and End open on the first and the last usable option", () => {
  assert.equal(selectKey(OPTS, closed(2), key("Home")).at, 0);
  assert.equal(selectKey(OPTS, closed(2), key("End")).at, 5);
});

test("closed with nothing chosen, or a disabled choice: opens on the first usable option", () => {
  assert.equal(selectKey(OPTS, closed(-1), key("ArrowDown")).at, 0);
  assert.equal(selectKey(OPTS, closed(3), key("Enter")).at, 0);
});

test("closed: a letter chooses the next match without opening, like the native control", () => {
  const next = selectKey(OPTS, closed(0), key("a"));
  assert.equal(next.open, false);
  assert.equal(next.choose, 2); // Antiguas
  assert.equal(next.selected, 2);
  const again = selectKey(OPTS, { ...closed(2), buffer: "a" }, key("a"));
  assert.equal(again.choose, 4); // Alfabético: the same letter walks on
  const miss = selectKey(OPTS, closed(0), key("z"));
  assert.equal(miss.choose, undefined);
  assert.equal(miss.handled, true);
});

test("other keys are not the select's while it is closed", () => {
  for (const k of ["Tab", "Escape", "ArrowLeft", "F5"]) assert.equal(selectKey(OPTS, closed(0), key(k)).handled, false, k);
  assert.equal(selectKey(OPTS, closed(0), key("a", { ctrlKey: true })).handled, false);
});

test("open: arrows move and skip disabled options, stopping at the ends", () => {
  assert.equal(selectKey(OPTS, opened(2), key("ArrowDown")).at, 4);
  assert.equal(selectKey(OPTS, opened(4), key("ArrowUp")).at, 2);
  assert.equal(selectKey(OPTS, opened(5), key("ArrowDown")).at, 5);
  assert.equal(selectKey(OPTS, opened(0), key("ArrowUp")).at, 0);
  assert.equal(selectKey(OPTS, opened(2), key("Home")).at, 0);
  assert.equal(selectKey(OPTS, opened(2), key("End")).at, 5);
  assert.equal(selectKey(OPTS, opened(0), key("PageDown")).at, 5);
  assert.equal(selectKey(OPTS, opened(5), key("PageUp")).at, 0);
  const next = selectKey(OPTS, opened(2), key("ArrowDown"));
  assert.equal(next.open, true);
  assert.equal(next.choose, undefined, "moving does not choose");
});

test("open: Enter and Space choose, close and give focus back", () => {
  for (const k of ["Enter", " "]) {
    const next = selectKey(OPTS, opened(4, 0), key(k));
    assert.deepEqual([next.open, next.choose, next.selected, next.handled, next.refocus], [false, 4, 4, true, true], k);
  }
});

test("open: Tab chooses and lets focus move on; Escape closes without choosing", () => {
  const tab = selectKey(OPTS, opened(4, 0), key("Tab"));
  assert.deepEqual([tab.open, tab.choose, tab.handled], [false, 4, false]);
  const esc = selectKey(OPTS, opened(4, 0), key("Escape"));
  assert.deepEqual([esc.open, esc.choose, esc.selected, esc.handled, esc.refocus], [false, undefined, 0, true, true]);
});

test("open: typing jumps to a match, ignoring accents and case", () => {
  assert.equal(selectKey(OPTS, opened(0), key("t")).at, 1); // Título
  const r = selectKey(OPTS, opened(0), key("r"));
  assert.equal(r.at, 5); // from Recientes, the next «r» is Relevancia
  const re = selectKey(OPTS, { ...opened(0), buffer: "r" }, key("e"));
  assert.equal(re.at, 0, "«re» still matches Recientes, which stays");
  const rel = selectKey(OPTS, { ...opened(0), buffer: "re" }, key("l"));
  assert.equal(rel.at, 5);
  assert.equal(typeahead(OPTS, "TI", 0), 1);
  assert.equal(typeahead(OPTS, "o", 0), -1, "a disabled option is never found");
  assert.equal(fold("Título"), "titulo");
});

test("an empty list answers nothing", () => {
  assert.equal(selectKey([], closed(-1), key("ArrowDown")).handled, false);
  assert.equal(seek([], 0, 1), -1);
  assert.equal(moveIndex(OPTS, 2, "x"), 2);
});

test("the list opens below, or above when it only fits there", () => {
  const view = { width: 1440, height: 900 };
  const below = placeList({ left: 100, top: 100, bottom: 140, width: 200 }, { width: 180, height: 300 }, view);
  assert.deepEqual([below.up, below.top, below.left, below.minWidth], [false, 146, 100, 200]);
  const above = placeList({ left: 100, top: 800, bottom: 840, width: 200 }, { width: 180, height: 300 }, view);
  assert.equal(above.up, true);
  assert.equal(above.top, 800 - 6 - 300);
  // Never off the right edge; a long list is capped to the room there is.
  const edge = placeList({ left: 1380, top: 100, bottom: 140, width: 50 }, { width: 240, height: 2000 }, view);
  assert.equal(edge.left, 1440 - 240 - 8);
  assert.equal(edge.maxHeight, 900 - 140 - 6 - 8);
});

test("click away: refs, lists of refs and predicates say what is inside", () => {
  const box = { contains: (t) => t === "in" || t === "box" };
  assert.equal(isInside({ current: box }, "in"), true);
  assert.equal(isInside({ current: box }, "out"), false);
  assert.equal(isInside([{ current: null }, { current: box }], "in"), true);
  assert.equal(isInside({ current: null }, "in"), false);
  assert.equal(isInside((t) => t === "menu", "menu"), true);
  assert.equal(isInside((t) => t === "menu", "page"), false);
  assert.equal(isInside({ current: box }, null), false);
});
