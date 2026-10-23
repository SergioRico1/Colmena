import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs } from "./fixtures/runtime-fixture.mjs";
import { composeInstructions, memoryTag } from "../server/soul.mjs";

const EMPTY = { memory: [], skill: { action: "none", skillId: null, edits: [], name: "", description: "", content: "" }, soul: null };

test("what the review learns is labelled as a fact or a procedure", async (t) => {
  const { store, runtime } = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Extrae"))
      return answer(JSON.stringify({ ...EMPTY, memory: [
        { action: "add", target: "equipo", text: "El cierre de ventas es el día 5", old: "", tipo: "hecho", por: ["m1"] },
        { action: "add", target: "bot", text: "Las ventas se sacan de la hoja de pedidos y se suman por cliente", old: "", tipo: "procedimiento", por: ["m1"] },
      ] }));
    const done = outputs(request.input).length;
    return done < 5 ? call("list_files", {}, "c" + done) : answer("Hecho");
  });
  store.patch("settings", "main", { learning: true });
  const m = runtime.create({ prompt: "Suma las ventas por cliente; el cierre es el día 5", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const learned = store.list("memories").filter((x) => x.missionId === m.id);
  assert.deepEqual(learned.map((x) => [x.text.slice(0, 20), x.nature]), [["El cierre de ventas ", "hecho"], ["Las ventas se sacan ", "procedimiento"]]);
});

test("a fact from another task is marked to be checked again; procedures and the person's words are not", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  const bot = store.get("bots", "nora");
  store.put("memories", { id: "a", text: "El cierre contable es el día 5", botId: "nora", target: "memory", source: "dedujo", nature: "hecho", missionId: "old", active: true, createdAt: "2026-10-01T00:00:00Z" });
  store.put("memories", { id: "b", text: "Los informes salen de la hoja de pedidos", botId: "nora", target: "bot", scope: "bot", source: "dedujo", nature: "procedimiento", missionId: "old", active: true });
  store.put("memories", { id: "c", text: "Prefiere el tuteo", target: "user", source: "dijiste", active: true });
  store.put("memories", { id: "d", text: "Trabaja con euros", botId: "nora", target: "user", source: "dedujo", missionId: "now", active: true });
  assert.equal(memoryTag(store.get("memories", "a"), "now"), " [compruébalo]");
  assert.equal(memoryTag(store.get("memories", "d"), "now"), "", "learned in this same task: no need");
  const prompt = composeInstructions(store, bot, { mission: { id: "now" } });
  assert.match(prompt, /- El cierre contable es el día 5 \[compruébalo\]/);
  assert.match(prompt, /- Los informes salen de la hoja de pedidos \[cómo\]/);
  assert.match(prompt, /- Prefiere el tuteo\n/);
  assert.match(prompt, /«\[compruébalo\]» es un hecho que aprendiste en otra tarea: antes de basar en él algo importante, vuelve a comprobarlo con la fuente/);
});
