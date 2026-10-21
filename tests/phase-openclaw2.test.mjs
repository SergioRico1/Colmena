import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fixture, answer } from "./fixtures/runtime-fixture.mjs";
import { createApp } from "../server/app.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

async function serve(t, store, runtime) {
  const session = { status: () => null, models: [], listModels: async () => [], start: async () => ({}), closePending() {}, logout: async () => ({}) };
  let base;
  const app = createApp({ store, runtime, session, scheduler: null, connections: null, getOrigin: () => base });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  base = "http://127.0.0.1:" + server.address().port;
  const token = (await (await fetch(base + "/api/bootstrap")).json()).csrf;
  const call = async (method, url, body) => {
    const r = await fetch(base + "/api" + url, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": token }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return call;
}

test("incognito chats: 24 h, no memory tool, no learning, no prior chats as context", async (t) => {
  let tools = [];
  let input = [];
  const { store, runtime } = await fixture(t, async (params) => { tools = params.tools.map((x) => x.name); input = params.input; return answer("Vale."); });
  const before = runtime.create({ prompt: "Recuerda que me gusta el té", mode: "solo", botIds: ["nora"], conversation: true });
  await runtime.launch(before.id);
  const m = runtime.create({ prompt: "Algo privado", mode: "solo", botIds: ["nora"], conversation: true, incognito: true });
  assert.equal(m.incognito, true);
  const left = Date.parse(m.expiresAt) - Date.now();
  assert.ok(left > 23.9 * 3600e3 && left <= 24 * 3600e3, "expires in 24 h");
  await runtime.launch(m.id);
  assert.ok(!tools.includes("remember"), "no memory tool");
  assert.ok(!JSON.stringify(input).includes("té"), "earlier chats are not brought in");
  assert.equal(store.get("missions", m.id).learningStatus, "incognito");
});

test("files panel: list, read with hash, conflict-safe save (409 when it changed), no escaping the folder", async (t) => {
  const { store, runtime, directory } = await fixture(t, async () => answer("ok"));
  const m = runtime.create({ prompt: "Notas", mode: "solo", botIds: ["nora"] });
  const root = runtime.root ? runtime.root(m.id) : path.join(directory, "workspaces", m.id);
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "notas.md"), "# Hola\n");
  const call = await serve(t, store, runtime);
  const list = await call("GET", `/missions/${m.id}/workfiles`);
  assert.deepEqual(list.body.files.map((f) => f.path), ["docs/notas.md"]);
  const file = await call("GET", `/missions/${m.id}/workfiles/file?path=docs/notas.md`);
  assert.equal(file.body.hash, sha("# Hola\n"));
  assert.equal(file.body.editable, true);
  const saved = await call("PUT", `/missions/${m.id}/workfiles/file`, { path: "docs/notas.md", content: "# Hola\nmundo\n", expectedHash: file.body.hash });
  assert.equal(saved.status, 200);
  assert.equal(await readFile(path.join(root, "docs", "notas.md"), "utf8"), "# Hola\nmundo\n");
  const stale = await call("PUT", `/missions/${m.id}/workfiles/file`, { path: "docs/notas.md", content: "pisado", expectedHash: file.body.hash });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.details.type, "conflict");
  const escape = await call("GET", `/missions/${m.id}/workfiles/file?path=../../secreto.txt`);
  assert.equal(escape.status, 404);
});
