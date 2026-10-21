import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { asideContext, askAside, asideBot, shareAside, ASIDE_RULES } from "../server/interject.mjs";

async function api(t, respond) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-aside-")),
    store = new Store(dir);
  store.patch("settings", "main", { model: "fixture", learning: false });
  const runtime = new Runtime(store, { respond });
  let origin;
  const app = createApp({ store, runtime, session: { status: () => ({ email: "a@b.c" }), models: [] }, getOrigin: () => origin });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    app.locals.interaction?.standing?.stop();
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const call = async (method, route, body) => {
    const res = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    return { status: res.status, body: await res.json() };
  };
  return { store, runtime, call };
}

function seed(store) {
  const at = new Date().toISOString();
  store.put("missions", { id: "m1", title: "Informe Q3", room: "informe-q3", prompt: "Prepara el informe del tercer trimestre", mode: "equipo", botIds: ["nora", "tomas"], status: "running", steps: [], createdAt: at });
  store.put("steps", { id: "s1", missionId: "m1", key: "work-nora", botId: "nora", kind: "work", title: "Datos de ventas", status: "completed", text: "Ventas: 1,2 M€ (+8 %).", deps: [] });
  store.put("steps", { id: "s2", missionId: "m1", key: "work-tomas", botId: "tomas", kind: "work", title: "Márgenes", status: "running", text: "", deps: [] });
  store.put("messages", { id: "msg1", missionId: "m1", role: "user", text: "Prepara el informe del tercer trimestre", kind: "message", at });
  store.put("artifacts", { id: "art1", missionId: "m1", botId: "nora", title: "ventas.md", content: "# Ventas\nTotal 1,2 M€", createdAt: at });
  store.put("thread", { id: "t1", missionId: "m1", from: "nora", to: "tomas", text: "Te paso las ventas", at });
}

test("the side question sees the mission and leaves its history untouched", async (t) => {
  const seen = [];
  const { store, call } = await api(t, async (params) => {
    seen.push(params);
    return { text: "Nora ya tiene las ventas (1,2 M€); Tomás sigue con los márgenes.", output: [] };
  });
  seed(store);
  const before = { messages: store.where("messages", "missionId", "m1").length, steps: JSON.stringify(store.where("steps", "missionId", "m1")), thread: store.where("thread", "missionId", "m1").length, status: store.get("missions", "m1").status };

  const res = await call("POST", "/missions/m1/aside", { text: "¿Qué falta para terminar?" });
  assert.equal(res.status, 200);
  assert.equal(res.body.botId, "atlas", "a team room is answered by Atlas");
  assert.match(res.body.answer, /márgenes/);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].tools, [], "no tools");
  assert.ok(seen[0].instructions.includes(ASIDE_RULES));
  // The mission as data first, then the question (earlier asides would go in between).
  const input = seen[0].input.map((x) => x.content).join("\n");
  assert.match(seen[0].input.at(-1).content, /¿Qué falta para terminar\?/);
  assert.match(input, /Datos de ventas/);
  assert.match(input, /ventas\.md/);
  assert.match(input, /Te paso las ventas/);
  assert.match(input, /¿Qué falta para terminar\?/);

  assert.equal(store.where("messages", "missionId", "m1").length, before.messages, "nothing written to the room");
  assert.equal(JSON.stringify(store.where("steps", "missionId", "m1")), before.steps, "steps not steered");
  assert.equal(store.where("thread", "missionId", "m1").length, before.thread);
  assert.equal(store.get("missions", "m1").status, before.status);

  const other = await call("POST", "/missions/m1/aside", { text: "¿Y tú qué opinas?", botId: "tomas" });
  assert.equal(other.body.botId, "tomas", "a member can be asked directly");
  const outsider = await call("POST", "/missions/m1/aside", { text: "¿Y tú?", botId: "iris" });
  assert.equal(outsider.body.botId, "atlas", "a bot outside the room falls back to Atlas");

  // «Pasarla a la sala»: question and answer become room messages, without a new turn.
  const shared = await call("POST", `/missions/m1/aside/${res.body.id}/share`, {});
  assert.equal(shared.body.shared, true);
  const room = store.where("messages", "missionId", "m1");
  assert.equal(room.length, before.messages + 2);
  assert.deepEqual(room.slice(-2).map((m) => [m.role, m.text]), [["user", "¿Qué falta para terminar?"], ["assistant", res.body.answer]]);
  assert.equal(store.where("steps", "missionId", "m1").length, 2, "sharing does not start a turn");
  await call("POST", `/missions/m1/aside/${res.body.id}/share`, {});
  assert.equal(store.where("messages", "missionId", "m1").length, before.messages + 2, "sharing twice is a no-op");

  assert.equal((await call("DELETE", `/missions/m1/aside/${other.body.id}`)).status, 200);
  assert.equal(store.get("asides", other.body.id), null, "Descartar removes it");
  assert.equal((await call("POST", "/missions/nope/aside", { text: "hola" })).status, 404);
  assert.equal((await call("POST", "/missions/m1/aside", { text: "" })).status, 400);
});

test("without an AI account the side question explains what is missing", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-aside-noai-")),
    store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => ({ text: "x" }) });
  let origin;
  const app = createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    app.locals.interaction?.standing?.stop();
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  seed(store);
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const res = await fetch(origin + "/api/missions/m1/aside", { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify({ text: "¿Qué tal va?" }) });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /Conecta una cuenta de IA/);
});

test("context is bounded and the answering bot follows the room", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-aside-ctx-")),
    store = new Store(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  seed(store);
  for (let i = 0; i < 40; i++) store.put("messages", { id: "bulk" + i, missionId: "m1", role: "assistant", botId: "nora", text: "x".repeat(5000), at: new Date().toISOString() });
  const ctx = asideContext(store, store.get("missions", "m1"));
  assert.equal(ctx.mensajes.length, 24);
  assert.ok(ctx.mensajes.every((m) => m.texto.length <= 1201));
  store.put("missions", { id: "c1", title: "Chat", mode: "solo", conversation: true, botIds: ["vera"], status: "completed", createdAt: new Date().toISOString() });
  assert.equal(asideBot(store, store.get("missions", "c1")).id, "vera");
  const aside = await askAside({ store, missionId: "c1", text: "¿Resumen?", infer: async () => ({ text: "  Breve.  " }), model: "m" });
  assert.equal(aside.answer, "Breve.");
  await assert.rejects(askAside({ store, missionId: "c1", text: "¿?", infer: async () => ({ text: "" }), model: "m" }), /no ha sabido responder/);
  store.patch("missions", "c1", { status: "cancelled" });
  assert.throws(() => shareAside(store, aside.id), /no admite/);
});

test("«Decir ahora»: a hint in the thread reaches the running step at its next round", async (t) => {
  const inputs = [];
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  const { store, runtime, call } = await api(t, async (params) => {
    calls++;
    inputs.push(JSON.stringify(params.input));
    if (calls === 1) {
      await gate;
      return { text: "", output: [{ type: "function_call", name: "remember_nothing_tool", arguments: "{}", call_id: "c1" }] };
    }
    return { text: "Hecho.", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Hecho." }] }] };
  });
  const created = await call("POST", "/missions", { prompt: "Redacta el resumen semanal", mode: "solo", botIds: ["vera"], conversation: true });
  assert.equal(created.status, 201);
  const id = created.body.id;
  for (let i = 0; i < 50 && calls === 0; i++) await new Promise((r) => setTimeout(r, 10));
  // While the bot is in its turn, the queued message goes out as a hint.
  const hint = await call("POST", `/missions/${id}/thread`, { text: "Que sea en tono cercano" });
  assert.equal(hint.status, 200);
  release();
  for (let i = 0; i < 200 && calls < 2; i++) await new Promise((r) => setTimeout(r, 10));
  await Promise.all([...runtime.jobs]);
  assert.ok(calls >= 2, "the step ran another round");
  assert.match(inputs.slice(1).join("\n"), /Que sea en tono cercano/, "the next round sees the hint");
  assert.ok(store.where("thread", "missionId", id).some((x) => x.from === "user"));
});

test("accepting an idea with evidence opens a mission; state shows evidence and hides retired ones", async (t) => {
  const { store, call } = await api(t, async () => ({ text: "Borrador listo.", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Borrador listo." }] }] }));
  const at = new Date().toISOString();
  store.put("suggestions", { id: "i1", kind: "idea", botId: "vera", status: "pending", text: "Ana te escribió.", cta: "Sí", payload: { source: "correo", prompt: "Prepara un borrador de respuesta para Ana. No lo envíes." }, evidence: [{ source: "Correo de Ana", quote: "¿Me envías el presupuesto?", url: null }], createdAt: at });
  store.put("suggestions", { id: "i2", kind: "idea", botId: "vera", status: "retired", text: "Vieja", payload: {}, createdAt: at });
  let state = (await call("GET", "/state")).body;
  assert.deepEqual(state.suggestions.map((s) => s.id), ["i1"]);
  assert.equal(state.suggestions[0].evidence[0].source, "Correo de Ana");
  const accepted = await call("POST", "/suggestions/i1", { decision: "accept" });
  assert.equal(accepted.status, 200);
  const mission = store.get("missions", accepted.body.missionId);
  assert.equal(mission.botIds[0], "vera");
  assert.equal(mission.safety, "preguntar");
  assert.match(mission.prompt, /No lo envíes/);
  assert.equal(store.get("suggestions", "i1").status, "accepted");
  state = (await call("GET", "/state")).body;
  assert.equal(state.suggestions.length, 0);
  assert.equal(state.voice.transcribe, false, "no API key → no server dictation");
  assert.ok(Array.isArray(state.standingOrders) && Array.isArray(state.intents));
  assert.equal((await call("PATCH", "/bots/vera", { voice: "Microsoft Helena - Spanish (Spain)" })).body.voice, "Microsoft Helena - Spanish (Spain)");
  state = (await call("GET", "/state")).body;
  assert.equal(state.bots.find((b) => b.id === "vera").voice, "Microsoft Helena - Spanish (Spain)");
  assert.equal((await call("GET", "/voice/status")).body.transcribe, false);
  assert.equal((await call("POST", "/voice/transcribe", { audio: "AAAAAAAAAAAAAAAAAAAA", mime: "audio/webm" })).status, 501);
});
