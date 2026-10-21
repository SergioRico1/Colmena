import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";

test("a chat gets a short title after its first answer, and a name you gave it is kept", async (t) => {
  const { store, runtime } = await fixture(t, async ({ instructions }) => {
    if (/Pon un título a esta conversación/.test(instructions)) return answer("«Presupuestos web de Orvalia.»\nmás texto");
    return answer("Hola, ¿en qué te ayudo con los presupuestos?");
  }, { autoTitle: true });
  runtime.provider.session = { models: [{ slug: "fixture" }] };
  const m = runtime.create({ prompt: "Hola", mode: "solo", botIds: ["atlas"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).title, "Presupuestos web de Orvalia");
  assert.equal(store.get("missions", m.id).titled, true);
  // Another answer does not rename it again.
  store.patch("missions", m.id, { title: "Mi nombre" });
  runtime.addMessage(m.id, "Sigue");
  await settle(runtime);
  assert.equal(store.get("missions", m.id).title, "Mi nombre");
});
