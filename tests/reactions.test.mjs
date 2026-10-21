import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, settle } from "./fixtures/runtime-fixture.mjs";
import { togglePersonReaction, isEmoji, reactionsOf } from "../server/reactions.mjs";

const byBot = (m, emoji, bot) => reactionsOf(m).some((r) => r.emoji === emoji && r.by === bot);

test("a bot shows 👀 on the message it works on and takes it away when it answers", async (t) => {
  let seenWhileWorking = null;
  const { store, runtime } = await fixture(t, async () => {
    const asked = store.list("messages").find((x) => x.role === "user");
    seenWhileWorking = byBot(asked, "👀", "nora");
    return answer("Tres planes para el domingo.");
  });
  const m = runtime.create({ prompt: "Planes para el domingo", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const asked = store.list("messages").find((x) => x.missionId === m.id && x.role === "user");
  assert.equal(seenWhileWorking, true, "👀 while working");
  assert.equal(byBot(store.get("messages", asked.id), "👀", "nora"), false, "gone once the answer is there");
});

test("«gracias» gets a reaction instead of an empty message", async (t) => {
  let turn = 0;
  const { store, runtime } = await fixture(t, async ({ tools }) => {
    turn += 1;
    if (turn === 1) return answer("Hecho: tres planes.");
    if (turn === 2) {
      assert.ok(tools.some((x) => x.name === "react"), "react is offered when answering a message");
      return call("react", { emoji: "🙌" });
    }
    return answer("");
  });
  const m = runtime.create({ prompt: "Planes para el domingo", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const thanks = runtime.addMessage(m.id, "Gracias!");
  await settle(runtime);
  const fresh = store.get("messages", thanks.id);
  assert.equal(byBot(fresh, "🙌", "nora"), true);
  assert.equal(byBot(fresh, "👀", "nora"), false);
  const answers = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant");
  assert.equal(answers.length, 1, "no empty «De nada» message");
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("the person's reactions never start a turn and reach the bot on its next one", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input }) => {
    seen.push(JSON.stringify(input));
    return answer(seen.length === 1 ? "Tres planes para el domingo." : "El concierto es a las 19:00.");
  });
  const m = runtime.create({ prompt: "Planes para el domingo", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const reply = store.list("messages").find((x) => x.missionId === m.id && x.role === "assistant");
  togglePersonReaction(store, reply.id, "👍");
  await settle(runtime);
  assert.equal(seen.length, 1, "a reaction does not wake the bot");
  assert.deepEqual(reactionsOf(store.get("messages", reply.id)).map((r) => [r.emoji, r.by]), [["👍", "user"]]);
  runtime.addMessage(m.id, "¿A qué hora es el concierto?");
  await settle(runtime);
  assert.match(seen.at(-1), /La persona reaccionó con 👍 a tu mensaje «Tres planes/);
  runtime.addMessage(m.id, "¿Y el museo?");
  await settle(runtime);
  assert.doesNotMatch(seen.at(-1), /reaccionó con 👍/, "each reaction is told once");
  togglePersonReaction(store, reply.id, "👍");
  assert.equal(reactionsOf(store.get("messages", reply.id)).length, 0, "a second click takes it back");
});

test("only emoji are accepted as the person's reaction", () => {
  for (const ok of ["👍", "👍🏽", "❤️", "🚀"]) assert.equal(isEmoji(ok), true, ok);
  for (const bad of ["", "ok", ":)", "a👍"]) assert.equal(isEmoji(bad), false, bad);
});

test("teammates acknowledge their part with 👍 on the plan and turn it into ✅ when they deliver", async (t) => {
  let whileWorking = null;
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    if (tools.some((x) => x.name === "propose_plan")) {
      const done = input.filter((x) => x.type === "function_call_output");
      return done.length ? answer("Plan en marcha") : call("propose_plan", { assignments: [{ botId: "nora", task: "Busca datos" }, { botId: "tomas", task: "Calcula" }], summary: "Reparto propuesto" }, "plan-1");
    }
    const plan = store.list("messages").find((x) => x.kind === "plan");
    if (whileWorking === null) whileWorking = reactionsOf(store.get("messages", plan.id)).map((r) => r.emoji + r.by);
    return answer("Trabajo hecho");
  });
  const m = runtime.create({ prompt: "Informe Q3 de ventas", mode: "equipo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  await settle(runtime);
  const plan = store.list("messages").find((x) => x.kind === "plan");
  assert.ok(whileWorking.includes("👍nora"), "👍 while Nora works on her part");
  const final = reactionsOf(store.get("messages", plan.id)).map((r) => r.emoji + r.by).sort();
  assert.deepEqual(final, ["✅nora", "✅tomas"]);
});

test("a bot that reads your message mid-work reacts 👍 on it", async (t) => {
  let written = null, rounds = 0;
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    if (tools.some((x) => x.name === "propose_plan")) {
      const done = input.filter((x) => x.type === "function_call_output");
      return done.length ? answer("Plan en marcha") : call("propose_plan", { assignments: [{ botId: "nora", task: "Busca planes" }, { botId: "nora", task: "Ordénalos" }], summary: "Reparto propuesto" }, "plan-1");
    }
    if (!tools.some((x) => x.name === "react") && !written) {
      // Nora is working: the person writes in the room meanwhile.
      written = runtime.addMessage(store.list("missions")[0].id, "Somos dos adultos y una niña de 6 años");
      return call("list_files", {}, "c-" + ++rounds);
    }
    return answer("Hecho, teniéndolo en cuenta.");
  });
  const m = runtime.create({ prompt: "Planes para el domingo", mode: "equipo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.ok(written, "the person wrote while Nora worked");
  const fresh = store.get("messages", written.id);
  assert.ok(reactionsOf(fresh).some((r) => r.emoji === "👍" && r.by === "nora"), JSON.stringify(fresh.reactions));
});
