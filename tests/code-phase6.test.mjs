// «Código», block C of the T3 Code / OpenClaw round: finer permissions («En esta tarea», «Siempre
// aquí»), comparing several engines (changes and tests), following the pull request with gh, and
// one file of the diff (undo it, open it in the editor).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService } from "../server/code/service.mjs";
import { decide, commandKey } from "../server/code/policy.mjs";
import { sideBySide } from "../src/components/v2/code/model.js";
import { parsePatch } from "../src/components/v2/code/model.js";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const GH = [process.execPath, fileURLToPath(new URL("./fixtures/fake-gh.mjs", import.meta.url))];
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-code6-" + name + "-"));
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); }
  throw Error("timeout");
};
const g = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

function setup(name, extra = {}, files = {}) {
  const dir = tmp(name);
  const repo = path.join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  for (const [f, body] of Object.entries(files)) writeFileSync(path.join(repo, f), body);
  g(repo, "add", "-A");
  g(repo, "commit", "-qm", "init");
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: null, opencodeCommand: null, ...extra });
  const done = async () => { code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { dir, repo, store, code, done };
}
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));
const pendingAsk = (code, id) => until(() => code.items(id).find((i) => i.kind === "ask" && i.status === "pending"));

test("finer permissions: «En esta tarea» and «Siempre aquí» for an exact command", () => {
  const base = { tool: "Bash", cwd: "C:\\w\\t", roots: ["C:\\w\\t"] };
  const push = decide({ ...base, input: { command: "git push  origin main" } });
  assert.deepEqual([push.decision, push.rule, push.taskScope, push.exact, push.durable], ["redline", "git-push", "git-push", "git push origin main", true]);
  assert.equal(decide({ ...base, input: { command: "git push origin main" }, taskAllow: ["git-push"] }).decision, "allow");
  assert.equal(decide({ ...base, input: { command: "git push origin main" }, commands: ["git push origin main"] }).decision, "allow");
  assert.equal(decide({ ...base, input: { command: "git push origin other" }, commands: ["git push origin main"] }).decision, "redline", "only that exact command");
  const sys = decide({ ...base, input: { command: "setx PATH x" }, taskAllow: ["system"], commands: ["setx PATH x"] });
  assert.equal(sys.decision, "redline", "changing the system always asks");
  assert.equal(sys.taskScope, undefined);
  const ask = decide({ ...base, access: "ask", input: { command: "npm test" } });
  assert.deepEqual([ask.decision, ask.taskScope, ask.exact], ["ask", "shell", "npm test"]);
  assert.equal(decide({ ...base, access: "ask", input: { command: "npm test" }, taskAllow: ["shell"] }).decision, "allow");
  assert.equal(decide({ tool: "Edit", cwd: "C:\\w\\t", access: "ask", input: { file_path: "C:\\w\\t\\a.js" }, taskAllow: ["edit"] }).decision, "allow");
  assert.equal(commandKey("  npm   run dev "), "npm run dev");
});

test("answers that last: in this task, or this command always in this project", async () => {
  const { code, repo, store, done } = setup("perms");
  try {
    const project = await code.addProject({ folder: repo });
    const a = await code.createTask({ projectId: project.id, text: "haz push" });
    let ask = await pendingAsk(code, a.id);
    assert.equal(ask.taskScope, "git-push");
    assert.equal(ask.exact, "git push origin main");
    code.answer(a.id, ask.id, { decision: "task" });
    await idle(code, a.id, 1);
    assert.deepEqual(code.mustTask(a.id).allow, ["git-push"]);
    assert.equal(code.items(a.id).find((i) => i.kind === "ask").scope, "task");
    await code.send(a.id, { text: "haz push otra vez" });
    await idle(code, a.id, 2);
    assert.equal(code.items(a.id).filter((i) => i.kind === "ask").length, 1, "no second question in this task");

    const b = await code.createTask({ projectId: project.id, text: "haz push" });
    ask = await pendingAsk(code, b.id);
    code.answer(b.id, ask.id, { decision: "here" });
    await idle(code, b.id, 1);
    assert.deepEqual(store.get("codeProjects", project.id).commands, ["git push origin main"]);
    const c = await code.createTask({ projectId: project.id, text: "haz push" });
    await idle(code, c.id, 1);
    assert.equal(code.items(c.id).filter((i) => i.kind === "ask").length, 0, "that exact command no longer asks in this project");
  } finally { await done(); }
});

test("one file of the diff: undo it (with «Deshacer»), and nothing outside the task opens", async () => {
  const { code, repo, done } = setup("revert");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "escribe la nota" });
    await idle(code, task.id, 1);
    const cwd = code.mustTask(task.id).cwd;
    assert.ok(existsSync(path.join(cwd, "nota.txt")));
    await code.revertFile(task.id, { path: "nota.txt", turn: 1 });
    assert.ok(!existsSync(path.join(cwd, "nota.txt")));
    const notice = code.items(task.id).at(-1);
    assert.match(notice.text, /Has deshecho los cambios de nota\.txt en el punto 1/);
    await code.restore(task.id, { undo: notice.undo });
    assert.ok(existsSync(path.join(cwd, "nota.txt")));
    await assert.rejects(code.revertFile(task.id, { path: "../fuera.txt" }), /no es de la tarea/);
    await assert.rejects(code.openInEditor(task.id, { path: "../../fuera.txt", line: 3 }), /no es de la tarea/);
  } finally { await done(); }
});

test("several engines at once: what each one changed, and their tests side by side", async () => {
  const pkg = JSON.stringify({ name: "demo", scripts: { test: "node -e \"process.exit(require('fs').existsSync('nota.txt') ? 0 : 1)\"" } });
  const { code, repo, done } = setup("compare", {}, { "package.json": pkg });
  try {
    const project = await code.addProject({ folder: repo });
    const a = await code.createTask({ projectId: project.id, text: "escribe la nota", label: "Claude Code · Opus 5.5", group: "cg-abcd1234" });
    const b = await code.createTask({ projectId: project.id, text: "hola", label: "Claude Code · Haiku 5.5", group: "cg-abcd1234" });
    await idle(code, a.id, 1);
    await idle(code, b.id, 1);
    let c = await code.compare("cg-abcd1234");
    assert.deepEqual(c.tasks.map((t) => [t.label, t.files.length]), [["Claude Code · Opus 5.5", 1], ["Claude Code · Haiku 5.5", 0]]);
    assert.equal(c.testCommand, "npm run test");
    await code.compareTests("cg-abcd1234", { wait: true });
    c = await code.compare("cg-abcd1234");
    assert.deepEqual(c.tasks.map((t) => t.tests.status), ["passed", "failed"]);
    await assert.rejects(code.compare("cg-ffff0000"), /No encuentro/);
  } finally { await done(); }
});

test("following the pull request: failing CI, conflicts and comments wake Bruno once; merged stops", async () => {
  const dir = tmp("gh-state");
  const file = path.join(dir, "state.json");
  process.env.GH_FAKE_STATE = file;
  const write = (s) => writeFileSync(file, JSON.stringify(s));
  write({ authed: false });
  const notices = [];
  const { code, repo, done } = setup("pr", { ghCommand: GH, notifier: { notify: (n) => notices.push(n) } });
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    assert.equal(await code.followPr(task.id, "colmena/x"), false);
    assert.match(code.items(task.id).at(-1).text, /gh auth login/);
    code.ghCache = null;
    write({ authed: true });
    assert.equal(await code.followPr(task.id, "colmena/x"), true);
    assert.equal(code.mustTask(task.id).pr.watching, true);

    const since = new Date(Date.now() + 1000).toISOString();
    const pr = { number: 7, url: "https://github.com/a/b/pull/7", state: "OPEN", mergeable: "MERGEABLE", headRefOid: "abc", comments: [], reviews: [],
      statusCheckRollup: [{ name: "test", conclusion: "FAILURE", detailsUrl: "https://github.com/a/b/actions/runs/99/job/1" }, { name: "lint", conclusion: "SUCCESS" }] };
    write({ authed: true, pr, logs: { 99: "FAIL tests/cart.test.js\nexpected 2 got 3" } });
    await code.checkPrs();
    await idle(code, task.id, 1);
    const woke = code.items(task.id).find((i) => i.kind === "notice" && i.goal);
    assert.match(woke.text, /^Bruno se pone con la PR #7: Falla el CI/);
    woke.text = woke.detail;
    assert.match(woke.text, /Falla el CI de la PR #7: test\./);
    assert.match(woke.text, /expected 2 got 3/);
    assert.match(woke.text, /subir sigue necesitando el OK/);
    assert.equal(code.mustTask(task.id).pr.checks, "failing");
    assert.ok(notices.some((n) => n.kind === "needs" && /Falla el CI/.test(n.text)));

    await code.checkPrs(); // the same failure: nothing new
    assert.equal(code.items(task.id).filter((i) => i.kind === "notice" && i.goal).length, 1);

    write({ authed: true, pr: { ...pr, mergeable: "CONFLICTING", comments: [{ id: "c1", author: { login: "ana" }, body: "Cambia el texto del botón", createdAt: since }] }, logs: {} });
    code.mustTask(task.id);
    await code.checkPrs();
    await idle(code, task.id, 2);
    const second = { text: code.items(task.id).filter((i) => i.kind === "notice" && i.goal)[1].detail };
    assert.match(second.text, /tiene conflictos con main/);
    assert.match(second.text, /ana: Cambia el texto del botón/);

    write({ authed: true, pr: { ...pr, state: "MERGED", statusCheckRollup: [] } });
    await code.checkPrs();
    assert.equal(code.mustTask(task.id).pr.watching, false);
    assert.match(code.items(task.id).at(-1).text, /La PR #7 se ha fusionado/);
  } finally { await done(); rmSync(dir, { recursive: true, force: true }); delete process.env.GH_FAKE_STATE; }
});

test("side by side: deleted lines on the left, added on the right, paired in order", () => {
  const rows = parsePatch("diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,4 +1,4 @@\n uno\n-dos\n-tres\n+DOS\n cuatro\n");
  const pairs = sideBySide(rows);
  assert.deepEqual(pairs.map((p) => p.type === "hunk" ? "hunk" : [p.left?.text ?? null, p.right?.text ?? null]), ["hunk", ["uno", "uno"], ["dos", "DOS"], ["tres", null], ["cuatro", "cuatro"]]);
});
