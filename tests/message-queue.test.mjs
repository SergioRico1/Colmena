import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { deliverNext, enqueue, queueOf, watchQueues } from "../server/queue.mjs";

async function tempStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-queue-"));
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return store;
}

test("queued messages go one at a time when the bot finishes, and a refused one pauses the queue", async (t) => {
  const store = await tempStore(t);
  store.put("missions", { id: "c", status: "running", conversation: true, botIds: ["nora"], mode: "solo" });
  for (const text of ["uno", "dos", "tres"]) enqueue(store, store.get("missions", "c"), text);
  const sent = [];
  const runtime = { active: new Set() };
  const send = async (id, text) => { sent.push(text); store.patch("missions", id, { status: "running" }); };
  assert.equal(await deliverNext(store, runtime, "c", send), null, "nothing goes while it works");
  store.patch("missions", "c", { status: "completed" });
  await deliverNext(store, runtime, "c", send);
  assert.deepEqual(sent, ["uno"]);
  assert.deepEqual(queueOf(store.get("missions", "c")).map((q) => q.text), ["dos", "tres"]);
  // The next one waits for that turn to end.
  await deliverNext(store, runtime, "c", send);
  assert.deepEqual(sent, ["uno"]);

  store.patch("missions", "c", { status: "completed" });
  await deliverNext(store, runtime, "c", async () => { throw Error("Sin conexión"); });
  const m = store.get("missions", "c");
  assert.deepEqual(queueOf(m).map((q) => q.text), ["dos", "tres"], "it goes back first in line");
  assert.equal(m.queuePaused, "Sin conexión");
  assert.equal(await deliverNext(store, runtime, "c", send), null, "a paused queue never resends on its own");
});

test("the queue is in the record, so after a restart it is still there and goes by itself", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-queue-"));
  let store = new Store(dir);
  store.put("missions", { id: "c", status: "running", conversation: true, botIds: ["nora"], mode: "solo" });
  enqueue(store, store.get("missions", "c"), "cuando acabes, resúmelo");
  store.patch("missions", "c", { status: "completed" });
  store.close();
  store = new Store(dir);
  const sent = [];
  const stop = watchQueues(store, { active: new Set() }, async (_id, text) => { sent.push(text); }, { delayMs: 5 });
  t.after(async () => { stop(); store.close(); await rm(dir, { recursive: true, force: true }); });
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(sent, ["cuando acabes, resúmelo"]);
  assert.equal(queueOf(store.get("missions", "c")).length, 0);
});

test("API: add, edit, reorder, remove and «Pasárselo ya» on the queue", async (t) => {
  const store = await tempStore(t);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await runtime.shutdown(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const call = async (method, route, body = {}) => {
    const r = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  store.put("missions", { id: "c", title: "Chat", status: "running", conversation: true, botIds: ["nora"], mode: "solo", createdAt: new Date().toISOString() });
  for (const text of ["primero", "segundo", "tercero"]) assert.equal((await call("POST", "/missions/c/queue", { text })).status, 200);
  let q = (await call("PATCH", `/missions/c/queue/${queueOf(store.get("missions", "c"))[1].id}`, { text: "segundo, cambiado" })).body.queue;
  assert.equal(q[1].text, "segundo, cambiado");
  q = (await call("PATCH", `/missions/c/queue/${q[2].id}`, { before: q[0].id })).body.queue;
  assert.deepEqual(q.map((x) => x.text), ["tercero", "primero", "segundo, cambiado"]);
  q = (await call("DELETE", `/missions/c/queue/${q[1].id}`)).body.queue;
  assert.deepEqual(q.map((x) => x.text), ["tercero", "segundo, cambiado"]);
  assert.equal((await call("DELETE", "/missions/c/queue/nope")).status, 409);
  const state = await (await fetch(origin + "/api/state")).json();
  assert.deepEqual(state.missions.find((m) => m.id === "c").queue.map((x) => x.text), ["tercero", "segundo, cambiado"]);
  // «Pasárselo ya»: out of the queue and into the conversation, as a steer.
  q = (await call("POST", `/missions/c/queue/${q[0].id}/now`)).body.queue;
  assert.deepEqual(q.map((x) => x.text), ["segundo, cambiado"]);
  const said = store.where("messages", "missionId", "c").find((m) => m.text === "tercero");
  assert.ok(said, "the message is in the conversation");
});
