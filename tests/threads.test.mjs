import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";

test("a reply in a message's thread stays there and the bot that wrote it answers in it", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input }) => {
    seen.push(JSON.stringify(input));
    return answer(seen.length === 1 ? "Tres opciones: museo, concierto y paseo." : "El concierto empieza a las 19:00.");
  });
  const m = runtime.create({ prompt: "Planes para el domingo", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const first = store.list("messages").find((x) => x.missionId === m.id && x.role === "assistant");
  assert.ok(first, "first answer");

  runtime.addMessage(m.id, "¿A qué hora es el concierto?", [], { replyTo: first.id });
  await settle(runtime);
  const messages = store.list("messages").filter((x) => x.missionId === m.id);
  const reply = messages.find((x) => x.role === "user" && x.text.startsWith("¿A qué hora"));
  assert.equal(reply.replyTo, first.id);
  const botReply = messages.find((x) => x.role === "assistant" && x.text.includes("19:00"));
  assert.equal(botReply.replyTo, first.id, "the answer lands in the same thread");
  assert.equal(botReply.botId, "nora");
  assert.match(seen.at(-1), /Responde en el hilo del mensaje de Nora/);
  assert.match(seen.at(-1), /museo, concierto y paseo/);
});
