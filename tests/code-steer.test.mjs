// «Código»: correcting Bruno while he works («Corrección»). Codex gets it through `turn/steer`
// in the running turn (fake app-server), Claude Code through a stdin line it takes at its next
// step — or right after its last answer, as a turn of its own Colmena adopts. A Codex without
// turn/steer waits for the end of the turn; «Parar» still stops; an engine that closes before
// reading a correction leaves it in the queue.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService } from "../server/code/service.mjs";
import { STEER_OFF } from "../server/code/steer.mjs";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const CODEX = [process.execPath, fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url))];
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); }
  throw Error("timeout");
};

function setup(name, { codex = CODEX } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "colmena-steer-" + name + "-"));
  const repo = path.join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: repo });
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: codex, opencodeCommand: null });
  const done = async () => { code.shutdown(); store.close(); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return { repo, store, code, done };
}
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));
/** The task's turn is running and its engine has said it started (Codex: its turn id). */
const working = (code, id, text) => until(() => {
  const e = code.engines.get(id);
  return e?.turn && !code.starting.has(id) && (e.engine.kind !== "codex" || e.engine.turnId) && code.items(id).some((i) => i.kind === "text" && i.text === text);
});
const said = (code, id) => code.items(id).filter((i) => i.kind === "user" || i.kind === "text").map((i) => (i.kind === "user" ? (i.steer ? "corrección: " : "tú: ") : "") + i.text);

test("Codex: a correction reaches the running turn (turn/steer), in order, and shows as read", async () => {
  const { code, repo, done } = setup("codex");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, engine: "codex", text: "hazlo despacio" });
    await working(code, task.id, "Empiezo.");
    assert.equal(code.taskView(code.mustTask(task.id)).steer, true);
    const r = await code.send(task.id, { text: "usa azul", when: "steer" });
    assert.equal(r.steered, true);
    await idle(code, task.id, 1);
    assert.deepEqual(said(code, task.id), ["tú: hazlo despacio", "Empiezo.", "corrección: usa azul", "Corregido: usa azul", "Terminado."], "the correction sits where it was sent");
    const row = code.items(task.id).find((i) => i.steer);
    assert.equal(row.ack, "read", "Codex recorded it (userMessage item with our id)");
    assert.equal(row.turn, 1);
    assert.equal(code.mustTask(task.id).turns.length, 1, "no extra turn");
    assert.deepEqual(code.mustTask(task.id).queue, []);
  } finally { await done(); }
});

test("Codex without turn/steer: the message waits for the end of the turn, said plainly", async () => {
  const { code, repo, done } = setup("old", { codex: [...CODEX, "--old"] });
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, engine: "codex", text: "hazlo despacio" });
    await working(code, task.id, "Empiezo.");
    const r = await code.send(task.id, { text: "usa azul", when: "steer" });
    assert.deepEqual(r, { queued: true, note: STEER_OFF });
    assert.equal(code.items(task.id).some((i) => i.steer), false, "no «Corrección» row");
    assert.equal(code.taskView(code.mustTask(task.id)).steer, false, "the composer says it waits");
    assert.deepEqual(code.mustTask(task.id).queue.map((q) => q.text), ["usa azul"]);
    // The next one goes straight to the queue, without asking Codex again.
    assert.deepEqual(await code.send(task.id, { text: "y rojo", when: "steer" }), { queued: true, note: STEER_OFF });
    await idle(code, task.id, 3);
    assert.deepEqual(said(code, task.id).filter((t) => t.startsWith("tú:")), ["tú: hazlo despacio", "tú: usa azul", "tú: y rojo"]);
  } finally { await done(); }
});

test("Codex: «Parar» still stops a turn that got a correction; one after the end starts a turn", async () => {
  const { code, repo, done } = setup("stop");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, engine: "codex", text: "muy despacio" });
    await working(code, task.id, "Empiezo.");
    await code.stop(task.id);
    await idle(code, task.id, 1);
    assert.ok(code.items(task.id).some((i) => i.kind === "notice" && /Has parado/.test(i.text)));
    // Sent «while working» but the turn is over: it starts the next turn instead of getting lost.
    const r = await code.send(task.id, { text: "otra cosa", when: "steer" });
    assert.equal(r.started, true);
    await idle(code, task.id, 2);
    assert.equal(said(code, task.id).at(-2), "tú: otra cosa");
  } finally { await done(); }
});

test("Codex closes before reading a correction: it is marked and waits in the queue", async () => {
  const { code, repo, done } = setup("exit");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, engine: "codex", text: "muere" });
    await working(code, task.id, "Empiezo.");
    await code.send(task.id, { text: "usa azul", when: "steer" });
    await idle(code, task.id, 1);
    const row = code.items(task.id).find((i) => i.steer);
    assert.equal(row.ack, "lost");
    assert.deepEqual(code.mustTask(task.id).queue.map((q) => q.text), ["usa azul"], "kept for the next turn");
    assert.equal(code.mustTask(task.id).status, "error");
  } finally { await done(); }
});

test("Claude Code: a correction is taken at the next step of the running turn", async () => {
  const { code, repo, done } = setup("claude");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "hazlo despacio" });
    await working(code, task.id, "Empiezo.");
    const r = await code.send(task.id, { text: "usa azul", when: "steer" });
    assert.equal(r.steered, true);
    assert.equal(code.items(task.id).find((i) => i.steer).ack, "sent");
    await idle(code, task.id, 1);
    await new Promise((r) => setTimeout(r, 3300)); // the wait for a follow-up passes: nothing comes
    assert.deepEqual(said(code, task.id), ["tú: hazlo despacio", "Empiezo.", "corrección: usa azul", "Corregido: usa azul", "Terminado."]);
    assert.equal(code.mustTask(task.id).turns.length, 1);
    assert.equal(code.mustTask(task.id).status, "idle");
  } finally { await done(); }
});

test("Claude Code: a correction after its last answer runs as its own turn, adopted; the queue waits for it", async () => {
  const { code, repo, done } = setup("overrun");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "remata" });
    await working(code, task.id, "Empiezo.");
    await code.send(task.id, { text: "corrige: usa azul", when: "steer" });
    await code.send(task.id, { text: "luego esto", when: "queue" });
    await idle(code, task.id, 3);
    assert.deepEqual(said(code, task.id), ["tú: remata", "Empiezo.", "corrección: corrige: usa azul", "Terminado.", "Sigo con: corrige: usa azul", "tú: luego esto", "Vale."]);
    const turns = code.mustTask(task.id).turns;
    assert.deepEqual(turns.map((t) => t.n), [1, 2, 3]);
    assert.equal(code.items(task.id).find((i) => i.text === "Sigo con: corrige: usa azul").turn, 2, "the follow-up is a turn of its own");
  } finally { await done(); }
});

test("Claude Code: «Parar» after a correction does not let the correction run afterwards", async () => {
  const { code, repo, done } = setup("claude-stop");
  try {
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "remata" });
    await working(code, task.id, "Empiezo.");
    await code.send(task.id, { text: "corrige: usa azul", when: "steer" });
    await code.stop(task.id);
    await idle(code, task.id, 1);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(code.mustTask(task.id).turns.length, 1, "no follow-up turn");
    assert.equal(code.items(task.id).some((i) => /^Sigo con/.test(i.text || "")), false);
    assert.ok(code.items(task.id).some((i) => i.kind === "notice" && /Has parado/.test(i.text)));
  } finally { await done(); }
});
