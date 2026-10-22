import test from "node:test";
import assert from "node:assert/strict";

// «Deshacer» for five seconds (src/lib/undoToast.js): what waits, what is hidden meanwhile,
// and what «Deshacer» puts back. Short waits stand in for the five seconds.
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
globalThis.CustomEvent ??= class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const { TOAST_MS, later, reversible, undoLast, isHidden, visible, _reset } = await import("../src/lib/undoToast.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("the notice lasts five seconds", () => {
  assert.equal(TOAST_MS, 5000);
});

test("later(): hidden at once, sent when the wait ends, shown again after", async () => {
  _reset();
  let ran = 0;
  later({ id: "mission:a", keys: ["mission:a"], text: "Sala borrada", run: () => { ran++; }, ms: 30 });
  assert.equal(isHidden("mission:a"), true);
  assert.deepEqual(visible("mission", [{ id: "a" }, { id: "b" }]).map((x) => x.id), ["b"]);
  assert.equal(ran, 0, "nothing reaches the server before the wait ends");
  await wait(60);
  assert.equal(ran, 1);
  assert.equal(isHidden("mission:a"), false, "the refreshed state carries the change from here");
});

test("«Deshacer» before the end: nothing is sent and it comes back", async () => {
  _reset();
  let ran = 0;
  let back = 0;
  later({ id: "x", keys: ["memory:1"], text: "Recuerdo olvidado", run: () => { ran++; }, undone: () => { back++; }, ms: 30 });
  assert.equal(undoLast(), true);
  await wait(60);
  assert.equal(ran, 0);
  assert.equal(back, 1);
  assert.equal(isHidden("memory:1"), false);
  assert.equal(undoLast(), false, "no notice left to undo");
});

test("a failed change shows the thing again and says so", async () => {
  _reset();
  later({ id: "y", keys: ["bot:z"], text: "Borrado", error: "No se pudo borrar", run: () => { throw Error("sin red"); }, ms: 10 });
  await wait(40);
  assert.equal(isHidden("bot:z"), false);
});

test("reversible(): already done, «Deshacer» runs the opposite once", async () => {
  _reset();
  let undone = 0;
  reversible({ id: "mission:b", text: "Sala archivada", undo: () => { undone++; }, ms: 1000 });
  assert.equal(undoLast(), true);
  assert.equal(undoLast(), false);
  await wait(5);
  assert.equal(undone, 1);
});
