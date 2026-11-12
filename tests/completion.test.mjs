import test from "node:test";
import assert from "node:assert/strict";
import { COMPLETION_KEEP_MS, completable, completionSummary, freshCompletions, tookText } from "../src/lib/completion.js";
import { weekRange, weekSummary } from "../src/lib/week.js";

// A visible end when work finishes (src/lib/completion.js) and the weekly card's count.

const NOW = Date.parse("2026-11-12T10:00:00");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const bots = [{ id: "atlas", name: "Atlas" }, { id: "nora", name: "Nora" }, { id: "tomas", name: "Tomás" }];
const task = (extra = {}) => ({ id: "m1", title: "Comparativa de proveedores de luz", room: "luz", botIds: ["atlas", "nora", "tomas"], conversation: false, status: "completed", createdAt: ago(20), completedAt: ago(6), ...extra });
const artifacts = [
  { id: "a1", missionId: "m1", title: "Comparativa", createdAt: ago(10) },
  { id: "a2", missionId: "m1", title: "Cálculo del ahorro", createdAt: ago(8) },
  { id: "c1", missionId: "chat", title: "Tabla", createdAt: ago(3) },
  { id: "c0", missionId: "chat", title: "De ayer", createdAt: ago(1500) },
];

test("the summary of a finished task: what it delivered, how long it took, one next action", () => {
  const s = completionSummary(task({ recap: { text: "Lumen sale un 11 % más barato. Te dejo el cálculo." }, suggestions: ["Prepara el cambio a Lumen", "Pásalo a una hoja", "Otra", "Cuarta"] }), { artifacts, bots });
  assert.deepEqual(s, {
    id: "m1", title: "Comparativa de proveedores de luz", line: "Lumen sale un 11 % más barato",
    who: "Atlas, Nora y Tomás", took: "14 min",
    deliverables: [{ id: "a1", title: "Comparativa", href: "/biblioteca?abrir=a1" }, { id: "a2", title: "Cálculo del ahorro", href: "/biblioteca?abrir=a2" }],
    open: { label: "Abrir", href: "/encargo/m1" },
    suggestions: ["Prepara el cambio a Lumen", "Pásalo a una hoja", "Otra"],
    href: "/encargo/m1", at: ago(6),
  });
  // One deliverable: «Abrir» opens it.
  assert.equal(completionSummary(task(), { artifacts: artifacts.slice(0, 1), bots }).open.href, "/biblioteca?abrir=a1");
  // Nothing delivered: a task still ends, and «Abrir» opens the task.
  const bare = completionSummary(task({ botIds: ["nora"] }), { artifacts: [], bots });
  assert.deepEqual([bare.who, bare.deliverables.length, bare.open.href, bare.suggestions.length], ["Nora", 0, "/encargo/m1", 0]);
  assert.deepEqual([tookText(20000), tookText(14 * 60000), tookText(3 * 3600e3), tookText(50 * 3600e3), tookText(0)], ["menos de 1 min", "14 min", "3 h", "2 días", null]);
});

test("a chat gets its moment only when that turn delivered something", () => {
  const chat = { id: "chat", title: "Oferta de limpieza", botIds: ["nora"], conversation: true, status: "completed", createdAt: ago(5000), completedAt: ago(2) };
  assert.equal(completionSummary(chat, { artifacts: [], bots }), null, "an answer is not an event");
  const s = completionSummary(chat, { artifacts, bots, startedAt: NOW - 4 * 60000 });
  assert.deepEqual(s.deliverables.map((d) => d.id), ["c1"], "what this turn made, not yesterday's");
  assert.equal(s.took, "2 min");
  assert.equal(s.open.href, "/biblioteca?abrir=c1");
  assert.equal(s.href, "/chat/nora?c=chat");
  // Its start was not seen (the window opened later): the time is left out, never guessed from the first message.
  assert.equal(completionSummary(chat, { artifacts, bots }).took, null);
});

test("never for a routine with nothing new, the watching bot, incognito or archived work", () => {
  assert.equal(completable(task()), true);
  assert.equal(completable(task({ automationId: "r1", nothingNew: true })), false);
  assert.equal(completable(task({ automationId: "r1" })), true, "a routine that brought something does end visibly");
  for (const extra of [{ watch: true }, { incognito: true }, { archived: true }, { status: "running" }, { status: "paused" }]) assert.equal(completable(task(extra)), false, JSON.stringify(extra));
  assert.equal(completionSummary(task({ automationId: "r1", nothingNew: true }), { artifacts, bots }), null);
});

test("only what finished while you were in the app, until you close it or it gets old", () => {
  const state = { missions: [task(), task({ id: "old", completedAt: ago(90) }), task({ id: "m2", title: "Otra", completedAt: ago(1) }), task({ id: "run", status: "running", completedAt: null })], artifacts, bots };
  const since = NOW - 30 * 60000; // the window opened half an hour ago
  assert.deepEqual(freshCompletions(state, { since, now: NOW }).map((s) => s.id), ["m2", "m1"], "newest first; what finished before is history");
  assert.deepEqual(freshCompletions(state, { since, now: NOW, dismissed: new Set(["m2:" + ago(1)]) }).map((s) => s.id), ["m1"]);
  assert.deepEqual(freshCompletions(state, { since, now: NOW + COMPLETION_KEEP_MS }).map((s) => s.id), [], "it leaves by itself");
  assert.deepEqual(freshCompletions(state, { since: NOW, now: NOW }), [], "a window opened now starts clean");
  // A chat that finishes again (a new turn) is a new moment, not the one you closed.
  const again = { ...state, missions: [task({ completedAt: ago(0.5) })] };
  assert.equal(freshCompletions(again, { since, now: NOW, dismissed: new Set(["m1:" + ago(6)]) }).length, 1);
});

test("the weekly card counts the work that finished this week, also what was asked in a chat", () => {
  const missions = [
    task(),
    { id: "chat", title: "Oferta", botIds: ["nora"], conversation: true, status: "completed", completedAt: ago(190) }, // delivered a table
    { id: "talk", title: "Charla", botIds: ["nora"], conversation: true, status: "completed", completedAt: ago(100) }, // just an answer
    task({ id: "old", completedAt: ago(8 * 1440) }),
    task({ id: "arch", archived: true, completedAt: ago(2000) }),
    task({ id: "quiet", automationId: "r1", nothingNew: true }),
    { id: "watch", conversation: true, watch: true, status: "completed", completedAt: ago(50) },
    task({ id: "run", status: "running" }),
  ];
  const week = weekSummary({ missions, artifacts, approvals: [{ decidedBy: "tú", decidedAt: ago(60) }, { decidedBy: "regla", decidedAt: ago(60) }], skills: [{ status: "pending" }] }, NOW);
  assert.equal(week.done, 3, "the task, the archived task and the chat that delivered");
  assert.equal(week.approved, 1);
  assert.equal(week.skills, 1);
  // Before, a week whose only finished work was asked in a chat read «0 tareas terminadas».
  assert.equal(weekSummary({ missions: [missions[1]], artifacts }, NOW).done, 1);
  assert.equal(weekSummary({ missions: [missions[2]], artifacts }, NOW).done, 0);
  assert.equal(weekRange(Date.parse("2026-11-05T10:00:00"), NOW), "Del 5 al 12 de noviembre");
  assert.equal(weekRange(Date.parse("2026-10-29T10:00:00"), Date.parse("2026-11-05T10:00:00")), "Del 29 de octubre al 5 de noviembre");
});
