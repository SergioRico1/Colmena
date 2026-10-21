import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { listRows, olderOf, threadOf } from "../src/lib/threads.js";

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-threads-")), store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => ({ text: "Vale.", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Vale." }] }] }) });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  t.after(async () => { await runtime.shutdown(); server.closeAllConnections(); await new Promise((r) => server.close(r)); store.close(); await rm(dir, { recursive: true, force: true }); });
  const post = async (route, body) => (await fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) })).json();
  return { store, post };
}

test("each bot has one chat: writing to it again continues the same thread; private chats and rooms stay apart", async (t) => {
  const { store, post } = await setup(t);
  const first = await post("/missions", { prompt: "Hola Vera", mode: "solo", botIds: ["vera"], conversation: true });
  const again = await post("/missions", { prompt: "¿Y lo de ayer?", mode: "solo", botIds: ["vera"], conversation: true });
  assert.equal(again.id, first.id);
  assert.equal(again.continued, true);
  assert.equal(store.get("missions", first.id).thread, true);
  const users = store.where("messages", "missionId", first.id).filter((m) => m.role === "user").map((m) => m.text);
  assert.deepEqual(users, ["Hola Vera", "¿Y lo de ayer?"]);
  const nora = await post("/missions", { prompt: "Hola Nora", mode: "solo", botIds: ["nora"], conversation: true });
  assert.notEqual(nora.id, first.id);
  const secret = await post("/missions", { prompt: "Algo privado", mode: "solo", botIds: ["vera"], conversation: true, incognito: true });
  assert.notEqual(secret.id, first.id);
  const room = await post("/missions", { prompt: "Preparad la campaña", mode: "equipo", botIds: ["vera", "nora"] });
  assert.notEqual(room.id, first.id);
});

test("the chats list shows each bot once and rooms; a private chat only while it is open", () => {
  const at = (d) => `2026-10-${String(d).padStart(2, "0")}T10:00:00Z`;
  const missions = [
    { id: "a", conversation: true, botIds: ["vera"], updatedAt: at(10) },
    { id: "b", conversation: true, botIds: ["vera"], updatedAt: at(12), thread: true },
    { id: "c", conversation: true, botIds: ["vera"], updatedAt: at(15) },
    { id: "d", conversation: true, botIds: ["nora"], updatedAt: at(11) },
    { id: "e", conversation: true, botIds: ["vera"], incognito: true, updatedAt: at(9) },
    { id: "r", conversation: false, botIds: ["vera", "nora"], room: "campaña", updatedAt: at(14) },
  ];
  assert.equal(threadOf(missions, "vera").id, "b");
  assert.deepEqual(olderOf(missions, "vera", "b").map((m) => m.id), ["c", "a"]);
  assert.deepEqual(listRows(missions).map((m) => m.id), ["b", "r", "d"]);
  assert.deepEqual(listRows(missions, "e").map((m) => m.id), ["b", "r", "d", "e"]);
});
