import { undoLearned } from "../server/learned.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { importSkill, activateSkill, skillDetail, resolveSkillApproval } from "../server/skills.mjs";
import { suggestAutomation, suggestAlwaysApprove, decideSuggestion, jaccard, containsSecret } from "../server/learning.mjs";
import { readSoul } from "../server/soul.mjs";

const SKILL = "---\nname: informe-ventas\ndescription: Prepara el informe de ventas\n---\n# Informe\n## Pasos\n1. Lee los datos.\n2. Calcula totales.\n3. Redacta.\n## Comprobacion\nCifras cuadran.\n## Limites\nSin datos inventados.";
const reflection = (over = {}) => JSON.stringify({
  skill: { action: "none", targetSkillId: null, name: "", description: "", content: "" },
  memories: [],
  soul: null,
  ...over,
});
/** Worker that makes `n` tool calls before answering; reflection returns `reflect()`. */
function worker(n, reflect, extra = () => null) {
  return async (request) => {
    if (request.instructions.startsWith("Extrae")) return answer(typeof reflect === "function" ? reflect(request) : reflect);
    const special = extra(request);
    if (special) return special;
    const done = outputs(request.input).length;
    return done < n ? call("list_files", {}, "c" + done) : answer("Terminado");
  };
}

test("complex mission (≥5 tool calls) creates a learned skill that is active at once, with «Aprendido» and Deshacer", async (t) => {
  const { store, runtime } = await fixture(t, worker(5, reflection({ skill: { action: "create", targetSkillId: null, name: "informe-ventas", description: "x", content: SKILL } })));
  store.patch("settings", "main", { learning: true });
  const m = runtime.create({ prompt: "Prepara el informe de ventas" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.equal(store.get("missions", m.id).learningStatus, "completed");
  const [skill] = store.list("skills");
  assert.equal(skill.status, "active", "like Hermes: used from now on");
  assert.equal(skill.origin, "learned");
  assert.equal(skill.botId, "nora");
  assert.equal(skill.steps, 3);
  assert.match(skill.learnedFrom, /tras una tarea de 5 pasos/);
  assert.equal(skill.missionId, m.id);
  assert.equal(store.list("approvals").filter((a) => a.kind === "skill" && a.status === "pending").length, 0, "nothing waits in the Bandeja");
  const notice = store.list("messages").find((x) => x.missionId === m.id && x.kind === "learned" && x.learned?.type === "skill");
  assert.match(notice.text, /Aprendido: versión 1 de «informe-ventas»/);
  undoLearned(store, notice.id);
  assert.equal(store.get("skills", skill.id).status, "disabled", "Deshacer switches it off");
});

test("simple missions do not create skills even if the model proposes one", async (t) => {
  let reflected = 0;
  const { store, runtime } = await fixture(t, worker(0, () => { reflected++; return reflection({ skill: { action: "create", name: "x", description: "x", content: SKILL } }); }));
  store.patch("settings", "main", { learning: true });
  const m = runtime.create({ prompt: "Hola" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).learningStatus, "skipped");
  assert.equal(reflected, 0);
  assert.equal(store.list("skills").length, 0);
});

test("three similar missions of the same bot count as complex: learnedFrom «tras 3 tareas parecidas»", async (t) => {
  const { store, runtime } = await fixture(t, worker(0, reflection({ skill: { action: "create", name: "resumen", description: "Resume", content: SKILL } })));
  for (const p of ["Resume las ventas semanales de la tienda", "Resume las ventas semanales de la tienda online", "Resume ventas semanales de la tienda"]) {
    if (p.endsWith("online")) store.patch("settings", "main", { learning: false });
    const m = runtime.create({ prompt: p });
    await runtime.launch(m.id);
    store.patch("settings", "main", { learning: true });
  }
  const skill = store.list("skills")[0];
  assert.ok(skill, "skill created on the third similar mission");
  assert.equal(skill.learnedFrom, "tras 3 tareas parecidas");
});

test("patch of a used skill makes a new active version; Deshacer brings the previous one back", async (t) => {
  const improved = SKILL.replace("3. Redacta.", "3. Revisa unidades.\n4. Redacta.");
  let skillId;
  const { store, runtime } = await fixture(t, worker(0, () => reflection({ skill: { action: "patch", targetSkillId: skillId, name: "informe-ventas", description: "Mejorada", content: improved } }),
    ({ input }) => (outputs(input).length ? null : call("read_skill", { id: skillId }, "rs"))));
  store.patch("settings", "main", { learning: true });
  const original = importSkill(store, { content: SKILL, botId: "nora" });
  activateSkill(store, original.id, "active");
  skillId = original.id;
  const m = runtime.create({ prompt: "Informe de ventas" });
  await runtime.launch(m.id);
  const versions = store.list("skills");
  assert.equal(versions.length, 2);
  const v2 = versions[1];
  assert.equal(v2.version, 2);
  assert.equal(v2.previous, original.id);
  assert.equal(v2.status, "active");
  assert.notEqual(store.get("skills", original.id).status, "active", "the old version steps aside");
  assert.equal(skillDetail(store, v2.id).previous.content, SKILL);
  const notice = store.list("messages").find((x) => x.missionId === m.id && x.kind === "learned" && x.learned?.type === "skill");
  undoLearned(store, notice.id);
  assert.equal(store.get("skills", original.id).status, "active", "Deshacer: the previous version again");
  assert.notEqual(store.get("skills", v2.id).status, "active");
  void resolveSkillApproval;
});

test("autonomy 'solo' activates a patch of an already active skill and records the event", async (t) => {
  let skillId;
  const { store, runtime } = await fixture(t, worker(0, () => reflection({ skill: { action: "patch", targetSkillId: skillId, name: "", description: "", content: SKILL + "\nNota extra." } }),
    ({ input }) => (outputs(input).length ? null : call("read_skill", { id: skillId }, "rs"))));
  store.patch("settings", "main", { learning: true });
  store.patch("bots", "nora", { autonomy: "solo" });
  const original = importSkill(store, { content: SKILL, botId: "nora" });
  activateSkill(store, original.id, "active");
  skillId = original.id;
  const m = runtime.create({ prompt: "Informe" });
  await runtime.launch(m.id);
  const v2 = store.list("skills")[1];
  assert.equal(v2.status, "active");
  assert.equal(store.get("skills", original.id).status, "disabled");
  assert.ok(store.events(m.id).some((e) => e.type === "skill_auto_activated"));
});

test("memories: dedupe, max 3, secrets filtered; soul proposals need approval", async (t) => {
  const { store, runtime } = await fixture(t, worker(5, reflection({
    memories: [
      { text: "Prefiere informes breves", scope: "equipo", kind: "preferencia" },
      { text: "prefiere informes breves.", scope: "equipo", kind: "preferencia" },
      { text: "Su correo es ana@example.com", scope: "bot", kind: "hecho" },
      { text: "El cierre contable es el día 5", scope: "equipo", kind: "hecho" },
      { text: "Nunca usa emojis", scope: "bot", kind: "preferencia" },
      { text: "Trabaja con euros", scope: "equipo", kind: "hecho" },
    ],
    soul: { proposal: "Sé más directa y usa siempre tablas para cifras.", reason: "La persona lo pidió dos veces" },
  })));
  store.patch("settings", "main", { learning: true });
  store.put("memories", { id: "old", text: "El cierre contable es el dia 5", active: true });
  const m = runtime.create({ prompt: "Analiza" });
  await runtime.launch(m.id);
  const learned = store.list("memories").filter((x) => x.missionId === m.id);
  assert.deepEqual(learned.map((x) => x.text), ["Prefiere informes breves", "Nunca usa emojis", "Trabaja con euros"]);
  assert.ok(learned.every((x) => x.source === "dedujo" && x.review === true));
  const soul = store.list("approvals").find((a) => a.kind === "soul");
  assert.ok(soul.diff.some((d) => d.op === "+" && /tablas/.test(d.line)));
  assert.match(soul.proposal, /tablas/);
  assert.doesNotMatch(soul.current, /tablas/);
  const before = readSoul("nora", { bot: store.get("bots", "nora") });
  assert.doesNotMatch(before, /tablas/);
  runtime.approve(soul.id, "approved");
  assert.match(readSoul("nora"), /tablas/);
  assert.ok(store.list("messages").some((x) => x.missionId === m.id && /SOUL de Nora/.test(x.text)));
});

test("failed reflection does not discard the completed result", async (t) => {
  const { store, runtime } = await fixture(t, worker(5, () => { throw Error("provider unavailable"); }));
  store.patch("settings", "main", { learning: true });
  const m = runtime.create({ prompt: "test" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.equal(store.get("missions", m.id).learningStatus, "failed");
});

test("learning=false disables reflection and suggestions", async (t) => {
  let reflected = 0;
  const { store, runtime } = await fixture(t, worker(6, () => { reflected++; return reflection(); }));
  const m = runtime.create({ prompt: "x" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).learningStatus, "disabled");
  assert.equal(reflected, 0);
  assert.equal(suggestAlwaysApprove(store).length, 0);
});

test("automation suggestion after 3 similar prompts on the same weekday and hour", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  store.patch("settings", "main", { learning: true });
  const mondays = ["2026-09-28T09:05:00", "2026-10-05T08:40:00", "2026-10-12T10:10:00"].map((d) => new Date(d).toISOString());
  const prompts = ["Resumen semanal de ventas del equipo", "Resumen semanal de ventas", "Prepara el resumen semanal de ventas del equipo"];
  mondays.forEach((createdAt, i) =>
    store.put("missions", { id: "m" + i, title: "Resumen semanal", prompt: prompts[i], mode: "solo", botIds: ["tomas"], status: "completed", createdAt }));
  const s = suggestAutomation(store, store.get("missions", "m2"));
  assert.equal(s.kind, "automation");
  assert.match(s.text, /^Atlas ha notado que cada lunes pides «/);
  assert.equal(s.cta, "Sí, cada lunes a las 9:00");
  assert.deepEqual(s.payload.trigger, { type: "semana", config: { dia: "lunes", hora: "09:00" }, sentence: "Cada lunes a las 9:00" });
  assert.equal(s.payload.botId, "tomas");
  assert.equal(suggestAutomation(store, store.get("missions", "m2")), null, "no duplicates");
  decideSuggestion(store, s.id, "dismiss");
  assert.equal(suggestAutomation(store, store.get("missions", "m2")), null, "dismissed stays dismissed");
  // Different weekday: no suggestion.
  store.put("missions", { id: "x", title: "Otro", prompt: "Resumen semanal de ventas", mode: "solo", botIds: ["vera"], status: "completed", createdAt: new Date("2026-10-14T09:00:00").toISOString() });
  assert.equal(suggestAutomation(store, store.get("missions", "x")), null);
});

test("always-approve suggestion after 4 unchanged approvals; accepting creates the grant", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  store.patch("settings", "main", { learning: true });
  for (let i = 0; i < 4; i++)
    store.put("approvals", { id: "a" + i, missionId: "m", botId: "vera", tool: "write_file", kind: "write", scope: "mision", canAlways: true, status: "executed", decidedBy: "tú" });
  const [s] = suggestAlwaysApprove(store);
  assert.equal(s.kind, "always-approve");
  assert.deepEqual(s.payload, { grant: { botId: "vera", tool: "write_file", kind: "write", scope: "mision" } });
  assert.equal(suggestAlwaysApprove(store).length, 0);
  const { grant } = decideSuggestion(store, s.id, "accept");
  assert.equal(grant.tool, "write_file");
  assert.throws(() => decideSuggestion(store, s.id, "accept"));
});

test("helpers: similarity and secret detection", () => {
  assert.ok(jaccard("Resumen semanal de ventas", "resumen  semanal ventas!") >= 0.5);
  assert.ok(jaccard("Diseña un logo", "Resumen de ventas") < 0.5);
  for (const s of ["mi clave: hunter2", "IBAN ES9121000418450200051332", "sk-abcdefghijklmnopqrstuv", "llama al 612 345 678", "x@y.com"])
    assert.ok(containsSecret(s), s);
  assert.ok(!containsSecret("Prefiere informes breves los lunes"));
});

test("suggestions are produced from a real mission run", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  store.patch("settings", "main", { learning: true });
  const base = new Date("2026-10-12T09:00:00");
  for (let w = 0; w < 3; w++) {
    const m = runtime.create({ prompt: "Resumen semanal de incidencias", botIds: ["vera"] });
    store.patch("missions", m.id, { createdAt: new Date(base.getTime() - w * 7 * 86400000).toISOString() });
    await runtime.launch(m.id);
  }
  await settle(runtime);
  assert.equal(store.list("suggestions").filter((s) => s.kind === "automation").length, 1);
});
