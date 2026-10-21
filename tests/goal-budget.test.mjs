import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call } from "./fixtures/runtime-fixture.mjs";
import { goalBudget } from "../server/goals.mjs";

test("a goal's budget adds what its missions spend; once used up they pause until it is raised", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async () => {
    round += 1;
    return round < 4 ? { ...call("list_files", {}, "c" + round), usage: { input_tokens: 900, output_tokens: 100 } } : answer("Hecho.", { input_tokens: 10, output_tokens: 10 });
  });
  store.put("goals", { id: "g1", title: "Lanzar la web", status: "active", milestones: [], budgetTokens: 2000, usedTokens: 0 });
  const m = runtime.create({ prompt: "Prepara la web", mode: "solo", botIds: ["nora"] });
  store.patch("missions", m.id, { goalId: "g1" });
  await runtime.launch(m.id);
  const goal = store.get("goals", "g1");
  assert.equal(goalBudget(goal).used, 2000);
  assert.equal(goalBudget(goal).limited, true);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "paused");
  assert.match(mission.error, /ha gastado su presupuesto/);
  assert.equal(round, 2, "no call once the budget ran out");
  // Raised: «Continuar» goes on.
  store.patch("goals", "g1", { budgetTokens: 100000 });
  await runtime.resume(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
});
