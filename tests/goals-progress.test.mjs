import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import {
  goalProgress, nextMilestone, goalsDigest, goalsDigestText, createGoal, linkToGoal, handleGoalTool, acceptGoalSuggestion, goalToolDef, goalToolSchema, normalizeDue,
} from "../server/goals.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-goals-p-")),
    store = new Store(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return store;
}
const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();

test("goalProgress: milestones done / total and finished linked missions (cancelled ignored)", () => {
  const goal = { milestones: [{ id: "a", done: true }, { id: "b", done: false }, { id: "c", done: true }, { id: "d", done: false }] };
  const missions = [{ id: "1", status: "completed" }, { id: "2", status: "running" }, { id: "3", status: "cancelled" }, { id: "1", status: "completed" }];
  assert.deepEqual(goalProgress(goal, missions), { milestonesDone: 2, milestonesTotal: 4, missionsDone: 1, missionsTotal: 2, percent: 50 });
  assert.equal(goalProgress({ milestones: [] }).percent, null, "no milestones → no percentage");
});

test("nextMilestone prefers the earliest dated pending milestone", () => {
  const goal = { milestones: [{ id: "a", done: false }, { id: "b", done: false, dueAt: "2026-11-02T00:00:00Z" }, { id: "c", done: false, dueAt: "2026-10-20T00:00:00Z" }, { id: "d", done: true, dueAt: "2026-10-01T00:00:00Z" }] };
  assert.equal(nextMilestone(goal).id, "c");
  assert.equal(nextMilestone({ milestones: [{ id: "a", done: false }, { id: "b", done: false }] }).id, "a");
  assert.equal(nextMilestone({ milestones: [{ id: "a", done: true }] }), null);
});

test("normalizeDue: date-only → end of the local day; invalid → 400", () => {
  const d = new Date(normalizeDue("2026-10-31"));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 31, 23]);
  assert.equal(normalizeDue(null), null);
  assert.equal(normalizeDue(""), null);
  assert.throws(() => normalizeDue("1800-01-01"), (e) => e.status === 400);
});

test("goalsDigest: overdue milestones or 7 days without progress, active goals only", async (t) => {
  const store = await fixture(t);
  const T = Date.parse("2026-10-15T10:00:00Z");
  const fresh = createGoal(store, { title: "Recién creado", milestones: [{ title: "Algo" }] });
  store.put("goals", { ...fresh, createdAt: iso(T - 2 * DAY) });
  const late = createGoal(store, { title: "Con hito vencido", milestones: [{ title: "Llamar al gestor", dueAt: iso(T - DAY) }, { title: "Firmar", dueAt: iso(T + DAY) }] });
  store.put("goals", { ...late, createdAt: iso(T - 3 * DAY) });
  const stale = createGoal(store, { title: "Parado", milestones: [{ title: "Uno" }] });
  store.put("goals", { ...stale, createdAt: iso(T - 10 * DAY) });
  const paused = createGoal(store, { title: "En pausa", milestones: [{ title: "Uno", dueAt: iso(T - DAY) }] });
  store.put("goals", { ...paused, status: "paused", createdAt: iso(T - 30 * DAY) });
  const done = createGoal(store, { title: "Todo hecho", milestones: [{ title: "Uno" }] });
  store.put("goals", { ...done, createdAt: iso(T - 30 * DAY), milestones: done.milestones.map((m) => ({ ...m, done: true, doneAt: iso(T - 20 * DAY) })) });

  // A linked mission that is still working counts as progress.
  const moving = createGoal(store, { title: "Se mueve", milestones: [{ title: "Uno" }] });
  store.put("goals", { ...moving, createdAt: iso(T - 20 * DAY) });
  store.put("missions", { id: "m1", title: "Trabajo", status: "running", createdAt: iso(T - DAY), updatedAt: iso(T - DAY) });
  linkToGoal(store, { goalId: moving.id, milestoneId: moving.milestones[0].id, missionId: "m1" });
  store.put("goals", { ...store.get("goals", moving.id), progressAt: iso(T - 15 * DAY) });

  const digest = goalsDigest(store, T);
  assert.deepEqual(digest.map((d) => d.title).sort(), ["Con hito vencido", "Parado"]);
  const l = digest.find((d) => d.title === "Con hito vencido");
  assert.equal(l.overdue.length, 1);
  assert.equal(l.overdue[0].title, "Llamar al gestor");
  assert.equal(l.stale, false);
  assert.equal(l.url, "/objetivos/" + late.id);
  assert.equal(l.ownerBotId, "atlas");
  assert.match(l.text, /«Llamar al gestor» está vencido/);
  const s = digest.find((d) => d.title === "Parado");
  assert.equal(s.stale, true);
  assert.match(s.text, /sin avance desde hace 10 días/);
  assert.match(goalsDigestText(digest), /^2 objetivos necesitan un empujón/);
  assert.equal(goalsDigestText([]), "");
  assert.equal(goalsDigest(store, T - 9 * DAY).length, 0, "nothing to report earlier on");
});

test("propose_goal tool: strict definition, suggestion (never a goal), no repeats, accept creates it", async (t) => {
  const store = await fixture(t);
  assert.equal(goalToolDef.name, "propose_goal");
  assert.equal(goalToolDef.strict, true);
  assert.deepEqual(goalToolDef.parameters.required, Object.keys(goalToolDef.parameters.properties));
  assert.throws(() => goalToolSchema.parse({ title: "x" }));

  const bot = store.get("bots", "nora");
  const args = { title: "Publicar el informe anual", why: "Lo pide la junta", dueAt: "2026-12-15", milestones: [{ title: "Reunir los datos", dueAt: "" }, { title: "Redactar el borrador", dueAt: "2026-11-30" }], reason: "Llevas tres misiones sobre esto." };
  const r = handleGoalTool(store, { bot, mission: { id: "m1" }, args: JSON.stringify(args) });
  assert.equal(r.proposed, true);
  assert.equal(store.list("goals").length, 0, "a bot never creates goals");
  const s = store.get("suggestions", r.suggestionId);
  assert.equal(s.kind, "goal");
  assert.equal(s.status, "pending");
  assert.equal(s.botId, "nora");
  assert.equal(s.cta, "Crear objetivo");
  assert.match(s.text, /^Nora propone el objetivo «Publicar el informe anual» con 2 hitos\./);
  assert.equal(s.payload.milestones[0].dueAt, null);
  assert.equal(handleGoalTool(store, { bot, args }).proposed, false, "same proposal twice is ignored");

  const goal = acceptGoalSuggestion(store, s);
  assert.equal(goal.title, "Publicar el informe anual");
  assert.equal(goal.milestones.length, 2);
  assert.equal(goal.ownerBotId, "atlas");
  assert.equal(goal.proposedBy, "nora");
  assert.equal(store.get("suggestions", s.id).status, "accepted");
  assert.throws(() => acceptGoalSuggestion(store, store.get("suggestions", s.id)), (e) => e.status === 409);
  assert.equal(handleGoalTool(store, { bot, args: { ...args, title: "publicar el informe ANUAL" } }).proposed, false, "an existing goal is not proposed again");
});
