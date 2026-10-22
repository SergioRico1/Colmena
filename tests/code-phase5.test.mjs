// «Código», block B of the T3 Code / OpenClaw round: comments on diff lines, the review before
// saving, «Ponerse al día» with the base (Bruno resolves conflicts in his copy, then saving is
// clean) and Bruno's own look at the preview (Colmena's desktop browser, preview-cli.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync, execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService, PREVIEW_CLI } from "../server/code/service.mjs";
import { parsePatch, diffContext, findingContext, findingsText } from "../src/components/v2/code/model.js";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-code5-" + name + "-"));
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
  writeFileSync(path.join(repo, "README.md"), "# demo\nuno\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-qm", "init");
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: null, opencodeCommand: null, ...extra });
  const done = async () => { code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { dir, repo, store, code, done };
}
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));

test("picked diff lines and review findings become chips and messages", () => {
  const rows = parsePatch("diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -10,3 +10,4 @@ function f() {\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n return a;\n");
  const c = diffContext("src/a.js", rows, 2, 4, "¿Por qué 3?");
  assert.deepEqual([c.kind, c.label, c.file, c.lines], ["diff", "a.js:11-12", "src/a.js", [11, 12]]);
  assert.equal(c.text, "-const b = 2;\n+const b = 3;\n+const c = 4;");
  assert.equal(diffContext("src/a.js", rows, 1, 1, "x").label, "a.js:10");
  const f = { severity: "P1", title: "La nota se pisa", file: "nota.txt", line: 3, detail: "Se pierde." };
  assert.deepEqual(findingContext(f), { kind: "diff", label: "P1 · La nota se pisa", file: "nota.txt", lines: [3, 3], note: "La nota se pisa. Se pierde.", text: "" });
  assert.match(findingsText([f]), /- \[P1\] La nota se pisa \(nota\.txt:3\): Se pierde\./);
});

test("the review before saving: findings P0–P3, and P0–P1 stop «Guardar en main» in the screen", async () => {
  const { code, repo, done } = setup("review");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "escribe la nota" });
    await idle(code, task.id, 1);
    const r = await code.review(task.id);
    assert.equal(r.serious, 1);
    assert.deepEqual(r.findings.map((f) => f.severity), ["P1", "P3"], "most severe first");
    const item = code.items(task.id).at(-1);
    assert.equal(item.kind, "review");
    assert.equal(item.files, 1);
    assert.deepEqual(code.mustTask(task.id).review, { ...code.mustTask(task.id).review, turns: 1, serious: 1, total: 2 });
    const empty = await code.createTask({ projectId: project.id, text: "" });
    await assert.rejects(code.review(empty.id), /No hay cambios que revisar/);
  } finally { await done(); }
});

test("«Ponerse al día»: the base comes into the copy; conflicts are Bruno's, then saving is clean", async () => {
  const { code, repo, done } = setup("catchup");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "escribe la nota" });
    await idle(code, task.id, 1);
    const cwd = code.mustTask(task.id).cwd;
    assert.deepEqual(await code.catchUp(task.id), { upToDate: true });

    // main moves on without touching the same lines: brought in, no conflict.
    writeFileSync(path.join(repo, "otro.txt"), "de main\n");
    g(repo, "add", "-A"); g(repo, "commit", "-qm", "main: otro");
    const up = await code.catchUp(task.id);
    assert.equal(up.merged, true);
    assert.ok(existsSync(path.join(cwd, "otro.txt")));

    // main and the copy change the same line: Bruno resolves it in his copy.
    writeFileSync(path.join(cwd, "README.md"), "# demo\ndos (tarea)\n");
    writeFileSync(path.join(repo, "README.md"), "# demo\ntres (main)\n");
    g(repo, "add", "-A"); g(repo, "commit", "-qm", "main: readme");
    const r = await code.merge(task.id);
    assert.deepEqual(r, { resolving: true, files: ["README.md"] });
    assert.ok(code.mustTask(task.id).merging);
    await assert.rejects(code.merge(task.id), /resolviendo los conflictos/);
    await until(() => !code.mustTask(task.id).merging && !code.engines.get(task.id)?.turn, 20000);
    const readme = readFileSync(path.join(cwd, "README.md"), "utf8");
    assert.ok(readme.includes("dos (tarea)") && readme.includes("tres (main)") && !readme.includes("<<<<<<<"));
    assert.ok(code.items(task.id).some((i) => i.kind === "notice" && /Conflictos resueltos/.test(i.text)));
    await code.merge(task.id);
    const merged = readFileSync(path.join(repo, "README.md"), "utf8");
    assert.ok(merged.includes("dos (tarea)") && merged.includes("tres (main)"));
    assert.ok(existsSync(path.join(repo, "nota.txt")));
  } finally { await done(); }
});

test("Bruno's look at the preview: errors, elements, a capture, and a line after each change", async () => {
  const calls = [];
  const computer = {
    available: true,
    call: async (op, args) => {
      calls.push([op, args]);
      if (op === "preview") return { url: args.url, title: "Tienda", console: [{ level: "error", text: "TypeError: x is undefined", url: args.url + "app.js" }, { level: "warning", text: "Deprecated" }], text: "Pagar pedido", jpegBase64: Buffer.from("jpg").toString("base64") };
      if (op === "snapshot") return { text: "[e1] botón «Pagar con Bizum»" };
      if (op === "act") return { url: "http://127.0.0.1:5555/ok", title: "Pagado", console: [] };
      if (op === "screenshot") return { url: "http://127.0.0.1:5555/ok", jpegBase64: Buffer.from("jpg2").toString("base64") };
      throw Error("op " + op);
    },
  };
  const { code, repo, done } = setup("preview", { computer });
  try {
    code.apiBase = "http://127.0.0.1:1/api";
    code.ports = async () => [{ port: 5555, url: "http://127.0.0.1:5555/" }];
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    assert.match(code.instructions(code.mustTask(task.id)), /preview-cli\.mjs" ver/);
    const r = await code.previewCheck(task.id, { path: "checkout" });
    assert.equal(calls[0][0], "preview");
    assert.equal(calls[0][1].url, "http://127.0.0.1:5555/checkout");
    assert.equal(calls[0][1].missionId, "code:" + task.id);
    assert.deepEqual(r.errors, ["TypeError: x is undefined (http://127.0.0.1:5555/checkoutapp.js)"]);
    assert.equal(r.elements, "[e1] botón «Pagar con Bizum»");
    assert.equal(readFileSync(r.screenshot, "utf8"), "jpg");
    assert.equal(code.mustTask(task.id).previewCheck.errors, 1);
    const a = await code.previewAct(task.id, { kind: "click", ref: "e1" });
    assert.equal(a.title, "Pagado");
    assert.deepEqual(calls.filter(([op]) => op === "act")[0][1], { missionId: "code:" + task.id, botId: "bruno", kind: "click", ref: "e1", text: "" });
    assert.equal(code.mustTask(task.id).previewCheck.errors, 0);

    // A turn that changed files ends with Bruno looking at the page.
    await code.send(task.id, { text: "escribe la nota" });
    await idle(code, task.id, 1);
    const line = await until(() => code.items(task.id).find((i) => i.kind === "tool" && i.tool === "Preview" && i.status !== "running"));
    assert.match(line.text, /Revisó la vista previa en 127\.0\.0\.1:5555 · 1 error/);
    assert.equal(line.status, "error");

    // Without the desktop app, it says so.
    code.computer = { available: false };
    await assert.rejects(code.previewCheck(task.id), /Colmena de escritorio/);
  } finally { await done(); }
});

test("preview-cli.mjs asks Colmena for the task and prints what Bruno needs", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      seen.push([req.method, req.url, req.headers["x-colmena-token"], body]);
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/bootstrap") return res.end(JSON.stringify({ csrf: "tok" }));
      res.end(JSON.stringify({ url: "http://127.0.0.1:5555/", title: "Tienda", errors: ["TypeError: x"], warnings: [], elements: "[e1] botón", text: "Hola", screenshot: "C:/x.jpg" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const env = { ...process.env, COLMENA_CODE_API: "http://127.0.0.1:" + server.address().port + "/api", COLMENA_CODE_TASK: "ct-1" };
    const out = await new Promise((resolve, reject) => execFile(process.execPath, [PREVIEW_CLI, "pulsa", "e1"], { env }, (e, stdout) => (e ? reject(e) : resolve(stdout))));
    assert.deepEqual(seen[1].slice(0, 3), ["POST", "/api/code/tasks/ct-1/preview/act", "tok"]);
    assert.deepEqual(JSON.parse(seen[1][3]), { kind: "click", ref: "e1" });
    assert.match(out, /Errores en la consola \(1\):\n {2}- TypeError: x/);
    assert.match(out, /Captura \(léela como imagen\): C:\/x\.jpg/);
    const bare = await new Promise((resolve) => execFile(process.execPath, [PREVIEW_CLI, "ver"], { env: { ...process.env, COLMENA_CODE_API: "", COLMENA_CODE_TASK: "" } }, (e, _o, stderr) => resolve([e?.code, stderr])));
    assert.equal(bare[0], 2);
  } finally { server.close(); }
});

test("a preview note keeps its capture only if Colmena saved it", async () => {
  const { code, repo, done } = setup("note");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    const { saveAttachment } = await import("../server/code/context.mjs");
    const shot = await saveAttachment(code.directory, { name: "vista.png", data: Buffer.from("png").toString("base64") });
    await code.send(task.id, { text: "mira", contexts: [
      { kind: "preview", label: "Vista previa · botón", note: "Más grande", text: "Zona marcada", image: shot.path, url: "http://127.0.0.1:5555/" },
      { kind: "preview", label: "Otra", note: "x", image: "C:/Windows/win.ini" },
    ] });
    await idle(code, task.id, 1);
    const user = code.items(task.id).find((i) => i.kind === "user");
    assert.equal(user.contexts[0].image, shot.path);
    assert.equal(user.contexts[1].image, undefined);
  } finally { await done(); }
});
