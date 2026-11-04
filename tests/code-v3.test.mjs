// Colmena 3 · Código (design/V3Codigo.dc.html, V3CodigoComparar.dc.html): the state of each
// task in words, the three parts of the list, Bruno's steps and which engine to keep.
import test from "node:test";
import assert from "node:assert/strict";
import { pillOf, sectionOf, homeSections, recommendOf, stepsOf, durationLabel } from "../src/components/v2/code/model.js";
import { todoList } from "../server/code/service.mjs";

test("a task says where it is in words; honey only when it needs you", () => {
  assert.equal(pillOf({ running: true }).text, "Trabajando");
  assert.equal(pillOf({ status: "waiting" }).tone, "honey");
  assert.equal(pillOf({ status: "error" }).text, "Atascada");
  assert.equal(pillOf({ turns: 2, pr: { checks: "failing", state: "OPEN" } }).text, "Falla el CI");
  assert.equal(pillOf({ turns: 2, pr: { state: "MERGED" } }).text, "Fusionada");
  assert.equal(pillOf({ turns: 2 }).text, "Revisar");
  assert.equal(pillOf({ turns: 0 }).tone, "quiet");
  const now = new Date(2026, 10, 4, 10, 0);
  assert.equal(pillOf({ snoozed: { until: new Date(2026, 10, 5, 9, 0).toISOString() } }, now).text, "Vuelve mañana");
});

test("the list has three parts and the archived shelf; several engines are one row", () => {
  assert.equal(sectionOf({ turns: 1 }), "wait");
  assert.equal(sectionOf({ running: true }), "work");
  assert.equal(sectionOf({ snoozed: { until: "x" } }), "later");
  assert.equal(sectionOf({ turns: 1, saved: { at: "x" } }), "later");
  assert.equal(sectionOf({ archived: { at: "x" } }), "archived");
  const tasks = [
    { id: "a", title: "Bizum · Claude Code · Opus 5.5", group: "cg-1", turns: 1, updatedAt: "2026-11-04T10:00:00Z" },
    { id: "b", title: "Bizum · Codex · GPT", group: "cg-1", turns: 1, updatedAt: "2026-11-04T10:05:00Z" },
    { id: "c", title: "CSV", running: true, updatedAt: "2026-11-04T09:00:00Z" },
    { id: "d", title: "Pin", turns: 1, pinned: true, updatedAt: "2026-11-01T09:00:00Z" },
  ];
  const s = homeSections(tasks);
  assert.deepEqual(s.map((x) => x.key), ["wait", "work"]);
  assert.equal(s[0].rows[0].task?.id, "d", "pinned first");
  const cmp = s[0].rows.find((r) => r.kind === "compare");
  assert.equal(cmp.title, "Bizum");
  assert.equal(cmp.tasks.length, 2);
  // Once one is chosen (the others archived), it is a task again.
  const after = homeSections([{ ...tasks[0] }, { ...tasks[1], archived: { at: "x" } }]);
  assert.equal(after.find((x) => x.key === "wait").rows[0].kind, "task");
});

test("the recommendation is what can be checked: tests, then the smallest change", () => {
  const t = (id, status, add = 10, del = 0) => ({ id, tests: status ? { status } : null, add, del, files: [{ path: "a" }] });
  assert.equal(recommendOf([t("a", null), t("b", null)]), null);
  assert.equal(recommendOf([{ ...t("a", "passed"), running: true }, t("b", "failed")]), null);
  assert.equal(recommendOf([t("a", "passed"), t("b", "failed"), t("c", "failed")]).id, "a");
  assert.match(recommendOf([t("a", "passed"), t("b", "failed"), t("c", "failed")]).why, /único/);
  assert.equal(recommendOf([t("a", "passed", 120, 9), t("b", "passed", 60, 4)]).id, "b");
  assert.equal(recommendOf([t("a", "failed"), t("b", "failed")]), null);
});

test("Bruno's steps come from his newest TodoWrite list", () => {
  assert.deepEqual(todoList([{ content: "Colores a variables", status: "completed" }, { content: "Contraste", status: "in_progress" }, { content: "Capturas", status: "pending" }, { content: " " }]),
    [{ text: "Colores a variables", status: "done" }, { text: "Contraste", status: "now" }, { text: "Capturas", status: "todo" }]);
  assert.equal(todoList(null), null);
  assert.equal(todoList([]), null);
  const items = [{ kind: "tool", todos: [{ text: "uno", status: "todo" }] }, { kind: "text" }, { kind: "tool", todos: [{ text: "uno", status: "done" }] }];
  assert.equal(stepsOf(items)[0].status, "done");
  assert.equal(stepsOf([{ kind: "text" }]), null);
  assert.equal(durationLabel(6 * 60000), "6 min");
  assert.equal(durationLabel(45000), "45 s");
  assert.equal(durationLabel(80 * 60000), "1 h 20 min");
  assert.equal(durationLabel(0), null);
});
