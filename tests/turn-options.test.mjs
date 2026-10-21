import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { cleanUse, turnNote } from "../server/turnoptions.mjs";

test("what you choose in «+» becomes a short note for the bot", () => {
  assert.deepEqual(cleanUse(["Gmail", "terminal", "gmail", "no vale!", ""]), ["gmail", "terminal"]);
  assert.equal(turnNote([]), "");
  const note = turnNote(["navegador", "gmail"], { deep: true });
  assert.match(note, /navegador/);
  assert.match(note, /Gmail/);
  assert.match(note, /a fondo/);
});

test("a message with «Pensar a fondo» and an app thinks «high» and reads the note", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input, reasoning }) => {
    seen.push({ effort: reasoning?.effort || null, text: JSON.stringify(input) });
    return answer("Hecho.");
  });
  const m = runtime.create({ prompt: "Hola", mode: "solo", botIds: ["vera"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  runtime.addMessage(m.id, "Mira mis correos de hoy", [], { use: ["gmail"], deep: true });
  await settle(runtime);
  const last = seen.at(-1);
  assert.equal(last.effort, "high");
  assert.match(last.text, /su app conectada Gmail/);
  const msg = store.list("messages").filter((x) => x.missionId === m.id && x.role === "user").at(-1);
  assert.deepEqual(msg.use, ["gmail"]);
  assert.equal(msg.deep, true);
});

test("the first message of a new chat carries its choices too", async (t) => {
  const seen = [];
  const { runtime } = await fixture(t, async ({ input, reasoning }) => {
    seen.push({ effort: reasoning?.effort || null, text: JSON.stringify(input) });
    return answer("Hecho.");
  });
  const m = runtime.create({ prompt: "Ordena mi carpeta de facturas", mode: "solo", botIds: ["vera"], conversation: true, use: ["terminal"], deep: true });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(seen[0].effort, "high");
  assert.match(seen[0].text, /run_command/);
});
