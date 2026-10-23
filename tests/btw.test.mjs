// «/btw …» (OpenClaw docs/tools/btw.md): a side question while the bot works. It is answered
// apart, on the bot's own model with its own side cache key, and nothing is written: no
// message, no queue item, no aside, no step; the turn in progress goes on untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { btwQuestion } from "../server/btw.mjs";
import { btwQuestion as clientQuestion } from "../src/lib/btw.js";

test("«/btw …» and «/side …» are side questions; anything else is not", () => {
  for (const parse of [btwQuestion, clientQuestion]) {
    assert.equal(parse("/btw ¿qué te falta?"), "¿qué te falta?");
    assert.equal(parse("  /BTW  cuánto llevas\ny qué queda "), "cuánto llevas\ny qué queda");
    assert.equal(parse("/side qué es esto"), "qué es esto");
    assert.equal(parse("/btw"), "");
    assert.equal(parse("/btwx hola"), null);
    assert.equal(parse("hola /btw qué"), null);
    assert.equal(parse("Haz el informe"), null);
  }
});

/** An app whose model answers through `respond`; the bot of the chat is working (a step running). */
async function setup(t, respond) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-btw-"));
  const store = new Store(dir);
  store.patch("settings", "main", { model: "gpt-fixture", learning: false });
  const calls = [];
  const runtime = new Runtime(store, { respond: async (params) => { calls.push(params); return respond(params); } }, null, { seed: false });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const post = (route, body) => fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const at = new Date().toISOString();
  store.put("missions", { id: "chat", title: "Comparativa de tarifas", prompt: "Compara las tarifas de luz", mode: "solo", botIds: ["nora"], conversation: true, status: "running", createdAt: at });
  store.put("messages", { id: "u1", missionId: "chat", role: "user", kind: "message", text: "Compara las tarifas de luz de Iberdrola y Endesa", at });
  store.put("messages", { id: "p1", missionId: "chat", role: "assistant", botId: "nora", kind: "progress", text: "Busco las tarifas vigentes…", at });
  store.put("steps", { id: "s1", missionId: "chat", botId: "nora", kind: "solo", status: "running", model: "gpt-step-model", history: [{ role: "user", content: "Compara las tarifas" }], pending: [{ type: "function_call", name: "web_fetch", call_id: "w1", arguments: "{}" }], narration: { text: "Ya tengo la de Iberdrola; me falta Endesa", at }, rounds: 2, startedAt: at });
  return { store, runtime, calls, post };
}

test("a side question is answered apart, on the step's model and side key, and nothing is written", async (t) => {
  const { store, runtime, calls, post } = await setup(t, async () => ({ text: "Llevo Iberdrola; me falta Endesa.", output: [] }));
  const snapshot = () => JSON.stringify(["messages", "steps", "asides", "missions", "approvals", "receipts"].map((k) => store.list(k)));
  const before = snapshot();
  const response = await post("/missions/chat/btw", { question: "¿Qué te falta?" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.answer, "Llevo Iberdrola; me falta Endesa.");
  assert.equal(body.botId, "nora");
  assert.equal(snapshot(), before, "no message, step, aside, approval or receipt changed");
  const [ask] = calls;
  assert.equal(ask.model, "gpt-step-model", "the conversation's own model");
  assert.deepEqual(ask.tools, [], "no tools: it cannot act");
  assert.equal(ask.cacheKey, runtime.cacheKeyFor("chat", "nora", true), "its side key, never the turn's warm connection");
  assert.notEqual(ask.cacheKey, runtime.cacheKeyFor("chat", "nora", false));
  assert.equal(ask.side, true);
  const text = JSON.stringify(ask.input);
  assert.match(text, /Pregunta al margen de la persona \(\/btw\): ¿Qué te falta\?/);
  assert.match(text, /Ya tengo la de Iberdrola; me falta Endesa/, "it knows what is happening now");
  assert.match(text, /herramientas en marcha: web_fetch/);
  assert.match(ask.instructions, /Pregunta al margen/);
});

test("«/btw» never becomes a message nor waits in the queue", async (t) => {
  const { store, post } = await setup(t, async () => ({ text: "x", output: [] }));
  const messages = store.list("messages").length;
  for (const route of ["/missions/chat/messages", "/missions/chat/queue"]) {
    const r = await post(route, { text: "/btw ¿cuánto falta?" });
    assert.equal(r.status, 400, route);
    assert.match((await r.json()).error, /pregunta al margen/);
  }
  assert.equal(store.list("messages").length, messages);
  assert.deepEqual(store.get("missions", "chat").queue || [], []);
  assert.equal((await post("/missions/chat/btw", { question: "" })).status, 400, "an empty question is refused");
  assert.equal((await post("/missions/nope/btw", { question: "hola" })).status, 404);
});

test("a /btw while the turn runs does not touch it: the turn goes on and its history has no trace", async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { store, runtime, calls, post } = await setup(t, async (params) => {
    if (/Pregunta al margen/.test(params.instructions || "")) return { text: "Voy por la mitad.", output: [] };
    await gate;
    return { text: "Aquí tienes la comparativa.", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Aquí tienes la comparativa." }] }] };
  });
  const m = runtime.create({ prompt: "Haz la comparativa", mode: "solo", botIds: ["nora"], conversation: true });
  const turn = runtime.launch(m.id);
  for (let i = 0; i < 50 && !calls.length; i++) await new Promise((r) => setTimeout(r, 10));
  const side = await post(`/missions/${m.id}/btw`, { question: "¿Por dónde vas?" });
  assert.equal((await side.json()).answer, "Voy por la mitad.");
  release();
  await turn;
  const step = runtime.steps(m.id)[0];
  assert.equal(step.status, "completed");
  assert.doesNotMatch(JSON.stringify(step.history), /Por dónde vas|Voy por la mitad/);
  assert.deepEqual(store.where("messages", "missionId", m.id).map((x) => x.text).filter((x) => /Por dónde vas|Voy por la mitad/.test(x)), []);
  const turnCall = calls.find((c) => !/Pregunta al margen/.test(c.instructions || ""));
  const sideCall = calls.find((c) => /Pregunta al margen/.test(c.instructions || ""));
  assert.notEqual(turnCall.cacheKey, sideCall.cacheKey);
});

test("in «Código», /btw asks Bruno about the task without sending him anything", async (t) => {
  const { runtime, calls, post } = await setup(t, async () => ({ text: "Estoy arreglando el test de login.", output: [] }));
  const sent = [];
  runtime.code = {
    detail: (id) => {
      if (id !== "task1") throw Object.assign(Error("Tarea no encontrada."), { status: 404 });
      return {
        task: { id, title: "Arreglar login", running: true, status: "running", branch: "colmena/login-1", goal: { text: "pasan los tests" } },
        project: { name: "web" },
        items: [{ kind: "user", text: "Arregla el login" }, { kind: "tool", verb: "edita", text: "src/login.js", status: "running" }],
        live: { text: "Cambio la validación del correo" },
      };
    },
    send: async (...args) => { sent.push(args); return {}; },
  };
  const r = await post("/code/tasks/task1/btw", { question: "¿Qué archivo tocas?" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).answer, "Estoy arreglando el test de login.");
  const text = JSON.stringify(calls[0].input);
  assert.match(text, /Arreglar login/);
  assert.match(text, /edita src\/login\.js \(en marcha\)/);
  assert.match(text, /Cambio la validación del correo/);
  assert.deepEqual(sent, [], "nothing reached Bruno's task");
  assert.equal((await post("/code/tasks/nope/btw", { question: "x" })).status, 404);
});
