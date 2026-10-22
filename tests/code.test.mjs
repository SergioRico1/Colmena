// «Código»: red lines and access (policy.mjs), restore points and diffs (git.mjs), and a task
// end to end with a fake Claude Code (service.mjs): worktree, turn, changes, red line,
// question, restore, edit from here, saving to the base branch and deleting.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyShell, decide, splitCommands, inside } from "../server/code/policy.mjs";
import { Snapshots, parseNumstat, parseNameStatus, splitPatch } from "../server/code/git.mjs";
import { parseNetstat } from "../server/code/ports.mjs";
import { CodeService, toolLine } from "../server/code/service.mjs";
import { Store } from "../server/store.mjs";
import { parsePatch, buildRows } from "../src/components/v2/code/model.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url));
const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-code-" + name + "-"));
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); }
  throw Error("timeout");
};

test("shell commands: red lines for publishing, sending, outside deletes and the system", () => {
  const cwd = path.resolve("C:/p/tienda");
  const red = (cmd) => classifyShell(cmd, { cwd });
  assert.equal(red("git push origin main").rule, "git-push");
  assert.equal(red("git push origin main").durable, true);
  assert.equal(red("npm test && git push").rule, "git-push");
  assert.equal(red("git status && git diff").redLine, false);
  assert.equal(red("npm install react").redLine, false);
  assert.equal(red("npm i -g typescript").rule, "global-install");
  assert.equal(red("npm publish").rule, "publish");
  assert.equal(red("gh pr create --fill").rule, "publish");
  assert.equal(red("gh pr view 3").redLine, false);
  assert.equal(red("vercel --prod").rule, "publish");
  assert.equal(red("curl -X POST https://api.example.com -d x=1").rule, "send");
  assert.equal(red("curl https://example.com").redLine, false);
  assert.equal(red("rm -rf node_modules dist").redLine, false);
  assert.equal(red("rm -rf ../otra").rule, "delete-outside");
  assert.equal(red("rm -rf /c/Users/persona/Documents").rule, "delete-outside");
  assert.equal(red("Remove-Item -Recurse C:\\Windows\\Temp").rule, "delete-outside");
  assert.equal(red("rd /s /q build").redLine, false);
  assert.equal(red("taskkill /IM node.exe /F").rule, "kill");
  assert.equal(red("taskkill /PID 1234 /F").redLine, false);
  assert.equal(red("winget install git").rule, "system");
  assert.equal(red("echo hola > ../fuera.txt").rule, "write-outside");
  assert.equal(red("echo hola > dentro.txt 2>/dev/null").redLine, false);
  assert.equal(red("ssh server ls").rule, "remote");
  assert.equal(red('echo "git push" && ls').redLine, false, "quoted text is not a command");
  assert.deepEqual(splitCommands("a b; c | d && e"), [["a", "b"], ["c"], ["d"], ["e"]]);
  assert.ok(inside("C:/p", "c:\\P\\x\\y.js"));
  assert.ok(!inside("C:/p", "C:/pp/x"));
});

test("access: free inside the project, asked when chosen, red lines always", () => {
  const cwd = path.resolve("C:/p/tienda");
  const at = (f) => path.join(cwd, f);
  assert.equal(decide({ tool: "Read", input: { file_path: "C:/Windows/x" }, cwd }).decision, "allow");
  assert.equal(decide({ tool: "Edit", input: { file_path: at("a.js") }, cwd }).decision, "allow");
  assert.equal(decide({ tool: "Write", input: { file_path: "C:/otra/a.js" }, cwd }).decision, "redline");
  assert.equal(decide({ tool: "Write", input: { file_path: "C:/otra/a.js" }, cwd, access: "full" }).decision, "allow");
  assert.equal(decide({ tool: "Edit", input: { file_path: at("a.js") }, cwd, access: "ask" }).decision, "ask");
  assert.equal(decide({ tool: "Bash", input: { command: "npm test" }, cwd, access: "ask" }).decision, "ask");
  assert.equal(decide({ tool: "Bash", input: { command: "rm -rf ../x" }, cwd, access: "full" }).decision, "redline");
  assert.equal(decide({ tool: "Bash", input: { command: "git push" }, cwd }).decision, "redline");
  assert.equal(decide({ tool: "Bash", input: { command: "git push" }, cwd, allowed: ["git-push"] }).decision, "allow");
  assert.equal(decide({ tool: "Bash", input: { command: "rm -rf ../x" }, cwd, allowed: ["delete-outside"] }).decision, "redline", "never a standing rule");
});

test("diff parsing and plain tool lines", () => {
  assert.deepEqual(parseNumstat("3\t1\ta.js\0-\t-\timg.png\0" + "2\t0\t\0old.js\0new.js\0").map((f) => [f.path, f.add, f.del, f.binary, f.from]),
    [["a.js", 3, 1, false, null], ["img.png", 0, 0, true, null], ["new.js", 2, 0, false, "old.js"]]);
  assert.deepEqual([...parseNameStatus("M\0a.js\0R100\0old.js\0new.js\0A\0b.js\0")], [["a.js", "M"], ["new.js", "R"], ["b.js", "A"]]);
  const patch = "diff --git a/a.js b/a.js\nindex 1..2 100644\n--- a/a.js\n+++ b/a.js\n@@ -1,2 +1,3 @@ fn\n uno\n-dos\n+DOS\n+tres\n";
  assert.equal(splitPatch(patch).get("a.js"), patch);
  const rows = parsePatch(patch);
  assert.deepEqual(rows.map((r) => [r.type, r.a, r.b, r.text]), [["hunk", null, null, "fn"], ["ctx", 1, 1, "uno"], ["del", 2, null, "dos"], ["add", null, 2, "DOS"], ["add", null, 3, "tres"]]);
  assert.equal(toolLine("Edit", { file_path: "C:/p/src/App.jsx" }).text, "Editó App.jsx");
  assert.equal(toolLine("Bash", { command: "npm test", description: "Pasar los tests" }).text, "Pasar los tests");
  const rowsTl = buildRows([
    { id: "1", kind: "user" }, { id: "2", kind: "tool", verb: "read" }, { id: "3", kind: "tool", verb: "read" }, { id: "4", kind: "tool", verb: "edit" }, { id: "5", kind: "text" },
  ]);
  assert.deepEqual(rowsTl.map((r) => r.kind), ["user", "log", "text"]);
  assert.equal(rowsTl[1].entries.length, 2);
  assert.equal(rowsTl[1].entries[0].items.length, 2);
  assert.deepEqual(parseNetstat("  TCP    127.0.0.1:5173   0.0.0.0:0   LISTENING   4242\r\n  TCP    10.0.0.2:80   0.0.0.0:0   LISTENING   9\r\n  TCP    [::1]:3000   [::]:0   LISTENING   77"), [{ port: 5173, pid: 4242 }, { port: 3000, pid: 77 }]);
});

test("restore points: what a turn changed, and putting the folder back", { skip: !hasGit }, async () => {
  const dir = tmp("snap");
  const root = path.join(dir, "work");
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(path.join(root, "a.txt"), "uno\n");
  const snaps = new Snapshots({ key: "t", dir: path.join(dir, "store"), root });
  const a = await snaps.capture("a");
  writeFileSync(path.join(root, "a.txt"), "uno\ndos\n");
  writeFileSync(path.join(root, "b.txt"), "nuevo\n");
  const b = await snaps.capture("b");
  const diff = await snaps.diff(a, b);
  assert.deepEqual(diff.files.map((f) => [f.path, f.status, f.add, f.del]), [["a.txt", "M", 1, 0], ["b.txt", "A", 1, 0]]);
  assert.match(diff.files[0].patch, /\+dos/);
  const r = await snaps.restore(a);
  assert.equal(r.removed, 1);
  assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "uno\n");
  assert.ok(!existsSync(path.join(root, "b.txt")));
  assert.ok(existsSync(path.join(root, ".git")), "the person's own .git is untouched");
  rmSync(dir, { recursive: true, force: true });
});

test("a task end to end with a fake Claude Code", { skip: !hasGit, timeout: 120000 }, async () => {
  const dir = tmp("svc");
  const repo = path.join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: repo });
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: [process.execPath, FAKE] });
  try {
    const project = await code.addProject({ folder: repo });
    assert.equal(project.repo, true);
    assert.equal(project.base, "main");
    const view = await code.createTask({ projectId: project.id, text: "escribe una nota", model: "claude-haiku-5-5" });
    assert.ok(view.isolated);
    assert.match(view.branch, /^colmena\//);
    assert.notEqual(path.resolve(view.cwd), path.resolve(repo), "works in its own copy");
    await until(() => code.mustTask(view.id).turns?.length === 1 && !code.engines.get(view.id)?.turn);
    let items = code.items(view.id);
    assert.deepEqual(items.map((i) => i.kind), ["user", "tool", "text", "turn"]);
    assert.equal(items[1].status, "done");
    assert.equal(items[1].text, "Escribió nota.txt");
    assert.equal(items[3].files[0].path, "nota.txt");
    assert.ok(existsSync(path.join(view.cwd, "nota.txt")));
    assert.ok(!existsSync(path.join(repo, "nota.txt")), "the project folder is untouched");
    assert.equal(code.mustTask(view.id).usage.used, 2000);
    const diff = await code.diff(view.id, { turn: 1 });
    assert.equal(diff.files[0].path, "nota.txt");

    // A red line waits for the person; «Ahora no» denies it.
    await code.send(view.id, { text: "haz push" });
    const askItem = await until(() => code.items(view.id).find((i) => i.kind === "ask" && i.status === "pending"));
    assert.equal(askItem.ask, "redline");
    assert.equal(askItem.rule, "git-push");
    assert.equal(code.mustTask(view.id).status, "waiting");
    code.answer(view.id, askItem.id, { decision: "deny" });
    await until(() => code.mustTask(view.id).turns.length === 2 && !code.engines.get(view.id)?.turn);
    items = code.items(view.id);
    assert.equal(items.find((i) => i.kind === "tool" && i.tool === "Bash").status, "denied");
    assert.equal(items.at(-1).text, "No lo he subido.");

    // «Siempre en este proyecto» keeps the rule for the next time.
    await code.send(view.id, { text: "push otra vez" });
    const again = await until(() => code.items(view.id).find((i) => i.kind === "ask" && i.status === "pending"));
    code.answer(view.id, again.id, { decision: "always" });
    await until(() => code.mustTask(view.id).turns.length === 3 && !code.engines.get(view.id)?.turn);
    assert.deepEqual(store.get("codeProjects", project.id).allow, ["git-push"]);
    await code.send(view.id, { text: "push y ya" });
    await until(() => code.mustTask(view.id).turns.length === 4 && !code.engines.get(view.id)?.turn);
    assert.equal(code.items(view.id).filter((i) => i.kind === "ask").length, 2, "no new question");

    // A question with options.
    await code.send(view.id, { text: "pregunta algo" });
    const q = await until(() => code.items(view.id).find((i) => i.kind === "ask" && i.ask === "question" && i.status === "pending"));
    code.answer(view.id, q.id, { answers: { "¿Qué color?": "Azul" } });
    await until(() => code.mustTask(view.id).turns.length === 5 && !code.engines.get(view.id)?.turn);
    assert.equal(code.items(view.id).at(-1).text, "Elegiste Azul.");

    // «Volver aquí» at the start, then «Deshacer».
    await code.restore(view.id, { turn: 0 });
    assert.ok(!existsSync(path.join(view.cwd, "nota.txt")));
    const notice = code.items(view.id).at(-1);
    await code.restore(view.id, { undo: notice.undo });
    assert.ok(existsSync(path.join(view.cwd, "nota.txt")));

    // «Editar desde aquí» on the second message: files back to before it, later items gone.
    const second = code.items(view.id).filter((i) => i.kind === "user")[1];
    const edited = await code.editFrom(view.id, { item: second.id });
    assert.equal(edited.text, "haz push");
    assert.equal(code.mustTask(view.id).turns.length, 1);
    assert.equal(code.items(view.id).at(-1).kind, "turn");
    assert.equal(code.mustTask(view.id).session.forkAt, "a-3");

    // «Guardar en main»: commit in the copy (message from the engine), merge in the folder.
    await code.merge(view.id);
    assert.ok(existsSync(path.join(repo, "nota.txt")));
    assert.match(execFileSync("git", ["log", "--format=%s", "-3"], { cwd: repo }).toString(), /feat: add a note/);
    // Saved into main, the copy is cleaned up (its branch merged); a hidden ref keeps it.
    assert.ok(!existsSync(view.cwd));
    assert.ok(code.mustTask(view.id).saved?.until);

    const removed = await code.deleteTask(view.id);
    assert.equal(removed.branchKept, false);
    assert.ok(!existsSync(view.cwd));
    assert.equal(code.items(view.id).length, 0);
  } finally {
    code.shutdown();
    store.close();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
