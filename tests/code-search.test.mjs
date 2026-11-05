// «Código»: searching inside tasks (titles and what was said, accents and archived tasks), the
// early warning when two tasks change the same files (notice once, chips, cleared when gone)
// and the quiet per-turn line (duration, files, tokens and cost the engine reports).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchTasks, snippetOf } from "../server/code/search.mjs";
import { CodeService, turnUsage } from "../server/code/service.mjs";
import { Store } from "../server/store.mjs";
import { turnStatsLine, tokensLabel } from "../src/components/v2/code/model.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url));
const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-codesearch-" + name + "-"));
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); }
  throw Error("timeout");
};

test("search: titles first, then what was said; accents, case, archived tasks, never tool outputs", () => {
  const projects = [{ id: "p1", name: "tienda" }, { id: "p2", name: "blog" }];
  const tasks = [
    { id: "t1", projectId: "p1", title: "Arreglar la canción del menú", updatedAt: "2026-11-01T10:00:00Z" },
    { id: "t2", projectId: "p2", title: "Portada nueva", archived: { at: "2026-11-02T10:00:00Z" }, updatedAt: "2026-11-02T10:00:00Z" },
    { id: "t3", projectId: "p1", title: "Otra cosa", updatedAt: "2026-11-03T10:00:00Z" },
  ];
  const items = [
    { id: "i1", taskId: "t2", kind: "user", text: "Pon la CANCIÓN de fondo en la portada", at: "2026-11-02T09:00:00Z" },
    { id: "i2", taskId: "t2", kind: "text", text: "He puesto la cancion.\n\n[objetivo: cumplido]", at: "2026-11-02T09:05:00Z" },
    { id: "i3", taskId: "t3", kind: "tool", text: "Ejecutó npm test", output: "canción ".repeat(5000), at: "2026-11-03T09:00:00Z" },
    { id: "i4", taskId: "t3", kind: "notice", text: "Bruno y la tarea «X» están cambiando los mismos archivos: cancion.js", at: "2026-11-03T09:01:00Z" },
    { id: "i5", taskId: "gone", kind: "user", text: "canción de una tarea borrada", at: "2026-11-03T09:02:00Z" },
  ];
  const r = searchTasks({ tasks, projects, items }, "Cancion");
  assert.deepEqual(r.hits.map((h) => [h.taskId, h.itemId, h.kind]), [["t1", null, "title"], ["t3", "i4", "notice"], ["t2", "i2", "text"], ["t2", "i1", "user"]]);
  const said = r.hits.find((h) => h.itemId === "i1");
  assert.equal(said.archived, true, "archived tasks are found and marked");
  assert.equal(said.project, "blog");
  assert.equal(said.who, "Tú");
  assert.match(said.snippet, /CANCIÓN de fondo/);
  assert.equal(r.hits.find((h) => h.itemId === "i2").who, "Bruno");
  assert.doesNotMatch(r.hits.find((h) => h.itemId === "i2").snippet, /objetivo/, "Bruno's goal mark is not shown");
  assert.equal(r.hits.find((h) => h.itemId === "i4").who, "Colmena");
  assert.ok(!r.hits.some((h) => h.itemId === "i3"), "tool outputs are never searched");
  assert.ok(!r.hits.some((h) => h.taskId === "gone"));
  // Upper case with accents finds plain text, and words split by a line break still match.
  assert.equal(searchTasks({ tasks, projects, items }, "PUESTO LA CANCIÓN").hits[0]?.itemId, "i2");
  assert.equal(searchTasks({ tasks, projects, items: [{ id: "x", taskId: "t1", kind: "user", text: "uno\ndos", at: "1" }] }, "uno dos").hits.at(-1).itemId, "x");
  assert.deepEqual(searchTasks({ tasks, projects, items }, "c").hits, [], "one letter is not a search");
  // At most `perTask` hits from one task, and `limit` in all.
  const many = Array.from({ length: 8 }, (_, k) => ({ id: "m" + k, taskId: "t3", kind: "user", text: "repetido " + k, at: "2026-11-04T0" + k + ":00:00Z" }));
  assert.equal(searchTasks({ tasks, projects, items: many }, "repetido").hits.length, 3);
  const capped = searchTasks({ tasks, projects, items: many }, "repetido", { perTask: 10, limit: 5 });
  assert.equal(capped.hits.length, 5);
  assert.equal(capped.more, true);
  assert.equal(capped.hits[0].itemId, "m7", "newest first");
  // The snippet is the words around the match.
  const long = "palabra ".repeat(60) + "AQUÍ está " + "fin ".repeat(60);
  const s = snippetOf(long, "aqui esta");
  assert.ok(s.startsWith("…") && s.endsWith("…") && s.includes("AQUÍ está"));
});

test("search through the service: only small fields, every project, archived too", () => {
  const dir = tmp("svc");
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: [process.execPath, FAKE], codexCommand: null, opencodeCommand: null });
  try {
    store.put("codeProjects", { id: "cp-1", name: "tienda", root: dir, allow: [] });
    store.put("codeTasks", { id: "ct-1", projectId: "cp-1", title: "Carrito", archived: { at: "2026-11-01T00:00:00Z", by: "manual" }, updatedAt: "2026-11-01T00:00:00Z", turns: [] });
    store.put("codeItems", { id: "ci-1", taskId: "ct-1", seq: 1, kind: "user", text: "Que el botón «Pagar» sea más grande", at: "2026-11-01T00:00:00Z" });
    store.put("codeItems", { id: "ci-2", taskId: "ct-1", seq: 2, kind: "tool", text: "Leyó boton.js", output: "boton pagar", at: "2026-11-01T00:01:00Z" });
    const r = code.search("el BOTON");
    assert.deepEqual(r.hits.map((h) => [h.itemId, h.archived, h.project]), [["ci-1", true, "tienda"]]);
    assert.deepEqual(code.search("").hits, []);
  } finally {
    code.shutdown();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turn stats: what the engine reported, and the quiet line", () => {
  assert.deepEqual(turnUsage({ reported: { tokens: 2300, cost: 0.0123 } }), { tokens: 2300, cost: 0.0123 });
  assert.deepEqual(turnUsage({ tokens: 900, cost: 0 }), { tokens: 900, cost: null }, "summed per call (Codex, OpenCode)");
  assert.deepEqual(turnUsage({}), { tokens: null, cost: null }, "nothing reported, nothing shown");
  assert.equal(tokensLabel(850), "850 tokens");
  assert.equal(tokensLabel(2300), "2,3 k tokens");
  assert.equal(tokensLabel(18000), "18 k tokens");
  assert.equal(tokensLabel(1400000), "1,4 M tokens");
  const stats = { durationMs: 80000, files: 3, add: 40, del: 5, tokens: 18000, cost: 0.42 };
  assert.equal(turnStatsLine(stats), "1 min · 3 archivos +40 −5");
  assert.equal(turnStatsLine(stats, { expert: true }), "1 min · 3 archivos +40 −5 · 18 k tokens · 0,42 $");
  assert.equal(turnStatsLine(stats, { files: false, expert: true }), "1 min · 18 k tokens · 0,42 $", "under the changes card the files are already said");
  assert.equal(turnStatsLine({ durationMs: 12000, files: 0, tokens: null, cost: null }, { expert: true }), "12 s");
  assert.equal(turnStatsLine({ durationMs: 5000, cost: 0.004 }, { expert: true }), "5 s · < 0,01 $");
});

/** A repository with one commit, a store and the service with the fake Claude Code. */
async function setup(name) {
  const dir = tmp(name);
  const repo = path.join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: repo });
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: [process.execPath, FAKE], codexCommand: null, opencodeCommand: null });
  const project = await code.addProject({ folder: repo });
  const idle = (id, turns) => until(() => code.mustTask(id).turns?.length === turns && !code.engines.get(id)?.turn && !code.starting.has(id));
  const settle = () => code.overlapRuns?.get(project.id);
  const done = async () => { await settle(); code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { dir, repo, store, code, project, idle, settle, done };
}

test("per-turn stats are recorded on the turn and shown on its card or answer", { skip: !hasGit, timeout: 120000 }, async () => {
  const { code, project, idle, done } = await setup("stats");
  try {
    const view = await code.createTask({ projectId: project.id, text: "escribe una nota", model: "claude-haiku-5-5" });
    await idle(view.id, 1);
    const turn = code.mustTask(view.id).turns[0];
    assert.ok(turn.durationMs >= 0);
    assert.equal(turn.tokens, 2300, "input + output + cached reads from Claude Code's result");
    assert.equal(turn.cost, 0.0123);
    const card = code.items(view.id).find((i) => i.kind === "turn");
    assert.deepEqual({ ...card.stats, durationMs: 0 }, { durationMs: 0, files: 1, add: 1, del: 0, tokens: 2300, cost: 0.0123 });
    // A turn that changes nothing: the line hangs under Bruno's answer.
    await code.send(view.id, { text: "hola" });
    await idle(view.id, 2);
    const answer = code.items(view.id).filter((i) => i.kind === "text").at(-1);
    assert.equal(answer.text, "Vale.");
    assert.equal(answer.stats.files, 0);
    assert.equal(answer.stats.tokens, 2300);
    assert.equal(code.items(view.id).filter((i) => i.kind === "turn").length, 1, "no card for a turn without changes");
  } finally {
    await done();
  }
});

test("two tasks changing the same files: one notice each, chips, cleared when it is gone", { skip: !hasGit, timeout: 180000 }, async () => {
  const { code, project, idle, settle, done } = await setup("overlap");
  const notices = (id) => code.items(id).filter((i) => i.kind === "notice" && i.overlap);
  try {
    const a = await code.createTask({ projectId: project.id, text: "escribe una nota", model: "claude-haiku-5-5" });
    await idle(a.id, 1);
    await settle();
    assert.deepEqual(code.mustTask(a.id).changed, ["nota.txt"]);
    assert.equal(code.taskView(code.mustTask(a.id)).overlaps, null, "alone, nothing to warn about");
    const b = await code.createTask({ projectId: project.id, text: "escribe otra nota", model: "claude-haiku-5-5" });
    await idle(b.id, 1);
    await until(() => code.mustTask(a.id).overlaps?.length && code.mustTask(b.id).overlaps?.length);
    // Both tasks say so in their timeline, and carry a chip that links to the other one.
    for (const [me, other] of [[a, b], [b, a]]) {
      const view = code.taskView(code.mustTask(me.id));
      assert.deepEqual(view.overlaps, [{ task: other.id, title: other.title, files: ["nota.txt"], count: 1 }]);
      const said = notices(me.id);
      assert.equal(said.length, 1);
      assert.equal(said[0].overlap, other.id);
      assert.equal(said[0].tone, "warn");
      assert.equal(said[0].text, `Bruno y la tarea «${other.title}» están cambiando los mismos archivos: nota.txt. Al fusionar pueden chocar.`);
    }
    // The same overlap again (another check, another turn on the same file): no second notice.
    await code.checkOverlaps(a.id, null);
    await code.send(a.id, { text: "escribe de nuevo" });
    await idle(a.id, 2);
    await settle();
    assert.equal(notices(a.id).length, 1);
    assert.equal(notices(b.id).length, 1);
    // «Volver aquí» to the start in B: its copy no longer changes nota.txt, both chips go.
    await code.restore(b.id, { turn: 0 });
    await settle();
    assert.deepEqual(code.mustTask(b.id).changed, []);
    assert.equal(code.taskView(code.mustTask(a.id)).overlaps, null);
    assert.equal(code.taskView(code.mustTask(b.id)).overlaps, null);
    // Back again: it is a new overlap, so it is said once more.
    await code.send(b.id, { text: "escribe otra vez" });
    await idle(b.id, 2);
    await until(() => code.mustTask(a.id).overlaps?.length);
    await settle();
    assert.equal(notices(a.id).length, 2);
    assert.equal(notices(b.id).length, 2);
    // An archived task no longer counts: the other one's chip clears.
    await code.archiveTask(a.id);
    await settle();
    assert.equal(code.taskView(code.mustTask(b.id)).overlaps, null);
    assert.equal(code.taskView(code.mustTask(a.id)).overlaps, null);
    // Search finds both, the archived one marked.
    const hits = code.search("mismos archivos").hits;
    assert.ok(hits.some((h) => h.taskId === a.id && h.archived));
    assert.ok(hits.some((h) => h.taskId === b.id && !h.archived));
    // Deleting a task clears what pointed at it.
    await code.unarchiveTask(a.id);
    await until(() => code.mustTask(b.id).overlaps?.length);
    await code.deleteTask(a.id);
    await settle();
    assert.equal(code.taskView(code.mustTask(b.id)).overlaps, null);
  } finally {
    await done();
  }
});
