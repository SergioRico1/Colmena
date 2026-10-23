// «Código»: archiving and snoozing tasks (T3 Code settle / snooze) and removing a task's copy
// without following NTFS junctions (T3 Code worktreeRemoval: Git for Windows before 2.54
// deletes what a junction inside the worktree points to).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService, ARCHIVE_DEFAULTS } from "../server/code/service.mjs";
import { removeLinkedWorktree, removeWorktree } from "../server/code/git.mjs";
import { projectScripts } from "../server/code/terminal.mjs";
import { snoozePresets, groupOf } from "../src/components/v2/code/model.js";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-code7-" + name + "-"));
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
  const notices = [];
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: null, opencodeCommand: null, notifier: { notify: (n) => notices.push(n) }, ...extra });
  const done = async () => { code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { dir, repo, store, code, notices, done };
}
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));

test("removing a copy never deletes what a junction inside it points to", { skip: process.platform !== "win32" && "junctions are Windows only" }, async () => {
  const dir = tmp("junction");
  try {
    const repo = path.join(dir, "repo"), wt = path.join(dir, "wt"), shared = path.join(dir, "shared-node_modules");
    mkdirSync(repo); mkdirSync(path.join(shared, "left-pad"), { recursive: true });
    writeFileSync(path.join(shared, "left-pad", "index.js"), "module.exports = 1;\n");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    writeFileSync(path.join(repo, "a.txt"), "a");
    g(repo, "add", "-A"); g(repo, "commit", "-qm", "init");
    g(repo, "worktree", "add", "-q", "-b", "task", wt);
    symlinkSync(shared, path.join(wt, "node_modules"), "junction");
    writeFileSync(path.join(wt, "suelto.txt"), "untracked\n");
    const r = await removeWorktree({ repo, dir: wt, branch: "task", base: "main" });
    assert.ok(!existsSync(wt), "the copy is gone");
    assert.ok(existsSync(path.join(shared, "left-pad", "index.js")), "what the junction pointed to is still there");
    assert.equal(g(repo, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1, "Git forgot the copy");
    assert.equal(r.branchKept, false);

    // Not a copy of this repository: refused, nothing deleted.
    const other = path.join(dir, "other");
    execFileSync("git", ["init", "-q", "-b", "main", other]);
    writeFileSync(path.join(other, "b.txt"), "b");
    g(other, "add", "-A"); g(other, "commit", "-qm", "init");
    const wt2 = path.join(dir, "wt2");
    g(other, "worktree", "add", "-q", "-b", "x", wt2);
    await assert.rejects(removeLinkedWorktree({ repo, dir: wt2 }), /no es una copia de este proyecto/);
    assert.ok(existsSync(path.join(wt2, "b.txt")));
    // A locked copy is refused too.
    g(other, "worktree", "lock", wt2);
    await assert.rejects(removeLinkedWorktree({ repo: other, dir: wt2 }), /bloqueada/);
    assert.ok(existsSync(path.join(wt2, "b.txt")));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test("snooze presets: later today, tomorrow, next week", () => {
  const morning = new Date(2026, 9, 23, 10, 0); // Friday 10:00
  const p = snoozePresets(morning);
  assert.deepEqual(p.map((x) => x.id), ["hoy", "manana", "semana"]);
  assert.equal(new Date(p[0].until).getHours(), 18);
  assert.equal(new Date(p[1].until).getDate(), 24);
  assert.equal(new Date(p[1].until).getHours(), 9);
  assert.equal(new Date(p[2].until).getDay(), 1, "next Monday");
  const evening = snoozePresets(new Date(2026, 9, 23, 17, 30));
  assert.equal(new Date(evening[0].until).getHours(), 20, "late in the day: in three hours");
  const sunday = snoozePresets(new Date(2026, 9, 25, 10, 0));
  assert.deepEqual(sunday.map((x) => x.id), ["hoy", "manana"], "tomorrow is already Monday");
  assert.equal(groupOf({ archived: { at: "x" }, status: "idle" }), "archived");
  assert.equal(groupOf({ snoozed: { until: "x" }, status: "working" }), "snoozed");
  assert.equal(groupOf({ pinned: true, status: "idle", turns: 1 }), "pinned");
});

test("archive by hand runs the closing scripts in the copy; writing again brings it back", async () => {
  const colmena = JSON.stringify({ scripts: [{ name: "limpiar", command: "npm run clean", onSettle: true }, { name: "t3", command: "x", runOnSettle: true }, { name: "dev", command: "npm run dev" }] });
  const { code, repo, done } = setup("archive", { ptySpawn: fakePty() }, { "colmena.json": colmena });
  try {
    assert.deepEqual(projectScripts(repo).map((s) => [s.name, s.onSettle]), [["limpiar", true], ["t3", true], ["dev", false]]);
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "escribe la nota" });
    await idle(code, task.id, 1);
    const view = await code.archiveTask(task.id);
    assert.equal(view.archived.by, "manual");
    const settle = code.items(task.id).filter((i) => i.settle);
    assert.deepEqual(settle.map((i) => i.text), ["Liberando espacio: «limpiar» en una terminal…", "Liberando espacio: «t3» en una terminal…"]);
    await until(() => pty.typed.some((t) => /^npm run clean/.test(t)));
    pty.list[0].fire("data", "[colmena:listo]\r\n");
    await until(() => code.items(task.id).some((i) => /Espacio liberado: «limpiar»/.test(i.text)));
    assert.equal(code.mustTask(task.id).pinned, false);
    await code.send(task.id, { text: "hola" });
    assert.equal(code.mustTask(task.id).archived, null, "your message brings it back");
    await idle(code, task.id, 2);

    // In the project folder (no copy), archiving runs nothing there.
    const own = await code.createTask({ projectId: project.id, text: "", isolated: false });
    await code.archiveTask(own.id);
    assert.equal(code.items(own.id).filter((i) => i.settle).length, 0);
    code.unarchiveTask(own.id);
    assert.equal(code.mustTask(own.id).holdAuto, true, "un-archived: not archived again on its own until you write");
  } finally { await done(); }
});

let pty;
/** A pty that records what is typed; `list[i].fire("data", …)` plays the i-th terminal's output. */
function fakePty() {
  pty = { typed: [], list: [] };
  return () => {
    const listeners = { data: [], exit: [] };
    const p = { pid: 7000 + pty.list.length, onData: (fn) => listeners.data.push(fn), onExit: (fn) => listeners.exit.push(fn), write: (d) => pty.typed.push(d), resize: () => {}, kill: () => listeners.exit.forEach((fn) => fn({ exitCode: 0 })) };
    p.fire = (kind, data) => listeners[kind].forEach((fn) => fn(data));
    pty.list.push(p);
    return p;
  };
}

test("automatic archiving: when saved, after N idle days, never when held", async () => {
  const { code, repo, store, done } = setup("auto");
  try {
    assert.deepEqual(code.archiveSettings(), ARCHIVE_DEFAULTS);
    const project = await code.addProject({ folder: repo });
    const saved = await code.createTask({ projectId: project.id, text: "escribe la nota" });
    await idle(code, saved.id, 1);
    await code.merge(saved.id);
    assert.equal(code.mustTask(saved.id).archived.by, "saved");

    const old = (id, days) => store.patch("codeTasks", id, { activeAt: new Date(Date.now() - days * 86400000).toISOString() });
    const a = await code.createTask({ projectId: project.id, text: "" });
    const pinned = await code.createTask({ projectId: project.id, text: "" });
    const off = await code.createTask({ projectId: project.id, text: "" });
    const snoozed = await code.createTask({ projectId: project.id, text: "" });
    const queued = await code.createTask({ projectId: project.id, text: "" });
    const withPr = await code.createTask({ projectId: project.id, text: "" });
    const fresh = await code.createTask({ projectId: project.id, text: "" });
    for (const t of [a, pinned, off, snoozed, queued, withPr]) old(t.id, 4);
    old(fresh.id, 1);
    code.patchTask(pinned.id, { pinned: true });
    code.patchTask(off.id, { autoArchive: false });
    code.snoozeTask(snoozed.id, { until: new Date(Date.now() + 3600000).toISOString() });
    store.patch("codeTasks", queued.id, { queue: [{ id: "q1", text: "luego" }] });
    store.patch("codeTasks", withPr.id, { pr: { number: 3, state: "OPEN", watching: false } });
    code.setArchiveSettings({ keepWithPr: true });
    const archived = await code.sweepArchive();
    assert.deepEqual(archived.sort(), [a.id].sort(), "only the idle one with nothing holding it");
    assert.equal(code.mustTask(a.id).archived.by, "idle");
    assert.match(code.items(a.id).at(-1).text, /Archivada tras 3 días sin actividad/);

    // Per project: 0 days = never; the global «keep with PR» can be switched off there.
    code.setProjectArchive(project.id, { idleDays: 0 });
    old(fresh.id, 30);
    assert.deepEqual(await code.sweepArchive(), []);
    code.setProjectArchive(project.id, { idleDays: null, keepWithPr: false });
    assert.deepEqual((await code.sweepArchive()).sort(), [withPr.id, fresh.id].sort());
    assert.throws(() => code.snoozeTask(a.id, { until: new Date(Date.now() + 3600000).toISOString() }), /archivada/);
  } finally { await done(); }
});

test("snooze: hidden until its time; back early only to ask or on a failure, quiet when done", async () => {
  const { code, repo, notices, done } = setup("snooze");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    assert.throws(() => code.snoozeTask(task.id, { until: new Date(Date.now() - 1000).toISOString() }), /más adelante/);
    const later = new Date(Date.now() + 3 * 3600000).toISOString();
    code.snoozeTask(task.id, { until: later });
    assert.equal(code.mustTask(task.id).snoozed.until, later);

    // It keeps working while hidden: an ordinary end stays quiet.
    code.notifyTask(task.id, "done", "Hecho");
    assert.equal(notices.length, 0);
    assert.ok(code.mustTask(task.id).snoozed);
    // A question brings it back early.
    code.notifyTask(task.id, "needs", "¿Rojo o azul?");
    assert.equal(code.mustTask(task.id).snoozed, null);
    assert.equal(code.mustTask(task.id).wokeBy, "needs");
    assert.equal(notices.at(-1).kind, "needs");

    // Its time comes.
    code.snoozeTask(task.id, { until: later });
    code.sweepSnoozed(Date.now() + 4 * 3600000);
    assert.equal(code.mustTask(task.id).snoozed, null);
    assert.equal(code.mustTask(task.id).wokeBy, "time");
    // Your message wakes it too.
    code.snoozeTask(task.id, { until: later });
    await code.send(task.id, { text: "hola" });
    assert.equal(code.mustTask(task.id).snoozed, null);
    await idle(code, task.id, 1);
  } finally { await done(); }
});
