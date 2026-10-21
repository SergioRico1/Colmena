// «Código», phase 2: Codex as engine (fake app-server), plan mode with Claude Code and with
// Codex (Implementar · En una tarea nueva · Refinar), pushing to a remote and the PR page, and
// the person's terminals (fake pty) with their saved scrollback.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService, githubRepo } from "../server/code/service.mjs";
import { unwrapCommand, toolOf } from "../server/code/codex.mjs";
import { Terminals, projectScripts, trimBuffer } from "../server/code/terminal.mjs";
import { probePage } from "../server/code/ports.mjs";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const CODEX = [process.execPath, fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url))];
const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-code2-" + name + "-"));
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); }
  throw Error("timeout");
};
const g = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

function setup(name) {
  const dir = tmp(name);
  const repo = path.join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo", scripts: { dev: "node x.js", test: "node --test" } }));
  g(repo, "add", "-A");
  g(repo, "commit", "-qm", "init");
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: CODEX });
  const done = async () => { code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { dir, repo, store, code, done };
}
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));

test("Codex commands and items read like Claude Code's", () => {
  assert.equal(unwrapCommand('"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "git push origin \\"main\\""'), 'git push origin "main"');
  assert.equal(unwrapCommand("powershell.exe -Command 'echo ''hi'''"), "echo 'hi'");
  assert.equal(unwrapCommand("npm test"), "npm test");
  assert.equal(toolOf({ type: "commandExecution", command: "cat a.js", commandActions: [{ type: "read", path: "C:/p/a.js", name: "a.js" }] }).name, "Read");
  assert.equal(toolOf({ type: "fileChange", changes: [{ path: "C:/p/n.txt", kind: { type: "add" } }] }).name, "Write");
  assert.equal(toolOf({ type: "fileChange", changes: [{ path: "C:/p/n.txt", kind: { type: "update" } }, { path: "C:/p/m.txt", kind: { type: "update" } }] }).input.paths.length, 2);
  assert.equal(toolOf({ type: "reasoning" }), null);
  assert.equal(githubRepo("git@github.com:ana/tienda.git"), "ana/tienda");
  assert.equal(githubRepo("https://github.com/ana/tienda"), "ana/tienda");
  assert.equal(githubRepo("https://gitlab.com/ana/tienda.git"), null);
  assert.equal(trimBuffer("a\nbcdef\nxyz", 6), "xyz");
});

test("a task with Codex: turns, approvals, red lines, plan and rollback", { skip: !hasGit, timeout: 120000 }, async () => {
  const { repo, code, store, done } = setup("codex");
  try {
    const project = await code.addProject({ folder: repo });
    const cat = await code.catalog();
    assert.deepEqual(cat.find((e) => e.id === "codex").models.map((m) => m.id), ["gpt-test"]);
    const view = await code.createTask({ projectId: project.id, engine: "codex", text: "escribe una nota" });
    assert.equal(view.engine, "codex");
    assert.equal(view.model, "gpt-test");
    await idle(code, view.id, 1);
    let items = code.items(view.id);
    assert.deepEqual(items.map((i) => i.kind), ["user", "tool", "text", "turn"]);
    assert.equal(items[1].text, "Escribió nota.txt");
    assert.equal(items[1].status, "done");
    assert.ok(existsSync(path.join(view.cwd, "nota.txt")));
    assert.equal(code.mustTask(view.id).usage.window, 272000);
    assert.equal(code.mustTask(view.id).session.id, "th-1");

    await code.send(view.id, { text: "haz push" });
    const ask = await until(() => code.items(view.id).find((i) => i.kind === "ask" && i.status === "pending"));
    assert.equal(ask.rule, "git-push");
    assert.equal(ask.command, "git push origin main");
    code.answer(view.id, ask.id, { decision: "deny" });
    await idle(code, view.id, 2);
    assert.equal(code.items(view.id).at(-1).text, "No lo he subido.");

    await code.send(view.id, { text: "propón algo", mode: "plan" });
    await idle(code, view.id, 3);
    const plan = code.items(view.id).find((i) => i.kind === "plan");
    assert.equal(plan.status, "open");
    assert.equal(code.mustTask(view.id).status, "planned");
    await code.planAction(view.id, { item: plan.id, action: "implement" });
    await idle(code, view.id, 4);
    assert.equal(store.get("codeItems", plan.id).status, "implemented");

    // «Editar desde aquí» on Codex rolls its thread back.
    const second = code.items(view.id).filter((i) => i.kind === "user")[1];
    await code.editFrom(view.id, { item: second.id });
    assert.equal(code.mustTask(view.id).session.rollback, 3);
    await code.send(view.id, { text: "hola" });
    await idle(code, view.id, 2);
    assert.match(code.items(view.id).at(-1).text, /\(1 turnos antes\)/);
    assert.equal(code.mustTask(view.id).session.rollback, 0);
  } finally {
    await done();
  }
});

test("plan mode with Claude Code, and «En una tarea nueva»", { skip: !hasGit, timeout: 120000 }, async () => {
  const { repo, code, done } = setup("plan");
  try {
    const project = await code.addProject({ folder: repo });
    const view = await code.createTask({ projectId: project.id, text: "quiero una nota", mode: "plan", model: "claude-haiku-5-5" });
    await idle(code, view.id, 1);
    const items = code.items(view.id);
    const plan = items.find((i) => i.kind === "plan");
    assert.equal(plan.text, "# Plan\n\n1. Escribir la nota.");
    assert.equal(items.at(-1).text, "Espero tu decisión.");
    assert.ok(!items.some((i) => i.kind === "tool"), "plan mode changes nothing");
    const moved = await code.planAction(view.id, { item: plan.id, action: "new" });
    assert.notEqual(moved.task.id, view.id);
    assert.equal(code.store.get("codeItems", plan.id).status, "moved");
    const first = code.items(moved.task.id).find((i) => i.kind === "user");
    assert.match(first.text, /^Implementa este plan:/);
    await idle(code, moved.task.id, 1);
  } finally {
    await done();
  }
});

test("saving, pushing to the remote and the PR page", { skip: !hasGit, timeout: 120000 }, async () => {
  const { dir, repo, code, done } = setup("push");
  try {
    const remote = path.join(dir, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    g(repo, "remote", "add", "origin", remote);
    const project = await code.addProject({ folder: repo });
    const view = await code.createTask({ projectId: project.id, text: "escribe una nota", model: "claude-haiku-5-5" });
    await idle(code, view.id, 1);
    const pushed = await code.push(view.id);
    assert.equal(pushed.branch, view.branch);
    assert.match(g(remote, "branch", "--list"), new RegExp(view.branch.replace("/", "\\/")));
    assert.match(g(remote, "log", "--format=%s", "-1", view.branch), /feat: add a note/);
    await assert.rejects(code.pullRequest(view.id), /solo en GitHub/);
    // Without a remote, a clear message.
    g(repo, "remote", "remove", "origin");
    await assert.rejects(code.push(view.id), /no está conectado a GitHub/);
  } finally {
    await done();
  }
});

test("the preview says when a page comes as text (its source code would show)", async () => {
  const http = await import("node:http");
  const page = "<!doctype html><html><body>hola</body></html>";
  const server = http.createServer((req, res) => {
    const type = req.url === "/texto" ? "text/plain; charset=utf-8" : req.url === "/sin" ? null : "text/html";
    if (type) res.setHeader("Content-Type", type);
    res.end(req.url === "/json" ? "{}" : page);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    assert.deepEqual(await probePage(base + "/texto"), { contentType: "text/plain", source: true });
    assert.deepEqual(await probePage(base + "/"), { contentType: "text/html", source: false });
    assert.equal((await probePage(base + "/sin")).source, false, "no type: the browser sniffs it as a page");
    assert.equal((await probePage("http://127.0.0.1:1/")).source, false);
  } finally {
    server.close();
  }
});

/** A pty stand-in: echoes what is written, like a shell would. */
function fakePty() {
  const spawned = [];
  const spawn = (shell, args, opts) => {
    const e = new EventEmitter();
    const p = {
      pid: 4000 + spawned.length, opts,
      onData: (fn) => e.on("data", fn), onExit: (fn) => e.on("exit", fn),
      write: (d) => setTimeout(() => e.emit("data", d === "\r" ? "\r\n" : d), 1),
      resize: (c, r) => { p.size = [c, r]; },
      kill: () => e.emit("exit", { exitCode: 0 }),
    };
    setTimeout(() => e.emit("data", "PS> "), 1);
    spawned.push(p);
    return p;
  };
  return { spawn, spawned };
}

test("terminals: the task folder, scripts, live output and the saved scrollback", async () => {
  const dir = tmp("term");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { dev: "vite", build: "vite build" } }));
  assert.deepEqual(projectScripts(dir).map((s) => [s.name, s.command]), [["dev", "npm run dev"], ["build", "npm run build"]]);
  const { spawn, spawned } = fakePty();
  const terms = new Terminals({ directory: dir, spawn });
  const t = await terms.open("task1", { cwd: dir, command: "npm run dev", title: "dev" });
  assert.equal(spawned[0].opts.cwd, dir);
  await new Promise((r) => setTimeout(r, 400));
  const frames = [];
  const off = terms.attach("task1", t.id, (f) => frames.push(f));
  assert.equal(frames[0].type, "replay");
  assert.match(frames[0].data, /PS> npm run dev/);
  terms.write("task1", t.id, "ls");
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(frames.slice(1).map((f) => f.data), ["ls"]);
  terms.resize("task1", t.id, 120, 40);
  assert.deepEqual(spawned[0].size, [120, 40]);
  assert.deepEqual(terms.pids("task1"), [4000]);
  await new Promise((r) => setTimeout(r, 300));
  assert.match(readFileSync(path.join(dir, "code", "terminals", "task1", t.id + ".log"), "utf8"), /npm run dev/);
  off();
  // After a restart the scrollback comes back and a new shell continues below it.
  const again = new Terminals({ directory: dir, spawn });
  assert.deepEqual((await again.list("task1")).map((x) => [x.id, x.running]), [[t.id, false]]);
  await again.open("task1", { cwd: dir, id: t.id });
  const frames2 = [];
  again.attach("task1", t.id, (f) => frames2.push(f));
  assert.match(frames2[0].data, /npm run dev[\s\S]*sesión anterior/);
  await again.close("task1", t.id);
  assert.deepEqual(await again.list("task1"), []);
  terms.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
