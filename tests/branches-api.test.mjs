import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";

// The bot answers with what it was asked and how much of the conversation it saw.
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-branches-"));
  const store = new Store(dir);
  store.patch("settings", "main", { model: "gpt-5" });
  const seen = [];
  let n = 0;
  const respond = async ({ input }) => {
    const said = (input || []).filter((x) => x.role === "user" || x.role === "assistant").map((x) => String(typeof x.content === "string" ? x.content : JSON.stringify(x.content)));
    const text = "respuesta " + ++n;
    seen.push({ said, text });
    return { text, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] };
  };
  const runtime = new Runtime(store, { respond }, null, { retryDelays: [], suggest: false, autoTitle: false, review: false, recaps: false });
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
  const idle = async (id) => { for (let i = 0; i < 200; i++) { const m = store.get("missions", id); if (m.status === "completed" && !runtime.active.has(id)) return; await new Promise((r) => setTimeout(r, 20)); } throw Error("still working"); };
  return { store, runtime, call, idle, seen };
}
const shown = (detail) => detail.messages.filter((m) => m.kind === "message").map((m) => m.text);

test("editing a message answers it again on a new version; «‹ 1/2 ›» goes back to the old one", async (t) => {
  const { call, idle, seen } = await setup(t);
  const m = (await call("POST", "/missions", { prompt: "precio del contrato", mode: "solo", botIds: ["nora"], conversation: true })).body;
  await idle(m.id);
  await call("POST", `/missions/${m.id}/messages`, { text: "¿y con IVA?" });
  await idle(m.id);
  let d = (await call("GET", `/missions/${m.id}`)).body;
  assert.deepEqual(shown(d), ["precio del contrato", "respuesta 1", "¿y con IVA?", "respuesta 2"]);
  const second = d.messages.find((x) => x.text === "¿y con IVA?");
  assert.equal((await call("POST", `/missions/${m.id}/edit`, { messageId: second.id, text: "¿y sin IVA?" })).status, 200);
  await idle(m.id);
  d = (await call("GET", `/missions/${m.id}`)).body;
  assert.deepEqual(shown(d), ["precio del contrato", "respuesta 1", "¿y sin IVA?", "respuesta 3"]);
  const turn = seen.find((x) => x.text === "respuesta 3").said;
  assert.ok(turn.some((s) => s.includes("sin IVA")), "it answered the new version");
  assert.ok(!turn.some((s) => s.includes("con IVA") || s.includes("respuesta 2")), "the bot never saw the edited-away version: " + JSON.stringify(turn));
  const edited = d.messages.find((x) => x.text === "¿y sin IVA?");
  assert.deepEqual(d.branches[edited.id], { index: 2, count: 2, ids: [second.id, edited.id] });
  // Back to the first version.
  assert.equal((await call("POST", `/missions/${m.id}/branch`, { messageId: second.id })).status, 200);
  d = (await call("GET", `/missions/${m.id}`)).body;
  assert.deepEqual(shown(d), ["precio del contrato", "respuesta 1", "¿y con IVA?", "respuesta 2"]);
  assert.equal(d.branches[second.id].index, 1);
});

test("«Otra respuesta» answers the same message again as a sibling version", async (t) => {
  const { call, idle } = await setup(t);
  const m = (await call("POST", "/missions", { prompt: "un título", mode: "solo", botIds: ["nora"], conversation: true })).body;
  await idle(m.id);
  let d = (await call("GET", `/missions/${m.id}`)).body;
  const first = d.messages.find((x) => x.text === "respuesta 1");
  assert.equal((await call("POST", `/missions/${m.id}/regenerate`, { messageId: first.id })).status, 200);
  await idle(m.id);
  d = (await call("GET", `/missions/${m.id}`)).body;
  assert.deepEqual(shown(d), ["un título", "respuesta 2"], "your message once, the new answer");
  const again = d.messages.find((x) => x.text === "respuesta 2");
  assert.deepEqual(d.branches[again.id], { index: 2, count: 2, ids: [first.id, again.id] });
});

test("no versions while the bot answers", async (t) => {
  const { store, call } = await setup(t);
  store.put("missions", { id: "busy", title: "x", status: "running", mode: "solo", botIds: ["nora"], conversation: true });
  store.put("messages", { id: "u1", missionId: "busy", role: "user", kind: "message", text: "hola", at: new Date().toISOString() });
  assert.equal((await call("POST", "/missions/busy/edit", { messageId: "u1", text: "adiós" })).status, 409);
});
