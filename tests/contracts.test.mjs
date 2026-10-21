import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";

test("each part of the plan says what it does not do, and the bot doing it hears it", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    if (tools.some((x) => x.name === "propose_plan")) {
      const last = outputs(input).at(-1);
      if (!last) return call("propose_plan", { assignments: [{ botId: "nora", title: "Buscar planes", task: "Busca planes", deliverable: "Lista", avoid: "No redacta la guía final", after: [] }, { botId: "nora", title: "Ordenar", task: "Ordena la lista" }], summary: "Reparto" }, "p1");
      return answer("Plan en marcha");
    }
    seen.push(JSON.stringify(input));
    return answer("Hecho.");
  });
  const m = runtime.create({ prompt: "Planes", mode: "equipo", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.equal(store.list("approvals").find((a) => a.kind === "plan").plan.assignments[0].avoid, "No redacta la guía final");
  await settle(runtime);
  const work = runtime.steps(m.id).find((s) => s.kind === "work");
  assert.match(work.task, /No hagas: No redacta la guía final/);
  assert.ok(seen.some((x) => /No hagas: No redacta/.test(x) && /bloqueo concreto/.test(x)), "the work step gets the part and the hand-back contract");
});

test("a delegated part that comes back empty counts as missing, not as a result", async (t) => {
  let round = 0;
  const { runtime } = await fixture(t, async ({ instructions }) => {
    if (/# Encargo delegado/.test(instructions)) return answer("");
    round += 1;
    if (round === 1) return call("ask_bot", { botId: "", question: "", tasks: [{ botId: "tomas", task: "Calcula el total", context: "" }] }, "d1");
    return answer("Listo.");
  });
  const m = runtime.create({ prompt: "Informe", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const out = JSON.parse(runtime.steps(m.id)[0].history.find((x) => x.type === "function_call_output" && x.call_id === "d1").output);
  assert.match(out.results[0].error, /no devolvió resultado/);
});
