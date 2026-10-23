import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { importSkill, activateSkill, resolveSkillApproval } from "../server/skills.mjs";
import { learnFromMission, isForgotten, proposeSoulChange, environmentFailure } from "../server/learning.mjs";
import { undoLearned } from "../server/learned.mjs";

const SKILL = "---\nname: informe-ventas\ndescription: Úsala cuando haya que preparar el informe de ventas\n---\n## Pasos\n1. Lee los datos.\n2. Redacta.\n## Comprobacion\nCifras cuadran.\n";
const EMPTY = { memory: [], skill: { action: "none", skillId: null, edits: [], name: "", description: "", content: "" }, soul: null };

/** Records every reflection payload; answers with `reflect(payload)`. */
async function setup(t, reflect = () => EMPTY) {
  const seen = [];
  const env = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Extrae")) {
      const payload = JSON.parse(request.input[0].content);
      seen.push(payload);
      return answer(JSON.stringify(reflect(payload)));
    }
    return answer("ok");
  });
  env.store.patch("settings", "main", { learning: true });
  const learn = (missionId) => learnFromMission({ store: env.store, missionId, model: "fixture", infer: (p, m) => env.runtime.infer(p, m) });
  return { ...env, seen, learn };
}

let n = 0;
function mission(store, { status = "blocked", error = null, prompt = "Prepara el informe de ventas", say = [], skillId = null, limited = null } = {}) {
  const id = "f" + ++n;
  const at = new Date().toISOString();
  store.put("missions", { id, title: "Informe " + n, prompt, mode: "solo", botIds: ["nora"], status, error, limited, createdAt: at });
  [prompt, ...say].forEach((text, i) => store.put("messages", { id: id + ":u" + i, missionId: id, role: "user", text, at }));
  const history = skillId ? [{ type: "function_call", name: "read_skill", arguments: JSON.stringify({ id: skillId }), call_id: "c1" }] : [];
  store.put("steps", { id: id + ":s", missionId: id, botId: "nora", status: "failed", history });
  return id;
}

test("a failed mission is reviewed for its method; environment failures and limits are not lessons", async (t) => {
  let skillId;
  const { store, seen, learn } = await setup(t, () => ({
    ...EMPTY, skill: { action: "patch", skillId, edits: [{ old: "2. Redacta.", new: "2. Comprueba que los totales cuadran antes de redactar." }], name: "", description: "", content: "" },
  }));
  skillId = activateSkill(store, importSkill(store, { content: SKILL, botId: "nora" }).id, "active").id;
  const failed = mission(store, { error: "Los totales no cuadraban con la hoja", say: ["No, los totales están mal"], skillId });
  const out = await learn(failed);
  assert.equal(out.status, "completed");
  assert.equal(seen.length > 0, true);
  assert.equal(seen[0].desenlace, "fallida");
  assert.equal(seen[0].motivoDelFallo, "Los totales no cuadraban con la hoja");
  assert.equal(seen[0].puedeCrearHabilidad, false, "nothing new is created from a failure");
  assert.match(out.reasons.join(" "), /la tarea falló/);
  assert.ok(store.list("skills").some((s) => s.previous === skillId && /totales cuadran antes/.test(s.content)), "the loaded skill is patched");

  const before = seen.length;
  assert.equal((await learn(mission(store, { error: "Conecta tu cuenta de Gmail en Ajustes", say: ["No, así no"] }))).reasons[0], "fallo del entorno");
  assert.equal((await learn(mission(store, { status: "paused", error: "Límite", limited: { engine: "chatgpt" } }))).status, "skipped");
  assert.equal(seen.length, before, "no review for the environment");
  assert.ok(environmentFailure({ error: "fetch failed" }));
  assert.ok(!environmentFailure({ error: "El cálculo del margen salió negativo" }));
});

test("stopped actions with their reason and earlier corrections reach the review", async (t) => {
  const { store, seen, learn } = await setup(t);
  const earlier = mission(store, { status: "completed", prompt: "Resume las ventas", say: ["Mejor en euros, no en dólares"] });
  store.patch("missions", earlier, { createdAt: new Date(Date.now() - 86400000).toISOString() });
  const m = mission(store, { status: "completed", prompt: "Envía el resumen al equipo" });
  store.put("approvals", { id: "ap", missionId: m, botId: "nora", kind: "send", title: "Enviar «Resumen»", status: "denied", decidedBy: "tú", decidedAt: new Date().toISOString(), denyReason: "Al equipo de ventas no, solo a dirección" });
  const out = await learn(m);
  assert.match(out.reasons.join(" "), /paraste una acción/);
  const [payload] = seen;
  assert.deepEqual(payload.rechazos, [{ accion: "Enviar «Resumen»", motivo: "Al equipo de ventas no, solo a dirección" }]);
  assert.deepEqual(payload.correccionesAnteriores, ["Mejor en euros, no en dólares"]);
});

test("cancelling a mission reviews it too, in the background", async (t) => {
  const { store, runtime, seen } = await setup(t);
  const m = runtime.create({ prompt: "Prepara el informe de ventas", mode: "solo", botIds: ["nora"] });
  store.put("messages", { id: "later", missionId: m.id, role: "user", text: "No, así no: sin gráficos", at: new Date().toISOString() });
  runtime.stop(m.id, true);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).learningStatus, "completed");
  assert.equal(seen[0].desenlace, "cancelada");
  assert.deepEqual(seen[0].correccionesDeLaPersona, ["No, así no: sin gráficos"]);
});

test("what is undone or rejected leaves a forget hash and is never proposed again", async (t) => {
  const { store, runtime, learn } = await setup(t, () => ({ ...EMPTY, memory: [{ action: "add", target: "persona", text: "Prefiere el informe de ventas en PDF", old: "" }] }));
  // A memory undone from its «Aprendido» notice.
  store.put("memories", { id: "mem", text: "Prefiere el informe de ventas en PDF", botId: "nora", target: "user", source: "dedujo", active: true });
  store.put("messages", { id: "note:m", missionId: "x", botId: "nora", role: "system", kind: "learned", text: "Aprendido", learned: { type: "memory", changes: [{ action: "add", id: "mem", text: "Prefiere el informe de ventas en PDF" }] } });
  undoLearned(store, "note:m");
  assert.ok(isForgotten(store, "memory", "prefiere el informe de ventas en pdf"));
  const out = await learn(mission(store, { status: "completed", say: ["No, lo quiero en PDF"] }));
  assert.equal(out.memories.length, 0);
  assert.match(out.notes.join(" "), /lo olvidaste antes/);

  // A learned skill you discard in the Bandeja.
  const skill = importSkill(store, { content: SKILL, botId: "nora", origin: "learned" });
  store.put("approvals", { id: "skill:" + skill.id, kind: "skill", skillId: skill.id, botId: "nora", status: "pending" });
  activateSkill(store, skill.id, "disabled");
  resolveSkillApproval(store, skill.id, "disabled");
  assert.ok(isForgotten(store, "skill", "informe-ventas", "nora"));

  // A SOUL change you turn down.
  const bot = store.get("bots", "nora");
  const a = proposeSoulChange(store, { bot, missionId: null, proposal: "Usa siempre tablas para las cifras.", reason: "Lo pidió" });
  runtime.approve(a.id, "denied");
  assert.ok(isForgotten(store, "soul", "Usa siempre tablas para las cifras.", "nora"));
  assert.equal(proposeSoulChange(store, { bot, missionId: null, proposal: "Usa siempre tablas para las cifras.", reason: "Otra vez" }), null);
  assert.equal(proposeSoulChange(store, { bot, missionId: null, proposal: "Usa siempre tablas para todas las cifras.", reason: "Casi igual" }), null, "nor one that says almost the same");
});
