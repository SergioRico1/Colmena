import test from "node:test";
import assert from "node:assert/strict";
import { activityStore, liveStore } from "../src/lib/liveStore.js";
import { applyDeltas } from "../src/lib/liveText.js";

// The per-frame store (src/lib/liveStore.js): subscribers hear of a change, and only of a change.

test("a frame of live text reaches the subscribers once", () => {
  liveStore.set({});
  let told = 0;
  const off = liveStore.subscribe(() => told++);
  liveStore.set((all) => applyDeltas(all, [["s1", { botId: "b1", mission: "m1", text: "Hola" }]]));
  assert.equal(told, 1);
  assert.deepEqual(liveStore.get(), { s1: { botId: "b1", mission: "m1", text: "Hola" } });
  off();
  liveStore.set({});
  assert.equal(told, 1, "an unsubscribed listener hears nothing more");
});

test("the same object back tells nobody", () => {
  activityStore.set({ b1: { verb: "escribiendo", mission: "m1", at: 1 } });
  let told = 0;
  const off = activityStore.subscribe(() => told++);
  activityStore.set((all) => all);
  assert.equal(told, 0);
  activityStore.set((all) => ({ ...all, b2: { verb: "leyendo", mission: "m1", at: 2 } }));
  assert.equal(told, 1);
  off();
  activityStore.set({});
});
