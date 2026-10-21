import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, settle } from "./fixtures/runtime-fixture.mjs";
import { reactionsOf } from "../server/reactions.mjs";

const followups = (runtime, id) => runtime.steps(id).filter((s) => s.kind === "followup");
const tookIt = (store, id, bot) => reactionsOf(store.get("messages", id)).some((r) => r.emoji === "👍" && r.by === bot);

test("steer (default): the bot reads it at its next step, skips a change it chose before, and the queued reply does not repeat it", async (t) => {
  let written = null, rounds = 0;
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    const text = JSON.stringify(input);
    seen.push(text);
    void tools;
    if (/"call_id":"r1"/.test(text)) return answer("");
    if (text.includes("ya lo leyeron")) return call("react", { emoji: "👍" }, "r1");
    if (text.includes("La persona acaba de escribir")) return answer("Plan rehecho para tres.");
    if (seen.length > 1 && text.includes("Somos tres")) return answer("Vale, somos tres.");
    rounds += 1;
    if (rounds === 1) {
      written = runtime.addMessage(store.list("missions")[0].id, "Somos tres, no dos");
      return call("write_file", { path: "plan.md", content: "Plan para dos" }, "w1");
    }
    return answer("Plan rehecho para tres.");
  });
  const m = runtime.create({ prompt: "Planes para el domingo", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await settle(runtime);
  const step = runtime.steps(m.id)[0];
  const out = JSON.parse(step.history.find((x) => x.type === "function_call_output" && x.call_id === "w1").output);
  assert.equal(out.skipped, true, "the change chosen before the message was not made");
  assert.ok(step.history.some((x) => x.role === "user" && /Somos tres, no dos/.test(x.content || "")), "delivered at the next step");
  assert.ok(tookIt(store, written.id, "nora"), "👍 when it read it");
  assert.equal(followups(runtime, m.id).length, 1);
  const answers = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant").map((x) => x.text);
  assert.ok(!answers.includes("Vale, somos tres."), "no repeated answer: " + JSON.stringify(answers));
});

test("collect: messages written while they work wait, and become one turn", async (t) => {
  let rounds = 0;
  const requests = [];
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    if (tools.some((x) => x.name === "react")) {
      requests.push(JSON.stringify(input));
      if (requests.length > 1) return answer("Respondo a las dos cosas.");
    }
    rounds += 1;
    if (rounds === 1) {
      const id = store.list("missions")[0].id;
      runtime.addMessage(id, "Primera cosa");
      runtime.addMessage(id, "Segunda cosa");
      return call("list_files", {}, "l1");
    }
    return answer("Trabajo hecho.");
  });
  const m = runtime.create({ prompt: "Haz el informe", mode: "solo", botIds: ["nora"] });
  store.patch("missions", m.id, { queueMode: "collect" });
  await runtime.launch(m.id);
  await settle(runtime);
  const work = runtime.steps(m.id)[0];
  assert.ok(!work.history.some((x) => /Primera cosa/.test(JSON.stringify(x.content || ""))), "not delivered while working");
  const turns = followups(runtime, m.id);
  assert.equal(turns.length, 1, "one turn for both");
  assert.match(turns[0].request, /Primera cosa[\s\S]*Segunda cosa/);
});

test("followup: they finish first; each message gets its own turn", async (t) => {
  let rounds = 0;
  const { store, runtime } = await fixture(t, async ({ tools }) => {
    if (tools.some((x) => x.name === "react") && rounds > 1) return answer("Respondido.");
    rounds += 1;
    if (rounds === 1) {
      const id = store.list("missions")[0].id;
      runtime.addMessage(id, "Una");
      runtime.addMessage(id, "Otra");
      return call("list_files", {}, "l1");
    }
    return answer("Trabajo hecho.");
  });
  const m = runtime.create({ prompt: "Haz el informe", mode: "solo", botIds: ["nora"] });
  store.patch("missions", m.id, { queueMode: "followup" });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(followups(runtime, m.id).length, 2);
});

test("interrupt: what they were doing stops and the message is answered now", async (t) => {
  let started = 0;
  const { store, runtime } = await fixture(t, async ({ tools, signal }) => {
    if (tools.some((x) => x.name === "react") && started > 0) return answer("Paro y te atiendo: cambiamos a Madrid.");
    started += 1;
    const id = store.list("missions")[0].id;
    setTimeout(() => runtime.addMessage(id, "Para, mejor en Madrid"), 20);
    // A long call that only ends when it is aborted.
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  });
  const m = runtime.create({ prompt: "Planes en Valladolid", mode: "solo", botIds: ["nora"] });
  store.patch("missions", m.id, { queueMode: "interrupt" });
  await runtime.launch(m.id);
  await new Promise((r) => setTimeout(r, 60));
  await settle(runtime);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "completed", mission.error || "");
  assert.equal(mission.result, "Paro y te atiendo: cambiamos a Madrid.");
  assert.equal(runtime.steps(m.id)[0].skipped, true);
});
