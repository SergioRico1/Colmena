import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { roomSlug, titleFromPrompt, clipWords } from "../server/runtime.mjs";

const planner = (assignments, summary = "Reparto propuesto") => async ({ input, tools }) => {
  if (tools.some((x) => x.name === "propose_plan")) {
    const done = outputs(input);
    const last = done.at(-1);
    if (!last || last.approved === false) return call("propose_plan", { assignments, summary }, "plan-" + done.length);
    return answer("Plan en marcha");
  }
  return answer("Trabajo hecho");
};

test("by default the team plan starts on its own: no «Aprobar plan»", async (t) => {
  const { store, runtime } = await fixture(t, planner([{ botId: "nora", task: "Busca datos" }, { botId: "tomas", task: "Calcula" }]));
  const m = runtime.create({ prompt: "Informe Q3 de ventas", mode: "equipo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  await settle(runtime);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "completed");
  assert.deepEqual(mission.steps, ["plan", "work-nora", "work-tomas", "synthesis"]);
  const approval = store.list("approvals").find((a) => a.kind === "plan");
  assert.equal(approval.status, "approved");
  assert.equal(approval.decidedBy, "regla");
  assert.match(approval.resolution, /Arranca solo/);
  // The room shows the plan as running (stop / change), never «Aprobado por ti».
  const planMessage = store.list("messages").find((x) => x.kind === "plan");
  assert.deepEqual([planMessage.plan.approved, planMessage.plan.auto], [true, true]);
  assert.equal(store.events(m.id).some((e) => e.type === "plan_proposed"), false);
  assert.throws(() => runtime.planDecision(m.id, "approved"), /No hay un plan pendiente/);
});

test("with Atlas on «Solo sugiere» the plan waits for approval, then creates work steps and synthesis", async (t) => {
  const { store, runtime } = await fixture(t, planner([{ botId: "nora", task: "Busca datos" }, { botId: "tomas", task: "Calcula" }]));
  store.patch("bots", "atlas", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Informe Q3 de ventas", mode: "equipo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "awaiting_plan");
  const approval = store.list("approvals").find((a) => a.kind === "plan");
  assert.equal(approval.status, "pending");
  assert.deepEqual(approval.plan.assignments.map((a) => a.botId), ["nora", "tomas"]);
  const planMessage = store.list("messages").find((x) => x.kind === "plan");
  assert.equal(planMessage.plan.approved, false);
  assert.equal(runtime.steps(m.id).length, 1);
  runtime.planDecision(m.id, "approved");
  await settle(runtime);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "completed");
  assert.deepEqual(mission.steps, ["plan", "work-nora", "work-tomas", "synthesis"]);
  assert.equal(store.get("messages", planMessage.id).plan.approved, true);
  assert.equal(store.get("approvals", approval.id).decidedBy, "tú");
  // Resuming after your OK is not a failure: the plan step shows no error.
  const planStep = runtime.steps(m.id).find((s) => s.key === "plan");
  assert.ok((planStep.activity || []).every((e) => e.status !== "error"), "plan step has no failed tool");
  assert.ok(store.list("receipts").filter((r) => r.tool === "propose_plan").every((r) => !r.result.error));
  const work = runtime.steps(m.id).find((s) => s.key === "work-tomas");
  assert.equal(work.task, "Calcula");
  assert.match(work.title, /Tomás/);
  assert.ok(work.words > 0);
});

test("asking for changes sends the note back to Atlas, who proposes again", async (t) => {
  const seenNotes = [];
  const { store, runtime } = await fixture(t, async (request) => {
    const prior = outputs(request.input).at(-1);
    if (prior?.approved === false) seenNotes.push(prior.changes);
    return planner([{ botId: "vera", task: "Redacta" }, { botId: "vera", task: "Revisa" }])(request);
  });
  store.patch("bots", "atlas", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Nota de prensa", mode: "equipo", botIds: ["vera"] });
  await runtime.launch(m.id);
  runtime.planDecision(m.id, "changes", "Que Vera lo haga mas corto");
  await settle(runtime);
  assert.deepEqual(seenNotes, ["Que Vera lo haga mas corto"]);
  assert.equal(store.get("missions", m.id).status, "awaiting_plan");
  assert.equal(store.list("approvals").filter((a) => a.kind === "plan").length, 2);
  assert.throws(() => runtime.planDecision(m.id, "changes", ""), /cambiar/);
  runtime.planDecision(m.id, "approved");
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("without botIds Atlas chooses among team bots; autonomy 'solo' approves by rule", async (t) => {
  const { store, runtime } = await fixture(t, planner([{ botId: "Bruno", task: "Programa el script" }]));
  store.patch("bots", "atlas", { autonomy: "solo" });
  const m = runtime.create({ prompt: "Script de limpieza", mode: "equipo" });
  assert.deepEqual(m.botIds, []);
  await runtime.launch(m.id);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "completed");
  assert.deepEqual(mission.botIds, ["bruno"]);
  assert.equal(store.list("approvals").find((a) => a.kind === "plan").decidedBy, "regla");
});

test("plan rejects bots outside the selection and private bots", async (t) => {
  let attempts = 0;
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    if (!tools.some((x) => x.name === "propose_plan")) return answer("ok");
    const prior = outputs(input).at(-1);
    attempts++;
    if (!prior) return call("propose_plan", { assignments: [{ botId: "iris", task: "Disena" }], summary: "x x x" }, "p1");
    assert.match(prior.error, /no válidos/);
    return call("propose_plan", { assignments: [{ botId: "nora", task: "Investiga" }, { botId: "nora", task: "Resume" }], summary: "Nora investiga" }, "p2");
  });
  store.patch("bots", "atlas", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Estudio", mode: "equipo", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.equal(attempts, 2);
  assert.equal(store.get("missions", m.id).status, "awaiting_plan");
});

test("room slugs are short, lowercase and unique", () => {
  assert.equal(roomSlug("Informe Q3"), "informe-q3");
  assert.equal(roomSlug("Informe Q3", new Set(["informe-q3"])), "informe-q3-2");
  assert.equal(roomSlug("Prepara el análisis de la campaña de otoño"), "prepara-analisis-campana");
  assert.equal(roomSlug("¡¡!!"), "sala");
});

test("a message while the plan waits becomes a change request", async (t) => {
  const { store, runtime } = await fixture(t, planner([{ botId: "nora", task: "Investiga" }, { botId: "nora", task: "Resume" }]));
  store.patch("bots", "atlas", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Mercado", mode: "equipo", botIds: ["nora"] });
  await runtime.launch(m.id);
  runtime.addMessage(m.id, "Incluye a la competencia");
  assert.equal(store.list("approvals").find((a) => a.kind === "plan").note, "Incluye a la competencia");
  await settle(runtime);
});

test("titles drop the request wrapping and rooms get meaningful names", () => {
  const title = titleFromPrompt("Quiero que me ayudes a buscar planes para hacer en Valladolid (España) este domingo");
  assert.equal(title, "Buscar planes para hacer en Valladolid (España) este domingo");
  assert.equal(roomSlug(title), "planes-valladolid-espana");
  assert.equal(titleFromPrompt("Resume el correo de ayer"), "Resume el correo de ayer");
  assert.equal(clipWords("una frase bastante larga que hay que cortar", 20), "una frase bastante…");
});
