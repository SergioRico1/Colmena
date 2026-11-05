import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { schemas as SCHEMAS } from "../server/tools.mjs";
import { QUESTION_PENDING, QUESTION_WAIT_MINUTES } from "../server/questions.mjs";
import { approvalView } from "../server/state.mjs";

async function setup(t, { autonomy = "solo", stepStatus = "running" } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-timedq-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("no"); } });
  const relaunched = [];
  runtime.relaunch = (id) => relaunched.push(id);
  runtime.launch = (id) => relaunched.push("launch:" + id);
  t.after(async () => { await runtime.shutdown(); store.close(); await rm(dir, { recursive: true, force: true }); });
  store.put("bots", { id: "tomas", name: "Tomás", role: "Finanzas", enabled: true, autonomy });
  const mission = store.put("missions", { id: "m", title: "Cierre", status: "waiting", mode: "solo", botIds: ["tomas"], conversation: true, steps: ["s"] });
  const step = store.put("steps", { id: "m:s", key: "s", missionId: "m", botId: "tomas", kind: "solo", status: stepStatus, deps: [], history: [], pending: [], startedAt: new Date(Date.now() - 60000).toISOString() });
  const args = SCHEMAS.ask_user.parse({ question: "¿Qué trimestre cierro?", options: ["El tercero", "El cuarto"] });
  return { store, runtime, mission, step, bot: runtime.bot("tomas"), args, relaunched };
}
const due = (store, id) => store.patch("approvals", id, { waitUntil: new Date(Date.now() - 1000).toISOString() });

test("a bot that acts waits a limited time; a bot that suggests waits for you unless it asks for a limit", async (t) => {
  const { runtime, store, mission, bot } = await setup(t);
  assert.equal(SCHEMAS.ask_user.parse({ question: "¿Cuál?", options: ["A", "B"] }).waitMinutes, 0);
  assert.equal(runtime.questionWait(mission, bot, 0), QUESTION_WAIT_MINUTES);
  assert.equal(runtime.questionWait(mission, bot, 45), 45);
  store.patch("settings", "main", { questionWaitMinutes: 30 });
  assert.equal(runtime.questionWait(mission, bot, 0), 30);
  store.patch("settings", "main", { questionWaitMinutes: 0 });
  assert.equal(runtime.questionWait(mission, bot, 0), 0, "0 = no limit");
  store.patch("bots", "tomas", { autonomy: "sugiere" });
  assert.equal(runtime.questionWait(mission, runtime.bot("tomas"), 0), 0);
  assert.equal(runtime.questionWait(mission, runtime.bot("tomas"), 5), 5);
});

test("when the wait ends the bot gets {pending:true} with a prudent instruction; the card stays answerable", async (t) => {
  const { runtime, store, mission, step, bot, args, relaunched } = await setup(t);
  const call = { call_id: "c1" };
  assert.deepEqual(runtime.askUser(mission, step, bot, call, args), { waiting: true });
  const a = store.get("approvals", "m:s:c1");
  assert.ok(Date.parse(a.waitUntil) > Date.now(), "waits about ten minutes");
  assert.deepEqual(runtime.askUser(mission, step, bot, call, args), { waiting: true }, "still within the wait");
  due(store, a.id);
  assert.equal(runtime.sweepQuestions(), 1);
  assert.deepEqual(relaunched, ["m"], "the mission goes on by itself");
  const out = runtime.askUser(mission, step, bot, call, args);
  assert.deepEqual(out, QUESTION_PENDING);
  assert.equal(out.pending, true);
  assert.match(out.message, /no es un «no» ni un «sí»/);
  assert.match(out.message, /línea roja/);
  assert.match(out.message, /qué has supuesto/);
  const fresh = store.get("approvals", a.id);
  assert.equal(fresh.status, "pending", "never closed as a refusal");
  assert.equal(fresh.timedOut, true);
  const view = approvalView(fresh, { bots: new Map(), missions: new Map([["m", mission]]), automations: new Map(), stepsByMission: new Map() });
  assert.equal(view.status, "pending");
  assert.equal(view.stillOpen, true);
  assert.equal(runtime.sweepQuestions(), 0, "timed out once");
});

test("a late answer reaches the bot tagged as the reply and closes the question; a second answer is refused", async (t) => {
  const { runtime, store, mission, step, bot, args } = await setup(t);
  const call = { call_id: "c1" };
  runtime.askUser(mission, step, bot, call, args);
  due(store, "m:s:c1");
  runtime.askUser(mission, step, bot, call, args);
  runtime.answer("m:s:c1", { optionId: "o2" });
  const a = store.get("approvals", "m:s:c1");
  assert.equal(a.status, "answered");
  assert.equal(a.lateAnswer, true);
  const said = store.where("messages", "missionId", "m").find((m) => m.role === "user" && m.lateAnswer);
  assert.equal(said.text, "El cuarto");
  assert.equal(said.approvalId, "m:s:c1");
  const next = runtime.injectMessages(mission, store.get("steps", "m:s"));
  const injected = next.history.at(-1).content;
  assert.match(injected, /responde ahora a tu pregunta «¿Qué trimestre cierro\?»/);
  assert.match(injected, /«El cuarto»/);
  assert.throws(() => runtime.answer("m:s:c1", { optionId: "o1" }), /respondida/);
  // Its tool result does not change: the bot already went on.
  assert.deepEqual(runtime.askUser(mission, step, bot, call, args), { answer: "El cuarto", optionId: "o2" });
});

test("a late answer after the asking step finished starts a new turn of that bot with the reply", async (t) => {
  const { runtime, store, mission, step, bot, args, relaunched } = await setup(t);
  const call = { call_id: "c1" };
  runtime.askUser(mission, step, bot, call, args);
  due(store, "m:s:c1");
  runtime.askUser(mission, step, bot, call, args);
  store.patch("steps", "m:s", { status: "completed" });
  store.patch("missions", "m", { status: "completed" });
  runtime.answer("m:s:c1", { text: "El tercero, y con el IVA aparte" });
  const turn = store.where("steps", "missionId", "m").find((s) => s.kind === "followup");
  assert.ok(turn, "a new turn");
  assert.equal(turn.botId, "tomas");
  assert.match(turn.request, /responde ahora a tu pregunta/);
  assert.match(turn.request, /IVA aparte/);
  assert.equal(store.get("missions", "m").status, "queued");
  assert.ok(relaunched.includes("launch:m"));
});

test("dismissing a timed-out question does not wake the bot again", async (t) => {
  const { runtime, store, mission, step, bot, args, relaunched } = await setup(t);
  runtime.askUser(mission, step, bot, { call_id: "c1" }, args);
  due(store, "m:s:c1");
  runtime.askUser(mission, step, bot, { call_id: "c1" }, args);
  relaunched.length = 0;
  runtime.dismissQuestion("m:s:c1");
  assert.deepEqual(relaunched, []);
});
