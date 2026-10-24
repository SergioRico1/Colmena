// «Código»: switching engine in the middle of a task (T3 Code provider switching): the next turn
// goes with the other engine in the same copy, and its first message carries a budgeted
// selection of the task's real messages (handoffContext), not a summary.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService, handoffContext } from "../server/code/service.mjs";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const CODEX = [process.execPath, fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url))];
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-code8-" + name + "-"));
const until = async (fn, ms = 20000) => {
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
  g(repo, "add", "-A");
  g(repo, "commit", "-qm", "init");
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: CODEX, opencodeCommand: null });
  const done = async () => { code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { dir, repo, store, code, done };
}
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));
const lastText = (code, id) => code.items(id).filter((i) => i.kind === "text").at(-1)?.text;

test("handoff: the original request, then the newest entries that fit, whole and in order", () => {
  const items = [
    { kind: "user", text: "Haz una tienda con carrito" },
    { kind: "text", text: "Hecho el carrito.\n[objetivo: sigue]" },
    { kind: "tool", verb: "run", detail: "npm test", status: "error", output: "1 failing\nexpected 2 got 3" },
    { kind: "turn", files: [{ path: "src/cart.js", add: 40, del: 2 }] },
    { kind: "plan", text: "1. Pagos\n2. Envíos", status: "open" },
    { kind: "notice", text: "Sigue con Codex · GPT", engineSwitch: {} },
    { kind: "user", text: "Ahora los pagos", attachments: [{ name: "logo.png" }] },
    { kind: "text", text: "x".repeat(3000) },
    { kind: "user", text: "Y que funcione en el móvil" },
  ];
  const all = handoffContext(items, { from: "Claude Code · Opus 5.5" });
  assert.match(all, /^Contexto de esta tarea hasta ahora\. La llevaba Claude Code · Opus 5\.5;/);
  assert.match(all, /\[Persona\]\nHaz una tienda con carrito/);
  assert.match(all, /\[Bruno\]\nHecho el carrito\.\n\n/, "the goal mark is not for the other engine");
  assert.match(all, /\[Colmena\]\nOrden: npm test → falló: 1 failing expected 2 got 3/);
  assert.match(all, /Cambios de ese turno: src\/cart\.js \(\+40 −2\)/);
  assert.match(all, /\[Bruno · plan propuesto \(aún sin implementar\)\]\n1\. Pagos/);
  assert.match(all, /Ahora los pagos\n\(con: adjunto logo\.png\)/);
  assert.ok(!all.includes("Sigue con Codex"), "the switch line itself is not history");
  assert.ok(all.indexOf("Haz una tienda") < all.indexOf("Ahora los pagos") && all.indexOf("Ahora los pagos") < all.indexOf("Y que funcione"));

  const small = handoffContext(items, { budget: 1200 });
  assert.match(small, /\[Persona\]\nHaz una tienda con carrito/, "the original request always goes");
  assert.match(small, /\[Persona\]\nY que funcione en el móvil/, "and the newest");
  assert.ok(!small.includes("x".repeat(3000)), "an entry that does not fit is left out, never cut");
  assert.match(small, /\[… \d+ entradas intermedias omitidas …\]/);
  assert.match(small, /con algunos intermedios omitidos/);
});

test("switching from Claude Code to Codex and back: the same copy, the history, the restore points", async () => {
  const { code, repo, done } = setup("switch");
  try {
    const project = await code.addProject({ folder: repo });
    await code.catalog(); // the menu has Codex's own model list, as in the screen
    const task = await code.createTask({ projectId: project.id, text: "escribe la nota" });
    await idle(code, task.id, 1);
    const cwd = code.mustTask(task.id).cwd;
    assert.ok(existsSync(path.join(cwd, "nota.txt")));

    // A Codex model in the task's model menu: the next turn goes with Codex.
    const view = code.patchTask(task.id, { engine: "codex", model: "gpt-test" });
    assert.deepEqual([view.engine, view.model, view.handoff.pending], ["codex", "gpt-test", true]);
    assert.equal(code.items(task.id).at(-1).text, "Sigue con Codex · GPT Test");
    await code.send(task.id, { text: "¿Qué hiciste?" });
    await idle(code, task.id, 2);
    assert.equal(lastText(code, task.id), "Codex recibió el contexto: 1 mensajes tuyos; nuevo: ¿Qué hiciste?");
    assert.equal(code.mustTask(task.id).handoff.pending, false);
    assert.equal(code.mustTask(task.id).cwd, cwd, "the same copy");
    // Its own session goes on: no second handoff.
    await code.send(task.id, { text: "hola" });
    await idle(code, task.id, 3);
    assert.match(lastText(code, task.id), /^Vale/);

    // Back to Claude Code: a new session with the history (now three messages of yours).
    code.patchTask(task.id, { engine: "claude-code", model: "claude-haiku-5-5" });
    assert.equal(code.items(task.id).at(-1).text, "Sigue con Claude Code · Haiku 5.5");
    await code.send(task.id, { text: "sigue" });
    await idle(code, task.id, 4);
    assert.equal(lastText(code, task.id), "Claude recibió el contexto: 3 mensajes tuyos; nuevo: sigue");
    assert.deepEqual(code.mustTask(task.id).turns.map((t) => t.engine), ["claude-code", "codex", "codex", "claude-code"]);

    // Restore points and per-turn diffs do not care which engine made them.
    assert.deepEqual((await code.diff(task.id, { turn: 1 })).files.map((f) => f.path), ["nota.txt"]);
    await code.restore(task.id, { turn: 0 });
    assert.ok(!existsSync(path.join(cwd, "nota.txt")));

    // «Editar desde aquí» on the first Codex message: that session cannot be cut there (it began
    // with the switch), so a new one starts with the handoff of what is left.
    const second = code.items(task.id).filter((i) => i.kind === "user")[1];
    await code.editFrom(task.id, { item: second.id });
    const t = code.mustTask(task.id);
    assert.deepEqual([t.turns.length, t.session.started, t.handoff.pending, t.sessionFrom], [1, false, true, 2]);
  } finally { await done(); }
});

test("chosen while it works, the switch waits for the end of the turn", async () => {
  const { code, repo, done } = setup("pending");
  try {
    const project = await code.addProject({ folder: repo });
    await code.catalog(); // the menu has Codex's own model list, as in the screen
    const task = await code.createTask({ projectId: project.id, text: "pregunta" });
    const ask = await until(() => code.items(task.id).find((i) => i.kind === "ask" && i.status === "pending"));
    const view = code.patchTask(task.id, { engine: "codex", model: "gpt-test" });
    assert.equal(view.engine, "claude-code", "not yet");
    assert.deepEqual([view.pendingSwitch.engine, view.pendingSwitch.model], ["codex", "gpt-test"]);
    code.answer(task.id, ask.id, { answers: { "¿Qué color?": "Azul" } });
    await idle(code, task.id, 1);
    await until(() => code.mustTask(task.id).engine === "codex");
    assert.equal(code.mustTask(task.id).pendingSwitch, null);
    assert.equal(code.items(task.id).at(-1).text, "Sigue con Codex · GPT Test");
    assert.throws(() => code.patchTask(task.id, { engine: "opencode" }), /OpenCode no está instalado/);
  } finally { await done(); }
});
