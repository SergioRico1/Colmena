import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call } from "./fixtures/runtime-fixture.mjs";
import { undoLearned } from "../server/learned.mjs";

test("a memory change shows «Aprendido: …» in the room and «Deshacer» puts it back", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async () => {
    round += 1;
    if (round === 1) return call("remember", { operations: [{ action: "add", target: "persona", text: "Prefiere reuniones por la mañana.", old: "" }] }, "m1");
    return answer("Apuntado.");
  });
  const m = runtime.create({ prompt: "Apunta que prefiero las mañanas", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const notice = store.list("messages").find((x) => x.missionId === m.id && x.kind === "learned");
  assert.equal(notice.text, "Aprendido: «Prefiere reuniones por la mañana.»");
  const memory = store.list("memories").find((x) => /mañana/.test(x.text));
  undoLearned(store, notice.id);
  assert.equal(store.get("memories", memory.id).active, false, "the new memory is forgotten");
  assert.match(store.get("messages", notice.id).text, /^Deshecho: /);
  assert.equal(undoLearned(store, notice.id).learned.undone, true, "a second click changes nothing");
});

test("undoing an edit restores the previous text", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  store.put("memories", { id: "mem1", text: "Prefiere reuniones por la tarde.", botId: "nora", scope: "equipo", target: "persona", active: true, origin: "bot" });
  store.put("messages", { id: "note:x", missionId: "m", botId: "nora", role: "system", kind: "learned", text: "Aprendido: ahora «tarde» (antes «mañana»)", learned: { type: "memory", changes: [{ action: "replace", id: "mem1", from: "Prefiere reuniones por la mañana.", text: "Prefiere reuniones por la tarde." }] } });
  undoLearned(store, "note:x");
  assert.equal(store.get("memories", "mem1").text, "Prefiere reuniones por la mañana.");
});
