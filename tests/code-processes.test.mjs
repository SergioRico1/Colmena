// «Código» › Procesos and Archivos: the task's process tree (parsing, ownership, «Parar»), the
// read-only file tree (one directory at a time, paths kept inside the task folder) and
// «Mostrar en el Explorador».
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { parseEtime, parsePs, parseCim, snapshot } from "../server/code/ports.mjs";
import { taskProcesses, ancestry, ownsPid, leftovers, stopTree } from "../server/code/processes.mjs";
import { cleanRel, resolveInside, listDir, readPreview, trackedSets, revealCommand, within } from "../server/code/files.mjs";
import { registerCodeRoutes } from "../server/code/routes.mjs";
import { CodeService, KEYBINDINGS } from "../server/code/service.mjs";
import { Store } from "../server/store.mjs";
import { uptime, leftoverPids, visibleRows, sizeLabel } from "../src/components/v2/code/panels.js";

const require = createRequire(import.meta.url);
const { allowedReveal } = require("../desktop/reveal.cjs");
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-procs-" + name + "-"));
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); }
  throw Error("timeout");
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("ps elapsed times, ps rows with and without them, and Win32_Process JSON", () => {
  assert.equal(parseEtime("05:07"), 307);
  assert.equal(parseEtime("01:00:00"), 3600);
  assert.equal(parseEtime("2-03:04:05"), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(parseEtime("vite"), null);
  const now = 1_000_000_000;
  const procs = parsePs("  501   400    01:40 /usr/local/bin/node /Users/ana/app/node_modules/.bin/vite\n  400     1 -zsh\n", now);
  assert.equal(procs.get(501).started, now - 100_000);
  assert.equal(procs.get(501).name, "node");
  assert.match(procs.get(501).command, /^\/usr\/local\/bin\/node .*vite$/);
  assert.equal(procs.get(400).started, null);
  assert.equal(procs.get(400).command, "-zsh");
  const cim = parseCim(JSON.stringify([{ ProcessId: 8, ParentProcessId: 4, Name: "node.exe", CommandLine: "node a.js", Started: 1700000000000 }, { ProcessId: 4, ParentProcessId: 0, Name: "System", CommandLine: null, Started: 0 }, null]));
  assert.deepEqual(cim.get(8), { pid: 8, parent: 4, name: "node.exe", command: "node a.js", started: 1700000000000 });
  assert.equal(cim.get(4).started, null);
  assert.equal(cim.get(4).command, "");
  assert.equal(parseCim(JSON.stringify({ ProcessId: 9, ParentProcessId: 1, Name: "x" })).size, 1, "one process comes as an object");
  assert.equal(parseCim("not json").size, 0);
});

const FOLDER = path.resolve(os.tmpdir(), "work", "task1");
function world() {
  const list = [
    [1, 0, "init", "init"],
    [50, 1, "electron.exe", "electron ."],
    [100, 50, "node.exe", "node server/index.mjs " + FOLDER], // Colmena itself (mentions the folder)
    [200, 100, "claude.exe", "claude --print"],
    [201, 200, "bash.exe", "bash -c npm run dev"],
    [202, 201, "node.exe", "node vite"],
    [300, 100, "powershell.exe", "powershell.exe -NoLogo"],
    [301, 300, "npm.exe", "npm test"],
    [302, 301, "node.exe", "node server.js"],
    [400, 999, "node.exe", "node api.js"], // remembered: its parent is gone
    [401, 1, "node.exe", "node something-else.js"], // remembered PID, reused by another program
    [500, 1, "node.exe", "node " + path.join(FOLDER, "node_modules", ".bin", "vite")], // a server in the folder
    [600, 1, "Code.exe", "Code.exe " + FOLDER], // the person's editor
    [601, 600, "node.exe", "node " + path.join(FOLDER, "x.js")], // its helper
    [700, 1, "node.exe", "node /elsewhere/app.js"],
  ];
  const processes = new Map(list.map(([pid, parent, name, command], k) => [pid, { pid, parent, name, command, started: 1000 + k }]));
  const listening = [[4319, 100], [5173, 202], [3000, 302], [8080, 400], [4000, 500], [9000, 600], [9001, 601], [7000, 700], [8081, 401]].map(([port, pid]) => ({ port, pid }));
  const roots = [{ pid: 200, kind: "engine", label: "Claude Code" }, { pid: 300, kind: "terminal", label: "npm test" }, { pid: 400, kind: "family", command: "node api.js" }, { pid: 401, kind: "family", command: "node old.js" }, { pid: 202, kind: "family", command: "node vite" }];
  return { processes, listening, roots };
}

test("the task's processes: engine, terminals, what they started, remembered and folder servers", () => {
  const { processes, listening, roots } = world();
  const exclude = { pids: [...ancestry(processes, 100)], ports: [4319] };
  assert.deepEqual([...ancestry(processes, 100)].sort((a, b) => a - b), [1, 50, 100]);
  const rows = taskProcesses({ processes, listening, roots, folders: [FOLDER], exclude });
  assert.deepEqual(rows.map((r) => [r.pid, r.kind, r.depth, r.root]), [
    [200, "engine", 0, 200], [201, "child", 1, 200], [202, "child", 2, 200],
    [300, "terminal", 0, 300], [301, "child", 1, 300], [302, "child", 2, 300],
    [400, "family", 0, 400],
    [500, "server", 0, 500],
  ]);
  assert.deepEqual(rows.find((r) => r.pid === 202).ports, [5173]);
  assert.equal(rows.find((r) => r.pid === 200).label, "Claude Code");
  assert.equal(rows.find((r) => r.pid === 202).label, null);
  assert.equal(rows.find((r) => r.pid === 500).started, 1000 + 11);
  // Ownership: only these PIDs may be stopped (Colmena, the editor, others never).
  for (const pid of [200, 202, 302, 400, 500]) assert.ok(ownsPid(rows, pid), "owns " + pid);
  for (const pid of [100, 50, 1, 401, 600, 601, 700, 12345]) assert.ok(!ownsPid(rows, pid), "not " + pid);
  // «Parar todo»: one PID per started tree; the engine and the shells stay.
  assert.deepEqual(leftovers(rows), [201, 301, 400, 500]);
  assert.deepEqual(leftoverPids(rows), leftovers(rows), "the panel agrees with the server");
  // Without a live engine nor terminals, what is left is still found (by memory and by folder).
  const later = taskProcesses({ processes, listening, roots: roots.filter((r) => r.kind === "family"), folders: [FOLDER], exclude });
  assert.deepEqual(later.map((r) => [r.pid, r.kind]), [[400, "family"], [202, "family"], [500, "server"]]);
  assert.equal(taskProcesses({ processes, listening, roots: [], folders: [], exclude }).length, 0);
});

test("stopping a tree elsewhere than Windows: children first, then the process", async () => {
  const rows = [{ pid: 10, parent: 1 }, { pid: 11, parent: 10 }, { pid: 12, parent: 11 }, { pid: 13, parent: 10 }, { pid: 20, parent: 1 }];
  const killed = [];
  assert.equal(await stopTree(10, rows, { platform: "linux", kill: (pid, sig) => killed.push([pid, sig]) }), true);
  assert.deepEqual(killed.map((k) => k[0]), [13, 12, 11, 10]);
  assert.ok(killed.every((k) => k[1] === "SIGTERM"));
  assert.equal(await stopTree(30, [], { platform: "darwin", kill: () => { throw Error("ESRCH"); } }), false);
});

test("the panel's little helpers: uptime, sizes and the visible tree", () => {
  assert.equal(uptime(null), null);
  assert.equal(uptime(1000, 13_000), "12 s");
  assert.equal(uptime(0 + 1, 5 * 60_000 + 1), "5 min");
  assert.equal(uptime(1, 1 + (2 * 60 + 3) * 60_000), "2 h 3 min");
  assert.equal(uptime(1, 1 + 3 * 86400_000), "3 d");
  assert.equal(sizeLabel(512), "512 B");
  assert.equal(sizeLabel(1536), "1,5 KB");
  assert.equal(sizeLabel(3 * 1024 * 1024), "3,0 MB");
  const dirs = {
    "": { entries: [{ name: "src", path: "src", type: "dir" }, { name: "node_modules", path: "node_modules", type: "dir", heavy: true }, { name: "a.txt", path: "a.txt", type: "file" }] },
    src: { entries: [{ name: "b.js", path: "src/b.js", type: "file" }], hidden: 2 },
  };
  assert.deepEqual(visibleRows(dirs, new Set()).map((r) => r.path), ["src", "node_modules", "a.txt"]);
  const open = visibleRows(dirs, new Set(["src", "node_modules"]));
  assert.deepEqual(open.map((r) => [r.path, r.depth]), [["src", 0], ["src/b.js", 1], ["src/…more", 1], ["node_modules", 0], ["a.txt", 0]]);
  assert.match(open[2].note, /2 ocultos por \.gitignore/);
  assert.equal(visibleRows({ "": dirs[""] }, new Set(["src"]))[1].note, "Cargando…");
});

test("paths from the page stay inside the task folder", async () => {
  for (const ok of [["", ""], [".", ""], ["src/a.js", "src/a.js"], ["src\\a.js", "src/a.js"], ["./src//a.js", "src/a.js"]]) assert.equal(cleanRel(ok[0]), ok[1]);
  for (const bad of ["../x", "src/../../x", "..\\x", "/etc/passwd", "\\\\server\\share", "C:\\Windows\\win.ini", "C:x", "a.txt:stream", "a\0b", "src/.../x"]) {
    assert.throws(() => cleanRel(bad), (e) => e.status === 400, bad);
  }
  assert.ok(within("/a/b", "/a/b"));
  assert.ok(within("/a/b", "/a/b/c"));
  assert.ok(!within("/a/b", "/a/bc"));
  assert.ok(!within("/a/b", "/a"));

  const dir = tmp("paths");
  try {
    const root = path.join(dir, "task"), outside = path.join(dir, "outside");
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(root, "src", "a.js"), "const a = 1;\n");
    writeFileSync(path.join(outside, "secret.txt"), "no\n");
    // A junction (no special rights needed on Windows) that leads out of the task.
    symlinkSync(outside, path.join(root, "fuera"), "junction");
    const at = await resolveInside(root, "src/a.js");
    assert.equal(at.rel, "src/a.js");
    await assert.rejects(resolveInside(root, "fuera/secret.txt"), (e) => e.status === 403);
    await assert.rejects(readPreview(root, "fuera/secret.txt"), (e) => e.status === 403);
    await assert.rejects(listDir(root, "fuera"), (e) => e.status === 403);
    await assert.rejects(resolveInside(root, "nada.txt"), (e) => e.status === 404);
    await assert.rejects(readPreview(root, "../outside/secret.txt"), (e) => e.status === 400);
    await assert.rejects(readPreview(root, path.join(outside, "secret.txt")), (e) => e.status === 400);
    await assert.rejects(resolveInside(path.join(dir, "gone"), ""), (e) => e.status === 409);
    const listed = await listDir(root, "");
    assert.deepEqual(listed.entries.find((e) => e.name === "fuera"), { name: "fuera", path: "fuera", type: "file", link: "out" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("one directory at a time: folders first, heavy ones closed, ignored files left out", async () => {
  const dir = tmp("tree");
  try {
    mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules", "react"), { recursive: true });
    mkdirSync(path.join(dir, ".git"));
    mkdirSync(path.join(dir, "dist"));
    writeFileSync(path.join(dir, "README.md"), "# hola\n");
    writeFileSync(path.join(dir, "b.txt"), "b");
    writeFileSync(path.join(dir, "debug.log"), "x");
    writeFileSync(path.join(dir, "dist", "out.js"), "x");
    writeFileSync(path.join(dir, "src", "app.js"), "x");
    writeFileSync(path.join(dir, "src", "lib", "util10.js"), "x");
    writeFileSync(path.join(dir, "src", "lib", "util9.js"), "x");
    const all = await listDir(dir, "");
    assert.deepEqual(all.entries.map((e) => [e.name, e.type, !!e.heavy]), [
      [".git", "dir", true], ["dist", "dir", false], ["node_modules", "dir", true], ["src", "dir", false],
      ["b.txt", "file", false], ["debug.log", "file", false], ["README.md", "file", false],
    ]);
    assert.equal(all.entries.find((e) => e.name === "README.md").size, 7);
    assert.equal(all.hidden, 0);
    // Git's view (listFiles): dist/ and *.log are ignored, so they stay out and are counted.
    const tracked = trackedSets(["README.md", "b.txt", "src/app.js", "src/lib/util9.js", "src/lib/util10.js"]);
    const shown = await listDir(dir, "", { tracked });
    assert.deepEqual(shown.entries.map((e) => e.name), [".git", "node_modules", "src", "b.txt", "README.md"]);
    assert.equal(shown.hidden, 2);
    assert.deepEqual((await listDir(dir, "src/lib", { tracked })).entries.map((e) => e.path), ["src/lib/util9.js", "src/lib/util10.js"], "numbers in order");
    const few = await listDir(dir, "", { max: 2 });
    assert.equal(few.entries.length, 2);
    assert.ok(few.truncated);
    await assert.rejects(listDir(dir, "README.md"), (e) => e.status === 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reading a file: text with a limit, images as data, binaries said", async () => {
  const dir = tmp("read");
  try {
    writeFileSync(path.join(dir, "a.js"), "uno\ndos\ntres\n");
    writeFileSync(path.join(dir, "big.txt"), "línea\n".repeat(100));
    writeFileSync(path.join(dir, "x.bin"), Buffer.from([1, 2, 0, 3]));
    writeFileSync(path.join(dir, "p.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    mkdirSync(path.join(dir, "sub"));
    assert.deepEqual(await readPreview(dir, "a.js"), { path: "a.js", size: 13, kind: "text", text: "uno\ndos\ntres\n", truncated: false });
    const big = await readPreview(dir, "big.txt", { maxText: 50 });
    assert.ok(big.truncated);
    assert.ok(big.text.length <= 50 && !big.text.includes("\n\n") && big.text.split("\n").every((l) => l === "línea"), "whole lines only");
    assert.deepEqual(await readPreview(dir, "x.bin"), { path: "x.bin", size: 4, kind: "binary" });
    const img = await readPreview(dir, "p.png");
    assert.equal(img.kind, "image");
    assert.equal(img.dataUrl, "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]).toString("base64"));
    assert.equal((await readPreview(dir, "p.png", { maxImage: 3 })).reason, "big");
    await assert.rejects(readPreview(dir, "sub"), (e) => e.status === 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("«Mostrar en el Explorador»: the system's command, and the desktop's own check", () => {
  const win = revealCommand("C:\\p q\\a.js", { platform: "win32" });
  assert.match(win.file, /explorer\.exe$/i);
  assert.deepEqual(win.args, ['/select,"C:\\p q\\a.js"']);
  assert.equal(win.verbatim, true);
  assert.deepEqual(revealCommand("C:\\p", { platform: "win32", folder: true }).args, ["C:\\p"]);
  assert.deepEqual(revealCommand("/u/a.js", { platform: "darwin" }), { file: "open", args: ["-R", "/u/a.js"], verbatim: false });
  assert.deepEqual(revealCommand("/u/a.js", { platform: "linux" }).args, ["/u"]);
  const dir = tmp("reveal");
  try {
    const root = path.join(dir, "task");
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "a.js"), "x");
    writeFileSync(path.join(dir, "other.txt"), "x");
    assert.ok(allowedReveal({ path: path.join(root, "src", "a.js"), root }));
    assert.ok(allowedReveal({ path: root, root }), "the task folder itself");
    assert.equal(allowedReveal({ path: path.join(dir, "other.txt"), root }), null);
    assert.equal(allowedReveal({ path: path.join(root, "nada.js"), root }), null);
    assert.equal(allowedReveal({ path: "src/a.js", root }), null, "relative");
    assert.equal(allowedReveal(null), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("shortcuts for the new tabs are free", () => {
  assert.equal(KEYBINDINGS.tabFiles, "mod+shift+f");
  assert.equal(KEYBINDINGS.tabProcesses, "mod+shift+o");
  const combos = Object.values(KEYBINDINGS);
  assert.equal(new Set(combos).size, combos.length, "no two actions share a key");
});

test("routes: tree, file, locate and processes check what comes from the page", async () => {
  const dir = tmp("routes");
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "a.js"), "hola\n");
  writeFileSync(path.join(dir, ".git"), "gitdir: ../repo/.git/worktrees/x\n"); // a worktree's pointer
  const calls = [];
  const code = {
    mustTask: (id) => { if (id !== "ct-1") throw Object.assign(Error("No existe esa tarea."), { status: 404 }); return { id, cwd: dir }; },
    processes: async (id) => { calls.push(["list", id]); return { processes: [], working: false }; },
    stopProcess: async (id, pid) => { calls.push(["stop", id, pid]); return { ok: true, stopped: [pid] }; },
    stopAllProcesses: async (id) => { calls.push(["all", id]); return { ok: true, stopped: [] }; },
  };
  const app = express();
  app.use(express.json());
  registerCodeRoutes(app, { code });
  app.use((err, _req, res, _next) => res.status(err instanceof z.ZodError ? 400 : err.status || 422).json({ error: err.message }));
  const server = http.createServer(app).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port + "/api/code/tasks/";
  const call = async (p, method = "GET") => { const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined }); return [r.status, await r.json()]; };
  try {
    const [s1, tree] = await call("ct-1/tree?dir=");
    assert.equal(s1, 200);
    assert.deepEqual(tree.entries.map((e) => e.path), ["src"], "a worktree's .git file is not listed");
    assert.deepEqual((await call("ct-1/tree?dir=src"))[1].entries.map((e) => e.path), ["src/a.js"]);
    assert.equal((await call("ct-1/tree?dir=" + encodeURIComponent("..")))[0], 400);
    assert.equal((await call("ct-1/file?path=" + encodeURIComponent("src/a.js")))[1].text, "hola\n");
    assert.equal((await call("ct-1/file?path=" + encodeURIComponent(path.join(dir, "src", "a.js"))))[0], 400, "absolute");
    assert.equal((await call("ct-1/file?path=" + encodeURIComponent("../x")))[0], 400);
    assert.equal((await call("ct-2/file?path=a"))[0], 404);
    const [s2, located] = await call("ct-1/locate?path=src");
    assert.equal(s2, 200);
    assert.equal(located.folder, true);
    assert.equal(located.top, false);
    assert.ok(within(located.root, located.path));
    assert.equal((await call("ct-1/locate?path="))[1].top, true);
    assert.equal((await call("ct-1/processes"))[0], 200);
    assert.equal((await call("ct-1/processes/abc/stop", "POST"))[0], 400);
    assert.equal((await call("ct-1/processes/-5/stop", "POST"))[0], 400);
    assert.equal((await call("ct-1/processes/4242/stop", "POST"))[0], 200);
    assert.equal((await call("ct-1/processes/stop-all", "POST"))[0], 200);
    assert.deepEqual(calls, [["list", "ct-1"], ["stop", "ct-1", 4242], ["all", "ct-1"]]);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("«Parar» only stops a PID of the task (looked up again on the server)", { timeout: 90000 }, async () => {
  const dir = tmp("owner");
  const data = path.join(dir, "data"), folder = path.join(dir, "tarea");
  mkdirSync(folder);
  const store = new Store(data);
  const code = new CodeService({ store, directory: data, command: null, codexCommand: null });
  const task = { id: "ct-own", cwd: folder, engine: "claude-code" };
  code.mustTask = (id) => { if (id !== task.id) throw Object.assign(Error("No existe esa tarea."), { status: 404 }); return task; };
  // A server whose command line runs inside the task folder (listening), and a stranger.
  const server = spawn(process.execPath, ["-e", "require('http').createServer(()=>{}).listen(0,'127.0.0.1');setInterval(()=>{},1000)", folder], { stdio: "ignore", windowsHide: true });
  const stranger = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "stranger"], { stdio: "ignore", windowsHide: true });
  try {
    const listed = await until(async () => { const r = await code.processes(task.id); return r.processes.some((p) => p.pid === server.pid && p.ports.length) && r; });
    const row = listed.processes.find((p) => p.pid === server.pid);
    assert.equal(row.kind, "server");
    assert.ok(!listed.processes.some((p) => p.pid === stranger.pid || p.pid === process.pid), "neither a stranger nor Colmena");
    await assert.rejects(code.stopProcess(task.id, stranger.pid), (e) => e.status === 404);
    await assert.rejects(code.stopProcess(task.id, process.pid), (e) => e.status === 404, "never Colmena itself");
    assert.ok(alive(stranger.pid));
    // Remembered by the task with its exact command line, the stranger becomes the task's.
    const seen = (await snapshot({ fresh: true })).processes.get(stranger.pid);
    code.families.set(task.id, new Map([[stranger.pid, { pid: stranger.pid, command: seen.command }]]));
    assert.ok((await code.processes(task.id)).processes.some((p) => p.pid === stranger.pid && p.kind === "family"));
    const all = await code.stopAllProcesses(task.id);
    assert.deepEqual([...all.stopped].sort(), [server.pid, stranger.pid].sort());
    await until(() => !alive(server.pid) && !alive(stranger.pid));
    assert.equal((await code.processes(task.id)).processes.length, 0);
    await assert.rejects(code.stopProcess(task.id, server.pid), (e) => e.status === 404, "gone");
  } finally {
    for (const p of [server, stranger]) try { p.kill(); } catch {}
    code.shutdown();
    store.close();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
