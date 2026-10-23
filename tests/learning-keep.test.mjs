import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs } from "./fixtures/runtime-fixture.mjs";
import { REFLECTION_INSTRUCTIONS } from "../server/learning.mjs";
import { toolsFor } from "../server/tools.mjs";

test("«mantener» is a valid answer: nothing is saved and the review says why", async (t) => {
  const { store, runtime } = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Extrae"))
      return answer(JSON.stringify({
        decision: "mantener", motivo: "La tarea salió como se pidió; no hay nada nuevo.",
        memory: [{ action: "add", target: "persona", text: "Prefiere el informe de ventas", old: "", por: ["m1"] }],
        skill: { action: "none", skillId: null, edits: [], name: "", description: "", content: "" }, soul: null,
      }));
    const done = outputs(request.input).length;
    return done < 5 ? call("list_files", {}, "c" + done) : answer("Hecho");
  });
  store.patch("settings", "main", { learning: true });
  store.put("learningCounters", { id: "nora", userTurns: 12, toolCalls: 12 });
  const m = runtime.create({ prompt: "Prepara el informe de ventas", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const mission = store.get("missions", m.id);
  assert.equal(mission.learningStatus, "completed");
  assert.equal(mission.learning.kept, true);
  assert.equal(mission.learning.notes[0], "Sin cambios: La tarea salió como se pidió; no hay nada nuevo.");
  assert.equal(store.list("memories").filter((x) => x.missionId === m.id).length, 0, "the decision wins over stray items");
  assert.equal(store.list("messages").filter((x) => x.kind === "learned").length, 0);
  assert.equal(store.get("learningCounters", "nora").toolCalls, 0, "a kept review still counts as a review");
});

test("the instructions and the SOUL tool say that changing nothing is a real answer", () => {
  assert.match(REFLECTION_INSTRUCTIONS, /MANTENER ES UNA RESPUESTA VALIDA/);
  assert.match(REFLECTION_INSTRUCTIONS, /"decision":"mantener"/);
  const soul = toolsFor("solo").find((x) => x.name === "propose_soul_change");
  assert.match(soul.description, /seguir como eres es una respuesta valida/);
});
