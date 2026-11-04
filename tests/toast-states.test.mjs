import test from "node:test";
import assert from "node:assert/strict";
import { _reset, currentToasts, later, promise, reversible, setPaused } from "../src/lib/undoToast.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => currentToasts();

test("a five-second change becomes «on its way», then «done», in the same notice", async () => {
  _reset();
  let ran = false;
  later({ id: "del", text: "Chat borrado", working: "Borrando el chat…", done: "Chat borrado", run: async () => { await sleep(30); ran = true; }, ms: 40 });
  assert.deepEqual(now().map((t) => t.kind), ["later"]);
  await sleep(55);
  assert.deepEqual(now().map((t) => [t.kind, t.text]), [["working", "Borrando el chat…"]]);
  await sleep(40);
  assert.equal(ran, true);
  assert.deepEqual(now().map((t) => [t.kind, t.text]), [["success", "Chat borrado"]]);
});

test("a failure says why, in the same notice", async () => {
  _reset();
  later({ id: "x", text: "Archivado", error: "No se pudo archivar", run: async () => { throw Error("sin conexión"); }, ms: 20 });
  await sleep(50);
  assert.deepEqual(now().map((t) => [t.kind, t.text]), [["error", "No se pudo archivar: sin conexión"]]);
});

test("promise(): working, then done with the result", async () => {
  _reset();
  const p = promise(sleep(20).then(() => 3), { id: "exp", loading: "Exportando…", success: (n) => `${n} páginas exportadas` });
  assert.equal(now()[0].kind, "working");
  assert.equal(await p, 3);
  await sleep(5);
  assert.deepEqual(now().map((t) => [t.kind, t.text]), [["success", "3 páginas exportadas"]]);
  await promise(Promise.reject(Error("disco lleno")), { id: "exp2", loading: "Exportando…", error: "No se pudo exportar" }).catch(() => {});
  await sleep(5);
  assert.equal(now().find((t) => t.id === "exp2").text, "No se pudo exportar: disco lleno");
});

test("nothing runs out while paused (hidden window, pointer on the notices)", async () => {
  _reset();
  let ran = false;
  later({ id: "p", text: "Borrado", run: async () => { ran = true; }, ms: 40 });
  reversible({ id: "r", text: "Archivado", undo: () => {}, ms: 40 });
  setPaused(true);
  await sleep(80);
  assert.equal(ran, false, "the change waits");
  assert.equal(now().length, 2, "the notices stay");
  setPaused(false);
  await sleep(70);
  assert.equal(ran, true);
  assert.ok(!now().some((t) => t.id === "r"), "the reversible one went after its time left");
  _reset();
});
