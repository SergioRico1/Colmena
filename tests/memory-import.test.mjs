import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fixture, answer } from "./fixtures/runtime-fixture.mjs";
import { createApp } from "../server/app.mjs";
import { parseConversations, parseMemoryText } from "../src/lib/chatgptImport.js";

test("ChatGPT memory list: one per line, bullets and repeats removed", () => {
  const items = parseMemoryText("Memoria\n- Prefiere informes breves en euros.\n• Trabaja en una agencia de viajes en Valencia.\n- prefiere informes breves en euros\n\nok");
  assert.deepEqual(items.map((i) => i.text), ["Prefiere informes breves en euros.", "Trabaja en una agencia de viajes en Valencia."]);
});

test("ChatGPT export: active branch only, your sentences with a preference, sensitive chats left out", () => {
  const conv = (id, title, texts, extra = {}) => {
    const mapping = { root: { id: "root", parent: null, children: ["a0"], message: null } };
    let parent = "root";
    texts.forEach((t, i) => { mapping["a" + i] = { id: "a" + i, parent, children: [], message: { author: { role: i % 2 ? "assistant" : "user" }, content: { parts: [t] } } }; mapping[parent].children.push("a" + i); parent = "a" + i; });
    return { conversation_id: id, title, mapping, current_node: parent, ...extra };
  };
  const data = [
    conv("c1", "Informe trimestral", ["Prefiero que los informes vayan en tablas. ¿Me ayudas?", "Claro.", "Trabajo en una agencia de viajes."]),
    conv("c2", "Dolor de espalda", ["Siempre me duele la espalda, ¿qué medicación tomo?"]),
    conv("c3", "Sin nada", ["Hola, ¿qué tal?"]),
  ];
  // A branch that was edited away is not read.
  data[0].mapping.old = { id: "old", parent: "root", children: [], message: { author: { role: "user" }, content: { parts: ["Prefiero el color rojo para todo."] } } };
  const { items, stats } = parseConversations(data);
  assert.deepEqual(items.map((i) => i.text), ["Dijo en ChatGPT: «Prefiero que los informes vayan en tablas.»", "Dijo en ChatGPT: «Trabajo en una agencia de viajes.»"]);
  assert.equal(stats.withheld, 1);
  assert.throws(() => parseConversations({ nope: true }), /conversations\.json/);
});

test("import: preview checks each line, nothing is written until you confirm, a backup comes first", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  store.put("memories", { id: "m0", text: "Prefiere informes breves en euros.", scope: "equipo", source: "dijiste", active: true, createdAt: new Date().toISOString() });
  const session = { status: () => null, models: [], listModels: async () => [], start: async () => ({}), closePending() {}, logout: async () => ({}) };
  let base;
  const app = createApp({ store, runtime, session, scheduler: null, connections: null, getOrigin: () => base });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  base = "http://127.0.0.1:" + server.address().port;
  const token = (await (await fetch(base + "/api/bootstrap")).json()).csrf;
  const call = async (url, body) => { const r = await fetch(base + "/api" + url, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": token }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

  const before = store.list("memories").length;
  const preview = await call("/memories/import/preview", { source: "chatgpt-memoria", items: [{ text: "Prefiere informes breves en euros." }, { text: "Su contraseña es hunter2-Secreta!" }, { text: "Trabaja en una agencia de viajes en Valencia." }, { text: "Responde siempre en inglés" }] });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.items.map((i) => i.status), ["duplicado", "bloqueado", "ok", "revisar"]);
  assert.equal(store.list("memories").length, before, "a preview writes nothing");

  const done = await call("/memories/import", { source: "chatgpt-memoria", items: [{ text: "Trabaja en una agencia de viajes en Valencia.", target: "user" }, { text: "Su contraseña es hunter2-Secreta!", target: "user" }] });
  assert.equal(done.status, 200);
  assert.equal(done.body.added, 1);
  assert.equal(done.body.skipped, 1, "a secret never gets in, even if sent");
  const added = store.list("memories").find((m) => m.text.startsWith("Trabaja en una agencia"));
  assert.equal(added.source, "importado");
  assert.equal(added.review, false);
  const backups = await readdir(path.join(store.directory, "backups"));
  assert.equal(backups.length, 1);
  const saved = JSON.parse(await readFile(path.join(store.directory, "backups", backups[0]), "utf8"));
  assert.equal(saved.memories.length, before, "the backup is the memory before the import");
});
