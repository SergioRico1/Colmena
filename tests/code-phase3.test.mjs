// «Código», phase 3: the composer's extras (`/` `$` `@`, attachments), compacting, several
// engines at once, the project's scripts file, remappable shortcuts and OpenCode as engine.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService, KEYBINDINGS } from "../server/code/service.mjs";
import { fuzzyFiles, frontmatter, listSkills, expandSkills, saveAttachment } from "../server/code/context.mjs";
import { projectScripts, saveScript } from "../server/code/terminal.mjs";
import { toolFromOpenCode, permissionToTool } from "../server/code/opencode.mjs";
import { triggerAt } from "../src/components/v2/code/model.js";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const OPENCODE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-opencode.mjs", import.meta.url))];
const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-code3-" + name + "-"));
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
  g(repo, "add", "-A");
  g(repo, "commit", "-qm", "init");
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: null, opencodeCommand: OPENCODE, ...extra });
  const done = async () => { code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { dir, repo, store, code, done };
}
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));

test("composer triggers, fuzzy files and skills", async () => {
  assert.deepEqual(triggerAt("/pla", 4), { kind: "/", query: "pla", start: 0, end: 4 });
  assert.equal(triggerAt("hola /pla", 9), null, "«/» only starts a message");
  assert.deepEqual(triggerAt("mira @src/Ap", 12), { kind: "@", query: "src/Ap", start: 5, end: 12 });
  assert.deepEqual(triggerAt("usa $rev", 8), { kind: "$", query: "rev", start: 4, end: 8 });
  assert.equal(triggerAt("correo@dominio", 14), null);
  const files = ["src/App.jsx", "src/lib/api.js", "README.md", "src/components/AppBar.jsx"];
  assert.deepEqual(fuzzyFiles(files, "app"), ["src/App.jsx", "src/components/AppBar.jsx"]);
  assert.deepEqual(fuzzyFiles(files, "sla"), ["src/lib/api.js"]);
  assert.deepEqual(frontmatter("---\nname: revisar\ndescription: \"Revisa el código\"\n---\n# x"), { name: "revisar", description: "Revisa el código" });

  const dir = tmp("skills");
  const home = path.join(dir, "home");
  for (const [root, name, body] of [[path.join(dir, ".claude", "skills"), "revisar", "Revisa con lupa."], [path.join(home, ".claude", "skills"), "revisar", "La de casa."], [path.join(home, ".codex", "skills"), "tests", "Escribe tests."]]) {
    mkdirSync(path.join(root, name), { recursive: true });
    writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n${body}\n`);
  }
  const skills = await listSkills(dir, { home });
  assert.deepEqual(skills.map((s) => [s.name, s.source, s.description]), [["revisar", "proyecto", "Revisa con lupa."], ["tests", "Codex", "Escribe tests."]]);
  const out = await expandSkills("arregla esto $revisar y $nada", dir, { home });
  assert.deepEqual(out.used, ["revisar"]);
  assert.match(out.text, /^arregla esto \$revisar y \$nada\n\nSigue estas habilidades[\s\S]*<habilidad nombre="revisar"[\s\S]*Revisa con lupa\./);
  assert.equal((await expandSkills("sin habilidades", dir, { home })).text, "sin habilidades");

  const saved = await saveAttachment(dir, { name: "../captura.png", data: Buffer.from("png").toString("base64") });
  assert.equal(saved.name, "captura.png");
  assert.ok(saved.image);
  assert.ok(saved.path.startsWith(path.join(dir, "code", "attachments")));
  await assert.rejects(saveAttachment(dir, { name: "x", data: "" }), /vacío/);
  rmSync(dir, { recursive: true, force: true });
});

test("project scripts: colmena.json, t3.json and package.json", async () => {
  const dir = tmp("scripts");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { dev: "vite", test: "vitest" } }));
  writeFileSync(path.join(dir, "t3.json"), JSON.stringify({ scripts: [{ name: "Instalar", command: "npm ci", runOnWorktreeCreate: true }] }));
  await saveScript(dir, { name: "dev", command: "npm run dev -- --port 5300" });
  const list = projectScripts(dir);
  assert.deepEqual(list.map((s) => [s.name, s.command, s.onCreate, s.source]), [
    ["dev", "npm run dev -- --port 5300", false, "colmena.json"],
    ["Instalar", "npm ci", true, "t3.json"],
    ["test", "npm run test", false, "package.json"],
  ]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "colmena.json"), "utf8")).scripts, [{ name: "dev", command: "npm run dev -- --port 5300" }]);
  rmSync(dir, { recursive: true, force: true });
});

test("shortcuts: defaults, a change, freeing a key and going back", async () => {
  const dir = tmp("keys");
  const store = new Store(dir);
  const code = new CodeService({ store, directory: dir, codexCommand: null, opencodeCommand: null });
  try {
    assert.equal(code.keybindings().bindings.togglePanel, KEYBINDINGS.togglePanel);
    const next = code.setKeybindings({ togglePanel: "mod+shift+k", stop: "", nonsense: "mod+q" });
    assert.equal(next.bindings.togglePanel, "mod+shift+k");
    assert.equal(next.bindings.stop, "");
    assert.ok(!("nonsense" in next.bindings));
    assert.equal(code.setKeybindings({}).bindings.togglePanel, KEYBINDINGS.togglePanel);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("attachments, $skills and «Compactar» reach the engine", { skip: !hasGit, timeout: 60000 }, async () => {
  const { repo, dir, code, done } = setup("compose");
  try {
    mkdirSync(path.join(repo, ".claude", "skills", "breve"), { recursive: true });
    writeFileSync(path.join(repo, ".claude", "skills", "breve", "SKILL.md"), "---\nname: breve\n---\nResponde en una línea.\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "skill");
    const project = await code.addProject({ folder: repo });
    const file = await saveAttachment(code.directory, { name: "nota.txt", data: Buffer.from("hola").toString("base64") });
    const outside = path.join(dir, "secreto.txt");
    writeFileSync(outside, "no");
    const view = await code.createTask({ projectId: project.id, text: "mira esto $breve", attachments: [file, { path: outside }], model: "claude-haiku-5-5" });
    await idle(code, view.id, 1);
    const user = code.items(view.id).find((i) => i.kind === "user");
    assert.equal(user.text, "mira esto $breve", "the timeline keeps your words");
    assert.deepEqual(user.attachments.map((a) => a.name), ["nota.txt"], "only files Colmena saved");
    const sent = await code.prepare(code.mustTask(view.id), "mira esto $breve", code.checkAttachments([file]));
    assert.match(sent, /<habilidad nombre="breve"/);
    assert.ok(sent.includes(file.path));

    await code.compact(view.id);
    await idle(code, view.id, 2);
    const items = code.items(view.id);
    assert.ok(items.some((i) => i.kind === "notice" && i.compact));
    await assert.rejects(code.compact("ct-nope"), /no encontrada/i);
  } finally {
    await done();
  }
});

test("several engines at once: one task each, labelled", { skip: !hasGit, timeout: 60000 }, async () => {
  const { repo, code, done } = setup("fanout");
  try {
    const project = await code.addProject({ folder: repo });
    const a = await code.createTask({ projectId: project.id, text: "di hola", engine: "claude-code", model: "claude-haiku-5-5", label: "Claude Code · Haiku 5.5" });
    const b = await code.createTask({ projectId: project.id, text: "di hola", engine: "opencode", model: "opencode/deepseek-v4.1-flash-free", label: "OpenCode · DeepSeek" });
    assert.equal(a.title, "di hola · Claude Code · Haiku 5.5");
    assert.equal(b.title, "di hola · OpenCode · DeepSeek");
    assert.notEqual(a.branch, b.branch);
    await idle(code, a.id, 1);
    await idle(code, b.id, 1);
    assert.equal(code.items(b.id).at(-1).text, "Vale.");
  } finally {
    await done();
  }
});

test("OpenCode as engine: tools, permissions, red lines and plan agent", { skip: !hasGit, timeout: 90000 }, async () => {
  assert.deepEqual(toolFromOpenCode("bash", { command: "npm test", description: "Probar" }), { name: "Bash", input: { command: "npm test", description: "Probar" } });
  assert.equal(toolFromOpenCode("write", { filePath: "C:/p/a.js" }).input.file_path, "C:/p/a.js");
  assert.deepEqual(permissionToTool({ permission: "edit", patterns: ["a.js"], metadata: { filepath: "C:/p/a.js" } }), { tool: "Edit", input: { file_path: "C:/p/a.js" } });
  assert.equal(permissionToTool({ permission: "external_directory", patterns: ["C:/x"], metadata: {} }).tool, "Permissions");
  const { repo, code, done } = setup("opencode", { goKey: async () => "sk-test-not-real" });
  try {
    const cat = await code.catalog();
    const oc = cat.find((e) => e.id === "opencode");
    assert.ok(oc.available);
    assert.equal(oc.models.find((m) => m.isDefault).id, "opencode-go/deepseek-v4.1-flash", "with a Go key, Go first");
    const project = await code.addProject({ folder: repo });
    const view = await code.createTask({ projectId: project.id, engine: "opencode", text: "escribe una nota" });
    assert.equal(view.model, "opencode-go/deepseek-v4.1-flash");
    await idle(code, view.id, 1);
    let items = code.items(view.id);
    assert.deepEqual(items.map((i) => i.kind), ["user", "tool", "text", "turn"]);
    assert.equal(items[1].text, "Escribió nota.txt");
    assert.ok(existsSync(path.join(view.cwd, "nota.txt")));
    assert.equal(code.mustTask(view.id).usage.used, 1000);
    assert.match(code.mustTask(view.id).session.id, /^ses_/);

    await code.send(view.id, { text: "haz push" });
    const ask = await until(() => code.items(view.id).find((i) => i.kind === "ask" && i.status === "pending"));
    assert.equal(ask.rule, "git-push");
    code.answer(view.id, ask.id, { decision: "deny" });
    await idle(code, view.id, 2);
    assert.equal(code.items(view.id).at(-1).text, "No lo he subido.");

    await code.send(view.id, { text: "un plan", mode: "plan" });
    await idle(code, view.id, 3);
    items = code.items(view.id);
    assert.equal(items.at(-1).text, "Plan: 1. escribir la nota.");
  } finally {
    await done();
  }
});
