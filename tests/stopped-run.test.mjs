import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { stopReason } from "../server/stopped.mjs";

test("why a turn stopped: length, a content filter, an error or you", () => {
  assert.equal(stopReason(Object.assign(Error("OpenAI interrumpio la respuesta"), { incomplete: "max_output_tokens" })).reason, "length");
  assert.equal(stopReason(Object.assign(Error("x"), { incomplete: "max_tokens" })).reason, "length");
  assert.equal(stopReason(Object.assign(Error("Respuesta demasiado extensa."), {})).reason, "length");
  assert.equal(stopReason(Object.assign(Error("OpenAI interrumpio la respuesta"), { incomplete: "content_filter" })).reason, "content-filter");
  assert.equal(stopReason(Object.assign(Error("Claude ha declinado"), { providerCode: "refusal" })).reason, "content-filter");
  assert.equal(stopReason(Error("ECONNRESET")).reason, "error");
  assert.equal(stopReason(Error("x"), { aborted: true }).reason, "cancelled");
});

async function setup(t, respond) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-stopped-"));
  const store = new Store(dir);
  store.patch("settings", "main", { model: "gpt-5" });
  const runtime = new Runtime(store, { respond }, null, { retryDelays: [] });
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
  return { store, runtime, call };
}
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw Error("timeout"); };

test("an answer cut for length shows «Se paró» with its reason; «Descartar» leaves the chat ready", async (t) => {
  const { store, call } = await setup(t, async () => { throw Object.assign(Error("OpenAI interrumpio la respuesta; no se ejecutarán sus herramientas."), { incomplete: "max_output_tokens" }); });
  const m = (await call("POST", "/missions", { prompt: "Escríbeme un libro entero", mode: "solo", botIds: ["nora"], conversation: true })).body;
  await until(() => store.get("missions", m.id).stopped);
  const summary = (await call("GET", "/state")).body.missions.find((x) => x.id === m.id);
  assert.equal(summary.stopped.reason, "length");
  assert.ok(["paused", "blocked"].includes(summary.status));
  assert.equal((await call("POST", `/missions/${m.id}/control`, { action: "discard" })).status, 200);
  const after = store.get("missions", m.id);
  assert.equal(after.status, "completed");
  assert.equal(after.stopped, null);
  assert.ok(store.where("steps", "missionId", m.id).every((s) => s.status === "completed"), "nothing left half done");
  assert.equal((await call("GET", "/state")).body.missions.find((x) => x.id === m.id).stopped, null);
  assert.equal((await call("POST", `/missions/${m.id}/control`, { action: "discard" })).status, 422, "nothing stopped to discard");
});

test("stopping it yourself says so; continuing clears the card", async (t) => {
  let release;
  let calls = 0;
  const done = { text: "Hola.", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Hola." }] }] };
  // The first answer waits until it is stopped; after «Continuar» it answers at once.
  const { store, runtime, call } = await setup(t, ({ signal }) => (calls++ ? Promise.resolve(done) : new Promise((resolve, reject) => { release = resolve; signal?.addEventListener("abort", () => reject(signal.reason)); })));
  const m = (await call("POST", "/missions", { prompt: "Hola", mode: "solo", botIds: ["nora"], conversation: true })).body;
  await until(() => runtime.active.has(m.id) && release);
  await call("POST", `/missions/${m.id}/control`, { action: "pause" });
  const stopped = await until(() => store.get("missions", m.id).stopped);
  assert.equal(stopped.reason, "cancelled");
  await until(() => !runtime.active.has(m.id));
  await call("POST", `/missions/${m.id}/control`, { action: "resume" });
  await until(() => store.get("missions", m.id).stopped === null);
});
