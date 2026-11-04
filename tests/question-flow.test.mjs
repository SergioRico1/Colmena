import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { schemas as SCHEMAS } from "../server/tools.mjs";
import { answersText, buildQuestions, checkAnswers } from "../server/questions.mjs";

const args = {
  question: "¿Qué trimestre cierro?", options: ["El tercero", "El cuarto"], blocks: 1, sources: [],
  more: [
    { question: "¿A quién se lo mando?", options: [], optional: false },
    { question: "¿Lo quieres también en inglés?", options: ["Sí", "No"], optional: true },
  ],
};

test("several questions: options, a free answer, and an optional one that can be skipped", () => {
  const qs = buildQuestions(args);
  assert.deepEqual(qs.map((q) => [q.id, q.options.length, q.optional]), [["q1", 2, false], ["q2", 0, false], ["q3", 2, true]]);
  const ok = checkAnswers(qs, [{ id: "q1", optionId: "o2" }, { id: "q2", text: "A Marta" }, { id: "q3", skipped: true }]);
  assert.deepEqual(ok.map((a) => a.label || a.text || (a.skipped && "—")), ["El cuarto", "A Marta", "—"]);
  assert.match(answersText(ok), /1\. ¿Qué trimestre cierro\?\n→ El cuarto/);
  assert.throws(() => checkAnswers(qs, [{ id: "q1", optionId: "o1" }, { id: "q3", optionId: "o1" }]), /Pregunta 2: falta tu respuesta/);
  assert.throws(() => checkAnswers(qs, [{ id: "q1", skipped: true }, { id: "q2", text: "x" }, { id: "q3", skipped: true }]), /Pregunta 1/, "a required one cannot be skipped");
  assert.throws(() => checkAnswers(qs, [{ id: "q1", optionId: "o9" }]), /esa opción no existe/);
});

test("the tool accepts `more`, and a single question stays as before", () => {
  assert.equal(SCHEMAS.ask_user.parse(args).more.length, 2);
  assert.deepEqual(SCHEMAS.ask_user.parse({ question: "¿Cuál?", options: ["A", "B"] }).more, []);
});

test("the bot gets every answer together once you answer them by steps", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-qflow-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("no"); } });
  runtime.relaunch = () => {};
  t.after(async () => { await runtime.shutdown(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const mission = store.put("missions", { id: "m", title: "Cierre", status: "running", mode: "solo", botIds: ["tomas"], conversation: true });
  const step = store.put("steps", { id: "m:s", key: "s", missionId: "m", botId: "tomas", kind: "solo", status: "running", deps: [], history: [], pending: [] });
  const bot = runtime.bot("tomas");
  const call = { call_id: "c1" };
  assert.deepEqual(runtime.askUser(mission, step, bot, call, args), { waiting: true });
  const a = store.get("approvals", "m:s:c1");
  assert.equal(a.questions.length, 3);
  runtime.answer(a.id, { answers: [{ id: "q1", optionId: "o1" }, { id: "q2", text: "A Marta" }, { id: "q3", skipped: true }] });
  const out = runtime.askUser(mission, step, bot, call, args);
  assert.deepEqual(out, { answers: [{ question: "¿Qué trimestre cierro?", answer: "El tercero" }, { question: "¿A quién se lo mando?", answer: "A Marta" }, { question: "¿Lo quieres también en inglés?", answer: null }] });
  const said = store.where("messages", "missionId", "m").find((m) => m.role === "user");
  assert.match(said.text, /→ A Marta/);
  assert.equal(store.get("approvals", a.id).resolution, "2 de 3 respuestas");
});
