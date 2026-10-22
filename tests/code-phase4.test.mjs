// «Código», block A of the T3 Code / OpenClaw round: notices when a task ends or waits, OpenCode
// plans and effort, the macOS port scanner, copies that start ready (.worktreeinclude, setup
// scripts that say when they end), cleaning up a copy saved into main, «/goal» and context chips.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService, cleanContexts, contextBlock, goalPrompt, GOAL_MARK } from "../server/code/service.mjs";
import { pickVariant } from "../server/code/opencode.mjs";
import { parseLsof, parsePs } from "../server/code/ports.mjs";
import { copyIncluded, savedRef } from "../server/code/git.mjs";
import { Terminals, setupLine } from "../server/code/terminal.mjs";
import { Notifier } from "../server/notifications.mjs";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const OPENCODE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-opencode.mjs", import.meta.url))];
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-code4-" + name + "-"));
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); }
  throw Error("timeout");
};
const g = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

function setup(name, extra = {}) {
  const dir = tmp(name);
  const repo = path.join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  writeFileSync(path.join(repo, ".gitignore"), ".env\nnode_modules/\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-qm", "init");
  const store = new Store(path.join(dir, "data"));
  const notices = [];
  const notifier = { notify: (n) => { notices.push(n); return n; } };
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: null, opencodeCommand: OPENCODE, notifier, ...extra });
  const done = async () => { code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { dir, repo, store, code, notices, done };
}
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));

test("a task that ends or waits for you sends a notice, unless you are looking at it", async () => {
  const { code, repo, notices, done } = setup("notify");
  try {
    const { project } = { project: await code.addProject({ folder: repo }) };
    const task = await code.createTask({ projectId: project.id, text: "hola" });
    await idle(code, task.id, 1);
    await until(() => notices.length === 1);
    assert.equal(notices[0].kind, "done");
    assert.equal(notices[0].url, "/codigo/" + task.id);
    assert.equal(notices[0].extra.codeTask, task.id);
    assert.match(notices[0].title, /ha terminado «hola»/);

    // A question: «te necesita».
    await code.send(task.id, { text: "pregunta" });
    await until(() => notices.length === 2);
    assert.equal(notices[1].kind, "needs");
    assert.match(notices[1].text, /¿Qué color\?/);
    const ask = code.items(task.id).find((i) => i.kind === "ask" && i.status === "pending");
    // Looking at the task (focused window): no notice for its end.
    code.setWatch({ task: task.id, focused: true });
    code.answer(task.id, ask.id, { answers: { "¿Qué color?": "Rojo" } });
    await idle(code, task.id, 2);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(notices.length, 2);
  } finally { await done(); }
});

test("the notifier keeps one unread notice per code task and kind", () => {
  const dir = tmp("notifier");
  const store = new Store(path.join(dir, "data"));
  try {
    const events = [];
    const notifier = new Notifier(store, { emit: (e) => events.push(e) });
    const a = notifier.notify({ kind: "done", title: "Bruno ha terminado «x»", text: "1", url: "/codigo/ct-1", extra: { codeTask: "ct-1" } });
    const b = notifier.notify({ kind: "done", title: "Bruno ha terminado «x»", text: "2", url: "/codigo/ct-1", extra: { codeTask: "ct-1" } });
    const c = notifier.notify({ kind: "needs", title: "Bruno te espera", text: "3", url: "/codigo/ct-1", extra: { codeTask: "ct-1" } });
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, c.id);
    assert.equal(store.list("notifications").length, 2);
    assert.equal(events[0].sound, "done");
    assert.equal(events[2].sound, "needs");
    assert.equal(events[0].tag, events[1].tag);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("OpenCode: a plan turn ends in a plan card, and the effort picks the model's variant", async () => {
  assert.equal(pickVariant("high", ["low", "high", "max"]), "high");
  assert.equal(pickVariant("medium", ["low", "high", "max"]), "low", "between two as close, the lighter");
  assert.equal(pickVariant("xhigh", ["low", "high", "max"]), "high");
  assert.equal(pickVariant("max", ["max"]), "max");
  assert.equal(pickVariant("low", []), null);
  const { code, repo, done } = setup("oc-plan");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "planea la nota", engine: "opencode", model: "opencode/deepseek-v4.1-flash-free", mode: "plan" });
    await idle(code, task.id, 1);
    const items = code.items(task.id);
    assert.equal(items.filter((i) => i.kind === "plan").length, 1);
    assert.match(items.find((i) => i.kind === "plan").text, /escribir la nota/);
    assert.equal(items.filter((i) => i.kind === "text").length, 0, "the plan is not repeated as text");
    assert.equal(code.mustTask(task.id).status, "planned");

    const other = await code.createTask({ projectId: project.id, text: "dime la variante", engine: "opencode", model: "opencode/deepseek-v4.1-flash-free", effort: "low" });
    await idle(code, other.id, 1);
    assert.equal(code.items(other.id).find((i) => i.kind === "text").text, "Variante: low");
  } finally { await done(); }
});

test("an engine that closes says which engine it was", async () => {
  const { code, repo, done } = setup("exit");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    const entry = { engine: { kind: "opencode" }, turn: { n: 1, tools: new Map(), live: "", started: Date.now() } };
    code.mustTask(task.id);
    code.onExit(task.id, entry, null);
    await until(() => code.items(task.id).some((i) => i.kind === "error"));
    assert.equal(code.items(task.id).find((i) => i.kind === "error").text, "OpenCode se cerró.");
  } finally { await done(); }
});

test("the port scanner reads lsof and ps (macOS, Linux)", () => {
  const lsof = "p501\nf12\nn127.0.0.1:5173\nf13\nn[::1]:5173\np777\nf4\nn*:3000\nf5\nn192.168.1.4:8080\n";
  assert.deepEqual(parseLsof(lsof), [{ port: 5173, pid: 501 }, { port: 5173, pid: 501 }, { port: 3000, pid: 777 }]);
  const ps = "  501   400 /usr/local/bin/node /Users/ana/app/node_modules/.bin/vite\n  400     1 -zsh\n";
  const procs = parsePs(ps);
  assert.equal(procs.get(501).parent, 400);
  assert.equal(procs.get(501).name, "node");
  assert.match(procs.get(501).command, /vite$/);
});

test("a new copy brings the .worktreeinclude files and its setup script says when it ends", async () => {
  const dir = tmp("include");
  try {
    const repo = path.join(dir, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    writeFileSync(path.join(repo, ".gitignore"), ".env\n*.log\n");
    writeFileSync(path.join(repo, ".worktreeinclude"), ".env\nnotes.txt\n");
    writeFileSync(path.join(repo, "notes.txt"), "tracked\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "init");
    writeFileSync(path.join(repo, ".env"), "KEY=demo\n");
    writeFileSync(path.join(repo, "debug.log"), "x\n");
    const to = path.join(dir, "copy");
    g(repo, "worktree", "add", "-b", "copy", to);
    assert.deepEqual(await copyIncluded({ from: repo, to }), [".env"], "only ignored files listed in .worktreeinclude");
    assert.equal(readFileSync(path.join(to, ".env"), "utf8"), "KEY=demo\n");
    assert.ok(!existsSync(path.join(to, "debug.log")));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }

  assert.match(setupLine("npm install", "win32"), /^npm install; if \(\$\?\)/);
  assert.ok(!setupLine("npm install", "win32").includes("[colmena:listo]"), "the typed line never shows the mark whole");
  assert.ok(!setupLine("npm ci", "darwin").includes("[colmena:listo]"));
  const emitters = [];
  const spawn = () => {
    const e = new EventEmitter();
    emitters.push(e);
    return { pid: 9000, onData: (fn) => e.on("data", fn), onExit: (fn) => e.on("exit", fn), write: () => {}, resize: () => {}, kill: () => e.emit("exit", { exitCode: 0 }) };
  };
  const tdir = tmp("setup");
  const terms = new Terminals({ directory: tdir, spawn });
  const ends = [];
  terms.onSetup = (e) => ends.push(e);
  await terms.open("t1", { cwd: tdir, command: "npm install", title: "preparar", setup: true });
  emitters[0].emit("data", "added 3 packages\r\n\x1b[32m[colmena:");
  emitters[0].emit("data", "listo]\x1b[0m\r\n");
  assert.deepEqual(ends.map((e) => [e.title, e.ok]), [["preparar", true]]);
  terms.shutdown();
  rmSync(tdir, { recursive: true, force: true });
});

test("saved into main, the copy is cleaned up and comes back when you write again", async () => {
  const { code, repo, store, done } = setup("saved");
  try {
    writeFileSync(path.join(repo, ".worktreeinclude"), ".env\n");
    writeFileSync(path.join(repo, ".env"), "KEY=demo\n");
    g(repo, "add", ".worktreeinclude");
    g(repo, "commit", "-qm", "include");
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "escribe la nota" });
    await idle(code, task.id, 1);
    const view = code.mustTask(task.id);
    assert.equal(readFileSync(path.join(view.cwd, ".env"), "utf8"), "KEY=demo\n");
    assert.match(code.items(task.id)[0].text, /Copia preparada con \.env/);

    await code.merge(task.id);
    assert.ok(existsSync(path.join(repo, "nota.txt")));
    assert.ok(!existsSync(view.cwd), "the copy is gone");
    const saved = code.mustTask(task.id).saved;
    assert.ok(Date.parse(saved.until) - Date.now() > 29 * 86400000);
    assert.equal(g(repo, "rev-parse", savedRef(task.id)).trim(), saved.commit);
    assert.equal(g(repo, "branch", "--list", view.branch).trim(), "", "its merged branch went with it");
    await assert.rejects(code.merge(task.id), /Ya está guardada/);

    // Writing again brings it back: same folder, same branch, same commit, its .env too.
    await code.send(task.id, { text: "hola" });
    await idle(code, task.id, 2);
    assert.ok(existsSync(path.join(view.cwd, "nota.txt")));
    assert.equal(readFileSync(path.join(view.cwd, ".env"), "utf8"), "KEY=demo\n");
    assert.equal(g(view.cwd, "rev-parse", "--abbrev-ref", "HEAD").trim(), view.branch);
    assert.equal(code.mustTask(task.id).saved, null);
    assert.equal(g(repo, "for-each-ref", "refs/colmena/").trim(), "");

    // After 30 days the hidden ref goes and the task can no longer come back.
    await code.merge(task.id).catch(() => {});
    await code.cleanUpCopy(task.id);
    assert.ok(code.mustTask(task.id).saved);
    await code.pruneSaved(Date.now() + 31 * 86400000);
    assert.equal(store.list("codeSaved").length, 0);
    assert.equal(g(repo, "for-each-ref", "refs/colmena/").trim(), "");
    await assert.rejects(code.send(task.id, { text: "otra" }), /más de 30 días/);
  } finally { await done(); }
});

test("/goal: Bruno keeps going until he says it is done, and says when he is blocked", async () => {
  assert.match(goalPrompt({ text: "pasan los tests", max: 12, turns: 0 }, true), /Tu objetivo es: pasan los tests/);
  assert.equal(GOAL_MARK.exec("Hecho.\n[objetivo: bloqueado — falta la clave]")[2], "falta la clave");
  const { code, repo, notices, done } = setup("goal");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    await code.setGoal(task.id, { text: "pasan los tests" });
    await until(() => code.mustTask(task.id).goal?.status === "complete");
    await idle(code, task.id, 2);
    const t = code.mustTask(task.id);
    assert.equal(t.goal.turns, 2);
    const texts = code.items(task.id).filter((i) => i.kind === "text").map((i) => i.text);
    assert.deepEqual(texts, ["Vuelta 1.", "Vuelta 2."], "the marks are taken out");
    const lines = code.items(task.id).filter((i) => i.kind === "notice").map((i) => i.text);
    assert.deepEqual(lines, ["Objetivo: «pasan los tests»", "Sigue con el objetivo · vuelta 2 de 12", "Objetivo cumplido: «pasan los tests»."]);
    assert.equal(notices.length, 1, "one notice for the whole goal, at its end");
    assert.match(notices[0].text, /Objetivo cumplido/);

    await code.setGoal(task.id, { text: "bloquea hasta tener la clave" });
    await until(() => code.mustTask(task.id).goal?.status === "blocked");
    assert.equal(code.mustTask(task.id).goal.note, "falta la clave de la API");
    await until(() => notices.length === 2);
    assert.equal(notices[1].kind, "needs");
    await code.setGoal(task.id, { action: "clear" });
    assert.equal(code.mustTask(task.id).goal, null);
  } finally { await done(); }
});

test("context chips reach the engine after the words and stay on the message", async () => {
  const clean = cleanContexts([{ kind: "terminal", label: "Terminal · 2 líneas", text: "npm ERR! missing script" }, { kind: "evil", text: "x" }, { kind: "diff", file: "src/a.js", lines: [3, 5], note: "¿Por qué?", text: "+const a = 1;" }]);
  assert.equal(clean.length, 2);
  assert.match(contextBlock(clean[0]), /^Terminal · 2 líneas:\n```\nnpm ERR! missing script\n```$/);
  assert.match(contextBlock(clean[1]), /^Comentario sobre src\/a\.js, líneas 3-5:\n¿Por qué\?\n```/);
  const { code, repo, done } = setup("contexts");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    await code.send(task.id, { text: "mira esto", contexts: [{ kind: "terminal", label: "Terminal", text: "Error: EADDRINUSE" }] });
    await idle(code, task.id, 1);
    const user = code.items(task.id).find((i) => i.kind === "user");
    assert.equal(user.text, "mira esto");
    assert.equal(user.contexts[0].text, "Error: EADDRINUSE");
    const sent = await code.prepare(code.mustTask(task.id), "mira esto", [], user.contexts);
    assert.match(sent, /mira esto\n\nTerminal:\n```\nError: EADDRINUSE\n```/);
  } finally { await done(); }
});
