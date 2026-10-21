import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer } from "./fixtures/runtime-fixture.mjs";

test("after a bot answers, the cheapest model proposes up to three replies; a new message clears them", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ model, instructions }) => {
    seen.push(model);
    if (/^Propón hasta 3 respuestas/.test(instructions)) return answer('{"sugerencias": ["Hazlo para tres personas", "¿Cuánto cuesta en total?", "Añade un plan B si llueve", "una cuarta que sobra"]}');
    return answer("Tres planes para el domingo en Valladolid.");
  }, { suggest: true });
  runtime.provider.session = { models: [{ slug: "gpt-6.1-sol" }, { slug: "gpt-5.6-luna" }] };
  const m = runtime.create({ prompt: "Planes para el domingo", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  for (let i = 0; i < 50 && !store.get("missions", m.id).suggestions; i++) await new Promise((r) => setTimeout(r, 10));
  const s = store.get("missions", m.id).suggestions;
  assert.deepEqual(s.list, ["Hazlo para tres personas", "¿Cuánto cuesta en total?", "Añade un plan B si llueve"]);
  assert.equal(seen.at(-1), "gpt-5.6-luna", "on the cheapest model");
  runtime.addMessage(m.id, "Hazlo para tres personas");
  assert.equal(store.get("missions", m.id).suggestions, null);
});

test("no suggestions when switched off", async (t) => {
  let calls = 0;
  const { store, runtime } = await fixture(t, async () => { calls += 1; return answer("Hecho."); }, { suggest: true });
  runtime.provider.session = { models: [{ slug: "gpt-5.6-luna" }] };
  store.patch("settings", "main", { suggestions: false });
  const m = runtime.create({ prompt: "Algo", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 1);
});
