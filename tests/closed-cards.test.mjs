import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { closedState } from "../src/lib/approvalState.js";

test("a closed request says how it ended; a pending one says nothing", () => {
  const options = [{ id: "o1", label: "Estímalas" }];
  assert.equal(closedState({ status: "pending" }), null);
  assert.equal(closedState({ status: "answered", resolution: "Estímalas", decidedBy: "tú" }, options).label, "Respondiste: Estímalas");
  assert.equal(closedState({ status: "answered", resolution: "Usa las de agosto", decidedBy: "tú" }).label, "Respondiste: Usa las de agosto");
  assert.equal(closedState({ status: "dismissed", resolution: "Sin responder" }).state, "dismissed");
  assert.equal(closedState({ status: "expired", resolution: "Sin respuesta a tiempo" }).label, "Caducó sin respuesta");
  assert.equal(closedState({ status: "denied", resolution: "Misión cancelada", decidedBy: "tú" }).state, "cancelled");
  assert.equal(closedState({ status: "denied", resolution: "Descartado", decidedBy: "tú" }).label, "Se canceló: descartado");
  assert.equal(closedState({ status: "denied", decidedBy: "tú" }).label, "Lo denegaste");
  assert.equal(closedState({ status: "approved", decidedBy: "regla" }).label, "Lo aprobó una regla");
});

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-closed-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls"); } });
  runtime.relaunch = () => {};
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await runtime.shutdown(); server.closeAllConnections(); await new Promise((r) => server.close(r)); store.close(); await rm(dir, { recursive: true, force: true }); });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const call = async (method, route, body) => {
    const r = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  store.put("missions", { id: "m", title: "Chat", status: "waiting", mode: "solo", botIds: ["tomas"], conversation: true, createdAt: new Date().toISOString() });
  const ask = (id) => store.put("approvals", { id, missionId: "m", botId: "tomas", stepId: "m:s", tool: "ask_user", kind: "question", title: "¿Cómo trato las devoluciones?", summary: "¿Cómo trato las devoluciones?", options: [{ id: "o1", label: "Estímalas" }], status: "pending", createdAt: new Date().toISOString() });
  return { store, call, ask };
}
const revisionOf = async (call, id) => (await call("GET", "/state")).body.approvals.find((a) => a.id === id).revision;

test("a question can be dismissed or answered in your own words, once", async (t) => {
  const { store, call, ask } = await setup(t);
  ask("q1");
  assert.equal((await call("POST", "/approvals/q1/dismiss", { revision: await revisionOf(call, "q1") })).status, 200);
  assert.equal(store.get("approvals", "q1").status, "dismissed");
  assert.equal((await call("POST", "/approvals/q1/dismiss", { revision: "x" })).status >= 400, true, "a closed one cannot be dismissed again");
  ask("q2");
  assert.equal((await call("POST", "/approvals/q2/answer", { text: "Usa las de agosto", revision: await revisionOf(call, "q2") })).status, 200);
  const q2 = store.get("approvals", "q2");
  assert.equal(q2.status, "answered");
  assert.equal(closedState(q2).label, "Respondiste: Usa las de agosto");
  assert.ok(store.where("messages", "missionId", "m").some((m) => m.role === "user" && m.text === "Usa las de agosto"), "your words are in the chat");
});
