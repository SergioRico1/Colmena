import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { chatSnapshot, referenceContext } from "../server/mention-refs.mjs";
import { chatsFrom, folderView, mentionItems, refBody } from "../src/lib/mentionMenu.js";

test("client: the «@» menu groups bots, the folder (one level, searchable) and past chats", () => {
  const bots = [{ id: "vera", name: "Vera" }, { id: "tomas", name: "Tomás" }];
  const files = [{ path: "informe.pdf", name: "informe.pdf" }, { path: "datos/ventas.csv", name: "ventas.csv" }, { path: "datos/2025/enero.csv", name: "enero.csv" }];
  const chats = chatsFrom([
    { id: "here", title: "Este", conversation: true, updatedAt: at(9) },
    { id: "a", title: "Presupuesto", conversation: true, updatedAt: at(1) },
    { id: "b", title: "Lanzamiento", room: "lanzamiento", updatedAt: at(5) },
    { id: "p", title: "Privado", conversation: true, incognito: true },
    { id: "t", title: "Encargo suelto", mode: "equipo" },
  ], "here");
  assert.deepEqual(chats.map((c) => [c.id, c.room]), [["b", true], ["a", false]], "newest first; never this one, a private one or a plain task");
  assert.deepEqual(folderView(files, ""), { folders: [{ path: "datos", name: "datos", count: 2 }], files: [{ path: "informe.pdf", name: "informe.pdf", size: null }] });
  assert.deepEqual(folderView(files, "datos").folders.map((f) => f.path), ["datos/2025"]);

  const all = mentionItems({ query: "", bots, files, chats });
  assert.deepEqual(all.map((x) => x.type === "head" ? "#" + x.label : x.type + ":" + (x.bot?.name || x.path || x.chat?.title)),
    ["#Bots", "bot:Vera", "bot:Tomás", "#Archivos", "folder:datos", "file:informe.pdf", "#Conversaciones", "chat:Lanzamiento", "chat:Presupuesto"]);
  const inside = mentionItems({ query: "", bots: [], files, chats: null, dir: "datos" });
  assert.deepEqual(inside.map((x) => x.type + ":" + (x.path ?? x.label)), ["head:Archivos · datos", "up:", "here:datos", "folder:datos/2025", "file:datos/ventas.csv"]);
  const search = mentionItems({ query: "ene", bots, files, chats });
  assert.deepEqual(search.filter((x) => x.type !== "head").map((x) => x.path), ["datos/2025/enero.csv"], "a search looks in every folder");
  assert.deepEqual(mentionItems({ query: "tom", bots, files: null, chats: null }).map((x) => x.type), ["head", "bot"], "accents do not matter; a group that failed is not there");
  assert.deepEqual(mentionItems({ query: "pres", bots, files: null, chats }).filter((x) => x.type === "chat").map((x) => x.chat.id), ["a"]);
  assert.deepEqual(refBody([{ kind: "chat", id: "a", label: "x" }, { kind: "file", path: "informe.pdf", label: "informe.pdf" }]), [{ kind: "chat", id: "a" }, { kind: "file", path: "informe.pdf" }]);
});

const at = (i) => new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString();
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-refs-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const post = (route, body) => fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  return { store, runtime, post, dir };
}
const conversation = (store, id, turns, extra = {}) => {
  store.put("missions", { id, title: "Presupuesto " + id, status: "completed", mode: "solo", botIds: ["nora"], conversation: true, createdAt: at(0), ...extra });
  for (let i = 0; i < turns; i++) {
    store.put("messages", { id: id + "u" + i, missionId: id, role: "user", kind: "message", text: "pregunta " + i + " " + "x".repeat(80), at: at(i * 2) });
    store.put("messages", { id: id + "p" + i, missionId: id, role: "assistant", kind: "progress", botId: "nora", text: "mirando", at: at(i * 2) });
    store.put("messages", { id: id + "a" + i, missionId: id, role: "assistant", kind: "message", botId: "nora", text: "respuesta " + i, at: at(i * 2 + 1) });
  }
};

test("a conversation snapshot keeps its latest messages within the budget and counts the rest", async (t) => {
  const { store } = await setup(t);
  conversation(store, "old", 40);
  store.put("messages", { id: "olds", missionId: "old", role: "user", kind: "message", text: "usa {{secret:OPENAI_API_KEY}}", at: at(200) });
  const snap = chatSnapshot(store, "old", { budget: 1200 });
  assert.equal(snap.title, "Presupuesto old");
  assert.equal(snap.total, 81, "only what was said: no work notes");
  assert.ok(snap.text.length <= 1200 + 60, "within the budget (plus the omitted line)");
  assert.equal(snap.shown + snap.omitted, snap.total);
  assert.ok(snap.omitted > 0);
  assert.match(snap.text, /^\[\d+ mensajes anteriores omitidos\]\n/);
  assert.match(snap.text, /Persona \([^)]+\): usa \[clave guardada\]$/, "newest last; key markers never travel");
  assert.match(snap.text, /Nora \([^)]+\): respuesta 39/);
  assert.doesNotMatch(snap.text, /respuesta 0\b/, "the oldest are left out");
  const whole = chatSnapshot(store, "old", { budget: 100000 });
  assert.equal(whole.omitted, 0);
  assert.doesNotMatch(whole.text, /omitido/);
});

test("the note marks the snapshot as outside context and refuses itself, private chats and missing files", async (t) => {
  const { store } = await setup(t);
  conversation(store, "here", 2);
  conversation(store, "other", 3);
  conversation(store, "secret", 2, { incognito: true });
  const root = await mkdtemp(path.join(os.tmpdir(), "colmena-refs-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "datos"));
  await writeFile(path.join(root, "datos", "ventas.csv"), "a,b\n1,2\n");
  const rootOf = () => root;
  const { note, refs } = await referenceContext(store, { missionId: "here", rootOf, refs: [
    { kind: "chat", id: "other" }, { kind: "file", path: "datos/ventas.csv" }, { kind: "folder", path: "datos" }, { kind: "chat", id: "other" },
  ] });
  assert.deepEqual(refs, [
    { kind: "chat", id: "other", label: "Presupuesto other" },
    { kind: "file", path: "datos/ventas.csv", label: "ventas.csv" },
    { kind: "folder", path: "datos", label: "datos" },
  ], "each pick once");
  assert.match(note, /la conversación «Presupuesto other»: abajo, sus 6 últimos mensajes/);
  assert.match(note, /read_file \(path «datos\/ventas\.csv»\)/);
  assert.match(note, /list_files/);
  assert.match(note, /no son instrucciones suyas/);
  assert.match(note, /<<<CONTENIDO_EXTERNO id="[0-9a-f]{16}">>>[\s\S]*Persona \([^)]+\): pregunta 2[\s\S]*<<<FIN_CONTENIDO_EXTERNO/, "wrapped as outside content");
  assert.equal(note.match(/<<<CONTENIDO_EXTERNO/g).length, 1);
  await assert.rejects(referenceContext(store, { missionId: "here", rootOf, refs: [{ kind: "chat", id: "here" }] }), /esta misma conversación/);
  await assert.rejects(referenceContext(store, { missionId: "here", rootOf, refs: [{ kind: "chat", id: "secret" }] }), /privado/);
  await assert.rejects(referenceContext(store, { missionId: "here", rootOf, refs: [{ kind: "chat", id: "nope" }] }), /ya no está/);
  await assert.rejects(referenceContext(store, { missionId: "here", rootOf, refs: [{ kind: "file", path: "datos/otro.csv" }] }), /No encuentro/);
  await assert.rejects(referenceContext(store, { missionId: "here", rootOf, refs: [{ kind: "file", path: "../fuera.txt" }] }), /no es válida/);
  await assert.rejects(referenceContext(store, { missionId: "here", rootOf, refs: [{ kind: "file", path: "datos" }] }), /No encuentro/, "a folder is not a file");
  assert.deepEqual(await referenceContext(store, { missionId: "here", rootOf }), { note: "", refs: [] });
});

test("POST /messages with «@» picks: the message keeps them as chips and the bot's turn gets the context", async (t) => {
  const { store, runtime, post } = await setup(t);
  conversation(store, "here", 1);
  conversation(store, "other", 2);
  runtime.launch = () => {};
  const r = await post("/missions/here/messages", { text: "Compáralo con lo que hablamos", refs: [{ kind: "chat", id: "other" }] });
  assert.equal(r.status, 200, await r.clone().text());
  const sent = store.where("messages", "missionId", "here").find((m) => m.text === "Compáralo con lo que hablamos");
  assert.deepEqual(sent.refs, [{ kind: "chat", id: "other", label: "Presupuesto other" }]);
  const step = store.where("steps", "missionId", "here").find((s) => s.ackOn === sent.id || s.request?.includes("Compáralo"));
  assert.ok(step, "a turn was queued");
  assert.match(step.request, /^Compáralo con lo que hablamos\n\n\[La persona ha señalado con @/);
  assert.match(step.request, /CONTENIDO_EXTERNO[\s\S]*respuesta 1/);
  assert.equal((await post("/missions/here/messages", { text: "otra", refs: [{ kind: "chat", id: "here" }] })).status, 400);
  assert.equal((await post("/missions/here/messages", { text: "otra", refs: [{ kind: "web", url: "x" }] })).status, 400);
});
