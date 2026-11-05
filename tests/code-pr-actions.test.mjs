// «Código» and the pull request on GitHub: merging it from Colmena with a head-SHA guard,
// marking a draft ready, inline comments and the review decision reaching Bruno, posting
// Código's P0–P3 review on the PR, and the sign-in check before pushing. gh is a fake
// (tests/fixtures/fake-gh.mjs) answering from a JSON file.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService } from "../server/code/service.mjs";
import { mergeRefusal, reviewPayload, rightLines } from "../server/code/pr.mjs";
import { Store } from "../server/store.mjs";

const CLAUDE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude-code.mjs", import.meta.url))];
const GH = [process.execPath, fileURLToPath(new URL("./fixtures/fake-gh.mjs", import.meta.url))];
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), "colmena-prx-" + name + "-"));
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); }
  throw Error("timeout");
};
const g = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
const idle = (code, id, n) => until(() => code.mustTask(id).turns?.length === n && !code.engines.get(id)?.turn && !code.starting.has(id));

/** A repository, the service with the fake gh, and the fake's state file. */
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
  const notices = [];
  const store = new Store(path.join(dir, "data"));
  const code = new CodeService({ store, directory: path.join(dir, "data"), command: CLAUDE, codexCommand: null, opencodeCommand: null, ghCommand: GH, notifier: { notify: (n) => notices.push(n) } });
  const done = async () => {
    code.shutdown(); store.close(); delete process.env.GH_FAKE_STATE;
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  };
  return { dir, repo, store, code, state, notices, done };
}

const PR = { number: 7, url: "https://github.com/a/b/pull/7", state: "OPEN", mergeable: "MERGEABLE", headRefOid: "abc", isDraft: false, reviewDecision: "REVIEW_REQUIRED", comments: [], reviews: [], statusCheckRollup: [{ name: "test", conclusion: "SUCCESS" }] };

/** A task that follows PR #7 and has looked at it once. */
async function followed(ctx, pr = PR) {
  const project = await ctx.code.addProject({ folder: ctx.repo });
  const task = await ctx.code.createTask({ projectId: project.id, text: "" });
  ctx.state.write({ authed: true, pr, login: "yo" });
  assert.equal(await ctx.code.followPr(task.id, "colmena/x"), true);
  await ctx.code.checkPrs();
  return task;
}
const goalNotices = (code, id) => code.items(id).filter((i) => i.kind === "notice" && i.goal);

test("merge on GitHub: only the commit the person saw (--match-head-commit), refused when it moved", async () => {
  const ctx = setup("merge");
  const { code, state } = ctx;
  try {
    const task = await followed(ctx);
    assert.equal(code.mustTask(task.id).pr.headRefOid, "abc");
    assert.equal(code.mustTask(task.id).pr.reviewDecision, "REVIEW_REQUIRED");
    // Someone pushes after the person looked: GitHub refuses and the state is refreshed.
    state.write({ ...state.read(), pr: { ...PR, headRefOid: "def" } });
    await assert.rejects(code.mergePr(task.id), (e) => e.status === 409 && /Han subido cambios a la PR #7 después de que la miraras/.test(e.message));
    assert.deepEqual(state.read().calls.at(-1), ["pr", "merge", "7", "--repo", "a/b", "--merge", "--match-head-commit", "abc"]);
    assert.equal(code.mustTask(task.id).pr.headRefOid, "def", "the new head is what the person sees now");
    // Required checks or approvals: a plain Spanish refusal.
    state.write({ ...state.read(), mergeError: "GraphQL: Required status check \"test\" is expected. (mergePullRequest)" });
    await assert.rejects(code.mergePr(task.id), /faltan comprobaciones o aprobaciones/);
    // Now it goes: the usual «merged» path (notice, archived by its PR).
    state.write({ ...state.read(), mergeError: null });
    const r = await code.mergePr(task.id);
    assert.equal(r.ok, true);
    assert.deepEqual(state.read().calls.at(-1).slice(-2), ["--match-head-commit", "def"]);
    assert.equal(code.mustTask(task.id).pr.state, "MERGED");
    assert.equal(code.mustTask(task.id).pr.watching, false);
    assert.ok(code.items(task.id).some((i) => i.kind === "notice" && /La PR #7 se ha fusionado/.test(i.text) && i.tone === "done"));
    assert.equal(code.mustTask(task.id).archived.by, "pr");
    await assert.rejects(code.mergePr(task.id), /no tiene una PR abierta/);
  } finally { await ctx.done(); }
});

test("merge on GitHub is held back while CI fails, on conflicts and for a draft; «Marcar como lista»", async () => {
  const ctx = setup("guards");
  const { code, state } = ctx;
  try {
    const task = await followed(ctx, { ...PR, isDraft: true });
    const pr = code.mustTask(task.id).pr;
    assert.equal(pr.isDraft, true);
    await assert.rejects(code.mergePr(task.id), /es un borrador: márcala como lista/);
    code.setTask(task.id, { pr: { ...pr, isDraft: false, checks: "failing" } });
    await assert.rejects(code.mergePr(task.id), /Falla el CI de la PR #7/);
    code.setTask(task.id, { pr: { ...pr, isDraft: false, mergeable: "CONFLICTING" } });
    await assert.rejects(code.mergePr(task.id), /tiene conflictos con main/);
    assert.equal((state.read().calls || []).length, 0, "nothing reached GitHub");

    code.setTask(task.id, { pr });
    await code.readyPr(task.id);
    assert.deepEqual(state.read().calls.at(-1), ["pr", "ready", "7", "--repo", "a/b"]);
    assert.equal(code.mustTask(task.id).pr.isDraft, false);
    assert.match(code.items(task.id).at(-1).text, /La PR #7 ya está lista para revisar/);
    // Without a gh session: how to sign in.
    code.ghCache = null;
    state.write({ ...state.read(), authed: false });
    await assert.rejects(code.mergePr(task.id), /gh auth login/);
  } finally { await ctx.done(); }
});

test("PR watch: inline comments reach Bruno once with path:line; changes requested wakes him, approved only tells", async () => {
  const ctx = setup("lines");
  const { code, state, notices } = ctx;
  try {
    const task = await followed(ctx);
    const since = new Date(Date.now() + 1000).toISOString();
    const lineComments = [
      { id: 11, path: "src/app.js", line: 12, body: "Usa const aquí", user: { login: "ana" }, created_at: since, pull_request_review_id: 90 },
      { id: 12, path: "src/app.js", line: 3, body: "Mi propia nota", user: { login: "yo" }, created_at: since, pull_request_review_id: 91 },
    ];
    state.write({ ...state.read(), lineComments });
    await code.checkPrs();
    await idle(code, task.id, 1);
    const woke = goalNotices(code, task.id);
    assert.equal(woke.length, 1);
    assert.match(woke[0].detail, /Han comentado líneas de la PR #7:\n- ana en src\/app\.js:12: Usa const aquí/);
    assert.doesNotMatch(woke[0].detail, /Mi propia nota/, "the person's own comments are not for Bruno");
    await code.checkPrs(); // the same comments: nothing new
    assert.equal(goalNotices(code, task.id).length, 1);

    state.write({ ...state.read(), pr: { ...PR, reviewDecision: "CHANGES_REQUESTED" } });
    await code.checkPrs();
    await idle(code, task.id, 2);
    assert.match(goalNotices(code, task.id)[1].detail, /Piden cambios en la PR #7\./);
    assert.equal(code.mustTask(task.id).pr.reviewDecision, "CHANGES_REQUESTED");

    state.write({ ...state.read(), pr: { ...PR, reviewDecision: "APPROVED" } });
    await code.checkPrs();
    const approved = code.items(task.id).at(-1);
    assert.equal(approved.text, "La PR #7 está aprobada.");
    assert.equal(approved.tone, "done");
    assert.ok(notices.some((n) => n.kind === "done" && /está aprobada/.test(n.text)));
    assert.equal(goalNotices(code, task.id).length, 2, "approval does not wake Bruno");
    assert.equal(code.mustTask(task.id).turns.length, 2);
    await code.checkPrs();
    assert.equal(code.items(task.id).filter((i) => i.text === "La PR #7 está aprobada.").length, 1, "said once");
  } finally { await ctx.done(); }
});

const DIFF = [
  "diff --git a/src/app.js b/src/app.js", "index 1..2 100644", "--- a/src/app.js", "+++ b/src/app.js",
  "@@ -1,3 +1,4 @@", " const a = 1;", "+const b = 2;", " const c = 3;", "-const d = 4;", " export { a };",
  "diff --git a/nuevo.md b/nuevo.md", "new file mode 100644", "--- /dev/null", "+++ b/nuevo.md", "@@ -0,0 +1,2 @@", "+# Nuevo", "+texto",
].join("\n") + "\n";

test("the PR diff's lines and the review payload: findings on a diff line inline, the rest in the body", () => {
  const lines = rightLines(DIFF);
  assert.deepEqual([...lines.get("src/app.js")], [1, 2, 3, 4]);
  assert.deepEqual([...lines.get("nuevo.md")], [1, 2]);
  const item = { summary: "Un fallo y dos avisos.", findings: [
    { severity: "P1", title: "Se pierde b", file: "./src/app.js", line: 2, detail: "Si b cambia, se rompe." },
    { severity: "P2", title: "Fuera del diff", file: "src/app.js", line: 40, detail: "Esa línea no cambió." },
    { severity: "P3", title: "Sin archivo", file: null, line: null, detail: "" },
    { severity: "P3", title: "Por el nombre", file: "nuevo.md", line: 1, detail: "" },
  ] };
  const p = reviewPayload(item, { commit: "abc", lines });
  assert.equal(p.commit_id, "abc");
  assert.equal(p.event, "COMMENT");
  assert.deepEqual(p.comments.map((c) => [c.path, c.line, c.side]), [["src/app.js", 2, "RIGHT"], ["nuevo.md", 1, "RIGHT"]]);
  assert.match(p.comments[0].body, /^\*\*P1\*\* Se pierde b\n\nSi b cambia, se rompe\.$/);
  assert.match(p.body, /Un fallo y dos avisos\./);
  assert.match(p.body, /2 comentarios en las líneas\./);
  assert.match(p.body, /- \*\*P2\*\* Fuera del diff \(`src\/app\.js:40`\): Esa línea no cambió\./);
  assert.match(p.body, /- \*\*P3\*\* Sin archivo/);
  assert.doesNotMatch(p.body, /Se pierde b/);
  assert.match(reviewPayload({ summary: "", findings: [] }, { commit: "abc" }).body, /No ha encontrado problemas/);
  assert.match(mergeRefusal("Pull request is not mergeable", { number: 3, base: "dev" }), /conflictos con dev/);
});

test("publishing Código's review on the PR: one GitHub review, once, with errors shown", async () => {
  const ctx = setup("publish");
  const { code, state } = ctx;
  try {
    const task = await followed(ctx);
    const item = code.addItem(task.id, { kind: "review", summary: "Revisado.", findings: [
      { severity: "P1", title: "Se pierde b", file: "src/app.js", line: 2, detail: "Detalle." },
      { severity: "P2", title: "Fuera del diff", file: "src/app.js", line: 40, detail: "" },
    ], files: 1, turnsAt: 0 });
    state.write({ ...state.read(), diff: DIFF, reviewError: "gh: Unprocessable Entity (HTTP 422)\n{\"message\":\"Validation Failed\",\"errors\":[\"Line could not be resolved\"]}" });
    await assert.rejects(code.publishReview(task.id, { item: item.id }), /GitHub no ha aceptado la revisión: Validation Failed \(Line could not be resolved\)/);
    assert.equal(code.store.get("codeItems", item.id).published, undefined);

    state.write({ ...state.read(), reviewError: null });
    const r = await code.publishReview(task.id, { item: item.id });
    const call = state.read().calls.at(-1);
    assert.deepEqual(call.slice(0, 4), ["api", "repos/a/b/pulls/7/reviews", "-X", "POST"]);
    const [posted] = state.read().posted;
    assert.equal(posted.commit_id, "abc");
    assert.deepEqual(posted.comments, [{ path: "src/app.js", line: 2, side: "RIGHT", body: "**P1** Se pierde b\n\nDetalle." }]);
    assert.match(posted.body, /Fuera del diff/);
    assert.equal(r.published.url, "https://github.com/a/b/pull/7#pullrequestreview-555");
    assert.equal(code.store.get("codeItems", item.id).published.number, 7);
    await assert.rejects(code.publishReview(task.id, { item: item.id }), /ya está publicada en la PR #7/);
    assert.equal(state.read().posted.length, 1, "never twice");
    // Its own inline comments never come back to Bruno (even under another login).
    state.write({ ...state.read(), lineComments: [{ id: 31, path: "src/app.js", line: 2, body: "**P1** Se pierde b", user: { login: "bot" }, created_at: new Date(Date.now() + 1000).toISOString(), pull_request_review_id: 555 }] });
    await code.checkPrs();
    assert.equal(goalNotices(code, task.id).length, 0);
  } finally { await ctx.done(); }
});

test("pushing to GitHub without a session: a clear 409 before anything is saved", { timeout: 60000 }, async () => {
  // A Git server that only answers «who are you?» (HTTP 401), under a github.com-looking path.
  const server = http.createServer((_req, res) => { res.writeHead(401, { "WWW-Authenticate": "Basic realm=\"GitHub\"" }); res.end("no"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const ctx = setup("signin");
  const { code, repo, state } = ctx;
  try {
    g(repo, "remote", "add", "origin", `http://127.0.0.1:${server.address().port}/github.com/a/b.git`);
    g(repo, "config", "credential.helper", ""); // no credential manager of this computer
    state.write({ authed: false });
    const project = await code.addProject({ folder: repo });
    const task = await code.createTask({ projectId: project.id, text: "escribe la nota" });
    await idle(code, task.id, 1);
    const cwd = code.mustTask(task.id).cwd;
    const before = g(cwd, "rev-list", "--count", "HEAD");
    await assert.rejects(code.push(task.id), (e) => e.status === 409 && e.signIn === true && /gh auth login/.test(e.message));
    assert.equal(g(cwd, "rev-list", "--count", "HEAD"), before, "nothing was committed");
    assert.match(g(cwd, "status", "--porcelain"), /nota\.txt/);
    // Signed in to gh but Git does not use it yet: «gh auth setup-git».
    code.ghCache = null;
    state.write({ authed: true });
    await assert.rejects(code.pullRequest(task.id), /gh auth setup-git/);
    assert.deepEqual(code.githubHint(), { installed: true, authed: true });
  } finally { await ctx.done(); server.close(); }
});
