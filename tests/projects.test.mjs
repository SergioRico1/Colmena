import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { createBridge, ComputerError } from "../server/computer/bridge.mjs";
import { computerExtraTools } from "../server/computer/wire.mjs";
import {
  createProject, editProjectFile, listProjectFiles, projectName, trashProjectPath, writeProjectFile, dependencyClosure,
} from "../server/projects/files.mjs";
import { npmCli, packageDependencies, projectEnv, scriptCommand, simpleScript } from "../server/projects/run.mjs";
import { DevServers, portArgs, serveKind } from "../server/projects/servers.mjs";
import {
  Projects, PREVIEW_ROUNDS, grantScope, newPackages, projectPermission, projectToolCard, projectToolDefs,
} from "../server/projects/tools.mjs";
import { toolCard } from "../server/state.mjs";
import { verbFor } from "../server/tools.mjs";
import { resolveProgram } from "../server/computer/system.mjs";

const require = createRequire(import.meta.url);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

/** A temp folder removed after the test; `before` runs first (close the store, stop servers). */
async function tmp(t, before = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-projects-"));
  t.after(async () => {
    for (const fn of before) await fn();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  return dir;
}

function fakeComputer(handlers = {}) {
  const calls = [];
  const bridge = createBridge({
    available: true,
    send: (message) => {
      calls.push({ op: message.op, args: message.args });
      setImmediate(async () => {
        try {
          const handler = handlers[message.op];
          if (!handler) throw new ComputerError("sin manejador " + message.op, "BAD_OP");
          bridge.handleMessage({ type: "computer-result", id: message.id, ok: true, result: await handler(message.args) });
        } catch (error) {
          bridge.handleMessage({ type: "computer-result", id: message.id, ok: false, error: { message: error.message, code: error.code } });
        }
      });
    },
  });
  bridge.calls = calls;
  return bridge;
}

/** Projects with a real store, a minimal runtime and a fake runner (no real npm). */
async function setup(t, { autonomy = "avisa", computer = { available: false }, runs = [] } = {}) {
  const cleanup = [];
  const dir = await tmp(t, cleanup);
  const store = new Store(dir);
  cleanup.push(() => store.close());
  const mission = store.put("missions", { id: "m1", title: "Prueba", status: "running" });
  const step = store.put("steps", { id: "s1", missionId: "m1", botId: "bruno", kind: "work", status: "running", history: [], pending: [] });
  const bot = { id: "bruno", name: "Bruno", color: "#FF7A1A", autonomy };
  const runtime = {
    root: (id) => path.join(dir, "workspaces", id), autonomy: () => autonomy, settings: () => ({}),
    setActivity() {}, announce() {}, approvalContext: () => "Bruno · Prueba",
  };
  const servers = new DevServers({ portRange: [5600, 5650] });
  cleanup.unshift(() => servers.shutdown());
  const projects = new Projects({
    store, runtime, computer, servers,
    runner: async (file, args, opts) => { runs.push({ file, args, opts }); return { exitCode: 0, stdout: "ok", stderr: "", truncated: false, timedOut: false, seconds: 0.1 }; },
  });
  let n = 0;
  const run = (tool, args) => projects.run(tool, args, { mission, step, bot, call: { call_id: "c" + ++n }, signal: new AbortController().signal });
  const again = (tool, args, callId) => projects.run(tool, args, { mission, step, bot, call: { call_id: callId }, signal: new AbortController().signal });
  return { dir, store, projects, run, again, runs, root: runtime.root("m1"), servers };
}

// ------------------------------------------------------------------ files
test("project names and paths stay inside proyectos/<nombre>/", async (t) => {
  assert.equal(projectName("Calculadora de Propinas"), "calculadora-de-propinas");
  assert.throws(() => projectName("..."), /no válido/);
  assert.throws(() => projectName("con"), /no válido/);
  const dir = await tmp(t);
  await createProject(dir, "web", "html");
  for (const bad of ["../fuera.txt", "a/../../b", "C:/Windows/x", "a\\b.txt", "node_modules/x.js", ".git/config", "aux.txt"])
    await assert.rejects(writeProjectFile(dir, "web", bad, "x"), Error, bad);
  await assert.rejects(writeProjectFile(dir, "otro", "a.txt", "x"), /No existe el proyecto/);
  const out = await writeProjectFile(dir, "web", "src/util.js", "export const a = 1;\n");
  assert.deepEqual([out.path, out.created], ["src/util.js", true]);
  assert.equal((await writeProjectFile(dir, "web", "src/util.js", "export const a = 2;\n")).created, false, "overwrites");
  assert.equal(await readFile(path.join(dir, "proyectos", "web", "src", "util.js"), "utf8"), "export const a = 2;\n");
});

test("project_edit replaces unique text only, all or nothing", async (t) => {
  const dir = await tmp(t);
  await createProject(dir, "web", "html");
  await writeProjectFile(dir, "web", "a.js", "const x = 1;\nconst y = 1;\nconst z = 2;\n");
  await assert.rejects(editProjectFile(dir, "web", "a.js", [{ old: "= 1;", new: "= 3;" }]), /aparece 2 veces/);
  await assert.rejects(editProjectFile(dir, "web", "a.js", [{ old: "const z = 2;", new: "const z = 9;" }, { old: "nada", new: "x" }]), /no aparece/);
  assert.equal(await readFile(path.join(dir, "proyectos", "web", "a.js"), "utf8"), "const x = 1;\nconst y = 1;\nconst z = 2;\n", "unchanged after a failed edit");
  const out = await editProjectFile(dir, "web", "a.js", [{ old: "const y = 1;", new: "const y = $&;" }, { old: "z = 2", new: "z = 4" }]);
  assert.equal(out.edits, 2);
  assert.equal(await readFile(path.join(dir, "proyectos", "web", "a.js"), "utf8"), "const x = 1;\nconst y = $&;\nconst z = 4;\n", "replacement is literal");
  await assert.rejects(editProjectFile(dir, "web", "nuevo.js", [{ old: "a", new: "b" }]), /créalo con project_write/);
});

test("deleting moves to the mission bin and listing skips node_modules", async (t) => {
  const dir = await tmp(t);
  await createProject(dir, "web", "html");
  await mkdir(path.join(dir, "proyectos", "web", "node_modules", "x"), { recursive: true });
  await writeFile(path.join(dir, "proyectos", "web", "node_modules", "x", "index.js"), "");
  const list = await listProjectFiles(dir, "web");
  assert.deepEqual(list.files.map((f) => f.path), ["app.js", "index.html", "styles.css"]);
  assert.deepEqual(list.omitted, ["node_modules"]);
  const gone = await trashProjectPath(dir, "web", "app.js");
  assert.match(gone.movedTo, /^\.papelera\/[\w-]+\/proyectos\/web\/app\.js$/);
  assert.equal(existsSync(path.join(dir, "proyectos", "web", "app.js")), false);
  assert.equal(existsSync(path.join(dir, ...gone.movedTo.split("/"))), true, "recoverable");
  await assert.rejects(trashProjectPath(dir, "web", "no-existe.js"), /No existe/);
});

test("the vite-react template is ready offline with Colmena's own packages", async (t) => {
  const dir = await tmp(t);
  const made = await createProject(dir, "App", "vite-react");
  const pkg = JSON.parse(await readFile(path.join(dir, "proyectos", "app", "package.json"), "utf8"));
  assert.equal(pkg.scripts.dev, "vite");
  assert.match(pkg.devDependencies.vite, /^\^\d+\./);
  for (const p of ["vite", "react", "react-dom", "@vitejs/plugin-react"]) assert.ok(existsSync(path.join(dir, "proyectos", "app", "node_modules", p, "package.json")), p);
  assert.ok(existsSync(path.join(dir, "proyectos", "app", "node_modules", ".bin", "vite.cmd")));
  assert.match(made.dependencies, /sin descargar nada/);
  assert.ok(dependencyClosure(["vite"]).includes("esbuild"));
  const how = await scriptCommand(path.join(dir, "proyectos", "app"), pkg, "build", [], { node: "node.exe", npm: () => "npm-cli.js" });
  assert.equal(how.direct, true, "a local tool runs with node, no shell");
  assert.match(how.args[0], /vite[\\/]bin[\\/]vite\.js$/);
  await assert.rejects(createProject(dir, "app", "html"), /Ya existe/);
});

// ------------------------------------------------------------------ run
test("npm runs through node and npm-cli.js; dependencies only from the registry", () => {
  const found = npmCli({ execPath: "C:\\node\\node.exe", envPath: "", exists: (p) => p === path.join("C:\\node", "node_modules", "npm", "bin", "npm-cli.js"), override: "" });
  assert.match(found, /npm-cli\.js$/);
  assert.throws(() => npmCli({ execPath: "C:\\x\\node.exe", envPath: "", exists: () => false, override: "" }), /No encuentro npm/);
  assert.deepEqual(packageDependencies({ dependencies: { react: "^19.0.0", "@vitejs/plugin-react": "~4.7", zod: "latest" }, devDependencies: { vite: ">=6 <7" } }).map((d) => d.name), ["react", "@vitejs/plugin-react", "zod", "vite"]);
  for (const spec of ["file:../x", "git+https://github.com/a/b.git", "https://x.com/a.tgz", "github:a/b", "npm:react@19", "link:../y"])
    assert.throws(() => packageDependencies({ dependencies: { a: spec } }), /solo se instalan versiones del registro/, spec);
  assert.deepEqual(simpleScript("vite build --mode x"), ["vite", "build", "--mode", "x"]);
  assert.equal(simpleScript("vite build && echo hecho"), null);
  const env = projectEnv({ source: { PATH: "C:\\x", OPENAI_API_KEY: "sk-secret", SystemRoot: "C:\\Windows" } });
  assert.equal(env.OPENAI_API_KEY, undefined, "no secrets in the child");
  assert.equal(env.npm_config_offline, "true");
  assert.match(env.HTTPS_PROXY, /127\.0\.0\.1:9/);
  assert.equal(projectEnv({ install: true, source: {} }).npm_config_offline, undefined, "installs may reach the registry");
  assert.throws(() => resolveProgram("npm"), /project_run/);
});

test("a bot that acts runs and installs its project without asking (Codex auto mode)", async (t) => {
  for (const autonomy of ["avisa", "solo"]) {
    assert.equal(projectPermission("project_write", {}, { autonomy }), null);
    assert.equal(projectPermission("project_run", { action: "install" }, { autonomy }), null);
    assert.equal(projectPermission("project_run", { action: "script" }, { autonomy }), null);
    assert.equal(projectPermission("project_preview", {}, { autonomy, kind: "node" }), null);
  }
  const runs = [];
  const { store, run } = await setup(t, { runs });
  await run("project_create", { name: "api", template: "vacio" });
  await run("project_write", { project: "api", path: "package.json", content: JSON.stringify({ name: "api", dependencies: { zod: "^3.24.0" } }) });
  assert.equal((await run("project_run", { project: "api", action: "install", target: "", args: [] })).exitCode, 0);
  assert.deepEqual(runs[0].args.slice(1, 3), ["install", "--ignore-scripts"], "still without install scripts");
  await run("project_write", { project: "api", path: "build.js", content: "console.log('hecho')" });
  assert.equal((await run("project_run", { project: "api", action: "node", target: "build.js", args: [] })).exitCode, 0);
  assert.equal(store.list("approvals").length, 0);
});

test("with «Solo sugiere»: once per project; installs ask again only for new packages", async (t) => {
  assert.equal(projectPermission("project_write", {}, { autonomy: "sugiere" }), "editar");
  assert.equal(projectPermission("project_run", { action: "install" }, { autonomy: "sugiere" }), "instalar");
  assert.equal(projectPermission("project_run", { action: "script" }, { autonomy: "sugiere" }), "ejecutar");
  assert.equal(projectPermission("project_preview", {}, { autonomy: "sugiere", kind: "static" }), null, "a static page runs nothing on this computer");
  assert.equal(projectPermission("project_preview", {}, { autonomy: "sugiere", kind: "node" }), "ejecutar");
  assert.deepEqual(newPackages([{ name: "a", spec: "^1" }, { name: "b", spec: "^2" }], { packages: ["a@^1"] }), [{ name: "b", spec: "^2" }]);

  const runs = [];
  const { store, run, again, root } = await setup(t, { runs, autonomy: "sugiere" });
  // Editing this project was already allowed once.
  store.put("grants", { id: "g-edit", botId: "bruno", tool: "project", kind: "permission", scope: grantScope("m1", "api", "editar"), active: true });
  await run("project_create", { name: "api", template: "vacio" });
  await run("project_write", { project: "api", path: "package.json", content: JSON.stringify({ name: "api", scripts: { build: "node build.js" }, dependencies: { zod: "^3.24.0" } }) });
  const first = await again("project_run", { project: "api", action: "install", target: "", args: [] }, "i1");
  assert.deepEqual(first, { waiting: true });
  const card = store.get("approvals", "s1:i1");
  assert.match(card.summary, /zod@\^3\.24\.0/);
  assert.match(card.summary, /--ignore-scripts/);
  assert.equal(card.canAlways, false);
  assert.equal(runs.length, 0, "nothing runs before the OK");
  store.patch("approvals", "s1:i1", { status: "approved" });
  const done = await again("project_run", { project: "api", action: "install", target: "", args: [] }, "i1");
  assert.equal(done.exitCode, 0);
  assert.deepEqual(runs[0].args.slice(1, 3), ["install", "--ignore-scripts"]);
  assert.equal(runs[0].opts.env.npm_config_offline, undefined);
  assert.equal(store.get("approvals", "s1:i1").status, "executed");
  // Same packages: no new question.
  assert.equal((await run("project_run", { project: "api", action: "install", target: "", args: [] })).exitCode, 0);
  // A new package: asked again, listing only it.
  await run("project_write", { project: "api", path: "package.json", content: JSON.stringify({ name: "api", scripts: { build: "node build.js" }, dependencies: { zod: "^3.24.0", lodash: "^4.17.21" } }) });
  assert.deepEqual(await again("project_run", { project: "api", action: "install", target: "", args: [] }, "i2"), { waiting: true });
  const second = store.get("approvals", "s1:i2").summary;
  assert.match(second, /lodash@\^4\.17\.21/);
  assert.doesNotMatch(second, /zod/);

  // Running the project's code: one approval, then free for this project.
  await run("project_write", { project: "api", path: "build.js", content: "console.log('hecho')" });
  assert.deepEqual(await again("project_run", { project: "api", action: "node", target: "build.js", args: [] }, "r1"), { waiting: true });
  assert.match(store.get("approvals", "s1:r1").summary, /código que ha escrito el bot/);
  store.patch("approvals", "s1:r1", { status: "approved" });
  assert.equal((await again("project_run", { project: "api", action: "node", target: "build.js", args: [] }, "r1")).exitCode, 0);
  assert.ok(store.list("grants").some((g) => g.scope === grantScope("m1", "api", "ejecutar")));
  const before = runs.length;
  assert.equal((await run("project_run", { project: "api", action: "script", target: "build", args: [] })).exitCode, 0, "no second question");
  assert.equal(runs.length, before + 1);
  assert.equal(runs.at(-1).opts.env.npm_config_offline, "true", "scripts run offline");
  await assert.rejects(run("project_run", { project: "api", action: "script", target: "dev", args: [] }), /project_server/);
  await assert.rejects(run("project_run", { project: "api", action: "node", target: "package.json", args: [] }), /\.js, \.mjs o \.cjs/);
  assert.ok(existsSync(path.join(root, "proyectos", "api", "build.js")));
});

test("with autonomy «sugiere» editing a project asks once", async (t) => {
  const { store, again, run } = await setup(t, { autonomy: "sugiere" });
  assert.deepEqual(await again("project_create", { name: "web", template: "html" }, "a1"), { waiting: true });
  store.patch("approvals", "s1:a1", { status: "approved" });
  assert.equal((await again("project_create", { name: "web", template: "html" }, "a1")).project, "web");
  assert.equal((await run("project_write", { project: "web", path: "b.js", content: "1" })).path, "b.js", "no second question");
});

// ------------------------------------------------------------- servers
test("static projects are served by Colmena on 127.0.0.1 without leaving the folder", async (t) => {
  const dir = await tmp(t);
  await createProject(dir, "web", "html");
  await writeFile(path.join(dir, "secreto.txt"), "no");
  const root = path.join(dir, "proyectos", "web");
  assert.deepEqual(await serveKind(root), { kind: "static" });
  const servers = new DevServers({ portRange: [5651, 5699] });
  t.after(() => servers.shutdown());
  const view = await servers.start({ missionId: "m1", project: "web", root });
  assert.match(view.url, /^http:\/\/127\.0\.0\.1:56\d\d\/$/);
  assert.match(await (await fetch(view.url)).text(), /<title>web<\/title>/);
  assert.equal((await fetch(view.url + "styles.css")).headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal((await fetch(view.url + "..%2Fsecreto.txt")).status, 404);
  assert.equal((await fetch(view.url + "%2e%2e/%2e%2e/secreto.txt")).status, 404);
  assert.equal(servers.missionOfPort(view.port), "m1");
  assert.equal((await servers.start({ missionId: "m1", project: "web", root })).port, view.port, "one per project");
  assert.equal((await servers.stop("m1", "web")).status, "stopped");
  assert.equal(servers.missionOfPort(view.port), null);
  assert.deepEqual(portArgs("vite", 5200), ["--host", "127.0.0.1", "--port", "5200", "--strictPort"]);
});

test("project_preview returns console errors and a capture, at most three rounds", async (t) => {
  let errors = [{ level: "error", text: "ReferenceError: total is not defined (/app.js:3)", source: "exception" }];
  const computer = fakeComputer({
    preview: (args) => ({ url: args.url, title: "web", loadError: null, console: errors, text: "Calculadora", jpegBase64: JPEG }),
    previewRevoke: () => ({ revoked: true }),
  });
  const { run, store, projects } = await setup(t, { computer });
  await run("project_create", { name: "web", template: "html" });
  const first = await run("project_preview", { project: "web", path: "/" });
  assert.equal(first.ok, false);
  assert.equal(first.errors[0].text, "ReferenceError: total is not defined (/app.js:3)");
  assert.equal(first.round, "1 de " + PREVIEW_ROUNDS);
  assert.match(first.image, /^data:image\/jpeg;base64,/);
  const opened = computer.calls.find((c) => c.op === "preview").args;
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(opened.port, Number(new URL(opened.url).port));
  assert.equal(opened.missionId, "m1");
  await run("project_preview", { project: "web", path: "/" });
  const third = await run("project_preview", { project: "web", path: "/" });
  assert.match(third.next, /última ronda/);
  const fourth = await run("project_preview", { project: "web", path: "/" });
  assert.equal(fourth.stopped, true);
  assert.match(fourth.message, /cuenta a la persona/);
  assert.equal(computer.calls.filter((c) => c.op === "preview").length, 3);
  errors = [];
  assert.equal(store.get("steps", "s1").previewRounds.web, 3);
  // Stopping the server closes its port in the bots' browser.
  await run("project_server", { project: "web", action: "stop" });
  assert.ok(computer.calls.some((c) => c.op === "previewRevoke"));
  assert.equal(projects.servers.get("m1", "web").status, "stopped");
});

test("a clean preview passes and does not use up a round", async (t) => {
  const computer = fakeComputer({ preview: (args) => ({ url: args.url, title: "web", console: [{ level: "warning", text: "aviso" }], text: "Hola", jpegBase64: JPEG }) });
  const { run, store } = await setup(t, { computer });
  await run("project_create", { name: "web", template: "html" });
  const out = await run("project_preview", { project: "web", path: "" });
  assert.equal(out.ok, true);
  assert.equal(out.warnings.length, 1);
  assert.equal(store.get("steps", "s1").previewRounds, undefined);
});

test("without the desktop app the preview checks that the server answers", async (t) => {
  const { run } = await setup(t);
  await run("project_create", { name: "web", template: "html" });
  const out = await run("project_preview", { project: "web", path: "/no-hay.html" });
  assert.equal(out.status, 404);
  assert.equal(out.ok, false);
  assert.match(out.browser, /app de escritorio/);
});

// --------------------------------------------------------------- wiring
test("cards, verbs and definitions of the project tools", () => {
  const names = projectToolDefs().map((d) => d.name);
  assert.deepEqual(names, ["project_create", "project_files", "project_write", "project_edit", "project_delete", "project_run", "project_server", "project_preview"]);
  for (const d of projectToolDefs()) assert.deepEqual(d.parameters.required, Object.keys(d.parameters.properties), d.name);
  assert.equal(toolCard("project_run", { project: "web", action: "install" }, { command: "npm install --ignore-scripts", exitCode: 0, stdout: "added 3 packages" }).type, "command", "shows in the Terminal panel");
  assert.deepEqual(projectToolCard("project_edit", { project: "web", path: "src/App.jsx", edits: [{}, {}] }, {}).path, "proyectos/web/src/App.jsx");
  assert.equal(toolCard("project_preview", { project: "web" }, { errors: [{}], round: "1 de 3", ok: false }).errors, 1);
  assert.equal(verbFor("project_edit", {}), "programando");
  assert.equal(verbFor("project_run", { action: "install" }), "instalando");
  assert.equal(verbFor("project_preview", {}), "navegando");
});

test("browser_screenshot sends its image to the model", async (t) => {
  const cleanup = [];
  const dir = await tmp(t, cleanup);
  const store = new Store(dir);
  cleanup.push(() => store.close());
  const computer = fakeComputer({ screenshot: () => ({ url: "https://ejemplo.es/", title: "Ejemplo", jpegBase64: JPEG }) });
  const runtime = { store, settings: () => ({}), autonomy: () => "avisa", root: () => path.join(dir, "w", "m1"), setActivity() {}, announce() {}, approvalContext: () => "" };
  const tools = computerExtraTools(runtime, { computer })({ id: "nora", name: "Nora" });
  const shot = tools.find((x) => x.name === "browser_screenshot");
  const out = await shot.run({}, { mission: { id: "m1" }, step: { id: "s1" }, bot: { id: "nora", name: "Nora" }, call: { call_id: "c1" }, signal: new AbortController().signal });
  assert.match(out.image, /^data:image\/jpeg;base64,/);
});

test("preview console lines keep errors and warnings only", () => {
  const { consoleEntry } = require("../desktop/browser.cjs");
  assert.equal(consoleEntry("Runtime.consoleAPICalled", { type: "log", args: [{ value: "hola" }] }), null);
  assert.deepEqual(consoleEntry("Runtime.consoleAPICalled", { type: "error", args: [{ value: "Falló" }, { value: 3 }] }), { level: "error", text: "Falló 3", source: "console" });
  assert.match(consoleEntry("Runtime.exceptionThrown", { exceptionDetails: { url: "http://127.0.0.1:5200/src/App.jsx", lineNumber: 9, exception: { description: "TypeError: x" } } }).text, /TypeError: x \(\/src\/App\.jsx:10\)/);
  assert.equal(consoleEntry("Log.entryAdded", { entry: { level: "verbose", text: "x" } }), null);
});

test("deleting a conversation stops its servers and drops its project permissions", async (t) => {
  const { store, run, again, servers } = await setup(t, { autonomy: "sugiere" });
  store.put("grants", { id: "g-edit", botId: "bruno", tool: "project", kind: "permission", scope: grantScope("m1", "web", "editar"), active: true });
  await run("project_create", { name: "web", template: "html" });
  await run("project_server", { project: "web", action: "start" });
  await run("project_write", { project: "web", path: "x.js", content: "1" });
  assert.deepEqual(await again("project_run", { project: "web", action: "node", target: "x.js", args: [] }, "g1"), { waiting: true });
  store.patch("approvals", "s1:g1", { status: "approved" });
  await again("project_run", { project: "web", action: "node", target: "x.js", args: [] }, "g1");
  assert.equal(store.list("grants").filter((g) => g.tool === "project").length, 2, "editing and running this project");
  store.remove("missions", "m1");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(servers.get("m1", "web").status, "stopped");
  assert.equal(store.list("grants").filter((g) => g.tool === "project").length, 0);
});
