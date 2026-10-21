import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { LoopGuard } from "../server/loops.mjs";
import { Store } from "../server/store.mjs";
import { TriggerEngine, normalizeTrigger } from "../server/triggers.mjs";

test("the guard silences a pair past the limit, once, and lets it talk again after the cooldown", () => {
  let t = 0;
  const guard = new LoopGuard({ windowMs: 1000, limit: 2, cooldownMs: 500 }, () => t);
  assert.equal(guard.hit("a").ok, true);
  assert.equal(guard.hit("a").ok, true);
  const third = guard.hit("a");
  assert.deepEqual([third.ok, third.fresh], [false, true]);
  assert.deepEqual([guard.hit("a").ok, guard.hit("a").fresh], [false, false], "still silenced, no second notice");
  assert.equal(guard.hit("b").ok, true, "other pairs are not affected");
  t = 600;
  assert.equal(guard.hit("a").ok, true, "back after the cooldown");
});

test("two bots consulting each other without end are stopped and the room says so once", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async ({ instructions, input }) => {
    if (/Consulta de un compañero/.test(instructions)) return answer("Ni idea, pregúntame otra vez.");
    round += 1;
    if (round <= 4) return call("ask_bot", { botId: "tomas", question: "¿Y ahora? " + round, tasks: [] }, "c" + round);
    const last = outputs(input).at(-1);
    return answer("Decido yo: " + (last.error ? "frenado" : "sigo"));
  }, { loopGuard: { windowMs: 60000, limit: 2, cooldownMs: 60000 } });
  const m = runtime.create({ prompt: "Cuadra el presupuesto", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await settle(runtime);
  const notices = store.list("messages").filter((x) => x.missionId === m.id && x.kind === "guard");
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /frenado a Nora y Tomás un minuto/);
  const reply = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant").at(-1);
  assert.equal(reply.text, "Decido yo: frenado");
  // The person is never held back.
  const next = runtime.addMessage(m.id, "Vale, ¿y el total?");
  assert.ok(next?.id);
});

test("room automations woken by bot messages rest a minute; the person's messages still wake them", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-loops-"));
  const store = new Store(directory);
  const fired = [];
  const engine = new TriggerEngine({ store, enqueue: (ruleId, event) => fired.push(event.id), loopGuard: { windowMs: 60000, limit: 2, cooldownMs: 60000 } });
  t.after(async () => { engine.stop(); store.close(); await rm(directory, { recursive: true, force: true }); });
  store.put("missions", { id: "room", title: "Ventas", room: "ventas", conversation: true, status: "completed", botIds: ["nora"], createdAt: new Date().toISOString() });
  store.put("automations", { id: "r", name: "Responder ventas", botId: "tomas", prompt: "Responde", enabled: true, trigger: normalizeTrigger({ type: "sala", config: { sala: "ventas", salaModo: "todo", deQuien: "todos" } }) });
  for (const n of [1, 2, 3, 4]) engine.onMessage({ id: "b" + n, missionId: "room", role: "assistant", botId: "nora", text: "Otra vez " + n });
  engine.onMessage({ id: "u1", missionId: "room", role: "user", text: "¿Cómo vamos?" });
  assert.deepEqual(fired, ["b1", "b2", "u1"]);
  const notices = store.list("messages").filter((x) => x.kind === "guard");
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /«Responder ventas» un minuto/);
});
