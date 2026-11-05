// Two ideas from DeepSeek's dsh-superagent for «Código»: automated reviewers (Copilot,
// CodeRabbit…) wake Bruno for at most three review runs per PR, and a task whose turn was cut
// by a restart goes on by itself, told to check before repeating anything.
// gh and Claude Code are fakes (tests/fixtures/fake-gh.mjs, fake-claude-code.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService, CODE_RESUMES, RESUME_NOTE } from "../server/code/service.mjs";
import { BOT_ROUNDS, botName, sortFeedback } from "../server/code/pr.mjs";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const GH = [process.execPath, fileURLToPath(new URL("./fixtures/fake-gh.mjs", import.meta.url))];
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-bots-" + name + "-"));
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); }
  throw Error("timeout");
};
const g = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));
const goalNotices = (code, id) => code.items(id).filter((i) => i.kind === "notice" && i.goal);

function setup(name) {
  const dir = tmp(name);
  const repo = path.join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(path.join(repo, "README.md"), "# demo\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-qm", "init");
  const file = path.join(dir, "gh-state.json");
  process.env.GH_FAKE_STATE = file;
  const state = { write: (s) => writeFileSync(file, JSON.stringify(s)), read: () => JSON.parse(readFileSync(file, "utf8")) };
  state.write({ authed: true });
  const ctx = { dir, repo, state, data: path.join(dir, "data") };
  ctx.open = () => {
    ctx.store = new Store(ctx.data);
    ctx.code = new CodeService({ store: ctx.store, directory: ctx.data, command: CLAUDE, codexCommand: null, opencodeCommand: null, ghCommand: GH, notifier: { notify: () => {} } });
    return ctx.code;
  };
  ctx.close = async () => { ctx.code.shutdown(); ctx.store.close(); await new Promise((r) => setTimeout(r, 300)); };
  ctx.done = async () => {
    await ctx.close();
    delete process.env.GH_FAKE_STATE;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  };
  ctx.open();
  return ctx;
}

const PR = { number: 7, url: "https://github.com/a/b/pull/7", state: "OPEN", mergeable: "MERGEABLE", headRefOid: "c1", isDraft: false, reviewDecision: "REVIEW_REQUIRED", comments: [], reviews: [], statusCheckRollup: [] };
const BOT = "copilot-pull-request-reviewer";

test("sortFeedback: people apart from bots; a bot gets three runs (head commits), then it is capped once", () => {
  assert.equal(botName(BOT + "[bot]"), BOT);
  const bots = new Set([BOT]);
  const review = (oid, body = "Mejor así") => ({ author: { login: BOT }, body, commit: { oid } });
  const line = (oid) => ({ user: { login: BOT + "[bot]", type: "Bot" }, commit_id: oid, path: "a.js", line: 1, body: "Ojo" });
  const ana = { author: { login: "ana" }, body: "Gracias" };
  let s = sortFeedback({ said: [review("c1"), ana], lines: [line("c1")], bots, head: "c1" });
  assert.deepEqual(s.people.said, [ana]);
  assert.equal(s.bots.get(BOT).said.length, 1);
  assert.equal(s.bots.get(BOT).lines.length, 1, "its review and its line comments are one run");
  assert.deepEqual(s.rounds, { [BOT]: ["c1"] });
  // More of the same run (the same commit) still counts as that run.
  s = sortFeedback({ said: [review("c1", "Otra cosa")], bots, rounds: s.rounds, head: "c1" });
  assert.deepEqual(s.rounds[BOT], ["c1"]);
  assert.equal(s.bots.size, 1);
  s = sortFeedback({ said: [review("c2")], bots, rounds: s.rounds });
  s = sortFeedback({ said: [review("c3")], bots, rounds: s.rounds });
  assert.equal(s.rounds[BOT].length, BOT_ROUNDS);
  s = sortFeedback({ said: [review("c4"), ana], bots, rounds: s.rounds, capped: s.capped });
  assert.equal(s.bots.size, 0, "a fourth run does not reach Bruno");
  assert.deepEqual(s.people.said, [ana], "people always do");
  assert.deepEqual(s.newlyCapped, [BOT]);
  s = sortFeedback({ said: [review("c5")], bots, rounds: s.rounds, capped: s.capped });
  assert.deepEqual(s.newlyCapped, [], "named once");
});

test("PR watch: a bot's review wakes Bruno as an automated review with its round; the fourth run only leaves a line", async () => {
  const ctx = setup("watch");
  const { code, state } = ctx;
  try {
    const project = await code.addProject({ folder: ctx.repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    state.write({ authed: true, pr: PR, login: "yo", bots: [BOT] });
    assert.equal(await code.followPr(task.id, "colmena/x"), true);
    await code.checkPrs();
    const at = () => new Date(Date.now() + 1000).toISOString();
    let turns = 0;
    for (const [i, oid] of ["c1", "c2", "c3"].entries()) {
      const when = at();
      state.write({
        ...state.read(),
        pr: { ...PR, headRefOid: oid, reviews: [{ id: "r" + i, author: { login: BOT }, body: "Revisión " + oid, submittedAt: when, commit: { oid } }] },
        lineComments: [{ id: 100 + i, path: "src/app.js", line: 4, body: "Usa const", user: { login: BOT + "[bot]", type: "Bot" }, commit_id: oid, created_at: when, pull_request_review_id: 900 + i }],
      });
      await code.checkPrs();
      await idle(code, task.id, ++turns);
      const woke = goalNotices(code, task.id).at(-1);
      assert.match(woke.detail, new RegExp(`Revisión automática de ${BOT} en la PR #7 \\(ronda ${i + 1} de 3\\):\\n- Revisión ${oid}\\n- en src/app\\.js:4: Usa const`));
      assert.match(woke.detail, /Los revisores automáticos se equivocan a menudo/);
      assert.doesNotMatch(woke.detail, /Han comentado/, "not presented as a person's comment");
    }
    assert.equal(state.read().lookups.filter((l) => l.includes(BOT)).length, 1, "the login is asked once");

    // The fourth run: no turn, one quiet line. A person still wakes him.
    const when = at();
    state.write({ ...state.read(), pr: { ...PR, headRefOid: "c4", reviews: [{ id: "r4", author: { login: BOT }, body: "Más cosas", submittedAt: when, commit: { oid: "c4" } }] }, lineComments: [] });
    await code.checkPrs();
    assert.equal(goalNotices(code, task.id).length, 3);
    assert.equal(code.mustTask(task.id).turns.length, 3);
    assert.ok(code.items(task.id).some((i) => i.kind === "notice" && i.text === `${BOT} ya ha revisado 3 veces la PR #7: Bruno no atiende más revisiones automáticas suyas.`));
    state.write({ ...state.read(), pr: { ...PR, headRefOid: "c4", comments: [{ id: "h1", author: { login: "ana" }, body: "¿Puedes renombrar esto?", createdAt: at() }] } });
    await code.checkPrs();
    await idle(code, task.id, 4);
    assert.match(goalNotices(code, task.id).at(-1).detail, /Han comentado en la PR #7:\n- ana: ¿Puedes renombrar esto\?/);
    assert.doesNotMatch(goalNotices(code, task.id).at(-1).detail, /revisores automáticos/);
  } finally { await ctx.done(); }
});

test("restart: a turn cut by the close goes on by itself with the note; at most three times in a row", async () => {
  const ctx = setup("restart");
  try {
    let code = ctx.code;
    const project = await code.addProject({ folder: ctx.repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    await code.send(task.id, { text: "hola" });
    await idle(code, task.id, 1);
    // «push» asks for the OK: the turn is under way when Colmena closes.
    await code.send(task.id, { text: "push" });
    await until(() => code.items(task.id).some((i) => i.kind === "ask" && i.status === "pending"));
    await ctx.close();
    code = ctx.open();
    const cut = code.mustTask(task.id);
    assert.equal(cut.status, "idle");
    assert.equal(cut.cut.n, 2);
    assert.equal(code.items(task.id).find((i) => i.kind === "ask").status, "expired");

    assert.deepEqual(code.resumeInterrupted(), [task.id]);
    await until(() => goalNotices(code, task.id).length === 1);
    const note = goalNotices(code, task.id)[0];
    assert.equal(note.text, "Bruno sigue: Colmena se reinició mientras trabajaba.");
    assert.equal(note.detail, RESUME_NOTE, "the conversation goes on: only the note");
    assert.equal(code.mustTask(task.id).cut, null);
    assert.deepEqual(code.resumeInterrupted(), [], "once");

    // A crash loop: after CODE_RESUMES resumes in 15 minutes it waits for the person.
    await idle(code, task.id, 2);
    code.setTask(task.id, { cut: { at: new Date().toISOString(), n: 3 }, autoResumes: Array(CODE_RESUMES).fill(new Date().toISOString()) });
    assert.deepEqual(code.resumeInterrupted(), []);
    assert.match(code.items(task.id).at(-1).text, /Colmena se ha cerrado varias veces mientras Bruno trabajaba en esto/);
    assert.equal(code.mustTask(task.id).cut, null);
  } finally { await ctx.done(); }
});

test("restart: a first turn cut before the engine had a conversation sends the request again; paused team waits", async () => {
  const ctx = setup("fresh");
  try {
    let { code, store } = ctx;
    const project = await code.addProject({ folder: ctx.repo });
    const task = await code.createTask({ projectId: project.id, text: "" });
    // A crash in the middle of the first turn: the record says «working», no conversation yet.
    code.addItem(task.id, { kind: "user", text: "Arregla el título", turn: 1 });
    store.put("codeTasks", { ...code.mustTask(task.id), status: "working" });
    await ctx.close();
    code = ctx.open();
    assert.equal(code.mustTask(task.id).cut.n, 1);
    code.resumeInterrupted();
    await until(() => goalNotices(code, task.id).length === 1);
    assert.equal(goalNotices(code, task.id)[0].detail, RESUME_NOTE + "\n\nLo que te pidieron:\nArregla el título");
    await idle(code, task.id, 1);

    // The team on pause: nothing starts, a line says how to go on.
    ctx.store.put("settings", { ...(ctx.store.get("settings", "main") || {}), id: "main", paused: true });
    code.setTask(task.id, { cut: { at: new Date().toISOString(), n: 2 } });
    assert.deepEqual(code.resumeInterrupted(), []);
    assert.match(code.items(task.id).at(-1).text, /el equipo está en pausa: escríbele cuando quieras que siga/);
    assert.equal(code.mustTask(task.id).turns.length, 1);
  } finally { await ctx.done(); }
});
