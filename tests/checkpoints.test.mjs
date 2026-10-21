import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { Checkpoints, CHECKPOINT_LIMITS, changesFiles, cpIdOf, diffFiles, gitAvailable, restoreLine, restoreNotice, walkFolder } from "../server/checkpoints.mjs";
import { answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { changesSummary, libraryLine } from "../src/lib/undo.js";

const HAS_GIT = await gitAvailable();
const BACKENDS = [["copia", false], ...(HAS_GIT ? [["git", true]] : [])];

/** A temp folder removed after the test; `first` runs before (close the store and the server). */
async function tmp(t, first = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-cp-"));
  t.after(async () => {
    for (const fn of first) await fn();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  return dir;
}

/** A store, a mission folder and Checkpoints with the chosen backend. */
async function setup(t, git, limits = {}) {
  const first = [];
  const dir = await tmp(t, first);
  const store = new Store(path.join(dir, "data"));
  first.push(() => store.close());
  const roots = path.join(dir, "data", "workspaces");
  const points = new Checkpoints(store, { git, limits });
  const mission = { id: "m1" };
  const root = path.join(roots, mission.id);
  await mkdir(root, { recursive: true });
  let n = 0;
  /** One bot turn: the point before its first change, the change, and the point at the end. */
  const turn = async (change, { tool = "write_file", args = {} } = {}) => {
    const step = { id: "s" + ++n, botId: "bruno" };
    await points.before({ mission, step, botId: "bruno", tool, args });
    await change();
    await points.finish(mission.id);
    return cpIdOf(step.id);
  };
  const put = (rel, text, base = root) => mkdir(path.dirname(path.join(base, rel)), { recursive: true }).then(() => writeFile(path.join(base, rel), text));
  const read = (rel, base = root) => readFile(path.join(base, rel), "utf8").catch(() => null);
  return { dir, store, points, mission, root, turn, put, read };
}

for (const [name, git] of BACKENDS) {
  test(`${name}: a turn's point lists what it created, edited and deleted, and «Deshacer cambios» puts it back`, async (t) => {
    const { points, root, turn, put, read } = await setup(t, git);
    await put("informe.md", "v1");
    await put("viejo.txt", "se borra");
    await put("intacto.txt", "igual");
    const cp = await turn(async () => {
      await put("informe.md", "v2");
      await rm(path.join(root, "viejo.txt"));
      await put("proyectos/web/src/App.jsx", "export default 1");
    });
    const [view] = points.views("m1");
    assert.equal(view.id, cp);
    assert.deepEqual([view.created, view.edited, view.deleted, view.total], [1, 1, 1, 3]);
    assert.deepEqual(points.list("m1")[0].changes.map((c) => [c.path, c.change]), [["informe.md", "edited"], ["proyectos/web/src/App.jsx", "created"], ["viejo.txt", "deleted"]]);
    const plan = await points.plan("m1", cp, "turn");
    assert.deepEqual(plan.files.map((f) => [f.path, f.change, f.later]), [["informe.md", "edited", false], ["proyectos/web/src/App.jsx", "created", false], ["viejo.txt", "deleted", false]]);
    const result = await points.restore("m1", cp, "turn");
    assert.equal(result.failed.length, 0);
    assert.equal(await read("informe.md"), "v1");
    assert.equal(await read("viejo.txt"), "se borra");
    assert.equal(await read("intacto.txt"), "igual");
    assert.equal(existsSync(path.join(root, "proyectos")), false, "the folders the turn created go too");
    assert.ok(points.views("m1")[0].restoredAt);
  });

  test(`${name}: «Volver a este punto» also undoes the later turns, and says what changed after`, async (t) => {
    const { points, turn, put, read } = await setup(t, git);
    await put("a.txt", "a0");
    const first = await turn(() => put("a.txt", "a1"));
    await put("c.txt", "c-tuyo"); // you made a file of your own between the turns…
    const second = await turn(() => Promise.all([put("a.txt", "a2"), put("b.txt", "b2"), put("c.txt", "c-bot")]));
    await put("b.txt", "b-tuyo"); // …and edited one afterwards
    // One turn alone: a.txt back to a0, but it also changed later (the second turn).
    const one = await points.plan("m1", first, "turn");
    assert.deepEqual(one.files.map((f) => [f.path, f.later]), [["a.txt", true]]);
    const point = await points.plan("m1", first, "point");
    assert.deepEqual(point.files.map((f) => [f.path, f.change, f.later]).sort(), [["a.txt", "edited", false], ["b.txt", "created", true], ["c.txt", "created", true]]);
    assert.equal(point.records.length, 2);
    await points.restore("m1", first, "point");
    assert.equal(await read("a.txt"), "a0");
    assert.equal(await read("b.txt"), null);
    assert.equal(await read("c.txt"), null, "back as before the first turn");
    assert.ok(points.list("m1").every((r) => r.restoredAt && r.restoredFrom === first));
    assert.ok(second);
  });

  test(`${name}: dependencies, builds and caches are left out, and so are files over the limit`, async (t) => {
    const { points, root, turn, put, read } = await setup(t, git, { maxFileBytes: 1000 });
    await put("grande.bin", "x".repeat(2000));
    await turn(async () => {
      for (const d of ["node_modules/react/index.js", "dist/app.js", ".cache/x", "proyectos/web/node_modules/a.js", "__pycache__/m.pyc"]) await put(d, "generado");
      await put("Thumbs.db", "x");
      await put("~$informe.docx", "bloqueo");
      await put("src/main.js", "hola");
      await put("grande.bin", "y".repeat(3000));
    });
    const [record] = points.list("m1");
    assert.deepEqual(record.changes.map((c) => c.path), ["src/main.js"]);
    await points.restore("m1", record.id, "turn");
    assert.equal(await read("node_modules/react/index.js"), "generado", "never touched");
    assert.equal(await read("grande.bin"), "y".repeat(3000), "a file too big to keep stays as it is");
    assert.equal(existsSync(path.join(root, "src")), false);
  });

  test(`${name}: a folder with too many files gets no point, and says so`, async (t) => {
    const { points, turn, put } = await setup(t, git, { maxFiles: 3 });
    for (let i = 0; i < 5; i++) await put("f" + i + ".txt", String(i));
    await turn(() => put("f0.txt", "cambiado"));
    const [view] = points.views("m1");
    assert.deepEqual(view.skipped, ["la carpeta del chat"]);
    assert.equal(view.total, 0);
  });

  test(`${name}: turns that changed nothing leave no point; old points are pruned and a deleted mission takes its own`, async (t) => {
    const { points, store, turn, put } = await setup(t, git, { keepTurns: 2 });
    await turn(async () => {});
    assert.equal(points.list("m1").length, 0);
    for (let i = 0; i < 4; i++) await turn(() => put("n.txt", String(i)));
    assert.equal(points.views("m1").length, 2);
    assert.deepEqual(points.list("m1").map((r) => r.changes[0].change), ["edited", "edited"]);
    await points.purgeMission("m1");
    assert.equal(store.where("checkpoints", "missionId", "m1").length, 0);
    assert.equal(existsSync(path.join(points.directory, "m-m1")), false);
  });

  test(`${name}: a shared folder with write access gets its own point; read-only ones do not`, async (t) => {
    const { dir, points, store, turn, put, read } = await setup(t, git);
    const shared = path.join(dir, "Clientes");
    await mkdir(shared, { recursive: true });
    await put("lista.csv", "a;b", shared);
    store.put("folders", { id: "f1", path: shared, label: "Clientes", botIds: ["bruno"], access: "escribe" });
    store.put("folders", { id: "f2", path: shared, label: "Solo lectura", botIds: ["bruno"], access: "lee" });
    assert.deepEqual(points.scopesFor({ missionId: "m1", botId: "bruno", tool: "run_command", args: { folderId: "f1" } }).map((s) => s.kind), ["mission", "folder"]);
    assert.deepEqual(points.scopesFor({ missionId: "m1", botId: "bruno", tool: "run_command", args: { folderId: "f2" } }).map((s) => s.kind), ["mission"]);
    assert.deepEqual(points.scopesFor({ missionId: "m1", botId: "otro", tool: "run_command", args: { folderId: "f1" } }).map((s) => s.kind), ["mission"]);
    const cp = await turn(() => put("lista.csv", "a;b;c", shared), { tool: "run_command", args: { folderId: "f1" } });
    assert.deepEqual(points.views("m1")[0].folders, ["Clientes"]);
    const plan = await points.plan("m1", cp);
    assert.deepEqual(plan.files.map((f) => [f.path, f.folder]), [["lista.csv", "Clientes"]]);
    await points.restore("m1", cp);
    assert.equal(await read("lista.csv", shared), "a;b");
  });

  test(`${name}: the trash a deletion fills is kept but not listed, and undoing the deletion empties it`, async (t) => {
    const { points, root, turn, put, read } = await setup(t, git);
    await put("proyectos/web/app.js", "1");
    const cp = await turn(async () => {
      await put(".papelera/20261021/proyectos/web/app.js", "1");
      await rm(path.join(root, "proyectos/web/app.js"));
    }, { tool: "project_delete" });
    const [view] = points.views("m1");
    assert.deepEqual([view.total, view.deleted, view.created], [1, 1, 0]);
    const plan = await points.plan("m1", cp);
    assert.deepEqual(plan.files.filter((f) => !f.hidden).map((f) => f.path), ["proyectos/web/app.js"]);
    await points.restore("m1", cp);
    assert.equal(await read("proyectos/web/app.js"), "1");
    assert.equal(existsSync(path.join(root, ".papelera")), false);
  });

  test(`${name}: after undoing a later turn, going back to an earlier point loses nothing of yours`, async (t) => {
    const { points, turn, put } = await setup(t, git);
    const first = await turn(() => put("index.html", "v1"));
    const second = await turn(() => put("index.html", "v2"));
    await points.restore("m1", second, "turn");
    const plan = await points.plan("m1", first, "point");
    assert.deepEqual(plan.files.map((f) => [f.path, f.change, f.later]), [["index.html", "created", false]]);
  });

  test(`${name}: a refused restore touches nothing`, async (t) => {
    const { points, turn, put, read } = await setup(t, git);
    const cp = await turn(() => put("x.txt", "nuevo"));
    await assert.rejects(points.restore("m1", cp, "turn", { busy: () => "Bruno está trabajando en este chat." }), (e) => e.status === 409 && /trabajando/.test(e.message));
    assert.equal(await read("x.txt"), "nuevo");
    assert.equal(points.views("m1")[0].restoredAt, null);
    await assert.rejects(points.plan("m1", "cp-nope"), (e) => e.status === 404);
  });
}

test("git: the person's own repository is never touched, and a nested one is left out", { skip: !HAS_GIT }, async (t) => {
  const { points, root, turn, put, read } = await setup(t, true);
  const git = (...args) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } });
  git("init", "-q");
  git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "mio");
  await put("vendor/lib/.git/HEAD", "ref: refs/heads/main\n");
  await put("vendor/lib/x.js", "1");
  const head = await readFile(path.join(root, ".git", "HEAD"), "utf8");
  const refs = git("for-each-ref").toString();
  const indexBefore = existsSync(path.join(root, ".git", "index")) ? (await stat(path.join(root, ".git", "index"))).mtimeMs : null;
  const cp = await turn(async () => { await put("app.js", "nuevo"); await put("vendor/lib/x.js", "2"); });
  assert.deepEqual(points.list("m1")[0].changes.map((c) => c.path), ["app.js"]);
  await points.restore("m1", cp);
  assert.equal(await read("app.js"), null);
  assert.equal(await readFile(path.join(root, ".git", "HEAD"), "utf8"), head);
  assert.equal(git("for-each-ref").toString(), refs, "no refs of Colmena in the person's repository");
  assert.equal(existsSync(path.join(root, ".git", "index")) ? (await stat(path.join(root, ".git", "index"))).mtimeMs : null, indexBefore);
  assert.equal(git("status", "--porcelain").toString().includes("app.js"), false);
});

test("git: files go back byte for byte whatever .gitattributes says", { skip: !HAS_GIT }, async (t) => {
  const { points, turn, put, read } = await setup(t, true);
  await put(".gitattributes", "* text=auto eol=crlf\n");
  await put("unix.txt", "uno\ndos\n");
  const cp = await turn(() => put("unix.txt", "cambiado\n"));
  await points.restore("m1", cp);
  assert.equal(await read("unix.txt"), "uno\ndos\n");
});

test("which tools take a point, and the words of the line and the bot's note", () => {
  for (const name of ["write_file", "create_presentation", "create_document", "create_spreadsheet", "project_write", "project_edit", "project_delete", "project_run", "run_command", "browser_download"]) assert.ok(changesFiles(name), name);
  for (const name of ["read_file", "web_fetch", "project_files", "project_preview", "apps_execute", "remember", "ask_user"]) assert.equal(changesFiles(name), false, name);
  assert.deepEqual(diffFiles(new Map([["a", "1"], ["b", "2"]]), new Map([["a", "9"], ["c", "3"]])), [
    { path: "a", change: "edited" }, { path: "b", change: "deleted" }, { path: "c", change: "created" },
  ]);
  assert.equal(restoreLine({ mode: "turn", files: [{}, {}], failed: [] }, "Bruno"), "Has deshecho los cambios de Bruno en 2 archivos.");
  assert.match(restoreLine({ mode: "point", files: [{}], failed: [{}] }, "Bruno"), /^Has vuelto los archivos a como estaban antes de la respuesta de Bruno \(0 archivos\)\. 1 no se pudieron/);
  assert.match(restoreLine({ mode: "turn", files: [{}], failed: [] }, "Bruno", "2026-10-21T15:20:00"), /^Has deshecho los cambios de Bruno en 1 archivo \(su respuesta de las 15:20\)\.$/);
  const note = restoreNotice([
    { at: "2026-10-21T15:20:00Z", mode: "turn", files: [{ path: "a.txt", change: "deleted" }, { path: "b.txt", change: "edited" }] },
    { at: "2026-10-21T15:25:00Z", mode: "point", files: [{ path: "a.txt", change: "created" }] },
  ]);
  assert.match(note, /volvió a un punto anterior/);
  assert.match(note, /Ahora están así: «a\.txt» \(ya no está\), «b\.txt» \(vuelve a una versión anterior\)\./, "the latest restore wins");
  assert.match(note, /léelos antes/);
});

test("the chat's words: what a turn did and what leaves the Biblioteca", () => {
  assert.equal(changesSummary({ created: 2, edited: 1, deleted: 0 }), "2 creados, 1 editado");
  assert.equal(changesSummary({ created: 0, edited: 0, deleted: 1 }), "1 borrado");
  assert.equal(libraryLine(["a.md"], [{ path: "a.md" }]), "Ese archivo también sale de la Biblioteca.");
  assert.equal(libraryLine(["a.md", "Informe"], [{ path: "a.md" }]), "También sale de la Biblioteca: «Informe».");
  assert.equal(libraryLine(["Informe", "Plan"], []), "También salen de la Biblioteca: «Informe», «Plan».");
});

test("the walk keeps no links and reports nested repositories", async (t) => {
  const dir = await tmp(t);
  await mkdir(path.join(dir, "a", ".git"), { recursive: true });
  await writeFile(path.join(dir, "a", "x"), "1");
  await writeFile(path.join(dir, "b.txt"), "2");
  const walk = await walkFolder(dir, CHECKPOINT_LIMITS);
  assert.deepEqual(walk.files.map((f) => f.rel), ["b.txt"]);
  assert.deepEqual(walk.nested, ["a"]);
});

// ------------------------------------------------------------------ the whole flow

async function app(t, respond) {
  const first = [];
  const dir = await tmp(t, first);
  const store = new Store(dir);
  store.patch("settings", "main", { model: "fixture", learning: false });
  const runtime = new Runtime(store, { respond }, null, { checkpoints: { git: HAS_GIT } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  first.push(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  const post = (route, body = {}) => fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const del = (route) => fetch(origin + "/api" + route, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: "{}" });
  const get = async (route) => (await fetch(origin + "/api" + route)).json();
  return { store, runtime, post, del, get };
}

test("a chat turn that writes files shows «Deshacer cambios», restores them, tells the thread and the bot", async (t) => {
  const seen = [];
  let turnNo = 0;
  const { store, runtime, post, del, get } = await app(t, async ({ input }) => {
    const done = outputs(input);
    const text = JSON.stringify(input);
    if (!done.length) {
      seen.push(text);
      turnNo++;
      if (turnNo === 1) return call("write_file", { path: "notas.md", content: "# Notas" }, "w1");
      if (turnNo === 2) return call("create_deliverable", { title: "calc.py", kind: "code", format: "py", content: "print(1)" }, "d1");
      return answer("Vale.");
    }
    return answer("Hecho.");
  });
  const m = runtime.create({ prompt: "Escribe unas notas", mode: "solo", botIds: ["bruno"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  await runtime.checkpoints.idle(m.id);
  let detail = await get("/missions/" + m.id);
  assert.equal(detail.checkpoints.length, 1);
  const first = detail.checkpoints[0];
  assert.deepEqual([first.created, first.edited, first.deleted], [1, 0, 0]);
  assert.ok(detail.steps.some((s) => s.id === first.stepId));

  // Second turn: a code deliverable (also a work file of the mission).
  await runtime.addMessage(m.id, "Ahora un script");
  await settle(runtime);
  await runtime.checkpoints.idle(m.id);
  detail = await get("/missions/" + m.id);
  assert.equal(detail.checkpoints.length, 2);
  const second = detail.checkpoints[1];
  assert.ok(store.where("artifacts", "missionId", m.id).some((a) => a.workFile === "calc.py"));

  // While the bot works, nothing is restored.
  runtime.active.set(m.id, new AbortController());
  const refused = await post(`/missions/${m.id}/checkpoints/${second.id}/restore`, { mode: "turn" });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /está trabajando en este chat/);
  assert.match((await get(`/missions/${m.id}/checkpoints/${second.id}`)).busy, /trabajando/);
  runtime.active.delete(m.id);
  assert.ok(existsSync(path.join(runtime.root(m.id), "calc.py")));

  // The preview of «Volver a este punto» from the first turn: both files, and the deliverable.
  const preview = await get(`/missions/${m.id}/checkpoints/${first.id}?modo=punto`);
  assert.equal(preview.busy, null);
  assert.deepEqual(preview.files.map((f) => [f.path, f.change]).sort(), [["calc.py", "created"], ["notas.md", "created"]]);
  assert.deepEqual(preview.deliverables.sort(), ["calc.py", "notas.md"]);
  assert.equal(preview.turns, 2);
  assert.equal(preview.later, 1);
  assert.match(preview.outside, /correos, eventos, mensajes/);

  const res = await post(`/missions/${m.id}/checkpoints/${first.id}/restore`, { mode: "point" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.restored, 2);
  assert.equal(existsSync(path.join(runtime.root(m.id), "notas.md")), false);
  assert.equal(existsSync(path.join(runtime.root(m.id), "calc.py")), false);
  assert.equal(store.where("artifacts", "missionId", m.id).some((a) => a.workFile === "calc.py"), false, "its deliverable leaves the Biblioteca");
  assert.equal(store.where("artifacts", "missionId", m.id).length, 0);
  assert.equal(store.where("messages", "missionId", m.id).some((x) => x.kind === "deliverable"), false, "and its card leaves the chat");
  const line = store.where("messages", "missionId", m.id).find((x) => x.kind === "activity" && x.checkpointId === first.id);
  assert.match(line.text, /^Has vuelto los archivos a como estaban antes de la respuesta de Bruno de las \d\d:\d\d \(2 archivos\)\.$/);
  detail = await get("/missions/" + m.id);
  assert.ok(detail.checkpoints.every((c) => c.restoredAt));

  // The bot's next turn knows the files went back.
  await runtime.addMessage(m.id, "¿Sigue ahí el script?");
  await settle(runtime);
  assert.match(seen.at(-1), /la persona ha deshecho cambios de archivos/);
  assert.match(seen.at(-1), /calc\.py/);

  // Deleting the chat deletes its points.
  await runtime.checkpoints.idle(m.id);
  assert.equal((await del("/missions/" + m.id)).status, 200);
  assert.equal(store.where("checkpoints", "missionId", m.id).length, 0);
  assert.equal(existsSync(path.join(runtime.checkpoints.directory, "m-" + m.id)), false);
});

test("turn mode restores only that turn, and the live answer of an untouched folder is a 404", async (t) => {
  let n = 0;
  const { runtime, post, get } = await app(t, async ({ input }) => {
    if (outputs(input).length) return answer("Hecho.");
    n++;
    return n === 1 ? call("write_file", { path: "uno.txt", content: "1" }, "a") : n === 2 ? call("write_file", { path: "dos.txt", content: "2" }, "b") : answer("Nada.");
  });
  const m = runtime.create({ prompt: "Uno", mode: "solo", botIds: ["bruno"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  await runtime.addMessage(m.id, "Dos");
  await settle(runtime);
  await runtime.checkpoints.idle(m.id);
  const [first] = (await get("/missions/" + m.id)).checkpoints;
  assert.equal((await post(`/missions/${m.id}/checkpoints/${first.id}/restore`, { mode: "turn" })).status, 200);
  assert.equal(existsSync(path.join(runtime.root(m.id), "uno.txt")), false);
  assert.equal(await readFile(path.join(runtime.root(m.id), "dos.txt"), "utf8"), "2");
  assert.equal((await post(`/missions/${m.id}/checkpoints/cp-nada/restore`, {})).status, 404);
  assert.equal((await readdir(runtime.root(m.id))).includes("dos.txt"), true);
});
