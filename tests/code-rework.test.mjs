// The reworked «Código»: the list groups, the one next action, the CI in words, the diff navigation
// model, and the QA seed (scripts/seed-code-qa.mjs) covering every state the screen knows.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { listGroupOf, listSections, needOf, stateText, ciOf, nextAction, fileStatusOf, splitPath, fileTree, hunkStarts, stepHunk, stepFile, findingsByLine } from "../src/components/v2/code/flow.js";
import { parsePatch } from "../src/components/v2/code/model.js";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const pr = (extra = {}) => ({ number: 7, url: "https://github.com/a/b/pull/7", state: "OPEN", checks: "passing", mergeable: "MERGEABLE", isDraft: false, reviewDecision: null, ...extra });

test("the list puts what needs the person first, and honey only on decisions", () => {
  assert.equal(listGroupOf({ status: "waiting", turns: 1 }), "needs");
  assert.equal(listGroupOf({ status: "planned", turns: 1 }), "needs");
  assert.equal(listGroupOf({ status: "error", turns: 1 }), "needs");
  assert.equal(listGroupOf({ status: "idle", turns: 1, add: 3, merging: { base: "main" } }), "needs");
  assert.equal(listGroupOf({ status: "idle", turns: 1, add: 3, pr: pr({ checks: "failing" }) }), "needs");
  assert.equal(listGroupOf({ status: "idle", turns: 2, add: 3, review: { turns: 2, serious: 1 } }), "needs");
  // An old review (made before the last turn) no longer holds the task.
  assert.equal(listGroupOf({ status: "idle", turns: 3, add: 3, review: { turns: 2, serious: 1 } }), "ready");
  assert.equal(listGroupOf({ status: "working", running: true, turns: 1 }), "running");
  assert.equal(listGroupOf({ status: "idle", turns: 1, add: 4 }), "ready");
  assert.equal(listGroupOf({ status: "idle", turns: 1, add: 4, pr: pr() }), "ready");
  assert.equal(listGroupOf({ status: "idle", turns: 1, add: 4, saved: { at: "x" } }), "done");
  assert.equal(listGroupOf({ status: "idle", turns: 1, add: 4, pr: pr({ state: "MERGED" }) }), "done");
  assert.equal(listGroupOf({ status: "idle", turns: 1 }), "done", "it answered without changing files");
  assert.equal(listGroupOf({ status: "waiting", snoozed: { until: "x" } }), "snoozed");
  assert.equal(listGroupOf({ status: "waiting", archived: { at: "x" } }), "archived");
  assert.equal(needOf({ status: "waiting" }).tone, "honey");
  assert.equal(needOf({ status: "planned" }).tone, "honey");
  assert.equal(needOf({ status: "error" }).tone, "error");
  assert.equal(needOf({ status: "idle", turns: 1, pr: pr({ checks: "failing" }) }).tone, "error", "a failing CI is red, never honey");
  assert.equal(needOf({ status: "idle", merging: { base: "dev" } }).text, "Conflictos con dev");
  assert.equal(needOf({ status: "working", running: true }), null);
  assert.equal(stateText({ status: "idle", turns: 1, add: 1 }), "Lista para guardar");
  assert.equal(stateText({ status: "idle", turns: 1, add: 1, pr: pr({ isDraft: true }) }), "PR en borrador");
  assert.equal(stateText({ status: "idle", turns: 1, add: 1, saved: { at: "x" }, base: "main" }), "Guardada en main");
  const sections = listSections([
    { id: "a", status: "idle", turns: 1, add: 1, updatedAt: "2026-01-01" },
    { id: "b", status: "waiting", turns: 1, updatedAt: "2026-01-02" },
    { id: "c", status: "idle", turns: 1, add: 1, updatedAt: "2026-01-03", pinned: true },
    { id: "d", status: "idle", turns: 1, add: 1, updatedAt: "2026-01-04" },
  ]);
  assert.deepEqual(sections.map((s) => s.key), ["needs", "ready"]);
  assert.deepEqual(sections[1].tasks.map((t) => t.id), ["c", "d", "a"], "pinned first, newest next");
});

test("the CI of a task in words", () => {
  assert.equal(ciOf({}), null);
  assert.equal(ciOf({ pr: pr({ state: "CLOSED", checks: "failing" }) }), null);
  assert.deepEqual(ciOf({ pr: pr({ checks: "failing" }) }), { state: "failing", text: "CI falla" });
  assert.equal(ciOf({ pr: pr({ checks: "pending" }) }).state, "pending");
  assert.equal(ciOf({ pr: pr({ checks: "none" }) }), null);
});

test("one next action, and none while Bruno works", () => {
  const base = { status: "idle", turns: 1, add: 3, isolated: true, base: "main" };
  assert.equal(nextAction({ ...base, running: true, status: "working" }), null);
  assert.equal(nextAction(base, { pendingAsk: { ask: "redline" } }).label, "Decidir la línea roja");
  assert.equal(nextAction(base, { pendingAsk: { ask: "question" } }).id, "answer");
  assert.equal(nextAction(base, { openPlan: { id: "p" } }).id, "implement");
  assert.equal(nextAction({ ...base, status: "error" }).id, "write");
  assert.equal(nextAction({ ...base, review: { turns: 1 } }, { findings: [{ severity: "P1" }] }).id, "fix");
  assert.equal(nextAction({ ...base, pr: pr({ checks: "failing" }) }).id, "fix");
  assert.equal(nextAction({ ...base, merging: { base: "main" } }).label, "Volver a fusionar en main");
  assert.equal(nextAction({ ...base, pr: pr({ mergeable: "CONFLICTING" }) }).id, "catchup");
  assert.equal(nextAction({ ...base, pr: pr({ isDraft: true, checks: "pending" }) }).id, "pr-ready");
  assert.deepEqual(nextAction({ ...base, pr: pr({ reviewDecision: "APPROVED" }) }), { id: "merge-pr", label: "Fusionar la PR #7" });
  assert.equal(nextAction({ ...base, pr: pr({ reviewDecision: "APPROVED", checks: "pending" }) }).id, "open-pr", "no merge while the CI runs");
  assert.equal(nextAction({ ...base, pr: pr() }).id, "open-pr");
  assert.equal(nextAction(base, { canSave: true }).label, "Fusionar en main");
  assert.equal(nextAction({ ...base, isolated: false }, { canSave: true }).label, "Guardar");
  assert.equal(nextAction({ ...base, saved: { at: "x" } }, { canSave: true }), null);
  assert.equal(nextAction({ ...base, add: 0 }, { canSave: true }), null, "nothing to save");
  assert.equal(nextAction(base, { canSave: false }), null);
});

test("the diff: file states, the tree, and moving through hunks and files", () => {
  assert.equal(fileStatusOf({ status: "A" }).letter, "A");
  assert.equal(fileStatusOf({ status: "D" }).tone, "error");
  assert.equal(fileStatusOf({ status: "M", from: "old.js" }).letter, "R");
  assert.equal(fileStatusOf({ status: "M" }).label, "Cambiado");
  assert.deepEqual(splitPath("src/api/client.js"), { dir: "src/api/", name: "client.js" });
  assert.deepEqual(splitPath("README.md"), { dir: "", name: "README.md" });
  const tree = fileTree([{ path: "src/b.js" }, { path: "README.md" }, { path: "src/a.js" }, { path: "lib/x.mjs" }]);
  assert.deepEqual(tree.map((g) => [g.dir, g.files.map((f) => f.path)]), [["", ["README.md"]], ["lib/", ["lib/x.mjs"]], ["src/", ["src/a.js", "src/b.js"]]]);
  const rows = parsePatch("@@ -1,2 +1,2 @@\n-a\n+b\n c\n@@ -10,1 +10,2 @@ fn\n x\n+y\n");
  assert.deepEqual(hunkStarts(rows), [0, 4]);
  assert.deepEqual(hunkStarts([]), []);
  // Three files: 2 hunks, none (binary), 1 hunk.
  const counts = [2, 0, 1];
  assert.deepEqual(stepHunk(counts, null, 1), { file: 0, hunk: 0 });
  assert.deepEqual(stepHunk(counts, null, -1), { file: 2, hunk: 0 });
  assert.deepEqual(stepHunk(counts, { file: 0, hunk: 1 }, 1), { file: 2, hunk: 0 }, "the file without hunks is skipped");
  assert.deepEqual(stepHunk(counts, { file: 2, hunk: 0 }, 1), { file: 2, hunk: 0 }, "it stays at the end");
  assert.deepEqual(stepHunk(counts, { file: 0, hunk: 0 }, -1), { file: 0, hunk: 0 });
  assert.equal(stepHunk([0, 0], null, 1), null);
  assert.equal(stepFile(3, 2, 1), 0);
  assert.equal(stepFile(3, 0, -1), 2);
  assert.equal(stepFile(3, null, 1), 0);
  assert.equal(stepFile(0, 0, 1), null);
  const byLine = findingsByLine([{ file: "customers.mjs", line: 6, title: "a" }, { file: "lib/customers.mjs", line: 6, title: "b" }, { file: "other.js", line: 6 }, { file: "lib/customers.mjs" }], "lib/customers.mjs");
  assert.deepEqual([...byLine.keys()], [6]);
  assert.deepEqual(byLine.get(6).map((f) => f.title), ["a", "b"]);
});

test("the QA seed writes every state the screen knows, with real restore points", { timeout: 240000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-code-qa-"));
  try {
    await run(process.execPath, [path.join(root, "scripts", "seed-code-qa.mjs")], { cwd: root, env: { ...process.env, COLMENA_DATA_DIR: dir }, timeout: 200000 });
    const { Store } = await import("../server/store.mjs");
    const store = new Store(dir);
    const tasks = store.list("codeTasks");
    const items = store.list("codeItems");
    assert.ok(tasks.length >= 8, "5-8 tasks at least");
    assert.equal(store.list("codeProjects").length, 3);
    // As the server shows them (taskView): totals and turn counts.
    const view = (t) => ({ ...t, turns: t.turns.length, add: t.turns.reduce((n, x) => n + x.add, 0), del: t.turns.reduce((n, x) => n + x.del, 0), lastChanged: [...t.turns].reverse().find((x) => x.files.length)?.n || null });
    const shown = tasks.map(view);
    const groups = new Set(shown.map(listGroupOf));
    // «running» is driven by --serve (a working task in the store would be resumed with a real engine).
    for (const g of ["needs", "ready", "done", "archived"]) assert.ok(groups.has(g), "a task in «" + g + "»");
    const ctx = (t) => {
      const mine = items.filter((i) => i.taskId === t.id);
      const review = [...mine].reverse().find((i) => i.kind === "review");
      return { pendingAsk: mine.find((i) => i.kind === "ask" && i.status === "pending") || null, openPlan: mine.find((i) => i.kind === "plan" && i.status === "open") || null, findings: review && t.review?.turns === t.turns ? review.findings : [], canSave: !!t.isolated };
    };
    const actions = new Set(shown.map((t) => nextAction(t, ctx(t))?.id).filter(Boolean));
    for (const a of ["answer", "implement", "fix", "save", "merge-pr", "pr-ready", "write"]) assert.ok(actions.has(a), "a task whose next action is «" + a + "»");
    assert.ok(items.some((i) => i.kind === "ask" && i.ask === "redline" && /git push/.test(i.command)), "a red line: push asks");
    const review = items.find((i) => i.kind === "review" && i.findings.length);
    assert.deepEqual([...new Set(review.findings.map((f) => f.severity))].sort(), ["P0", "P1", "P2", "P3"]);
    assert.ok(shown.some((t) => t.pr?.checks === "failing") && shown.some((t) => t.pr?.checks === "passing") && shown.some((t) => t.pr?.checks === "pending"));
    assert.ok(shown.every((t) => !t.pr?.watching), "nothing asks GitHub");
    assert.ok(shown.some((t) => t.merging), "conflicts with the base");
    assert.equal(new Set(shown.filter((t) => t.group).map((t) => t.engine)).size, 2, "a comparison of two engines");
    assert.equal(store.list("peerCodeMirrors").length, 1, "a task shared by a person");
    assert.equal(store.list("peerCodeHandoffs").length, 1, "a handoff");
    // The restore points are real: the hidden store has the commits each turn points at.
    const { Snapshots } = await import("../server/code/git.mjs");
    const t = tasks.find((x) => x.turns.some((y) => y.files.length) && x.isolated);
    const snaps = new Snapshots({ key: t.id, dir: path.join(dir, "code", "snapshots", t.id), root: t.cwd });
    const d = await snaps.diff(t.baseSnap, t.turns.at(-1).endSnap);
    assert.ok(d.files.length >= 1 && d.files[0].patch.includes("@@"));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
});
