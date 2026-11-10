// code_task: a mission hands a coding task to «Código» and gets back what was done. A stand-in
// Código checks the background wait (independent steps go on, a pause picks the same task up
// again, a cancel stops it); a fake Claude Code checks it end to end with Código's own rules.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { CodeService } from "../server/code/service.mjs";
import { pickProject } from "../server/code/missions.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url));
const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const who = (instructions) => /Eres (\S+),/.exec(instructions)?.[1];
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw Error("timeout");
};

/** Código's surface that code_task uses: tasks that work until the test finishes them. */
class StubCode {
  constructor(store) {
    this.store = store;
    this.events = new EventEmitter();
    this.engines = new Map();
    this.starting = new Set();
    this.created = [];
    this.stopped = [];
  }
  async createTask(options) {
    const id = "ct-" + (this.created.length + 1);
    this.created.push(options);
    this.store.put("codeTasks", { id, projectId: options.projectId, title: "Tarea " + id, engine: options.engine, access: options.access, status: "working", turns: [], isolated: true, branch: "colmena/tarea-" + id });
    return { id, title: "Tarea " + id, engine: options.engine };
  }
  finish(id, { text = "He añadido el botón y pasan los tests.", files = [{ path: "src/Boton.jsx", status: "A", add: 12, del: 0 }], error = null } = {}) {
    if (text) this.store.put("codeItems", { id: "ci-" + id + "-t", taskId: id, seq: 1, kind: "text", text, turn: 1 });
    if (error) this.store.put("codeItems", { id: "ci-" + id + "-e", taskId: id, seq: 2, kind: "error", text: error, turn: 1 });
    this.store.patch("codeTasks", id, { status: error ? "error" : "idle", turns: [{ n: 1, files, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) }] });
    this.events.emit("event", { type: "task", task: { id } });
  }
  items(taskId) { return this.store.list("codeItems").filter((i) => i.taskId === taskId); }
  async stop(id) { this.stopped.push(id); }
}

const coder = (task = "Añade un botón de compra") => async ({ instructions, input }) => {
  const out = outputs(input);
  if (!out.length) return call("code_task", { project: "", task, engine: "auto" }, "c1");
  return answer(out[0].ok ? "Hecho en Código: " + out[0].link : "No se pudo: " + out[0].error);
};

test("code_task is offered to Atlas and Bruno when Código exists, never to others or without it", async (t) => {
  const offered = {};
  const { store, runtime } = await fixture(t, async ({ instructions, tools }) => {
    offered[who(instructions)] = tools.some((x) => x.name === "code_task");
    return answer("ok");
  });
  for (const botId of ["bruno", "nora"]) await runtime.launch(runtime.create({ prompt: "Hola", mode: "solo", botIds: [botId] }).id);
  assert.deepEqual(offered, { Bruno: false, Nora: false }, "no Código, no tool");
  runtime.code = new StubCode(store);
  for (const botId of ["bruno", "nora", "atlas"]) await runtime.launch(runtime.create({ prompt: "Hola", mode: "solo", botIds: [botId] }).id);
  assert.deepEqual(offered, { Bruno: true, Nora: false, Atlas: true });
  assert.deepEqual(pickProject([{ id: "cp-1", name: "Tienda", root: "C:/p/tienda" }, { id: "cp-2", name: "Blog", root: "C:/p/blog" }], "tienda").project.id, "cp-1");
  assert.match(pickProject([{ id: "cp-1", name: "Tienda" }, { id: "cp-2", name: "Blog" }], "").error, /varios proyectos/);
});

test("without a Código project the tool explains, in Spanish, how to set it up", async (t) => {
  let seen = null;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const out = outputs(input);
    if (!out.length) return call("code_task", { project: "", task: "Arregla el login", engine: "auto" }, "c1");
    seen = out[0];
    return answer("Necesito que prepares Código.");
  });
  runtime.code = new StubCode(store);
  await runtime.launch(runtime.create({ prompt: "Arregla el login", mode: "solo", botIds: ["bruno"] }).id);
  assert.match(seen.error, /Código aún no está preparado.*añada la carpeta de su proyecto/);
  assert.equal(runtime.code.created.length, 0);
});

test("the Código task runs as a background job: independent parts go on and the result comes back", async (t) => {
  let noraDone = false;
  const { store, runtime } = await fixture(t, async (request) => {
    const { tools, input, instructions } = request;
    if (tools.some((x) => x.name === "propose_plan"))
      return outputs(input).length ? answer("Plan en marcha") : call("propose_plan", { assignments: [{ botId: "bruno", task: "Programa el botón" }, { botId: "nora", task: "Investiga precios" }], summary: "Bruno programa, Nora investiga" }, "p1");
    const name = who(instructions);
    if (name === "Nora") { noraDone = true; return answer("Precios investigados"); }
    if (name === "Bruno") return coder()(request);
    return answer("Síntesis");
  });
  const code = (runtime.code = new StubCode(store));
  store.put("codeProjects", { id: "cp-1", name: "tienda", root: "C:/p/tienda", allow: [] });
  const m = runtime.create({ prompt: "Botón y precios", mode: "equipo", botIds: ["bruno", "nora"] });
  runtime.launch(m.id);
  await until(() => code.created.length === 1 && noraDone && runtime.steps(m.id).find((s) => s.key === "work-nora")?.status === "completed");
  const bruno = runtime.steps(m.id).find((s) => s.key === "work-bruno");
  assert.equal(bruno.status, "running", "Bruno waits for Código while Nora finished");
  assert.deepEqual(bruno.codeTasks, ["ct-1"]);
  assert.equal(code.created[0].isolated, true, "always in a separate copy");
  assert.equal(code.created[0].access, "project");
  assert.match(code.created[0].text, /Añade un botón de compra[\s\S]*Encargo de Bruno/);
  // The room says it and links the task.
  const note = store.list("messages").find((x) => x.codeTask === "ct-1");
  assert.deepEqual(note.link, { href: "/codigo/ct-1", label: "Ver en Código" });
  assert.equal(runtime.activity.get("bruno")?.verb, "programando");
  code.finish("ct-1");
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
  const out = JSON.parse(runtime.history(runtime.steps(m.id).find((s) => s.key === "work-bruno")).find((x) => x.type === "function_call_output").output);
  assert.equal(out.ok, true);
  assert.equal(out.link, "/codigo/ct-1");
  assert.equal(out.summary, "He añadido el botón y pasan los tests.");
  assert.deepEqual(out.files, [{ path: "src/Boton.jsx", status: "A", add: 12, del: 0 }]);
  assert.deepEqual([out.filesChanged, out.add, out.del], [1, 12, 0]);
  assert.match(out.note, /copia aparte \(rama colmena\/tarea-ct-1\)/);
  assert.equal(store.get("codeJobs", runtime.steps(m.id).find((s) => s.key === "work-bruno").id + ":c1").status, "done");
});

test("a pause keeps the Código task: resuming picks the same one up; a cancel stops it", async (t) => {
  const { store, runtime } = await fixture(t, coder());
  const code = (runtime.code = new StubCode(store));
  store.put("codeProjects", { id: "cp-1", name: "tienda", root: "C:/p/tienda", allow: [] });
  store.patch("bots", "bruno", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Botón", mode: "solo", botIds: ["bruno"] });
  runtime.launch(m.id);
  await until(() => code.created.length === 1);
  assert.equal(code.created[0].access, "ask", "«Solo sugiere»: every change asked in Código");
  runtime.stop(m.id);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "paused");
  assert.deepEqual(code.stopped, [], "a pause does not stop Código");
  code.finish("ct-1");
  await runtime.resume(m.id);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.equal(code.created.length, 1, "no second task");
  assert.match(store.get("missions", m.id).result, /Hecho en Código: \/codigo\/ct-1/);

  const m2 = runtime.create({ prompt: "Otro botón", mode: "solo", botIds: ["bruno"] });
  runtime.launch(m2.id);
  await until(() => code.created.length === 2);
  runtime.stop(m2.id, true);
  await settle(runtime);
  assert.deepEqual(code.stopped, ["ct-2"]);
});

test("a Código task that fails comes back as a clear error, with the link", async (t) => {
  const { store, runtime } = await fixture(t, coder());
  const code = (runtime.code = new StubCode(store));
  store.put("codeProjects", { id: "cp-1", name: "tienda", root: "C:/p/tienda", allow: [] });
  const m = runtime.create({ prompt: "Botón", mode: "solo", botIds: ["bruno"] });
  runtime.launch(m.id);
  await until(() => code.created.length === 1);
  code.finish("ct-1", { text: "", files: [], error: "Claude Code no está instalado." });
  await settle(runtime);
  assert.match(store.get("missions", m.id).result, /No se pudo: Código no pudo terminar la tarea: Claude Code no está instalado\..*\/codigo\/ct-1/);
});

test("end to end with a fake Claude Code: a worktree, the files changed, and Código's red lines", { skip: !hasGit, timeout: 120000 }, async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), "colmena-codemission-"));
  const repo = path.join(base, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: repo });
  let task = "escribe una nota";
  const { store, runtime, directory } = await fixture(t, async (request) => coder(task)(request));
  const code = (runtime.code = new CodeService({ store, directory, command: [process.execPath, FAKE] }));
  try {
    await code.addProject({ folder: repo });
    const m = runtime.create({ prompt: "Nota", mode: "solo", botIds: ["bruno"] });
    await runtime.launch(m.id);
    await settle(runtime);
    assert.equal(store.get("missions", m.id).status, "completed");
    const out = JSON.parse(runtime.history(runtime.steps(m.id)[0]).find((x) => x.type === "function_call_output").output);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.match(out.link, /^\/codigo\/ct-/);
    assert.equal(out.summary, "He escrito la nota.");
    assert.deepEqual(out.files.map((f) => f.path), ["nota.txt"]);
    assert.equal(out.engine, "Claude Code");
    assert.ok(!existsSync(path.join(repo, "nota.txt")), "the project folder is untouched until the person saves it");

    // «push» is a red line in Código: the mission waits while Código asks the person there.
    task = "haz push de la rama";
    const m2 = runtime.create({ prompt: "Sube", mode: "solo", botIds: ["bruno"] });
    runtime.launch(m2.id);
    const ask = await until(() => store.list("codeItems").find((i) => i.kind === "ask" && i.status === "pending"));
    assert.equal(ask.ask, "redline");
    await until(() => runtime.activity.get("bruno")?.detail === "Código espera tu permiso");
    code.answer(ask.taskId, ask.id, { decision: "deny" });
    await settle(runtime);
    const out2 = JSON.parse(runtime.history(runtime.steps(m2.id)[0]).find((x) => x.type === "function_call_output").output);
    assert.equal(out2.summary, "No lo he subido.");
  } finally {
    code.shutdown();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(base, { recursive: true, force: true, maxRetries: 5 });
  }
});
